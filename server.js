const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for dev
    methods: ["GET", "POST"]
  }
});

app.use(express.static('public'));

let initiatorSocket = null;

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  socket.on('initiate', () => {
    console.log('📱 Phone ready to stream');
    initiatorSocket = socket;
    socket.emit('ready');
  });

  socket.on('join', () => {
    if (!initiatorSocket) {
      socket.emit('error', 'No phone sender available');
      return;
    }
    console.log('💻 Monitor requesting stream');
    initiatorSocket.emit('startCall', { monitorId: socket.id });
  });

  socket.on('signal', (data) => {
    if (data.to === 'initiator') {
      initiatorSocket?.emit('signal', data);
    } else {
      const target = io.sockets.sockets.get(data.to);
      target?.emit('signal', data);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket === initiatorSocket) {
      initiatorSocket = null;
      io.emit('phoneDisconnected');
    }
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Phone: http://<your-local-ip>:${PORT}/phone.html`);
  console.log(`💻 Monitor: http://<your-local-ip>:${PORT}/monitor.html`);
});