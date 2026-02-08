require('dotenv').config();
const path = require('path');
const express = require('express');
const livereload = require('livereload');
const connectLivereload = require('connect-livereload');

const PORT = process.env.PORT || 3000;
const app = express();

// Start livereload server and watch the public directory
const lrserver = livereload.createServer();
lrserver.watch(path.join(__dirname, 'public'));

// Inject the livereload script into served HTML
app.use(connectLivereload());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple health endpoint
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
