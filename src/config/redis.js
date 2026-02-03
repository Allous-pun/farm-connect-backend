// src/config/redis.js
const redis = require('redis');

class RedisClient {
  constructor() {
    // Get Redis URL from environment (Render provides this)
    const redisUrl = process.env.REDIS_URL;
    
    if (!redisUrl) {
      console.warn('REDIS_URL not set. Redis functionality will be limited.');
      // Create better mock clients for development without Redis
      this.client = this.createMockClient();
      this.pubClient = this.createMockClient();
      this.subClient = this.createMockClient();
      return;
    }

    console.log(`Connecting to Redis: ${redisUrl.replace(/:[^:]*@/, ':****@')}`);
    
    // Create Redis client with Render-compatible settings
    this.client = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Max Redis reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        },
        tls: redisUrl.includes('rediss://') ? {} : undefined // Enable TLS for rediss://
      }
    });

    // Create pub/sub clients for Socket.IO
    this.pubClient = this.client.duplicate();
    this.subClient = this.client.duplicate();

    // Event listeners
    this.client.on('error', (err) => console.error('Redis Client Error:', err));
    this.client.on('connect', () => console.log('Redis connected successfully'));
    this.client.on('ready', () => console.log('Redis ready for commands'));
    this.client.on('reconnecting', () => console.log('Redis reconnecting...'));
    this.client.on('end', () => console.log('Redis connection closed'));
  }

  // Create mock client with Socket.IO compatible methods
  createMockClient() {
    const mockClient = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve('OK'),
      setEx: () => Promise.resolve('OK'),
      del: () => Promise.resolve(0),
      hSet: () => Promise.resolve(0),
      hGet: () => Promise.resolve(null),
      hGetAll: () => Promise.resolve({}),
      expire: () => Promise.resolve(0),
      connect: () => Promise.resolve(),
      quit: () => Promise.resolve(),
      disconnect: () => Promise.resolve(),
      isReady: false,
      on: () => {},
      duplicate: () => this.createMockClient(),
      // Socket.IO Redis adapter methods
      psubscribe: () => Promise.resolve(),
      punsubscribe: () => Promise.resolve(),
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
      sAdd: () => Promise.resolve(0),
      sRem: () => Promise.resolve(0),
      sMembers: () => Promise.resolve([])
    };
    return mockClient;
  }

  async connect() {
    // If mock client, do nothing
    if (!this.client.connect || typeof this.client.connect !== 'function') {
      return Promise.resolve();
    }
    
    try {
      await this.client.connect();
      await this.pubClient.connect();
      await this.subClient.connect();
      console.log('Redis clients connected successfully');
    } catch (error) {
      console.error('Redis connection error:', error);
      // Don't crash the app if Redis fails
      // The app can still work with degraded functionality
    }
  }

  async disconnect() {
    if (!this.client.quit || typeof this.client.quit !== 'function') {
      return Promise.resolve();
    }
    
    try {
      await this.client.quit();
      await this.pubClient.quit();
      await this.subClient.quit();
      console.log('Redis connections closed');
    } catch (error) {
      console.error('Redis disconnect error:', error);
    }
  }

  // Basic methods with fallbacks
  async get(key) {
    if (!this.client.get || typeof this.client.get !== 'function') return null;
    try {
      return await this.client.get(key);
    } catch (error) {
      console.error('Redis get error:', error);
      return null;
    }
  }

  set(key, value, ttl = null) {
    if (!this.client.set || typeof this.client.set !== 'function') return Promise.resolve('OK');
    try {
      if (ttl) {
        return this.client.set(key, value, 'EX', ttl);
      }
      return this.client.set(key, value);
    } catch (error) {
      console.error('Redis set error:', error);
      return Promise.resolve('OK');
    }
  }

  async del(key) {
    if (!this.client.del || typeof this.client.del !== 'function') return 0;
    try {
      return await this.client.del(key);
    } catch (error) {
      console.error('Redis del error:', error);
      return 0;
    }
  }

  async hset(key, field, value) {
    if (!this.client.hSet || typeof this.client.hSet !== 'function') return 0;
    try {
      return await this.client.hSet(key, field, value);
    } catch (error) {
      console.error('Redis hset error:', error);
      return 0;
    }
  }

  async hget(key, field) {
    if (!this.client.hGet || typeof this.client.hGet !== 'function') return null;
    try {
      return await this.client.hGet(key, field);
    } catch (error) {
      console.error('Redis hget error:', error);
      return null;
    }
  }

  async hgetall(key) {
    if (!this.client.hGetAll || typeof this.client.hGetAll !== 'function') return {};
    try {
      return await this.client.hGetAll(key) || {};
    } catch (error) {
      console.error('Redis hgetall error:', error);
      return {};
    }
  }

  async expire(key, seconds) {
    if (!this.client.expire || typeof this.client.expire !== 'function') return 0;
    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      console.error('Redis expire error:', error);
      return 0;
    }
  }

  // User session management with fallback
  async setUserSession(userId, socketId, userData) {
    if (!this.client.hSet || typeof this.client.hSet !== 'function') {
      // Fallback to in-memory storage if Redis not available
      this._userSessions = this._userSessions || {};
      this._userSessions[userId] = {
        socketId,
        lastSeen: new Date().toISOString(),
        userData
      };
      return true;
    }
    
    const key = `user:${userId}:session`;
    await this.hset(key, 'socketId', socketId);
    await this.hset(key, 'lastSeen', new Date().toISOString());
    await this.hset(key, 'userData', JSON.stringify(userData));
    await this.expire(key, 86400);
    return true;
  }

  async getUserSession(userId) {
    if (!this.client.hGet || typeof this.client.hGet !== 'function') {
      // Fallback to in-memory storage
      return this._userSessions?.[userId] || null;
    }
    
    const key = `user:${userId}:session`;
    const session = await this.hgetall(key);
    
    if (!session || !session.socketId) return null;
    
    return {
      socketId: session.socketId,
      lastSeen: session.lastSeen,
      userData: session.userData ? JSON.parse(session.userData) : null
    };
  }
}

// Create singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;