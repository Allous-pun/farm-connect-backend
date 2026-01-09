const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middlewares/auth.middleware');

// Apply auth middleware to all routes
router.use(protect);

// Routes
router.get('/', chatController.getChats);
router.delete('/:chatId', chatController.deleteChat); // Only one delete route
router.post('/listing/:listingId', chatController.getOrCreateChat);
router.get('/:chatId/messages', chatController.getMessages);
router.post('/:chatId/messages', chatController.sendMessage);
router.post('/:chatId/offer', chatController.sendOffer);
router.put('/:chatId/offer/:offerId/respond', chatController.respondToOffer);
router.put('/:chatId/status', chatController.updateChatStatus);
router.get('/:chatId/online-status', chatController.getOnlineStatus);
router.get('/health', chatController.getChatHealth);
router.get('/offline-messages', chatController.getOfflineMessages);
router.post('/:chatId/typing', chatController.sendTypingIndicator);

module.exports = router;