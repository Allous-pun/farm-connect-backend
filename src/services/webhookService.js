// src/services/webhookService.js
const axios = require('axios');
const crypto = require('crypto');
const Webhook = require('../models/Webhook');
const User = require('../models/User');
const redisClient = require('../config/redis');

class WebhookService {
  constructor() {
    this.maxRetries = 3;
    this.timeout = 10000; // 10 seconds
    this.retryDelays = [1000, 5000, 15000]; // 1s, 5s, 15s
    this.queueKey = 'webhook:queue';
    this.deadLetterKey = 'webhook:dead-letter';
  }

  /**
   * Register a new webhook for a user
   */
  async registerWebhook(userId, webhookData) {
    try {
      const { url, events, secret, name, enabled = true } = webhookData;
      
      // Validate URL
      this.validateWebhookUrl(url);
      
      // Generate webhook ID and secret if not provided
      const webhookId = crypto.randomUUID();
      const webhookSecret = secret || this.generateSecret();
      
      const webhook = new Webhook({
        userId,
        webhookId,
        url,
        events: Array.isArray(events) ? events : [events],
        secret: webhookSecret,
        name: name || `Webhook ${Date.now()}`,
        enabled,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await webhook.save();
      
      // Invalidate cache
      await this.invalidateUserWebhooksCache(userId);
      
      return {
        success: true,
        data: {
          id: webhook._id,
          webhookId,
          url,
          events: webhook.events,
          name: webhook.name,
          enabled: webhook.enabled,
          createdAt: webhook.createdAt
        },
        // Only return secret on creation
        secret: webhookSecret
      };
    } catch (error) {
      console.error('Error registering webhook:', error);
      throw error;
    }
  }

  /**
   * Update an existing webhook
   */
  async updateWebhook(webhookId, userId, updateData) {
    try {
      const webhook = await Webhook.findOne({
        _id: webhookId,
        userId
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      // Update fields
      if (updateData.url !== undefined) {
        this.validateWebhookUrl(updateData.url);
        webhook.url = updateData.url;
      }
      
      if (updateData.events !== undefined) {
        webhook.events = Array.isArray(updateData.events) ? updateData.events : [updateData.events];
      }
      
      if (updateData.name !== undefined) {
        webhook.name = updateData.name;
      }
      
      if (updateData.enabled !== undefined) {
        webhook.enabled = updateData.enabled;
      }
      
      if (updateData.rotateSecret === true) {
        webhook.secret = this.generateSecret();
        webhook.secretRotatedAt = new Date();
      }
      
      webhook.updatedAt = new Date();
      
      await webhook.save();
      
      // Invalidate cache
      await this.invalidateUserWebhooksCache(userId);
      
      return {
        success: true,
        data: webhook,
        ...(updateData.rotateSecret ? { newSecret: webhook.secret } : {})
      };
    } catch (error) {
      console.error('Error updating webhook:', error);
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId, userId) {
    try {
      const result = await Webhook.findOneAndDelete({
        _id: webhookId,
        userId
      });

      if (!result) {
        throw new Error('Webhook not found');
      }
      
      // Invalidate cache
      await this.invalidateUserWebhooksCache(userId);
      
      return { success: true, message: 'Webhook deleted successfully' };
    } catch (error) {
      console.error('Error deleting webhook:', error);
      throw error;
    }
  }

  /**
   * Get user's webhooks
   */
  async getUserWebhooks(userId) {
    try {
      // Try to get from cache first
      const cacheKey = `user:${userId}:webhooks`;
      const cached = await redisClient.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const webhooks = await Webhook.find({ userId }).sort({ createdAt: -1 });
      
      // Cache for 5 minutes
      await redisClient.set(cacheKey, JSON.stringify(webhooks), 300);
      
      return webhooks;
    } catch (error) {
      console.error('Error getting user webhooks:', error);
      throw error;
    }
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId, userId) {
    try {
      const webhook = await Webhook.findOne({
        _id: webhookId,
        userId
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }
      
      return webhook;
    } catch (error) {
      console.error('Error getting webhook:', error);
      throw error;
    }
  }

  /**
   * Trigger webhook event - Main method
   */
  async triggerWebhook(eventType, data, userId = null) {
    try {
      // Get all webhooks that should receive this event
      const webhooks = await this.getWebhooksForEvent(eventType, userId);
      
      if (webhooks.length === 0) {
        console.log(`[Webhook] No webhooks registered for event: ${eventType}`);
        return { success: true, triggered: 0, event: eventType };
      }
      
      const results = [];
      
      for (const webhook of webhooks) {
        if (!webhook.enabled) {
          results.push({
            webhookId: webhook._id,
            url: webhook.url,
            success: false,
            error: 'Webhook disabled',
            skipped: true
          });
          continue;
        }
        
        const result = await this.sendWebhook(webhook, eventType, data);
        results.push(result);
        
        // Update webhook stats
        await this.updateWebhookStats(webhook._id, result.success);
      }
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success && !r.skipped).length;
      
      console.log(`[Webhook] Event ${eventType}: ${successful} successful, ${failed} failed`);
      
      return {
        success: failed === 0,
        event: eventType,
        triggered: successful,
        failed,
        results
      };
    } catch (error) {
      console.error('Error triggering webhook event:', error);
      throw error;
    }
  }

  /**
   * Send webhook to a specific endpoint
   */
  async sendWebhook(webhook, eventType, data) {
    const startTime = Date.now();
    const payload = {
      event: eventType,
      data,
      timestamp: new Date().toISOString(),
      webhookId: webhook.webhookId
    };
    
    // Generate signature
    const signature = this.generateSignature(payload, webhook.secret);
    
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'FarmConnect-Webhook/1.0',
      'X-Webhook-Id': webhook.webhookId,
      'X-Webhook-Event': eventType,
      'X-Webhook-Timestamp': payload.timestamp,
      'X-Webhook-Signature': signature,
      'X-Webhook-Attempt': '1'
    };
    
    let attempt = 1;
    let lastError = null;
    
    // Retry logic
    while (attempt <= this.maxRetries) {
      try {
        const response = await axios.post(webhook.url, payload, {
          headers,
          timeout: this.timeout,
          validateStatus: (status) => status >= 200 && status < 300
        });
        
        const duration = Date.now() - startTime;
        
        console.log(`[Webhook] Success: ${webhook.url} - ${response.status} (${duration}ms)`);
        
        return {
          webhookId: webhook._id,
          url: webhook.url,
          success: true,
          statusCode: response.status,
          duration,
          attempts: attempt,
          response: response.data
        };
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        
        console.warn(`[Webhook] Attempt ${attempt} failed for ${webhook.url}:`, error.message);
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelays[attempt - 1];
          await new Promise(resolve => setTimeout(resolve, delay));
          attempt++;
          
          // Update attempt header for retry
          headers['X-Webhook-Attempt'] = String(attempt);
        } else {
          // Max retries reached, add to dead letter queue
          await this.addToDeadLetterQueue(webhook, eventType, payload, error);
          
          return {
            webhookId: webhook._id,
            url: webhook.url,
            success: false,
            error: error.message,
            statusCode: error.response?.status,
            duration,
            attempts: attempt,
            retried: true,
            deadLettered: true
          };
        }
      }
    }
    
    // This shouldn't be reached, but just in case
    return {
      webhookId: webhook._id,
      url: webhook.url,
      success: false,
      error: lastError?.message || 'Unknown error',
      attempts: attempt
    };
  }

  /**
   * Get webhooks for a specific event
   */
  async getWebhooksForEvent(eventType, userId = null) {
    try {
      const query = {
        events: { $in: [eventType, '*'] },
        enabled: true
      };
      
      if (userId) {
        query.userId = userId;
      }
      
      return await Webhook.find(query);
    } catch (error) {
      console.error('Error getting webhooks for event:', error);
      return [];
    }
  }

  /**
   * Generate webhook signature for security
   */
  generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  /**
   * Verify incoming webhook signature
   */
  verifySignature(payload, signature, secret) {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Validate webhook URL
   */
  validateWebhookUrl(url) {
    try {
      const urlObj = new URL(url);
      
      // Allow only HTTPS in production (except localhost for development)
      if (process.env.NODE_ENV === 'production' && 
          urlObj.protocol !== 'https:' && 
          !urlObj.hostname.includes('localhost')) {
        throw new Error('Webhook URL must use HTTPS in production');
      }
      
      // Block dangerous ports
      const dangerousPorts = [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 445, 587, 3306, 3389, 5432];
      if (urlObj.port && dangerousPorts.includes(parseInt(urlObj.port))) {
        throw new Error('Webhook URL uses a potentially dangerous port');
      }
      
      // Block internal/private IPs in production
      if (process.env.NODE_ENV === 'production') {
        const isPrivate = /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|127\.|::1|fc00:|fe80:)/.test(urlObj.hostname);
        if (isPrivate) {
          throw new Error('Webhook URL cannot point to private/internal network in production');
        }
      }
      
      return true;
    } catch (error) {
      throw new Error(`Invalid webhook URL: ${error.message}`);
    }
  }

  /**
   * Generate random secret
   */
  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Update webhook statistics
   */
  async updateWebhookStats(webhookId, success) {
    try {
      const update = {
        $inc: {
          totalCalls: 1,
          successfulCalls: success ? 1 : 0,
          failedCalls: success ? 0 : 1
        },
        $set: {
          lastCalledAt: new Date(),
          lastCallSuccess: success
        }
      };
      
      await Webhook.findByIdAndUpdate(webhookId, update);
    } catch (error) {
      console.error('Error updating webhook stats:', error);
    }
  }

  /**
   * Add failed webhook to dead letter queue
   */
  async addToDeadLetterQueue(webhook, eventType, payload, error) {
    try {
      const deadLetterItem = {
        webhookId: webhook._id,
        userId: webhook.userId,
        url: webhook.url,
        eventType,
        payload,
        error: {
          message: error.message,
          code: error.code,
          response: error.response?.data
        },
        timestamp: new Date().toISOString(),
        attempts: this.maxRetries
      };
      
      await redisClient.zadd(
        this.deadLetterKey,
        Date.now(),
        JSON.stringify(deadLetterItem)
      );
      
      // Keep dead letter items for 30 days
      await redisClient.expire(this.deadLetterKey, 2592000);
      
      console.log(`[Webhook] Added to dead letter queue: ${webhook.url}`);
    } catch (queueError) {
      console.error('Error adding to dead letter queue:', queueError);
    }
  }

  /**
   * Get dead letter queue items
   */
  async getDeadLetterQueue(start = 0, end = 50) {
    try {
      const items = await redisClient.zrange(this.deadLetterKey, start, end);
      return items.map(item => JSON.parse(item));
    } catch (error) {
      console.error('Error getting dead letter queue:', error);
      return [];
    }
  }

  /**
   * Retry dead letter queue items
   */
  async retryDeadLetterQueue(itemIds = []) {
    try {
      const items = await this.getDeadLetterQueue();
      const results = [];
      
      for (const item of items) {
        if (itemIds.length > 0 && !itemIds.includes(item.webhookId)) {
          continue;
        }
        
        try {
          const webhook = await Webhook.findById(item.webhookId);
          if (!webhook || !webhook.enabled) {
            continue;
          }
          
          const result = await this.sendWebhook(webhook, item.eventType, item.payload.data);
          results.push(result);
          
          // Remove from dead letter queue if successful
          if (result.success) {
            await redisClient.zrem(this.deadLetterKey, JSON.stringify(item));
          }
        } catch (error) {
          console.error('Error retrying dead letter item:', error);
          results.push({
            webhookId: item.webhookId,
            success: false,
            error: error.message
          });
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error retrying dead letter queue:', error);
      throw error;
    }
  }

  /**
   * Invalidate user webhooks cache
   */
  async invalidateUserWebhooksCache(userId) {
    try {
      await redisClient.del(`user:${userId}:webhooks`);
    } catch (error) {
      console.error('Error invalidating webhooks cache:', error);
    }
  }

  /**
   * Get webhook delivery statistics
   */
  async getWebhookStats(webhookId = null, userId = null) {
    try {
      const match = {};
      if (webhookId) match._id = webhookId;
      if (userId) match.userId = userId;
      
      const stats = await Webhook.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalWebhooks: { $sum: 1 },
            enabledWebhooks: { $sum: { $cond: [{ $eq: ['$enabled', true] }, 1, 0] } },
            totalCalls: { $sum: '$totalCalls' },
            successfulCalls: { $sum: '$successfulCalls' },
            failedCalls: { $sum: '$failedCalls' },
            avgResponseTime: { $avg: '$avgResponseTime' },
            lastCall: { $max: '$lastCalledAt' }
          }
        }
      ]);
      
      if (stats.length === 0) {
        return {
          totalWebhooks: 0,
          enabledWebhooks: 0,
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          successRate: 0,
          avgResponseTime: 0,
          lastCall: null
        };
      }
      
      const stat = stats[0];
      const successRate = stat.totalCalls > 0 
        ? (stat.successfulCalls / stat.totalCalls) * 100 
        : 0;
      
      return {
        ...stat,
        successRate: Math.round(successRate * 100) / 100 // Round to 2 decimal places
      };
    } catch (error) {
      console.error('Error getting webhook stats:', error);
      throw error;
    }
  }

  /**
   * Clean up old webhook data
   */
  async cleanupOldData(days = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      // Archive old webhooks that haven't been used
      const result = await Webhook.deleteMany({
        enabled: false,
        lastCalledAt: { $lt: cutoffDate },
        createdAt: { $lt: cutoffDate }
      });
      
      console.log(`[Webhook] Cleanup: Deleted ${result.deletedCount} old webhooks`);
      
      return result;
    } catch (error) {
      console.error('Error cleaning up old webhook data:', error);
      throw error;
    }
  }

  /**
   * Test webhook configuration
   */
  async testWebhook(webhookId, userId) {
    try {
      const webhook = await this.getWebhook(webhookId, userId);
      
      if (!webhook.enabled) {
        throw new Error('Webhook is disabled');
      }
      
      const testData = {
        test: true,
        message: 'This is a test webhook from FarmConnect',
        timestamp: new Date().toISOString(),
        webhookId: webhook.webhookId
      };
      
      const result = await this.sendWebhook(webhook, 'test', testData);
      
      return {
        success: result.success,
        data: {
          url: webhook.url,
          statusCode: result.statusCode,
          duration: result.duration,
          response: result.response
        },
        error: result.error
      };
    } catch (error) {
      console.error('Error testing webhook:', error);
      throw error;
    }
  }

  /**
   * Health check for webhook service
   */
  async healthCheck() {
    try {
      const stats = await this.getWebhookStats();
      const deadLetterCount = await redisClient.zCard(this.deadLetterKey);
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        stats,
        deadLetterCount,
        redis: await redisClient.exists(this.deadLetterKey) !== null
      };
    } catch (error) {
      console.error('Webhook health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

// Create singleton instance
const webhookService = new WebhookService();

module.exports = { webhookService };