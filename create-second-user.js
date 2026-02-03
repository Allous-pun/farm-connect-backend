// create-second-user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function createSecondUser() {
  try {
    await mongoose.connect('mongodb://localhost:27017/farm-connect');
    
    const User = require('./src/models/User');
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('partner123', salt);
    
    const user = new User({
      name: 'Chat Partner',
      email: 'partner@example.com',
      password: hashedPassword,
      roles: ['farmer'],
      profileStatus: 'active',
      location: {
        type: 'Point',
        coordinates: [36.8172, -1.2864]
      },
      locationDetails: {
        address: {
          county: 'Nairobi'
        }
      }
    });
    
    await user.save();
    
    console.log('✅ Second user created successfully!');
    console.log('ID:', user._id);
    console.log('Email: partner@example.com');
    console.log('Password: partner123');
    
    // Get JWT token for this user (by simulating login)
    const axios = require('axios');
    const loginRes = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'partner@example.com',
      password: 'partner123'
    });
    
    console.log('Partner token:', loginRes.data.token);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.connection.close();
  }
}

createSecondUser();