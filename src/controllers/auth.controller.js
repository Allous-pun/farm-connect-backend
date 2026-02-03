const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const { validationResult } = require('express-validator');

const COUNTY_COORDS = {
  Nairobi: [36.8172, -1.2864],
  Mombasa: [39.6682, -4.0435],
  Kisumu: [34.7617, -0.0917],
  Nakuru: [36.0667, -0.3031],
  Eldoret: [35.2698, 0.5143],
  Thika: [37.0736, -1.0330],
  Kakamega: [34.7500, 0.2833],
  Kisii: [34.7833, -0.6833],
  Meru: [37.6493, 0.0471],
  Nyeri: [36.9478, -0.4167],
  Machakos: [37.2667, -1.5167],
  Kiambu: [36.8356, -1.1711],
  Muranga: [37.1500, -0.7833],
  Kirinyaga: [37.2833, -0.6833],
  Nyandarua: [36.3833, -0.5333],
  Laikipia: [36.8333, 0.4167],
  Narok: [35.8667, -1.0833],
  Kajiado: [36.7833, -1.8333],
  Makueni: [37.6333, -1.8167],
  Kitui: [38.0167, -1.3667],
  Garissa: [39.6500, -0.4500],
  Wajir: [40.0667, 1.7500],
  Mandera: [41.8500, 3.9333],
  Marsabit: [36.9167, 2.3333],
  Isiolo: [37.5833, 0.3500],
  Lamu: [40.9000, -2.2667],
  TanaRiver: [40.1167, -1.2000],
  Kilifi: [39.8500, -3.6333],
  Kwale: [39.4167, -4.1833],
  "Taita Taveta": [38.3667, -3.3667],
  Busia: [34.1000, 0.4500],
  Siaya: [34.2833, 0.0667],
  "Homa Bay": [34.6333, -0.5333],
  Migori: [34.4667, -1.0667],
  Bomet: [35.3500, -0.7667],
  Kericho: [35.2833, -0.3667],
  Bungoma: [34.5667, 0.5667],
  Vihiga: [34.7333, 0.0833],
  "Trans Nzoia": [35.0000, 1.0333],
  "Uasin Gishu": [35.2833, 0.5167],
  "Elgeyo Marakwet": [35.5667, 0.6333],
  Nandi: [35.1000, 0.1333],
  Baringo: [35.9833, 0.5000],
  Samburu: [37.5167, 0.5333],
  Turkana: [36.0000, 3.1000],
  "West Pokot": [35.5000, 1.2333],
};

/**
 * Normalize location input into:
 * { location: {...}, coordinates: { type: 'Point', coordinates: [lng, lat] } }
 * Any county not in COUNTY_COORDS defaults to Nairobi coordinates.
 */
const parseLocationData = (location) => {
  const defaultCoords = COUNTY_COORDS['Nairobi'];

  let coordinates = { type: 'Point', coordinates: defaultCoords };
  let locationData = {};

  if (!location) return { location: locationData, coordinates };

  // CASE 1: GPS object { lat, lng, ... }
  if (typeof location === 'object' && typeof location.lat === 'number' && typeof location.lng === 'number') {
    coordinates.coordinates = [Number(location.lng), Number(location.lat)];
    locationData = {
      name: location.name || 'Your Location',
      address: {
        county: location.county || null,
        subCounty: location.subCounty || null,
        ward: location.ward || null,
        town: location.town || null,
        street: location.street || null,
      },
      landmark: location.landmark || null,
    };
    return { location: locationData, coordinates };
  }

  // CASE 2: Object with county info (no GPS)
  if (typeof location === 'object' && location.county) {
    const fallback = COUNTY_COORDS[location.county] || defaultCoords; // fallback to Nairobi if county not found
    coordinates.coordinates = fallback;
    locationData = {
      name: location.county,
      address: { county: location.county, town: location.town || null },
    };
    return { location: locationData, coordinates };
  }

  // CASE 3: Simple string
  if (typeof location === 'string') {
    const fallback = COUNTY_COORDS[location] || defaultCoords; // fallback to Nairobi
    coordinates.coordinates = fallback;
    locationData = { name: location };
    return { location: locationData, coordinates };
  }

  // Fallback
  return { location: {}, coordinates };
};

/**
 * Format user response with role-specific data
 */
