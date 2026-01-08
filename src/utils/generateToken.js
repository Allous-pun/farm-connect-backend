const jwt = require('jsonwebtoken');

const generateToken = (userId, roles) => {
  return jwt.sign(
    { 
      id: userId,
      roles: roles 
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRE
    }
  );
};

module.exports = generateToken;