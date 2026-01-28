// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// IMPORTANT FOR RENDER: Use the system port or 3000
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname));

// Known Users
const USERS_DB = {
  "Vinden4554": { name: "Matteus Aydin", id: "Vinden4554" },
  "6767": { name: "Andrej Petrov", id: "6767" },
  "1234": { name: "Felix Nydén Leander", id: "1234" }
};

// Default Data
let DATA = {
  // Pre-make a General group
  chats: [
    { id: 'general', name: 'General Class', type: 'group', members: ['Vinden4554', '6767', '1234'] }
  ],
  messages: {} 
};

// Load Saved Data
if (fs.existsSync('chat-data.json')) {
  try {
    const raw = fs.readFileSync('chat-data.json');
    const saved = JSON.parse(raw);
    DATA.chats = saved.chats || DATA.chats;
    DATA.messages = saved.messages || DATA.messages;
  } catch(e) { console.log("No save found, starting fresh."); }
}

function saveData() {
  fs.writeFileSync('chat-data.json', JSON.stringify(DATA));
}

io.on('connection', (socket) => {
  let currentUser = null;

  // 1. Login
  socket.on('login', (code) => {
    if (USERS_DB[code]) {
      currentUser = USERS_DB[code];
      socket.join(currentUser.id); // Join their private room
      socket.emit('login_success', currentUser);
      
      // Send the list of all available users (for creating new chats)
      socket.emit('user_list', Object.values(USERS_DB));
      
      // Send existing chats
      socket.emit('update_chats', DATA.chats);
    } else {
      socket.emit('login_fail');
    }
  });

  // 2. Get Messages
  socket.on('get_messages', (chatId) => {
    if (!currentUser) return;
    const history = DATA.messages[chatId] || [];
    socket.emit('history_data', { chatId, messages: history });
  });

  // 3. Send Message
  socket.on('send_msg', (payload) => {
    if (!currentUser) return;
    
    const { chatId, text } = payload;
    const msg = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: text,
      timestamp: new Date().toISOString()
    };

    if (!DATA.messages[chatId]) DATA.messages[chatId] = [];
    DATA.messages[chatId].push(msg);
    saveData();

    // Broadcast to everyone (simple implementation for this project)
    io.emit('new_msg', { chatId, message: msg });
  });

  // 4. Create Group or DM
  socket.on('create_chat', ({ name, type, members }) => {
    // Ensure current user is in the members
    if(!members.includes(currentUser.id)) members.push(currentUser.id);

    const newChat = {
      id: 'c_' + Date.now(),
      name: name,
      type: type, // 'group' or 'dm'
      members: members
    };

    DATA.chats.push(newChat);
    saveData();
    io.emit('update_chats', DATA.chats);
  });

  // 5. Rename/Delete
  socket.on('rename_chat', ({ chatId, newName }) => {
    const chat = DATA.chats.find(c => c.id === chatId);
    if (chat) {
      chat.name = newName;
      saveData();
      io.emit('update_chats', DATA.chats);
    }
  });

  socket.on('delete_chat', (chatId) => {
    DATA.chats = DATA.chats.filter(c => c.id !== chatId);
    delete DATA.messages[chatId];
    saveData();
    io.emit('update_chats', DATA.chats);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});