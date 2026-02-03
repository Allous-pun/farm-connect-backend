// src/controllers/chat.controller.js
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const User = require('../models/User');
const mongoose = require('mongoose');

// Services
const { messageQueue } = require('../services/messageQueue');
const { webhookService } = require('../services/webhookService');
const { getIO, notifyUser, isUserOnline, getOnlineUsersCount, getUserPresence } = require('../socket/socket');

// Validation schemas (you can move these to separate validation files)
const Joi = require('joi');

const messageSchema = Joi.object({
  text: Joi.string().max(2000).when('type', {
    is: 'text',
    then: Joi.required()
  }),
  type: Joi.string().valid('text', 'offer', 'location', 'contact', 'system').default('text'),
  offerDetails: Joi.object({
    price: Joi.number().positive().required(),
    quantity: Joi.number().positive().required(),
    unit: Joi.string().required(),
    conditions: Joi.string().max(500)
  }).when('type', {
    is: 'offer',
    then: Joi.required()
  }),
  location: Joi.object({
    coordinates: Joi.array().items(Joi.number()).length(2),
    address: Joi.string(),
    name: Joi.string()
  }),
  contact: Joi.object({
    phone: Joi.string(),
    name: Joi.string()
  })
});

const offerSchema = Joi.object({
  price: Joi.number().positive().required(),
  quantity: Joi.number().positive().required(),
  unit: Joi.string().required(),
  conditions: Joi.string().max(500)
});

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/['"]/g, '')
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    next();
  };
};

