// src/services/messageQueue.js
const Queue = require('bull');
const redisClient = require('../config/redis');
const { getIO } = require('../socket/socket');

class MessageQueue {
  constructor() {
    // Create Bull queue for message processing
    this.messageQueue = new Queue('chat-messages', {
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: 500 // Keep last 500 failed jobs
      }
    });

    // Create queue for offline messages
    this.offlineQueue = new Queue('offline-messages', {
      redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      },
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'fixed',
          delay: 5000
        }
      }
    });

    // Processors
    this.setupProcessors();
    
    // Event listeners
    this.setupEventListeners();
  }

  setupProcessors() {
    // Process chat messages
    this.messageQueue.process('send-message', async (job) => {
      const { chatId, message, sender, recipientId } = job.data;
      
      try {
        const io = getIO();
        if (io) {
          // Try to deliver via socket
          io.to(`chat_${chatId}`).emit('chat:message', {
            chatId,
            message,
            sender
          });
          
          // Store delivery receipt
          await redisClient.set(
            `delivery:${chatId}:${message._id}`,
            JSON.stringify({
              delivered: true,
              timestamp: new Date().toISOString()
            }),
            86400 // 24 hours TTL
          );
          
          return { success: true, deliveredViaSocket: true };
        }
        
        // If socket not available, move to offline queue
        await this.enqueueOfflineMessage(recipientId, {
          chatId,
          message,
          sender
        });
        
        return { success: true, queuedOffline: true };
        
      } catch (error) {
        console.error('Message processing error:', error);
        throw error;
      }
    });

    // Process offline messages
    this.offlineQueue.process('deliver-offline', async (job) => {
      const { userId, messages } = job.data;
      
      try {
        const io = getIO();
        if (io) {
          // Check if user is online
          const isOnline = await redisClient.isUserOnline(userId);
          
          if (isOnline) {
            // Get user's socket session
            const session = await redisClient.getUserSession(userId);
            
            if (session && session.socketId) {
              // Deliver all queued messages
              for (const msg of messages) {
                io.to(session.socketId).emit('chat:message', {
                  chatId: msg.chatId,
                  message: msg.message,
                  sender: msg.sender,
                  wasOffline: true
                });
              }
              
              // Clear offline messages
              await redisClient.del(`offline:${userId}`);
              
              return { 
                success: true, 
                delivered: messages.length,
                userId 
              };
            }
          }
          
          // If still offline, requeue with delay
          throw new Error('User still offline');
        }
        
        return { success: false, error: 'Socket.IO not available' };
        
      } catch (error) {
        console.error('Offline message delivery error:', error);
        throw error;
      }
    });
  }

  setupEventListeners() {
    // Message queue events
    this.messageQueue.on('completed', (job, result) => {
      console.log(`Message ${job.id} completed:`, result);
    });

    this.messageQueue.on('failed', (job, error) => {
      console.error(`Message ${job.id} failed:`, error.message);
      
      // Move to dead letter queue after too many failures
      if (job.attemptsMade >= job.opts.attempts) {
        console.log(`Moving message ${job.id} to dead letter queue`);
        // Could store in Redis for manual review
      }
    });

    // Offline queue events
    this.offlineQueue.on('completed', (job, result) => {
      console.log(`Offline messages delivered to user ${result.userId}: ${result.delivered} messages`);
    });
  }

  async enqueueMessage(messageData) {
    try {
      const job = await this.messageQueue.add('send-message', messageData, {
        jobId: `msg:${messageData.chatId}:${Date.now()}:${messageData.sender.id}`,
        priority: messageData.priority || 1,
        timeout: 10000 // 10 second timeout
      });
      
      console.log(`Message enqueued with ID: ${job.id}`);
      return { success: true, jobId: job.id };
      
    } catch (error) {
      console.error('Error enqueuing message:', error);
      return { success: false, error: error.message };
    }
  }

  async enqueueOfflineMessage(userId, messageData) {
    try {
      // Store offline message in Redis sorted set by timestamp
      await redisClient.zadd(
        `offline:${userId}`,
        Date.now(),
        JSON.stringify(messageData)
      );
      
      // Set TTL for offline messages (7 days)
      await redisClient.expire(`offline:${userId}`, 604800);
      
      console.log(`Message queued offline for user ${userId}`);
      return { success: true };
      
    } catch (error) {
      console.error('Error enqueuing offline message:', error);
      return { success: false, error: error.message };
    }
  }

  async getOfflineMessages(userId) {
    try {
      const messages = await redisClient.zrange(`offline:${userId}`, 0, -1);
      return messages.map(msg => JSON.parse(msg));
    } catch (error) {
      console.error('Error getting offline messages:', error);
      return [];
    }
  }

  async deliverOfflineMessages(userId) {
    try {
      const messages = await this.getOfflineMessages(userId);
      
      if (messages.length === 0) {
        return { delivered: 0, failed: 0 };
      }
      
      const job = await this.offlineQueue.add('deliver-offline', {
        userId,
        messages
      }, {
        jobId: `offline:${userId}:${Date.now()}`,
        attempts: 1 // Don't retry offline delivery automatically
      });
      
      return { 
        delivered: messages.length, 
        failed: 0,
        jobId: job.id 
      };
      
    } catch (error) {
      console.error('Error delivering offline messages:', error);
      return { delivered: 0, failed: messages?.length || 0, error: error.message };
    }
  }

  async getQueueStats() {
    try {
      const messageStats = await this.messageQueue.getJobCounts();
      const offlineStats = await this.offlineQueue.getJobCounts();
      
      return {
        messageQueue: {
          ...messageStats,
          name: 'chat-messages'
        },
        offlineQueue: {
          ...offlineStats,
          name: 'offline-messages'
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting queue stats:', error);
      return {
        messageQueue: { error: error.message },
        offlineQueue: { error: error.message },
        timestamp: new Date().toISOString()
      };
    }
  }

  async cleanupOldJobs() {
    try {
      // Clean completed jobs older than 7 days
      await this.messageQueue.clean(604800000, 'completed');
      await this.offlineQueue.clean(604800000, 'completed');
      
      // Clean failed jobs older than 30 days
      await this.messageQueue.clean(2592000000, 'failed');
      await this.offlineQueue.clean(2592000000, 'failed');
      
      console.log('Old jobs cleaned up');
    } catch (error) {
      console.error('Error cleaning up old jobs:', error);
    }
  }
}

// Create singleton
const messageQueue = new MessageQueue();

// Export for use in other files
module.exports = { messageQueue };