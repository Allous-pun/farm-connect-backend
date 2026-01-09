import { io } from 'socket.io-client';

class ChatSocket {
  constructor(token) {
    this.socket = io('http://localhost:5000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    this.setupEventListeners();
  }

  setupEventListeners() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to chat server');
    });

    this.socket.on('connected', (data) => {
      console.log('Socket authenticated:', data);
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from chat server');
    });

    // Chat events
    this.socket.on('chat:message', (data) => {
      console.log('New message:', data);
      // Handle new message (update UI, play sound, etc.)
    });

    this.socket.on('chat:typing', (data) => {
      console.log('User typing:', data);
      // Show typing indicator
    });

    this.socket.on('chat:read', (data) => {
      console.log('Messages read:', data);
      // Update read receipts
    });

    this.socket.on('chat:offer:made', (data) => {
      console.log('New offer:', data);
      // Handle new offer
    });

    this.socket.on('chat:offer:accepted', (data) => {
      console.log('Offer accepted:', data);
      // Handle accepted offer
    });

    this.socket.on('chat:offer:rejected', (data) => {
      console.log('Offer rejected:', data);
      // Handle rejected offer
    });

    this.socket.on('user:online', (data) => {
      console.log('User online:', data);
      // Update online status
    });

    this.socket.on('user:offline', (data) => {
      console.log('User offline:', data);
      // Update online status
    });
  }

  // Join a chat room
  joinChat(chatId) {
    this.socket.emit('chat:join', chatId);
  }

  // Leave a chat room
  leaveChat(chatId) {
    this.socket.emit('chat:leave', chatId);
  }

  // Send message
  sendMessage(chatId, text, type = 'text', options = {}) {
    this.socket.emit('chat:message', {
      chatId,
      text,
      type,
      ...options
    });
  }

  // Send typing indicator
  sendTyping(chatId, isTyping) {
    this.socket.emit('chat:typing', { chatId, isTyping });
  }

  // Send read receipt
  sendReadReceipt(chatId, messageIds) {
    this.socket.emit('chat:read', { chatId, messageIds });
  }

  // Make an offer
  makeOffer(chatId, offer) {
    this.socket.emit('chat:offer:make', { chatId, offer });
  }

  // Accept offer
  acceptOffer(chatId, offerId) {
    this.socket.emit('chat:offer:accept', { chatId, offerId });
  }

  // Reject offer
  rejectOffer(chatId, offerId) {
    this.socket.emit('chat:offer:reject', { chatId, offerId });
  }

  // Disconnect
  disconnect() {
    this.socket.disconnect();
  }
}

export default ChatSocket;