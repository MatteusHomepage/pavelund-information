const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const fetch = require('node-fetch');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e8,
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = "mongodb+srv://admin:admin@secretchatcluster.92tgwe3.mongodb.net/chatData?retryWrites=true&w=majority";

const ChatSchema = new mongoose.Schema({ id: String, name: String, type: String, members: [String], createdBy: String });
const MsgSchema = new mongoose.Schema({ chatId: String, id: String, senderId: String, senderName: String, text: String, file: Object, timestamp: Date, edited: Boolean, deleted: Boolean, isPlaceholder: Boolean });
const ScheduledSchema = new mongoose.Schema({ chatId: String, text: String, senderId: String, senderName: String, sendAt: Date });

const Chat = mongoose.model('Chat', ChatSchema);
const Message = mongoose.model('Message', MsgSchema);
const Scheduled = mongoose.model('Scheduled', ScheduledSchema);

mongoose.connect(MONGO_URI).then(async () => {
    console.log("DB Connected");
    try {
        const general = await Chat.findOne({ id: 'general' });
        if (!general) {
            await new Chat({ id: 'general', name: 'General Class', type: 'group', members: ["Vinden4554", "6721", "6711"], createdBy: 'system' }).save();
        }
    } catch (e) {}
}).catch(e => { console.log(e); process.exit(1); });

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.use(express.static(__dirname));

const USERS_DB = { "Vinden4554": { name: "Matteus Aydin", id: "Vinden4554" }, "6721": { name: "Andrej Petrov", id: "6721" }, "6711": { name: "Felix Nydén Leander", id: "6711" } };

const broadcastChatUpdate = async (chat) => {
    const allChats = await Chat.find();
    chat.members.forEach(mId => io.to(mId).emit('update_chats', allChats));
};

setInterval(async () => {
    try {
        const now = new Date();
        const due = await Scheduled.find({ sendAt: { $lte: now } });
        for (const s of due) {
            const msgData = { id: 'm' + Date.now() + Math.random().toString(36).substr(2, 5), chatId: s.chatId, senderId: s.senderId, senderName: s.senderName, text: s.text, file: null, timestamp: new Date(), edited: false, deleted: false, isPlaceholder: false };
            const savedMsg = await new Message(msgData).save();
            const chat = await Chat.findOne({ id: s.chatId });
            if (chat) {
                chat.members.forEach(mId => io.to(mId).emit('new_msg', { chatId: s.chatId, message: savedMsg }));
            }
            await Scheduled.deleteOne({ _id: s._id });
        }
    } catch (e) {}
}, 5000);

setInterval(() => {
    const host = process.env.RENDER_EXTERNAL_HOSTNAME;
    if (host) fetch(`https://${host}`).catch(() => {});
}, 300000);

io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('login', async (code) => {
    if (USERS_DB[code]) {
      currentUser = USERS_DB[code];
      socket.join(currentUser.id);
      socket.emit('login_success', currentUser);
      socket.emit('user_list', Object.values(USERS_DB));
      const chats = await Chat.find({ members: currentUser.id });
      socket.emit('update_chats', await Chat.find());
    } else { socket.emit('login_fail'); }
  });

  socket.on('get_messages', async (chatId) => {
    const history = await Message.find({ chatId }).sort({ timestamp: 1 });
    socket.emit('history_data', { chatId, messages: history });
  });

  socket.on('send_msg', async (payload) => {
    if (!currentUser) return;
    const msg = { id: 'm' + Date.now() + Math.random().toString(36).substr(2, 5), chatId: payload.chatId, senderId: currentUser.id, senderName: currentUser.name, text: payload.text || "", file: payload.file || null, timestamp: new Date(), edited: false, deleted: false, isPlaceholder: false };
    const saved = await new Message(msg).save();
    const chat = await Chat.findOne({ id: payload.chatId });
    if (chat) chat.members.forEach(mId => io.to(mId).emit('new_msg', { chatId: payload.chatId, message: saved }));
  });

  socket.on('schedule_msg', async (payload) => {
    if (!currentUser) return;
    const placeholder = { id: 'p' + Date.now(), chatId: payload.chatId, senderId: currentUser.id, senderName: currentUser.name, text: "🕒 Timed message", timestamp: new Date(), isPlaceholder: true };
    const savedPlaceholder = await new Message(placeholder).save();
    const chat = await Chat.findOne({ id: payload.chatId });
    if (chat) chat.members.forEach(mId => io.to(mId).emit('new_msg', { chatId: payload.chatId, message: savedPlaceholder }));
    await new Scheduled({ chatId: payload.chatId, text: payload.text, senderId: currentUser.id, senderName: currentUser.name, sendAt: new Date(Date.now() + payload.delayMs) }).save();
  });

  socket.on('create_chat', async ({ name, type, members }) => {
    if (!currentUser) return;
    if(!members.includes(currentUser.id)) members.push(currentUser.id);
    
    if (type === 'dm') {
        const existing = await Chat.findOne({ type: 'dm', members: { $all: members, $size: 2 } });
        if (existing) return;
    }

    const newChat = new Chat({ id: 'c_' + Date.now(), name, type, members, createdBy: currentUser.id });
    await newChat.save();
    const chats = await Chat.find();
    members.forEach(mId => io.to(mId).emit('update_chats', chats));
  });

  socket.on('rename_chat', async (p) => {
    const chat = await Chat.findOne({ id: p.chatId });
    if (chat) {
        await Chat.updateOne({ id: p.chatId }, { name: p.newName });
        const chats = await Chat.find();
        chat.members.forEach(mId => io.to(mId).emit('update_chats', chats));
    }
  });

  socket.on('delete_chat', async (id) => {
    const chat = await Chat.findOne({ id });
    if (chat) {
        const members = chat.members;
        await Chat.deleteOne({ id });
        await Message.deleteMany({ chatId: id });
        const chats = await Chat.find();
        members.forEach(mId => io.to(mId).emit('update_chats', chats));
    }
  });

  socket.on('edit_msg', async (p) => {
    if (!currentUser) return;
    await Message.updateOne({ id: p.messageId, senderId: currentUser.id }, { text: p.newText, edited: true });
    const chat = await Chat.findOne({ id: p.chatId });
    if (chat) chat.members.forEach(mId => io.to(mId).emit('msg_edited', p));
  });

  socket.on('delete_msg', async (p) => {
    if (!currentUser) return;
    await Message.updateOne({ id: p.messageId, senderId: currentUser.id }, { text: "", file: null, deleted: true });
    const chat = await Chat.findOne({ id: p.chatId });
    if (chat) chat.members.forEach(mId => io.to(mId).emit('msg_deleted', p));
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