// @desc    Get user's chats with Redis caching
// @route   GET /api/chats
// @access  Private
exports.getChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user:${userId}:chats`;
    const redisClient = require('../config/redis');
    
    // Try to get from cache first
    const cachedChats = await redisClient.get(cacheKey);
    if (cachedChats) {
      return res.json({
        success: true,
        cached: true,
        data: JSON.parse(cachedChats)
      });
    }
    
    // Find chats where user is participant and not archived
    const chats = await Chat.find({
      participants: userId,
      status: { $ne: 'archived' }
    })
    .populate('listing', 'title category type status images isExpired timeRemaining')
    .populate('participants', 'name roles profileStatus')
    .populate('lastMessage.sender', 'name')
    .populate('initiator', 'name')
    .sort('-updatedAt')
    .lean(); // Use lean() for better performance

    // Filter out chats that user has deleted
    const filteredChats = chats.filter(chat => {
      if (chat.deletedBy && Array.isArray(chat.deletedBy)) {
        const userDeletedChat = chat.deletedBy.some(deletion => {
          const deletedUserId = deletion.user 
            ? (deletion.user._id ? deletion.user._id.toString() : deletion.user.toString())
            : deletion.toString();
          return deletedUserId === userId.toString();
        });
        if (userDeletedChat) return false;
      }
      return true;
    });

    // Format response with unread counts and online status
    const formattedChats = await Promise.all(filteredChats.map(async (chat) => {
      const otherParticipant = chat.participants.find(
        p => p._id.toString() !== userId.toString()
      );
      
      const unreadCount = chat.unreadCounts?.get(userId.toString()) || 0;
      const isOtherOnline = await isUserOnline(otherParticipant._id.toString());
      
      return {
        ...chat,
        unreadCount,
        otherParticipant,
        otherParticipantOnline: isOtherOnline,
        lastSeen: new Date() // TODO: Implement last seen tracking
      };
    }));

    // Cache for 30 seconds
    await redisClient.set(cacheKey, JSON.stringify(formattedChats), 30);
    
    res.json({
      success: true,
      count: formattedChats.length,
      data: formattedChats
    });

  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching chats',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Delete chat for user
// @route   DELETE /api/chats/:chatId
// @access  Private
exports.deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Initialize deletedBy array if it doesn't exist
    if (!chat.deletedBy) {
      chat.deletedBy = [];
    }

    // Check if user already deleted the chat
    const alreadyDeleted = chat.deletedBy.some(deletion => {
      const deletedUserId = deletion.user 
        ? (deletion.user._id ? deletion.user._id.toString() : deletion.user.toString())
        : deletion.toString();
      
      return deletedUserId === userId.toString();
    });

    if (!alreadyDeleted) {
      // Add user to deletedBy array
      chat.deletedBy.push({
        user: userId,
        deletedAt: new Date()
      });

      await chat.save();
      
      // Invalidate cache
      const redisClient = require('../config/redis');
      await redisClient.del(`user:${userId}:chats`);
      
      // Trigger webhook - CHANGED: chat.hidden instead of chat.archived
      await webhookService.triggerWebhook(
        'chat.hidden',
        {
          chatId,
          hiddenBy: req.user.id,
          timestamp: new Date().toISOString()
        },
        req.user.id
      );
    }

    res.json({
      success: true,
      message: 'Chat deleted successfully'
    });

  } catch (error) {
    console.error('Delete chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get or create chat for a listing
// @route   POST /api/chats/listing/:listingId
// @access  Private
exports.getOrCreateChat = async (req, res) => {
  try {
    const { listingId } = req.params;
    const { initialMessage } = req.body;

    // Get listing
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check if listing is active
    if (listing.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot start chat for inactive listing'
      });
    }

    // Check if user is not the owner
    if (listing.owner.toString() === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start chat with yourself'
      });
    }

    // Check if chat already exists
    let chat = await Chat.findOne({
      listing: listingId,
      participants: { $all: [req.user.id, listing.owner] },
      status: { $ne: 'archived' }
    })
    .populate('participants', 'name roles profileStatus')
    .populate('listing', 'title category type');

    // Filter out if user deleted the chat
    if (chat) {
      const userDeletedChat = chat.deletedBy && chat.deletedBy.some(deletion => {
        const deletedUserId = deletion.user 
          ? (deletion.user._id ? deletion.user._id.toString() : deletion.user.toString())
          : deletion.toString();
        return deletedUserId === req.user.id.toString();
      });
      
      if (userDeletedChat) {
        chat.deletedBy = chat.deletedBy.filter(deletion => {
          const deletedUserId = deletion.user 
            ? (deletion.user._id ? deletion.user._id.toString() : deletion.user.toString())
            : deletion.toString();
          return deletedUserId !== req.user.id.toString();
        });
        await chat.save();
      }
    }

    if (!chat) {
      // Create new chat
      chat = new Chat({
        listing: listingId,
        participants: [req.user.id, listing.owner],
        initiator: req.user.id,
        status: 'active'
      });

      await chat.save();

      // Populate the new chat
      chat = await Chat.findById(chat._id)
        .populate('participants', 'name roles profileStatus')
        .populate('listing', 'title category type')
        .populate('initiator', 'name');

      // Increment chat count on listing
      await listing.incrementChatCount();
      
      // Trigger webhook for chat creation
      await webhookService.triggerWebhook('chat.created', {
        chatId: chat._id,
        listingId,
        participants: [req.user.id, listing.owner],
        initiator: req.user.id,
        timestamp: new Date().toISOString()
      }, req.user.id);
    }

    // Send initial message if provided
    if (initialMessage) {
      const message = new Message({
        chat: chat._id,
        sender: req.user.id,
        text: initialMessage,
        type: 'text'
      });

      await message.save();
      await message.populate('sender', 'name roles');

      // Queue message for delivery
      await messageQueue.enqueueMessage({
        chatId: chat._id,
        message: {
          _id: message._id,
          text: message.text,
          type: message.type,
          sender: message.sender._id,
          createdAt: message.createdAt
        },
        sender: {
          id: req.user.id,
          name: req.user.name,
          roles: req.user.roles
        },
        recipientId: listing.owner
      });
    }

    // Reset unread count for current user
    await chat.resetUnreadCount(req.user.id);
    
    // Invalidate cache
    const redisClient = require('../config/redis');
    await redisClient.del(`user:${req.user.id}:chats`);
    await redisClient.del(`user:${listing.owner}:chats`);

    res.json({
      success: true,
      data: chat,
      message: initialMessage ? 'Chat started with message' : 'Chat found'
    });

  } catch (error) {
    console.error('Get or create chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating chat',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get chat messages with pagination and Redis caching
// @route   GET /api/chats/:chatId/messages
// @access  Private
exports.getMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50, after } = req.query;
    const userId = req.user.id;

    // Check if user is participant in chat
    const chat = await Chat.findOne({
      _id: chatId,
      participants: userId,
      status: { $ne: 'archived' }
    });

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }

    // Build query
    let query = { chat: chatId, isDeleted: false };
    if (after) {
      query._id = { $gt: after };
    }

    // Get messages with pagination
    const skip = (page - 1) * limit;
    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('sender', 'name roles')
      .populate('readBy.user', 'name')
      .populate('deliveredTo.user', 'name')
      .lean();

    // Mark messages as read for current user
    const unreadMessages = messages.filter(
      msg => !msg.readBy?.some(read => read.user?._id?.toString() === userId.toString())
    );

    if (unreadMessages.length > 0) {
      // Update in batch for better performance
      const unreadIds = unreadMessages.map(msg => msg._id);
      await Message.updateMany(
        { _id: { $in: unreadIds } },
        { 
          $addToSet: { 
            readBy: { 
              user: userId, 
              readAt: new Date() 
            } 
          } 
        }
      );

      // Reset unread count in chat
      await chat.resetUnreadCount(userId);

      // Notify via socket
      const io = getIO();
      if (io) {
        const otherParticipant = chat.participants.find(
          p => p.toString() !== userId.toString()
        );
        
        io.to(`chat_${chatId}`).emit('chat:messages:read', {
          chatId,
          userId,
          messageIds: unreadIds,
          timestamp: new Date().toISOString()
        });
        
        // Trigger webhook - CHANGED: message.read with recipient notification
        if (otherParticipant) {
          await webhookService.triggerWebhook(
            'message.read',
            {
              chatId,
              readerId: req.user.id,
              messageIds: unreadIds,
              timestamp: new Date().toISOString()
            },
            otherParticipant.toString()
          );
        }
      }
    }

    // Get total count for pagination
    const total = await Message.countDocuments({ chat: chatId, isDeleted: false });

    res.json({
      success: true,
      data: messages.reverse(), // Return in chronological order
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + messages.length < total
      }
    });

  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Send message with validation and queueing
// @route   POST /api/chats/:chatId/messages
// @access  Private
exports.sendMessage = [
  validateRequest(messageSchema),
  async (req, res) => {
    try {
      const { chatId } = req.params;
      const { text, type = 'text', offerDetails, location, contact } = req.body;

      // Check if user is participant in chat
      const chat = await Chat.findOne({
        _id: chatId,
        participants: req.user.id,
        status: 'active'
      }).populate('participants', 'name roles');

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or access denied'
        });
      }

      // Check if chat is blocked
      if (chat.status === 'blocked' && chat.blockedBy?.toString() !== req.user.id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'This chat has been blocked'
        });
      }

      // Rate limiting check (optional - implement proper rate limiting)
      const redisClient = require('../config/redis');
      const rateLimitKey = `rate:${req.user.id}:messages`;
      const messageCount = await redisClient.get(rateLimitKey) || 0;
      
      if (messageCount > 100) { // 100 messages per minute limit
        return res.status(429).json({
          success: false,
          message: 'Rate limit exceeded. Please wait before sending more messages.'
        });
      }

      // Create message
      const message = new Message({
        chat: chatId,
        sender: req.user.id,
        text,
        type,
        offerDetails,
        location,
        contact
      });

      await message.save();
      await message.populate('sender', 'name roles profileStatus');

      // Mark as delivered to sender immediately
      await message.markAsDelivered(req.user.id);

      // Get other participant
      const otherParticipant = chat.participants.find(
        p => p._id.toString() !== req.user.id.toString()
      );

      // Queue message for reliable delivery
      const queueResult = await messageQueue.enqueueMessage({
        chatId,
        message: {
          _id: message._id,
          text: message.text,
          type: message.type,
          sender: message.sender._id,
          createdAt: message.createdAt,
          offerDetails: message.offerDetails,
          location: message.location,
          contact: message.contact
        },
        sender: {
          id: req.user.id,
          name: req.user.name,
          roles: req.user.roles,
          profileStatus: req.user.profileStatus
        },
        recipientId: otherParticipant._id,
        priority: type === 'offer' ? 2 : 1 // Higher priority for offers
      });

      if (!queueResult.success) {
        console.error('Failed to queue message:', queueResult.error);
        // Still continue, as message is saved in DB
      }

      // Increment rate limit counter
      await redisClient.set(rateLimitKey, parseInt(messageCount) + 1, 60); // Expire in 60 seconds

      // Trigger webhooks - CHANGED: notify recipient with message.created, and optionally sender with self: true
      const payload = {
        chatId,
        messageId: message._id,
        senderId: req.user.id,
        recipientId: otherParticipant._id,
        text: message.text,
        type: message.type,
        timestamp: message.createdAt
      };

      // Notify recipient
      await webhookService.triggerWebhook(
        'message.created',
        payload,
        otherParticipant._id.toString()
      ).catch(err => console.error('Recipient webhook error:', err));

      // Optional: notify sender
      await webhookService.triggerWebhook(
        'message.created',
        { ...payload, self: true },
        req.user.id
      ).catch(err => console.error('Sender webhook error:', err));

      // Invalidate chat cache
      await redisClient.del(`user:${req.user.id}:chats`);
      await redisClient.del(`user:${otherParticipant._id}:chats`);

      res.status(201).json({
        success: true,
        data: message,
        queued: queueResult.success,
        jobId: queueResult.jobId,
        message: 'Message sent successfully'
      });

    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({
        success: false,
        message: 'Error sending message',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
];

// @desc    Send offer with validation
// @route   POST /api/chats/:chatId/offer
// @access  Private
exports.sendOffer = [
  validateRequest(offerSchema),
  async (req, res) => {
    try {
      const { chatId } = req.params;
      const { price, quantity, unit, conditions } = req.body;

      // Check if user is participant in chat
      const chat = await Chat.findOne({
        _id: chatId,
        participants: req.user.id,
        status: 'active'
      }).populate('participants', 'name roles')
        .populate('listing', 'title category');

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: 'Chat not found or access denied'
        });
      }

      // Check if there's already a pending offer
      if (chat.activeOffer?.status === 'pending') {
        return res.status(400).json({
          success: false,
          message: 'There is already a pending offer in this chat'
        });
      }

      // Create offer message
      const message = new Message({
        chat: chatId,
        sender: req.user.id,
        type: 'offer',
        offerDetails: {
          price,
          quantity,
          unit,
          conditions,
          status: 'pending'
        }
      });

      await message.save();

      // Update chat with active offer
      chat.activeOffer = {
        price,
        quantity,
        unit,
        conditions,
        offeredBy: req.user.id,
        offeredAt: new Date(),
        status: 'pending'
      };

      await chat.save();
      await message.populate('sender', 'name roles');

      // Get other participant
      const otherParticipant = chat.participants.find(
        p => p._id.toString() !== req.user.id.toString()
      );

      // Queue offer for delivery
      await messageQueue.enqueueMessage({
        chatId,
        message: {
          _id: message._id,
          type: 'offer',
          offerDetails: message.offerDetails,
          sender: message.sender._id,
          createdAt: message.createdAt
        },
        sender: {
          id: req.user.id,
          name: req.user.name,
          roles: req.user.roles
        },
        recipientId: otherParticipant._id,
        priority: 2 // Higher priority for offers
      });

      // Trigger webhooks
      await webhookService.triggerWebhook('offer.made', {
        chatId,
        offerId: message._id,
        fromUserId: req.user.id,
        toUserId: otherParticipant._id,
        price,
        quantity,
        unit,
        conditions,
        timestamp: new Date().toISOString()
      }, req.user.id);

      res.status(201).json({
        success: true,
        data: message,
        message: 'Offer sent successfully'
      });

    } catch (error) {
      console.error('Send offer error:', error);
      res.status(500).json({
        success: false,
        message: 'Error sending offer',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
];

// @desc    Respond to offer
// @route   PUT /api/chats/:chatId/offer/:offerId/respond
// @access  Private
exports.respondToOffer = async (req, res) => {
  try {
    const { chatId, offerId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be "accept" or "reject"'
      });
    }

    // Check if user is participant in chat
    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user.id,
      status: 'active',
      'activeOffer.status': 'pending'
    }).populate('participants', 'name roles');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat or pending offer not found'
      });
    }

    // Check if user is the listing owner (only owner can accept/reject offers)
    const listing = await Listing.findById(chat.listing);
    if (listing.owner.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Only listing owner can respond to offers'
      });
    }

    // Update offer status
    const message = await Message.findById(offerId);
    if (!message || message.type !== 'offer') {
      return res.status(404).json({
        success: false,
        message: 'Offer not found'
      });
    }

    // Map action to status value
    const status = action === 'accept' ? 'accepted' : 'rejected';
    message.offerDetails.status = status;
    await message.save();

    // Update chat active offer
    if (chat.activeOffer) {
      chat.activeOffer.status = status;
      await chat.save();
    }

    // Create system message
    const systemMessage = new Message({
      chat: chatId,
      sender: req.user.id,
      type: 'system',
      text: `Offer ${action}ed: ${message.offerDetails.quantity}${message.offerDetails.unit} at KES ${message.offerDetails.price}`
    });

    await systemMessage.save();

    // Send real-time notification
    const io = getIO();
    if (io) {
      const event = action === 'accept' ? 'chat:offer:accepted' : 'chat:offer:rejected';
      
      io.to(`chat_${chatId}`).emit(event, {
        chatId,
        offerId,
        respondedBy: {
          id: req.user.id,
          name: req.user.name
        },
        timestamp: new Date().toISOString()
      });

      // Also send system message
      io.to(`chat_${chatId}`).emit('chat:message', {
        chatId,
        message: {
          _id: systemMessage._id,
          text: systemMessage.text,
          type: 'system',
          createdAt: systemMessage.createdAt
        }
      });
    }

    // If offer accepted, mark listing as matched
    if (action === 'accept') {
      await listing.markAsMatched(
        message.sender, // The one who made the offer
        null // No matched listing ID for single listing
      );
      
      // Trigger webhook for offer acceptance
      await webhookService.triggerWebhook('offer.accepted', {
        chatId,
        offerId,
        listingId: listing._id,
        buyerId: message.sender,
        sellerId: req.user.id,
        price: message.offerDetails.price,
        quantity: message.offerDetails.quantity,
        unit: message.offerDetails.unit,
        timestamp: new Date().toISOString()
      }, req.user.id);
    } else {
      // Trigger webhook for offer rejection
      await webhookService.triggerWebhook('offer.rejected', {
        chatId,
        offerId,
        listingId: listing._id,
        buyerId: message.sender,
        sellerId: req.user.id,
        timestamp: new Date().toISOString()
      }, req.user.id);
    }

    res.json({
      success: true,
      message: `Offer ${action}ed successfully`,
      data: {
        offer: message.offerDetails,
        systemMessage: systemMessage.text
      }
    });

  } catch (error) {
    console.error('Respond to offer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error responding to offer',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update chat status
// @route   PUT /api/chats/:chatId/status
// @access  Private
exports.updateChatStatus = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { status, blockReason } = req.body;

    if (!['active', 'blocked', 'archived'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be "active", "blocked", or "archived"'
      });
    }

    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user.id
    }).populate('participants', 'name roles');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    // Store previous status for webhook
    const previousStatus = chat.status;

    // Update status
    chat.status = status;

    // Handle blocking
    if (status === 'blocked') {
      chat.blockedBy = req.user.id;
      chat.blockedAt = new Date();
      chat.blockReason = blockReason;
    } else if (status === 'active') {
      chat.blockedBy = null;
      chat.blockedAt = null;
      chat.blockReason = null;
    }

    await chat.save();

    // Send real-time notification
    const io = getIO();
    if (io) {
      io.to(`chat_${chatId}`).emit('chat:status:updated', {
        chatId,
        status,
        previousStatus,
        updatedBy: {
          id: req.user.id,
          name: req.user.name
        },
        timestamp: new Date().toISOString()
      });
    }

    // Trigger webhook
    if (status === 'blocked') {
      await webhookService.triggerWebhook('chat.blocked', {
        chatId,
        blockedBy: req.user.id,
        blockReason,
        timestamp: new Date().toISOString()
      }, req.user.id);
    } else if (status === 'active' && previousStatus === 'blocked') {
      await webhookService.triggerWebhook('chat.unblocked', {
        chatId,
        unblockedBy: req.user.id,
        timestamp: new Date().toISOString()
      }, req.user.id);
    }

    // Invalidate cache for all participants
    const redisClient = require('../config/redis');
    await Promise.all(
      chat.participants.map(async (participant) => {
        await redisClient.del(`user:${participant._id}:chats`);
      })
    );

    res.json({
      success: true,
      message: `Chat ${status} successfully`,
      data: chat
    });

  } catch (error) {
    console.error('Update chat status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating chat status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get online status of chat participants
// @route   GET /api/chats/:chatId/online-status
// @access  Private
exports.getOnlineStatus = async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user.id
    }).populate('participants', '_id name');

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }

    const onlineStatus = await Promise.all(chat.participants.map(async (participant) => {
      const isOnline = await isUserOnline(participant._id.toString());
      const presence = await getUserPresence(participant._id.toString());
      
      return {
        userId: participant._id,
        name: participant.name,
        isOnline,
        lastSeen: presence.lastSeen,
        socketId: presence.socketId
      };
    }));

    res.json({
      success: true,
      data: onlineStatus
    });

  } catch (error) {
    console.error('Get online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching online status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get chat health and stats
// @route   GET /api/chats/health
// @access  Private
exports.getChatHealth = async (req, res) => {
  try {
    const queueStats = await messageQueue.getQueueStats();
    const onlineCount = await getOnlineUsersCount();
    const userPresence = await getUserPresence(req.user.id);
    
    // Get Redis health
    const redisClient = require('../config/redis');
    const redisHealth = await redisClient.get('health:check') === 'ok' ? 'healthy' : 'unhealthy';
    
    // Get MongoDB stats
    const dbStats = await mongoose.connection.db.stats();
    
    res.json({
      success: true,
      data: {
        onlineUsers: onlineCount,
        userPresence,
        queues: queueStats,
        redis: redisHealth,
        database: {
          collections: dbStats.collections,
          objects: dbStats.objects,
          avgObjSize: dbStats.avgObjSize,
          storageSize: dbStats.storageSize
        },
        timestamp: new Date().toISOString(),
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          env: process.env.NODE_ENV,
          nodeVersion: process.version
        }
      }
    });
  } catch (error) {
    console.error('Get chat health error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting chat health',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get offline messages
// @route   GET /api/chats/offline-messages
// @access  Private
exports.getOfflineMessages = async (req, res) => {
  try {
    const offlineMessages = await messageQueue.getOfflineMessages(req.user.id);
    const delivered = await messageQueue.deliverOfflineMessages(req.user.id);
    
    // Trigger webhook for user coming online
    await webhookService.triggerWebhook('user.online', {
      userId: req.user.id,
      name: req.user.name,
      timestamp: new Date().toISOString(),
      offlineMessagesDelivered: delivered.delivered
    }, req.user.id);
    
    res.json({
      success: true,
      data: {
        queuedMessages: offlineMessages,
        delivered,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get offline messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting offline messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Send typing indicator via REST (for clients without socket)
// @route   POST /api/chats/:chatId/typing
// @access  Private
exports.sendTypingIndicator = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { isTyping } = req.body;
    
    if (typeof isTyping !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isTyping must be a boolean value'
      });
    }
    
    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user.id,
      status: 'active'
    });
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found or access denied'
      });
    }
    
    const otherParticipant = chat.participants.find(
      p => p.toString() !== req.user.id.toString()
    );
    
    // Notify via socket
    await notifyUser(otherParticipant, 'chat:typing', {
      chatId,
      userId: req.user.id,
      name: req.user.name,
      isTyping,
      timestamp: new Date().toISOString()
    });
    
    // Trigger webhook for typing events
    if (isTyping) {
      await webhookService.triggerWebhook('typing.started', {
        chatId,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      }, otherParticipant);
    } else {
      await webhookService.triggerWebhook('typing.stopped', {
        chatId,
        userId: req.user.id,
        timestamp: new Date().toISOString()
      }, otherParticipant);
    }
    
    res.json({
      success: true,
      message: `Typing indicator ${isTyping ? 'started' : 'stopped'}`,
      data: {
        chatId,
        isTyping,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Send typing indicator error:', error);
    res.status(500).json({
      success: false,
      message: 'Error sending typing indicator',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Search messages in chat
// @route   GET /api/chats/:chatId/search
// @access  Private
exports.searchMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const { query, page = 1, limit = 20 } = req.query;
    
    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }
    
    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user.id
    });
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    }
    
    const skip = (page - 1) * limit;
    const searchQuery = {
      chat: chatId,
      isDeleted: false,
      text: { $regex: query, $options: 'i' }
    };
    
    const messages = await Message.find(searchQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('sender', 'name roles')
      .lean();
    
    const total = await Message.countDocuments(searchQuery);
    
    res.json({
      success: true,
      data: messages,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + messages.length < total
      }
    });
    
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};