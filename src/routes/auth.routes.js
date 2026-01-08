const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { 
  register, 
  login, 
  getProfile, 
  updateProfile, 
  updateLocation,
  getNearbyUsers,
  logout 
} = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');

// Validation middleware
const registerValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
  body('name').notEmpty().trim().withMessage('Name is required'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('roles').optional().isArray().withMessage('Roles must be an array'),
  body('roles.*').optional().isIn(['farmer', 'transport', 'storage', 'admin']).withMessage('Invalid role'),
  body('location').optional()
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

const updateProfileValidation = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('location').optional()
];

const updateLocationValidation = [
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('name').optional().trim(),
  body('county').optional().trim(),
  body('town').optional().trim()
];

// Public routes
router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);

// Protected routes
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfileValidation, updateProfile);
router.put('/location', protect, updateLocationValidation, updateLocation);
router.get('/users/nearby', protect, getNearbyUsers);
router.post('/logout', protect, logout);

// Test protected route with role authorization
router.get('/test-admin', protect, authorize('admin'), (req, res) => {
  res.json({
    success: true,
    message: 'Welcome admin!'
  });
});

module.exports = router;