const formatUserResponse = (user) => {
  const baseResponse = {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
    primaryRole: user.primaryRole,
    bio: user.bio,
    location: {
      name: user.location?.name,
      coordinates: user.coordinates?.coordinates || [0, 0],
      county: user.location?.address?.county,
      town: user.location?.address?.town
    },
    profileStatus: user.profileStatus,
    isVerified: user.isVerified,
    ratings: user.ratings || [],
    averageRating: user.averageRating || 0,
    roleRatings: user.roleRatings || {
      farmer: { average: 0, count: 0 },
      transport: { average: 0, count: 0 },
      storage: { average: 0, count: 0 }
    },
    transactions: user.transactions || [],
    totalTransactions: user.totalTransactions || 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };

  // Add role-specific info
  if (user.roleSpecificInfo) {
    baseResponse.roleInfo = {};
    
    if (user.roles.includes('farmer') && user.roleSpecificInfo.farmer) {
      baseResponse.roleInfo.farmer = user.roleSpecificInfo.farmer;
    }
    
    if (user.roles.includes('transport') && user.roleSpecificInfo.transport) {
      baseResponse.roleInfo.transport = user.roleSpecificInfo.transport;
    }
    
    if (user.roles.includes('storage') && user.roleSpecificInfo.storage) {
      baseResponse.roleInfo.storage = user.roleSpecificInfo.storage;
    }
  }

  return baseResponse;
};

