// src/routes/webhook.routes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { webhookService } = require('../services/webhookService');
const { validate } = require('../middlewares/validation.middleware');
const Joi = require('joi');

// All routes require authentication
router.use(protect);

// CHANGED: Updated event list with dots instead of colons
const validEvents = [
  'message.created',
  'message.read',
  'chat.created',
  'chat.hidden',
  'offer.made',
  'offer.accepted',
  'offer.rejected',
  'user.online',
  'user.offline',
  'typing.started',
  'typing.stopped',
  'chat.blocked',
  'chat.unblocked',
  'listing.matched',
  'test',
  '*'
];

// Validation schemas
const registerWebhookSchema = Joi.object({
  url: Joi.string().uri().required().max(500),
  events: Joi.alternatives().try(
    Joi.string().valid(...validEvents),
    Joi.array().items(Joi.string().valid(...validEvents))
  ).required(),
  name: Joi.string().max(100).required(),
  secret: Joi.string().max(100).optional(),
  description: Joi.string().max(500).optional(),
  tags: Joi.array().items(Joi.string().max(50)).optional(),
  enabled: Joi.boolean().optional(),
  maxRetries: Joi.number().min(0).max(10).optional(),
  timeout: Joi.number().min(1000).max(30000).optional()
});

const updateWebhookSchema = Joi.object({
  url: Joi.string().uri().max(500).optional(),
  events: Joi.alternatives().try(
    Joi.string().valid(...validEvents),
    Joi.array().items(Joi.string().valid(...validEvents))
  ).optional(),
  name: Joi.string().max(100).optional(),
  description: Joi.string().max(500).optional(),
  tags: Joi.array().items(Joi.string().max(50)).optional(),
  enabled: Joi.boolean().optional(),
  rotateSecret: Joi.boolean().optional(),
  maxRetries: Joi.number().min(0).max(10).optional(),
  timeout: Joi.number().min(1000).max(30000).optional()
});

const testWebhookSchema = Joi.object({
  testData: Joi.object().optional()
});

// Register a new webhook
router.post('/register', validate(registerWebhookSchema), async (req, res) => {
  try {
    const result = await webhookService.registerWebhook(req.user.id, req.body);
    
    res.status(201).json({
      success: true,
      message: 'Webhook registered successfully',
      data: result.data,
      secret: result.secret // Only returned once
    });
  } catch (error) {
    console.error('Error registering webhook:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error registering webhook'
    });
  }
});

// Get all user's webhooks
router.get('/', async (req, res) => {
  try {
    const webhooks = await webhookService.getUserWebhooks(req.user.id);
    
    res.json({
      success: true,
      count: webhooks.length,
      data: webhooks
    });
  } catch (error) {
    console.error('Error getting webhooks:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting webhooks'
    });
  }
});

// Get webhook by ID
router.get('/:webhookId', async (req, res) => {
  try {
    const webhook = await webhookService.getWebhook(req.params.webhookId, req.user.id);
    
    res.json({
      success: true,
      data: webhook
    });
  } catch (error) {
    console.error('Error getting webhook:', error);
    res.status(error.message === 'Webhook not found' ? 404 : 500).json({
      success: false,
      message: error.message || 'Error getting webhook'
    });
  }
});

// Update webhook
router.put('/:webhookId', validate(updateWebhookSchema), async (req, res) => {
  try {
    const result = await webhookService.updateWebhook(
      req.params.webhookId,
      req.user.id,
      req.body
    );
    
    res.json({
      success: true,
      message: 'Webhook updated successfully',
      data: result.data,
      ...(result.newSecret ? { newSecret: result.newSecret } : {})
    });
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(error.message === 'Webhook not found' ? 404 : 400).json({
      success: false,
      message: error.message || 'Error updating webhook'
    });
  }
});

// Delete webhook
router.delete('/:webhookId', async (req, res) => {
  try {
    const result = await webhookService.deleteWebhook(req.params.webhookId, req.user.id);
    
    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(error.message === 'Webhook not found' ? 404 : 500).json({
      success: false,
      message: error.message || 'Error deleting webhook'
    });
  }
});

// Test webhook
router.post('/:webhookId/test', validate(testWebhookSchema), async (req, res) => {
  try {
    const result = await webhookService.testWebhook(req.params.webhookId, req.user.id);
    
    res.json({
      success: result.success,
      message: result.success ? 'Webhook test successful' : 'Webhook test failed',
      data: result.data,
      error: result.error
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(error.message === 'Webhook not found' ? 404 : 400).json({
      success: false,
      message: error.message || 'Error testing webhook'
    });
  }
});

// Get webhook statistics
router.get('/:webhookId/stats', async (req, res) => {
  try {
    const webhook = await webhookService.getWebhook(req.params.webhookId, req.user.id);
    const stats = await webhookService.getWebhookStats(req.params.webhookId, req.user.id);
    
    res.json({
      success: true,
      data: {
        webhook: {
          id: webhook._id,
          name: webhook.name,
          url: webhook.url,
          events: webhook.events,
          enabled: webhook.enabled
        },
        stats
      }
    });
  } catch (error) {
    console.error('Error getting webhook stats:', error);
    res.status(error.message === 'Webhook not found' ? 404 : 500).json({
      success: false,
      message: error.message || 'Error getting webhook stats'
    });
  }
});

// Get global webhook statistics (admin/overview)
router.get('/stats/overview', async (req, res) => {
  try {
    const stats = await webhookService.getWebhookStats(null, req.user.id);
    const deadLetterQueue = await webhookService.getDeadLetterQueue(0, 10);
    
    res.json({
      success: true,
      data: {
        stats,
        deadLetterQueue: {
          count: deadLetterQueue.length,
          items: deadLetterQueue
        }
      }
    });
  } catch (error) {
    console.error('Error getting webhook overview:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting webhook overview'
    });
  }
});

// Retry dead letter queue (admin)
router.post('/dead-letter/retry', async (req, res) => {
  try {
    const { webhookIds } = req.body;
    const results = await webhookService.retryDeadLetterQueue(webhookIds);
    
    res.json({
      success: true,
      message: 'Dead letter queue retry initiated',
      results
    });
  } catch (error) {
    console.error('Error retrying dead letter queue:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrying dead letter queue'
    });
  }
});

// Webhook health check
router.get('/health/check', async (req, res) => {
  try {
    const health = await webhookService.healthCheck();
    
    res.json({
      success: health.status === 'healthy',
      ...health
    });
  } catch (error) {
    console.error('Error checking webhook health:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

module.exports = router;