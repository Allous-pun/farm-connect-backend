// test-webhook-server.js
const express = require('express');
const app = express();
const PORT = 3001;

app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('📨 Webhook received:', {
    event: req.body.event,
    timestamp: req.body.timestamp,
    data: req.body.data,
    headers: {
      'X-Webhook-Id': req.headers['x-webhook-id'],
      'X-Webhook-Event': req.headers['x-webhook-event'],
      'X-Webhook-Signature': req.headers['x-webhook-signature']
    }
  });
  
  // Always respond with success
  res.json({ received: true, event: req.body.event });
});

app.listen(PORT, () => {
  console.log(`✅ Test webhook server running at http://localhost:${PORT}`);
});