/* ======================================================
   REGISTER
====================================================== */
const register = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, phone, roles, location, roleInfo } = req.body;

    // Validate roles
    const validRoles = ['farmer', 'transport', 'storage', 'admin'];
    if (roles) {
      const invalidRoles = roles.filter(role => !validRoles.includes(role));
      if (invalidRoles.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid roles: ${invalidRoles.join(', ')}`
        });
      }
    }

    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ success: false, message: 'User already exists with this email' });

    const { location: loc, coordinates } = parseLocationData(location);

    // CLEAN coordinates for MongoDB
    const cleanCoordinates = {
      type: 'Point',
      coordinates: [Number(coordinates.coordinates[0]), Number(coordinates.coordinates[1])],
    };

    // Prepare role-specific info
    const roleSpecificInfo = {};
    if (roleInfo) {
      const userRoles = roles || ['farmer'];
      
      userRoles.forEach(role => {
        if (roleInfo[role]) {
          roleSpecificInfo[role] = roleInfo[role];
        }
      });
    }

    const user = await User.create({
      email,
      password,
      name,
      phone,
      roles: roles || ['farmer'],
      location: loc,
      coordinates: cleanCoordinates,
      roleSpecificInfo
    });

    const token = generateToken(user._id, user.roles);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ======================================================
   LOGIN
====================================================== */
const login = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (!['active', 'verified'].includes(user.profileStatus))
      return res.status(401).json({ success: false, message: `Account is ${user.profileStatus}` });

    const token = generateToken(user._id, user.roles);

    res.json({
      success: true,
      token,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/* ======================================================
   GET PROFILE
====================================================== */
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -__v');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   UPDATE PROFILE
====================================================== */
const updateProfile = async (req, res) => {
  try {
    const { name, phone, location } = req.body;
    const update = {};
    
    if (name) update.name = name;
    if (phone) update.phone = phone;

    if (location) {
      const parsed = parseLocationData(location);
      update.location = parsed.location;
      update.coordinates = {
        type: 'Point',
        coordinates: [Number(parsed.coordinates.coordinates[0]), Number(parsed.coordinates.coordinates[1])],
      };
    }

    const user = await User.findByIdAndUpdate(
      req.user.id, 
      update, 
      { new: true, runValidators: true }
    ).select('-password -__v');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   UPDATE ROLE-SPECIFIC PROFILE
====================================================== */
const updateRoleProfile = async (req, res) => {
  try {
    const { role, data } = req.body;
    const userId = req.user.id;
    
    // Validate role
    if (!['farmer', 'transport', 'storage'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified'
      });
    }
    
    // Check if user has this role
    const user = await User.findById(userId);
    if (!user.roles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: `User doesn't have ${role} role`
      });
    }
    
    // Update role-specific data
    const updatedUser = await user.updateRoleInfo(role, data);
    
    res.json({
      success: true,
      message: `${role} profile updated successfully`,
      user: formatUserResponse(updatedUser)
    });
    
  } catch (error) {
    console.error('Update role profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   GET USERS BY ROLE
====================================================== */
const getUsersByRole = async (req, res) => {
  try {
    const { role } = req.params;
    const { lat, lng, maxDistance = 50000, available } = req.query;
    
    // Validate role
    if (!['farmer', 'transport', 'storage'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified'
      });
    }
    
    let query = { 
      roles: role, 
      profileStatus: { $in: ['active', 'verified'] } 
    };
    
    // Add role-specific filters
    if (role === 'transport' && available === 'true') {
      query['roleSpecificInfo.transport.availability'] = true;
    }
    
    if (role === 'storage' && available === 'true') {
      query['roleSpecificInfo.storage.availableCapacity'] = { $gt: 0 };
    }
    
    // Add location filter if coordinates provided
    if (lat && lng) {
      query.coordinates = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [Number(lng), Number(lat)]
          },
          $maxDistance: Number(maxDistance)
        }
      };
    }
    
    const users = await User.find(query)
      .select('name email phone roles location coordinates profileStatus roleSpecificInfo averageRating roleRatings totalTransactions')
      .limit(50);
    
    const formattedUsers = users.map(user => {
      const baseUser = {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        roles: user.roles,
        location: user.location,
        coordinates: user.coordinates?.coordinates || [0, 0],
        profileStatus: user.profileStatus,
        averageRating: user.averageRating,
        roleSpecificRating: user.roleRatings?.[role]?.average || 0,
        ratingCount: user.roleRatings?.[role]?.count || 0,
        totalTransactions: user.totalTransactions || 0
      };
      
      // Add role-specific info
      if (user.roleSpecificInfo && user.roleSpecificInfo[role]) {
        baseUser.roleInfo = user.roleSpecificInfo[role];
      }
      
      return baseUser;
    });
    
    res.json({
      success: true,
      count: formattedUsers.length,
      role: role,
      users: formattedUsers
    });
    
  } catch (error) {
    console.error('Get users by role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   UPDATE LOCATION (GPS ONLY)
====================================================== */
const updateLocation = async (req, res) => {
  const { lat, lng, name } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number')
    return res.status(400).json({ success: false, message: 'Latitude and longitude are required' });

  const user = await User.findByIdAndUpdate(
    req.user.id,
    { location: { name: name || 'Your Location' }, coordinates: { type: 'Point', coordinates: [Number(lng), Number(lat)] } },
    { new: true }
  );

  res.json({ 
    success: true, 
    location: { 
      name: user.location?.name, 
      coordinates: user.coordinates.coordinates,
      county: user.location?.address?.county,
      town: user.location?.address?.town
    } 
  });
};

/* ======================================================
   NEARBY USERS
====================================================== */
const getNearbyUsers = async (req, res) => {
  const { lat, lng, maxDistance = 5000, role } = req.query;
  if (!lat || !lng) return res.status(400).json({ success: false, message: 'Latitude and longitude required' });

  const query = {
    coordinates: { 
      $near: { 
        $geometry: { 
          type: 'Point', 
          coordinates: [Number(lng), Number(lat)] 
        }, 
        $maxDistance: Number(maxDistance) 
      } 
    },
    profileStatus: { $in: ['active', 'verified'] },
  };

  // Filter by role if specified
  if (role && ['farmer', 'transport', 'storage'].includes(role)) {
    query.roles = role;
  }

  const users = await User.find(query)
    .select('name roles location coordinates profileStatus roleSpecificInfo averageRating')
    .limit(30);

  res.json({ 
    success: true, 
    count: users.length,
    users: users.map(user => ({
      id: user._id,
      name: user.name,
      roles: user.roles,
      primaryRole: user.primaryRole,
      location: {
        name: user.location?.name,
        coordinates: user.coordinates.coordinates,
        county: user.location?.address?.county
      },
      profileStatus: user.profileStatus,
      averageRating: user.averageRating
    }))
  });
};

/* ======================================================
   GET USER BY ID
====================================================== */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -__v');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   SUBMIT RATING FOR USER WITH ROLE CONTEXT
====================================================== */
const submitRating = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { rating, comment, roleContext } = req.body;
    const userId = req.params.id;
    const raterId = req.user.id;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Prevent self-rating
    if (userId === raterId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot rate yourself'
      });
    }

    // Validate roleContext if provided
    if (roleContext && !['farmer', 'transport', 'storage'].includes(roleContext)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role context'
      });
    }

    // Check if user has the role being rated
    if (roleContext && !user.roles.includes(roleContext)) {
      return res.status(400).json({
        success: false,
        message: `User doesn't have ${roleContext} role`
      });
    }

    // Check if rater has already rated this user for this role
    const existingRating = user.ratings.find(r => 
      r.fromUserId.toString() === raterId && 
      r.roleContext === roleContext
    );

    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: `You have already rated this user as ${roleContext || 'general'}`
      });
    }

    // Add rating
    const newRating = await user.addRating({
      fromUserId: raterId,
      rating: parseInt(rating),
      comment: comment || '',
      roleContext: roleContext || null
    });

    res.json({
      success: true,
      message: 'Rating submitted successfully',
      rating: newRating,
      averageRating: user.averageRating,
      roleSpecificRating: roleContext ? user.roleRatings[roleContext] : null
    });
  } catch (error) {
    console.error('Submit rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   UPDATE USER PROFILE WITH BIO AND FARM INFO
====================================================== */
const updateProfileDetails = async (req, res) => {
  try {
    const { name, phone, bio, farm } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (bio) updateData.bio = bio;
    if (farm) updateData.farm = farm;

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
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Update profile details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   GET USER RATINGS WITH ROLE FILTER
====================================================== */
const getUserRatings = async (req, res) => {
  try {
    const { role } = req.query;
    
    const user = await User.findById(req.params.id)
      .select('ratings averageRating roleRatings name roles');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    let filteredRatings = user.ratings || [];
    
    // Filter by role if specified
    if (role && ['farmer', 'transport', 'storage'].includes(role)) {
      filteredRatings = filteredRatings.filter(rating => rating.roleContext === role);
    }

    // Populate fromUserId with user details
    const populatedRatings = await Promise.all(
      filteredRatings.map(async (rating) => {
        const rater = await User.findById(rating.fromUserId)
          .select('name roles');
        return {
          ...rating.toObject(),
          fromUser: rater ? {
            id: rater._id,
            name: rater.name,
            primaryRole: rater.primaryRole
          } : null
        };
      })
    );

    res.json({
      success: true,
      ratings: populatedRatings,
      averageRating: user.averageRating || 0,
      roleRatings: user.roleRatings || {
        farmer: { average: 0, count: 0 },
        transport: { average: 0, count: 0 },
        storage: { average: 0, count: 0 }
      },
      userName: user.name,
      userRoles: user.roles,
      filteredByRole: role || 'all'
    });
  } catch (error) {
    console.error('Get user ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   GET ROLE-SPECIFIC STATS
====================================================== */
const getRoleStats = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const stats = {
      roles: user.roles,
      roleInfo: {},
      roleStats: {}
    };

    // Add role-specific info and stats
    user.roles.forEach(role => {
      if (user.roleSpecificInfo && user.roleSpecificInfo[role]) {
        stats.roleInfo[role] = user.roleSpecificInfo[role];
      }
      
      if (user.roleRatings && user.roleRatings[role]) {
        stats.roleStats[role] = user.roleRatings[role];
      } else {
        stats.roleStats[role] = { average: 0, count: 0 };
      }
    });

    // Count transactions by role
    if (user.transactions && user.transactions.length > 0) {
      const transactionCounts = {};
      user.roles.forEach(role => {
        transactionCounts[role] = user.transactions.filter(
          t => t.roleInvolved === role
        ).length;
      });
      stats.transactionCounts = transactionCounts;
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get role stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   ADD/REMOVE ROLES (ADMIN ONLY)
====================================================== */
const updateUserRoles = async (req, res) => {
  try {
    const { userId, roles } = req.body;
    
    // Check if current user is admin
    if (!req.user.roles.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    // Validate roles
    const validRoles = ['farmer', 'transport', 'storage', 'admin'];
    const invalidRoles = roles.filter(role => !validRoles.includes(role));
    
    if (invalidRoles.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid roles: ${invalidRoles.join(', ')}`
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { roles },
      { new: true, runValidators: true }
    ).select('-password -__v');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User roles updated successfully',
      user: formatUserResponse(user)
    });
  } catch (error) {
    console.error('Update user roles error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

/* ======================================================
   LOGOUT
====================================================== */
const logout = (req, res) => res.json({ success: true, message: 'Logged out' });

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  updateRoleProfile,
  getUsersByRole,
  updateLocation,
  getNearbyUsers,
  logout,
  getUserById,
  submitRating,
  updateProfileDetails,
  getUserRatings,
  getRoleStats,
  updateUserRoles
};