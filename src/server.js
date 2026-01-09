// src/server.js
require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const redisClient = require('./config/redis');
const socket = require('./socket/socket');
const { messageQueue } = require('./services/messageQueue');

// Import your app from app.js
const app = require('./app');  // 👈 ADD THIS

const server = http.createServer(app);

// Initialize Redis
redisClient.connect().catch(err => {
  console.warn('Redis connection failed:', err.message);
});

// Initialize Socket.IO
socket.initializeSocket(server);

// Database connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/farm-connect', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, starting graceful shutdown...');
  
  try {
    await messageQueue.messageQueue?.close();
    await messageQueue.offlineQueue?.close();
    await redisClient.disconnect();
    await mongoose.connection.close();
    console.log('All connections closed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Client URL: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
  console.log(`Redis URL: ${process.env.REDIS_URL ? 'Set' : 'Not set'}`);
});