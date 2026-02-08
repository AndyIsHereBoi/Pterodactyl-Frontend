require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const express = require('express');
const connectLivereload = require('connect-livereload');
const livereload = require('livereload');

const lrserver = livereload.createServer();
const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'Pterodactyl Frontend';

lrserver.watch(path.join(__dirname, 'public'));

app.use(connectLivereload());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configure EJS view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Serve templated pages (titles/headers reflect APP_NAME)
app.get('/login.html', (req, res) => res.render('login', { appName: APP_NAME }));
app.get('/dashboard.html', (req, res) => res.render('dashboard', { appName: APP_NAME }));
app.get('/index.html', (req, res) => res.render('index', { appName: APP_NAME }));

// Redirect root to login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Mount API router
app.use('/api', require('./index_api'));

// Note: API endpoints live in `index_api.js`

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
