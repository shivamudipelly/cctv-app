const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static('public'));

// Store active rooms
const rooms = new Map();

// Generate unique 6-digit code
function generateRoomCode() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return rooms.has(code) ? generateRoomCode() : code;
}

// Cleanup old rooms (older than 1 hour)
function cleanupOldRooms() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.created > oneHour) {
      // Notify monitors
      io.to(roomCode).emit('phone-disconnected');
      rooms.delete(roomCode);
      console.log(`🗑️ Cleaned up old room: ${roomCode}`);
    }
  }
}

// Run cleanup every 30 minutes
setInterval(cleanupOldRooms, 30 * 60 * 1000);

io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);

  // Phone creates a new room
  socket.on('create-room', () => {
    const roomCode = generateRoomCode();
    rooms.set(roomCode, {
      phoneSocket: socket.id,
      monitors: new Map(),
      created: Date.now()
    });

    socket.join(roomCode);
    socket.emit('room-created', { roomCode });
    console.log(`📱 Room created: ${roomCode} by ${socket.id}`);
  });

  // Monitor joins a room
  socket.on('join-room', (roomCode) => {
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }

    // Check if phone is still connected
    if (!room.phoneSocket) {
      socket.emit('error', 'Streamer disconnected');
      return;
    }

    room.monitors.set(socket.id, {
      joinedAt: Date.now(),
      id: socket.id
    });

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode });

    // Notify phone about new monitor
    socket.to(room.phoneSocket).emit('monitor-joined', {
      monitorId: socket.id,
      roomCode,
      totalViewers: room.monitors.size
    });

    console.log(`💻 Monitor ${socket.id} joined room: ${roomCode} (Total: ${room.monitors.size})`);
  });

  // WebRTC signaling
  socket.on('signal', (data) => {
    const { roomCode, target, signal } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      console.log(`Signal error: Room ${roomCode} not found`);
      return;
    }

    if (target === 'phone' && room.phoneSocket) {
      socket.to(room.phoneSocket).emit('signal', {
        from: socket.id,
        signal
      });
    } else if (room.monitors.has(target)) {
      socket.to(target).emit('signal', {
        from: socket.id,
        signal
      });
    } else {
      console.log(`Signal target not found: ${target} in room ${roomCode}`);
    }
  });

  // Handle monitor leaving room
  socket.on('leave-room', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);

    if (room && room.monitors.has(socket.id)) {
      room.monitors.delete(socket.id);

      // Notify phone about monitor leaving
      if (room.phoneSocket) {
        socket.to(room.phoneSocket).emit('monitor-left', {
          monitorId: socket.id,
          totalViewers: room.monitors.size
        });
      }

      console.log(`💻 Monitor ${socket.id} left room: ${roomCode} (Remaining: ${room.monitors.size})`);
    }
  });

  // Handle disconnections
  socket.on('disconnect', (reason) => {
    console.log('🔌 Client disconnected:', socket.id, 'Reason:', reason);

    // Clean up rooms
    for (const [roomCode, room] of rooms.entries()) {
      if (room.phoneSocket === socket.id) {
        // Phone disconnected - notify all monitors and delete room
        io.to(roomCode).emit('phone-disconnected');
        rooms.delete(roomCode);
        console.log(`🗑️ Room ${roomCode} deleted (phone disconnected)`);
        break;
      }

      if (room.monitors.has(socket.id)) {
        // Monitor disconnected
        room.monitors.delete(socket.id);

        // Notify phone about monitor leaving
        if (room.phoneSocket) {
          socket.to(room.phoneSocket).emit('monitor-left', {
            monitorId: socket.id,
            totalViewers: room.monitors.size
          });
        }

        console.log(`💻 Monitor ${socket.id} left room: ${roomCode} (Remaining: ${room.monitors.size})`);

        // Delete room if no monitors left (after delay)
        if (room.monitors.size === 0) {
          setTimeout(() => {
            const currentRoom = rooms.get(roomCode);
            if (currentRoom && currentRoom.monitors.size === 0) {
              rooms.delete(roomCode);
              console.log(`🗑️ Room ${roomCode} deleted (no monitors)`);
            }
          }, 30000); // 30 second grace period
        }
        break;
      }
    }
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

app.get('/view', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

app.get('/view.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📱 Streamer: http://localhost:${PORT}`);
  console.log(`👁️ Viewer: http://localhost:${PORT}/view.html`);
});