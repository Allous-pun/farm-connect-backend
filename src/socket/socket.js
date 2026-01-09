const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createAdapter } = require('@socket.io/redis-adapter');
const redisClient = require('../config/redis');

let io;

const initializeSocket = (server) => {
  io = socketIO(server, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    connectionStateRecovery: {
      // Enable reconnection with state recovery
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true
    }
  });

  // Enable Redis adapter for horizontal scaling
  io.adapter(createAdapter(redisClient.pubClient, redisClient.subClient));

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error: Token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Authentication error'));
    }
  });

  // Connection handler
  io.on('connection', async (socket) => {
    console.log(`User connected: ${socket.user._id} (${socket.user.name})`);
    
    const userId = socket.user._id.toString();
    
    // Store user session in Redis
    await redisClient.setUserSession(
      userId,
      socket.id,
      {
        name: socket.user.name,
        roles: socket.user.roles,
        profileStatus: socket.user.profileStatus
      }
    );
    
    // Mark user as online
    await redisClient.setUserOnline(userId);
    
    // Deliver any offline messages
    const { messageQueue } = require('../services/messageQueue');
    await messageQueue.deliverOfflineMessages(userId);
    
    // Notify user about their connection
    socket.emit('connected', {
      userId,
      socketId: socket.id,
      message: 'Connected to chat server',
      timestamp: new Date().toISOString()
    });

    // Notify user's contacts about online status
    socket.broadcast.emit('user:online', {
      userId,
      name: socket.user.name,
      timestamp: new Date().toISOString()
    });

    // Basic Chat Event Handlers
    socket.on('chat:join', (chatId) => {
      socket.join(`chat_${chatId}`);
      console.log(`User ${userId} joined chat ${chatId}`);
      
      // Notify other chat participants
      socket.to(`chat_${chatId}`).emit('chat:participant:joined', {
        chatId,
        userId,
        name: socket.user.name,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat_${chatId}`);
      console.log(`User ${userId} left chat ${chatId}`);
      
      // Notify other chat participants
      socket.to(`chat_${chatId}`).emit('chat:participant:left', {
        chatId,
        userId,
        name: socket.user.name,
        timestamp: new Date().toISOString()
      });
    });

    socket.on('chat:typing', (data) => {
      try {
        const { chatId, isTyping } = data;
        
        socket.to(`chat_${chatId}`).emit('chat:typing', {
          chatId,
          userId,
          name: socket.user.name,
          isTyping,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error handling typing indicator:', error);
      }
    });

    socket.on('chat:message:typing', (data) => {
      try {
        const { chatId, text } = data;
        
        // Use message queue for reliable delivery
        const { messageQueue } = require('../services/messageQueue');
        
        messageQueue.enqueueMessage({
          chatId,
          message: {
            _id: `temp_${Date.now()}`,
            text,
            type: 'text',
            sender: socket.user._id,
            createdAt: new Date()
          },
          sender: {
            id: userId,
            name: socket.user.name,
            roles: socket.user.roles,
            profileStatus: socket.user.profileStatus
          },
          recipientId: null // Will be determined by chat participants
        });
        
      } catch (error) {
        console.error('Error handling chat message:', error);
      }
    });

    socket.on('chat:message:read', async (data) => {
      try {
        const { chatId, messageIds } = data;
        
        // Update read status in database
        const Message = require('../models/Message');
        await Promise.all(
          messageIds.map(msgId => 
            Message.findByIdAndUpdate(msgId, {
              $addToSet: { readBy: { user: userId, readAt: new Date() } }
            })
          )
        );
        
        // Notify other participants
        socket.to(`chat_${chatId}`).emit('chat:messages:read', {
          chatId,
          userId,
          messageIds,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        console.error('Error handling message read:', error);
      }
    });

    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${userId} (${socket.user.name})`);
      
      // Mark user as offline
      await redisClient.setUserOffline(userId);
      
      // Remove user session
      await redisClient.removeUserSession(userId);
      
      // Notify contacts about offline status
      socket.broadcast.emit('user:offline', {
        userId,
        name: socket.user.name,
        timestamp: new Date().toISOString()
      });
    });
  });

  console.log('Socket.IO initialized with Redis adapter');
  return io;
};

const getIO = () => io;

const notifyUser = async (userId, event, data) => {
  if (io && userId) {
    try {
      // Get user's socket session from Redis
      const session = await redisClient.getUserSession(userId.toString());
      
      if (session && session.socketId) {
        io.to(session.socketId).emit(event, data);
        return true;
      }
      
      // If user not online, queue the notification
      const { messageQueue } = require('../services/messageQueue');
      await messageQueue.enqueueOfflineMessage(userId, {
        type: 'notification',
        event,
        data,
        timestamp: new Date().toISOString()
      });
      
      return false;
    } catch (error) {
      console.error('Error notifying user:', error);
      return false;
    }
  }
  return false;
};

const isUserOnline = async (userId) => {
  try {
    return await redisClient.isUserOnline(userId.toString());
  } catch (error) {
    console.error('Error checking user online status:', error);
    return false;
  }
};

const getOnlineUsersCount = async () => {
  try {
    const onlineUsers = await redisClient.getOnlineUsers();
    return Object.keys(onlineUsers).length;
  } catch (error) {
    console.error('Error getting online users count:', error);
    return 0;
  }
};

const getUserPresence = async (userId) => {
  try {
    const isOnline = await redisClient.isUserOnline(userId.toString());
    const session = await redisClient.getUserSession(userId.toString());
    
    return {
      userId,
      isOnline,
      lastSeen: session?.lastSeen || new Date().toISOString(),
      socketId: session?.socketId
    };
  } catch (error) {
    console.error('Error getting user presence:', error);
    return {
      userId,
      isOnline: false,
      lastSeen: new Date().toISOString(),
      error: error.message
    };
  }
};

module.exports = {
  initializeSocket,
  getIO,
  notifyUser,
  isUserOnline,
  getOnlineUsersCount,
  getUserPresence
};