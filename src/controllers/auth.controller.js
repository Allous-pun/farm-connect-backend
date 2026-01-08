const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { validationResult } = require('express-validator');

// Helper function to parse location data
const parseLocationData = (location) => {
  if (!location) return {};
  
  const result = {};
  
  // If location is a string, treat it as location name
  if (typeof location === 'string') {
    result.location = { name: location };
    result.coordinates = {
      type: 'Point',
      coordinates: [36.8172, -1.2864] // Default Kenya coordinates
    };
    return result;
  }
  
  // If location is an object with lat/lng
  if (location.lat && location.lng) {
    result.location = {
      name: location.name || 'Your Location',
      address: {
        county: location.county,
        subCounty: location.subCounty,
        ward: location.ward,
        town: location.town,
        street: location.street
      },
      landmark: location.landmark
    };
    result.coordinates = {
      type: 'Point',
      coordinates: [location.lng, location.lat] // Note: MongoDB expects [longitude, latitude]
    };
    return result;
  }
  
  // If already in proper format
  if (location.coordinates) {
    result.coordinates = location.coordinates;
  }
  if (location.name || location.address || location.landmark) {
    result.location = location;
  }
  
  return result;
};

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name, phone, roles, location } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ 
        success: false,
        message: 'User already exists with this email' 
      });
    }

    // Parse location data
    const locationData = parseLocationData(location);

    // Create user
    const user = await User.create({
      email,
      password,
      name,
      phone,
      roles: roles || ['farmer'],
      ...locationData // Spread the location data (includes both location and coordinates)
    });

    // Generate token
    const token = generateToken(user._id, user.roles);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates?.coordinates || [0, 0], // Use coordinates field
          county: user.location?.address?.county,
          town: user.location?.address?.town
        },
        profileStatus: user.profileStatus,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Check if user exists and include password
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (user.profileStatus !== 'active' && user.profileStatus !== 'verified') {
      return res.status(401).json({
        success: false,
        message: `Account is ${user.profileStatus}. Please contact support.`
      });
    }

    // Check password
    const isPasswordMatch = await user.comparePassword(password);
    
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user._id, user.roles);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates?.coordinates || [0, 0], // Use coordinates field
          county: user.location?.address?.county,
          town: user.location?.address?.town
        },
        profileStatus: user.profileStatus,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates?.coordinates || [0, 0], // Use coordinates field
          address: user.location?.address || {},
          landmark: user.location?.landmark
        },
        profileStatus: user.profileStatus,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, phone, location } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (location) {
      const locationData = parseLocationData(location);
      Object.assign(updateData, locationData);
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates?.coordinates || [0, 0], // Use coordinates field
          county: user.location?.address?.county,
          town: user.location?.address?.town
        },
        profileStatus: user.profileStatus,
        isVerified: user.isVerified
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update user location
// @route   PUT /api/auth/location
// @access  Private
const updateLocation = async (req, res) => {
  try {
    const { lat, lng, name, county, town } = req.body;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const updateData = {
      location: {
        name: name || 'Your Location',
        address: {
          county: county || '',
          town: town || ''
        }
      },
      coordinates: {
        type: 'Point',
        coordinates: [lng, lat] // Note: MongoDB expects [longitude, latitude]
      }
    };

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      location: {
        name: user.location?.name,
        coordinates: user.coordinates?.coordinates,
        county: user.location?.address?.county,
        town: user.location?.address?.town
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Find users near a location
// @route   GET /api/auth/users/nearby
// @access  Private
const getNearbyUsers = async (req, res) => {
  try {
    const { lat, lng, maxDistance = 5000, role, limit = 20 } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const query = {
      coordinates: { // Use coordinates field, not location.coordinates
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: parseInt(maxDistance) // in meters
        }
      },
      _id: { $ne: req.user.id }, // Exclude current user
      profileStatus: { $in: ['active', 'verified'] }
    };

    // Filter by role if specified
    if (role) {
      query.roles = role;
    }

    const users = await User.find(query)
      .select('name email phone roles location coordinates profileStatus')
      .limit(parseInt(limit));

    res.json({
      success: true,
      count: users.length,
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        roles: user.roles,
        location: {
          name: user.location?.name,
          coordinates: user.coordinates?.coordinates // Use coordinates field
        },
        profileStatus: user.profileStatus
      }))
    });
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Logout user (client-side token removal)
// @route   POST /api/auth/logout
// @access  Private
const logout = (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  updateLocation,
  getNearbyUsers,
  logout
};