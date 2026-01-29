const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);


const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.use(express.static(__dirname));


const USERS_DB = {
  "Vinden4554": { name: "Matteus Aydin", id: "Vinden4554" },
  "6767": { name: "Andrej Petrov", id: "6767" },
  "1234": { name: "Felix Nydén Leander", id: "1234" }
};


let DATA = {

  chats: [
    { id: 'general', name: 'General Class', type: 'group', members: ['Vinden4554', '6767', '1234'] }
  ],
  messages: {} 
};


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


  socket.on('login', (code) => {
    if (USERS_DB[code]) {
      currentUser = USERS_DB[code];
      socket.join(currentUser.id);
      socket.emit('login_success', currentUser);
      
    
      socket.emit('user_list', Object.values(USERS_DB));
      
    
      socket.emit('update_chats', DATA.chats);
    } else {
      socket.emit('login_fail');
    }
  });


  socket.on('get_messages', (chatId) => {
    if (!currentUser) return;
    const history = DATA.messages[chatId] || [];
    socket.emit('history_data', { chatId, messages: history });
  });


socket.on('send_msg', (payload) => {
    if (!currentUser) return;
    
    const { chatId, text, file } = payload;
    const msg = {
      id: Date.now().toString(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text: text,
      file: file || null,
      timestamp: new Date().toISOString()
    };

    if (!DATA.messages[chatId]) DATA.messages[chatId] = [];
    DATA.messages[chatId].push(msg);
    saveData();

    io.emit('new_msg', { chatId, message: msg });
  });

 
  socket.on('create_chat', ({ name, type, members }) => {
    if (!currentUser) return;
    
 
    if(!members.includes(currentUser.id)) members.push(currentUser.id);


    if (type === 'dm' && members.length === 2) {
      const existingDM = DATA.chats.find(c => 
        c.type === 'dm' && 
        c.members.length === 2 &&
        c.members.includes(members[0]) && 
        c.members.includes(members[1])
      );
      
      if (existingDM) {
        socket.emit('chat_exists', existingDM.id);
        return;
      }
    }

    const newChat = {
      id: 'c_' + Date.now(),
      name: name,
      type: type, 
      members: members,
      createdBy: currentUser.id
    };

    DATA.chats.push(newChat);
    saveData();
    io.emit('update_chats', DATA.chats);
  });


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


  socket.on('edit_msg', ({ chatId, messageId, newText }) => {
    if (!currentUser) return;
    
    const messages = DATA.messages[chatId];
    if (!messages) return;
    
    const msg = messages.find(m => m.id === messageId);
    if (msg && msg.senderId === currentUser.id) {
      msg.text = newText;
      msg.edited = true;
      saveData();
      io.emit('msg_edited', { chatId, messageId, newText });
    }
  });


  socket.on('delete_msg', ({ chatId, messageId }) => {
    if (!currentUser) return;
    
    const messages = DATA.messages[chatId];
    if (!messages) return;
    
    const msgIndex = messages.findIndex(m => m.id === messageId);
    if (msgIndex !== -1 && messages[msgIndex].senderId === currentUser.id) {
      messages.splice(msgIndex, 1);
      saveData();
      io.emit('msg_deleted', { chatId, messageId });
    }
  });
});
    


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


