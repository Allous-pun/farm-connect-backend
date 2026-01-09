// src/models/Webhook.js
const mongoose = require('mongoose');

const WebhookSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
    webhookId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
      validate: {
        validator: function(v) {
          try {
            new URL(v);
            return true;
          } catch {
            return false;
          }
        },
        message: props => `${props.value} is not a valid URL!`
      }
    },
    
    secret: {
      type: String,
      required: true
    },
    
    secretRotatedAt: {
      type: Date
    },
    
    events: [{
      type: String,
      required: true,
      enum: [
        'message:created',
        'message:read',
        'chat:created',
        'chat:archived',
        'offer:made',
        'offer:accepted',
        'offer:rejected',
        'user:online',
        'user:offline',
        'typing:started',
        'typing:stopped',
        'chat:blocked',
        'chat:unblocked',
        'listing:matched',
        'test',
        '*' // Wildcard for all events
      ]
    }],
    
    enabled: {
      type: Boolean,
      default: true,
      index: true
    },
    
    // Statistics
    totalCalls: {
      type: Number,
      default: 0
    },
    
    successfulCalls: {
      type: Number,
      default: 0
    },
    
    failedCalls: {
      type: Number,
      default: 0
    },
    
    avgResponseTime: {
      type: Number,
      default: 0
    },
    
    lastCalledAt: {
      type: Date
    },
    
    lastCallSuccess: {
      type: Boolean
    },
    
    // Metadata
    description: {
      type: String,
      maxlength: 500
    },
    
    tags: [{
      type: String,
      maxlength: 50
    }],
    
    // Retry configuration (can override global settings)
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
      max: 10
    },
    
    timeout: {
      type: Number,
      default: 10000, // 10 seconds
      min: 1000,
      max: 30000
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // Don't expose the secret in API responses
        delete ret.secret;
        return ret;
      }
    }
  }
);

// Indexes for efficient querying
WebhookSchema.index({ userId: 1, enabled: 1 });
WebhookSchema.index({ userId: 1, events: 1 });
WebhookSchema.index({ 'events': 1, enabled: 1 });
WebhookSchema.index({ createdAt: -1 });
WebhookSchema.index({ lastCalledAt: -1 });

// Virtual for success rate
WebhookSchema.virtual('successRate').get(function() {
  if (this.totalCalls === 0) return 0;
  return (this.successfulCalls / this.totalCalls) * 100;
});

// Middleware to validate events array is not empty
WebhookSchema.pre('save', function(next) {
  if (this.events.length === 0) {
    next(new Error('At least one event must be specified'));
  }
  next();
});

// Method to check if webhook should receive an event
WebhookSchema.methods.shouldReceiveEvent = function(eventType) {
  return this.enabled && (this.events.includes(eventType) || this.events.includes('*'));
};

// Method to rotate secret
WebhookSchema.methods.rotateSecret = function() {
  const crypto = require('crypto');
  this.secret = crypto.randomBytes(32).toString('hex');
  this.secretRotatedAt = new Date();
  return this.secret;
};

// Static method to get webhooks for a specific event
WebhookSchema.statics.getForEvent = async function(eventType, userId = null) {
  const query = {
    events: { $in: [eventType, '*'] },
    enabled: true
  };
  
  if (userId) {
    query.userId = userId;
  }
  
  return this.find(query);
};

module.exports = mongoose.model('Webhook', WebhookSchema);