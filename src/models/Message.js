const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    text: {
      type: String,
      required: function() {
        return this.type === 'text';
      },
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters']
    },

    // Message type
    type: {
      type: String,
      enum: ['text', 'offer', 'location', 'contact', 'system'],
      default: 'text'
    },

    // For offer messages
    offerDetails: {
      price: {
        type: Number,
        required: function() { return this.type === 'offer'; }
      },
      quantity: {
        type: Number,
        required: function() { return this.type === 'offer'; }
      },
      unit: {
        type: String,
        required: function() { return this.type === 'offer'; }
      },
      conditions: {
        type: String,
        trim: true,
        maxlength: 500
      },
      status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
      }
    },

    // For location messages
    location: {
      coordinates: {
        type: [Number], // [lng, lat]
        index: '2dsphere'
      },
      address: String,
      name: String
    },

    // For contact messages
    contact: {
      phone: String,
      name: String
    },

    // Read status
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Delivery status
    deliveredTo: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      deliveredAt: {
        type: Date,
        default: Date.now
      }
    }],

    // Metadata
    isEdited: {
      type: Boolean,
      default: false
    },
    editedAt: {
      type: Date
    },
    
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    deletedAt: {
      type: Date
    },

    // Reactions
    reactions: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      emoji: String,
      reactedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  {
    timestamps: true
  }
);

// Indexes for efficient querying
MessageSchema.index({ chat: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, createdAt: -1 });
MessageSchema.index({ 'readBy.user': 1 });
MessageSchema.index({ 'deliveredTo.user': 1 });

// Middleware to update chat's last message
MessageSchema.post('save', async function(doc) {
  const Chat = mongoose.model('Chat');
  const User = mongoose.model('User');
  
  try {
    const chat = await Chat.findById(doc.chat);
    if (chat) {
      // Update last message
      chat.lastMessage = {
        text: doc.text,
        sender: doc.sender,
        timestamp: doc.createdAt,
        type: doc.type
      };

      // Increment unread count for other participants
      chat.participants.forEach(participantId => {
        if (participantId.toString() !== doc.sender.toString()) {
          const currentCount = chat.unreadCounts.get(participantId.toString()) || 0;
          chat.unreadCounts.set(participantId.toString(), currentCount + 1);
        }
      });

      await chat.save();

      // Update sender info for last message
      const sender = await User.findById(doc.sender).select('name');
      if (sender) {
        chat.lastMessage.sender = sender;
      }
    }
  } catch (error) {
    console.error('Error updating chat last message:', error);
  }
});

// Method to mark message as read by user
MessageSchema.methods.markAsRead = async function(userId) {
  if (!this.readBy.some(read => read.user.toString() === userId.toString())) {
    this.readBy.push({ user: userId });
    await this.save();
  }
  return this;
};

// Method to mark message as delivered to user
MessageSchema.methods.markAsDelivered = async function(userId) {
  if (!this.deliveredTo.some(delivered => delivered.user.toString() === userId.toString())) {
    this.deliveredTo.push({ user: userId });
    await this.save();
  }
  return this;
};

// Static method to get messages with pagination
MessageSchema.statics.getMessages = async function(chatId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return this.find({ chat: chatId, isDeleted: false })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'name roles')
    .populate('readBy.user', 'name')
    .populate('deliveredTo.user', 'name');
};

module.exports = mongoose.model('Message', MessageSchema);