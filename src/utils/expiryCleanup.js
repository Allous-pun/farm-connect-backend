const cron = require('node-cron');
const Listing = require('../models/Listing');

// Run every hour to check for expired listings
cron.schedule('0 * * * *', async () => {
  try {
    const expiredListings = await Listing.updateMany(
      {
        status: 'active',
        expiryDate: { $lte: new Date() }
      },
      {
        status: 'expired',
        closedAt: new Date()
      }
    );

    console.log(`Expired ${expiredListings.modifiedCount} listings at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('Error in expiry cleanup:', error);
  }
});

module.exports = cron;