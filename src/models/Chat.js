const mongoose = require('mongoose');

const ChatSchema = new mongoose.Schema(
  {
    listing: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true
    },

    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }],

    // First message in the conversation
    initiator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    // Last message for quick preview
    lastMessage: {
      text: String,
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      type: {
        type: String,
        enum: ['text', 'offer', 'location', 'contact', 'system'],
        default: 'text'
      }
    },

    // Unread messages count for each participant
    unreadCounts: {
      type: Map,
      of: Number,
      default: {}
    },

    // Status of the chat
    status: {
      type: String,
      enum: ['active', 'closed', 'archived', 'blocked'],
      default: 'active'
    },

    // Block information
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    blockedAt: {
      type: Date
    },
    blockReason: {
      type: String
    },

    // Offer negotiation
    activeOffer: {
      price: Number,
      quantity: Number,
      unit: String,
      conditions: String,
      offeredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      offeredAt: Date,
      status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
      }
    },

    // Metadata
    deletedBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      deletedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Index for quick lookups
ChatSchema.index({ listing: 1, participants: 1 });
ChatSchema.index({ 'lastMessage.timestamp': -1 });
ChatSchema.index({ participants: 1, status: 1 });
ChatSchema.index({ updatedAt: -1 });

// Virtual for chat preview
ChatSchema.virtual('preview').get(function() {
  if (this.lastMessage) {
    const preview = this.lastMessage.text || '';
    return preview.length > 50 ? preview.substring(0, 50) + '...' : preview;
  }
  return 'New conversation';
});

// Virtual for other participant
ChatSchema.virtual('otherParticipant', {
  ref: 'User',
  localField: 'participants',
  foreignField: '_id',
  justOne: true
});

// Method to get other participant (excluding given user)
ChatSchema.methods.getOtherParticipant = function(userId) {
  // Safety checks
  if (!this.participants || !Array.isArray(this.participants)) {
    return null;
  }
  
  // Convert userId to string for comparison
  const userIdStr = userId && userId.toString ? userId.toString() : String(userId);
  
  return this.participants.find(participant => {
    if (!participant || !participant._id) return false;
    
    const participantId = participant._id.toString ? participant._id.toString() : String(participant._id);
    return participantId !== userIdStr;
  });
};

// Method to increment unread count for a user
ChatSchema.methods.incrementUnreadCount = function(userId) {
  const currentCount = this.unreadCounts.get(userId.toString()) || 0;
  this.unreadCounts.set(userId.toString(), currentCount + 1);
  return this.save();
};

// Method to reset unread count for a user
ChatSchema.methods.resetUnreadCount = function(userId) {
  this.unreadCounts.set(userId.toString(), 0);
  return this.save();
};

// Method to get unread count for a user
ChatSchema.methods.getUnreadCount = function(userId) {
  return this.unreadCounts.get(userId.toString()) || 0;
};

module.exports = mongoose.model('Chat', ChatSchema);