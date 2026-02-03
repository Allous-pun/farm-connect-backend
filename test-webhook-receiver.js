// test-webhook-receiver.js
const express = require('express');
const app = express();
const PORT = 9999;

app.use(express.json());

// Simple webhook receiver
app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString();
  console.log('\n=== 📨 WEBHOOK RECEIVED ===');
  console.log('Time:', timestamp);
  console.log('Event:', req.body.event);
  console.log('Webhook ID:', req.body.webhookId);
  console.log('Headers:', {
    'X-Webhook-Id': req.headers['x-webhook-id'],
    'X-Webhook-Event': req.headers['x-webhook-event'],
    'X-Webhook-Signature': req.headers['x-webhook-signature']
  });
  console.log('Data:', JSON.stringify(req.body.data, null, 2));
  console.log('=== END ===\n');
  
  // Always respond with success
  res.json({ 
    received: true, 
    event: req.body.event,
    timestamp: timestamp
  });
});

// Health check
app.get('/', (req, res) => {
  res.send('Webhook Test Server is running!');
});

app.listen(PORT, () => {
  console.log(`✅ Test webhook server running at http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});