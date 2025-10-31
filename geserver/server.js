const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const { localstorage } = require('./localstorage');
const { startItchWatcher, getWatcherStatus } = require('./itchwatcher');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// Rate limiting configuration
const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                  // 100 requests per window
    message: { error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 5,                    // 5 login attempts per window
    message: { error: 'Too many login attempts, please try again later' }
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 30,                   // 30 requests per window
    message: { error: 'Too many admin requests, please try again later' }
});

// Middleware setup
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// Apply rate limiting
app.use(defaultLimiter);              // Default limit for all routes
app.use('/users/login', authLimiter); // Stricter limit for login
app.use('/users/register', authLimiter); // Stricter limit for registration
app.use('/admin', adminLimiter);      // Moderate limit for admin routes

if (!fs.existsSync("db")) fs.mkdirSync("db");
if (!fs.existsSync("db/localstorage.json")) fs.writeFileSync("db/localstorage.json", "{}");

// Initialize storage if needed
if (!localstorage.getItem('games')) {
    localstorage.setItem('games', {});
}
if (!localstorage.getItem('announcements')) {
    localstorage.setItem('announcements', []);
}
if (!localstorage.getItem('admins')) {
    localstorage.setItem('admins', ['admin']); // Add default admin user
}
// Templates for automatic announcements (global and per-game)
if (!localstorage.getItem('templates')) {
    localstorage.setItem('templates', {
        global: "New update for {gameId}: version {version}\n\n{patchNotes}",
        perGame: {}
    });
}

// Initialize users storage
if (!localstorage.getItem('users')) {
    localstorage.setItem('users', {});
}

// Middleware to check admin authentication - JWT only
const isAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Invalid authentication. Use Bearer token.' });
    }

    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        if (!decoded.isAdmin) {
            return res.status(403).json({ error: 'Not authorized - admin access required' });
        }

        // Store user info for route handlers
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Routes

// Game version endpoints
app.post('/webhook/itch-io/:gameId', (req, res) => {
    const { gameId } = req.params;
    const { version, patchNotes } = req.body;

    const games = localstorage.getItem('games');
    // Maintain version history for the game
    const now = new Date().toISOString();
    if (!games[gameId]) games[gameId] = { version: null, patchNotes: null, lastUpdated: null, versions: [] };
    games[gameId].version = version;
    games[gameId].patchNotes = patchNotes;
    games[gameId].lastUpdated = now;
    // push to versions history (avoid duplicate by id)
    if (!games[gameId].versions) games[gameId].versions = [];
    const exists = games[gameId].versions.find(v => v.id === version);
    if (!exists) {
        games[gameId].versions.unshift({ id: version, patchNotes, detectedAt: now });
    }
    localstorage.setItem('games', games);

    res.json({ success: true });
});

app.get('/games/:gameId/version', (req, res) => {
    const { gameId } = req.params;
    const games = localstorage.getItem('games');
    const gameInfo = games[gameId];

    if (!gameInfo) {
        return res.status(404).json({ error: 'Game not found' });
    }

    res.json({
        current: gameInfo.version,
        lastUpdated: gameInfo.lastUpdated,
        patchNotes: gameInfo.patchNotes
    });
});

// Return version history for a game
app.get('/games/:gameId/versions', (req, res) => {
    const { gameId } = req.params;
    console.log(`GET /games/${gameId}/versions`);
    const games = localstorage.getItem('games');
    const gameInfo = games[gameId];

    // If the game doesn't exist yet, return an empty versions array
    if (!gameInfo) {
        return res.json({ versions: [] });
    }

    res.json({ versions: gameInfo.versions || [] });
});

// Announcement endpoints
app.post('/admin/announcements', isAdmin, (req, res) => {
    const { title, content, type, gameId } = req.body;
    const announcements = localstorage.getItem('announcements');

    const newAnnouncement = {
        id: Date.now().toString(),
        title,
        content,
        type, // 'global' or 'game-specific'
        gameId, // only for game-specific announcements
        date: new Date().toISOString()
    };

    announcements.unshift(newAnnouncement);
    localstorage.setItem('announcements', announcements);

    res.json(newAnnouncement);
});

// Edit announcement
app.put('/admin/announcements/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    const { title, content } = req.body;
    const announcements = localstorage.getItem('announcements');
    const idx = announcements.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Announcement not found' });
    if (title) announcements[idx].title = title;
    if (content) announcements[idx].content = content;
    announcements[idx].editedAt = new Date().toISOString();
    localstorage.setItem('announcements', announcements);
    res.json(announcements[idx]);
});

// Delete announcement
app.delete('/admin/announcements/:id', isAdmin, (req, res) => {
    const { id } = req.params;
    let announcements = localstorage.getItem('announcements');
    const idx = announcements.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Announcement not found' });
    const removed = announcements.splice(idx, 1)[0];
    localstorage.setItem('announcements', announcements);
    res.json({ success: true, removed });
});

app.get('/announcements', (req, res) => {
    const { gameId, type } = req.query;
    let announcements = localstorage.getItem('announcements');

    if (type === 'game-specific' && gameId) {
        announcements = announcements.filter(a => a.type === 'game-specific' && a.gameId === gameId);
    } else if (type === 'global') {
        announcements = announcements.filter(a => a.type === 'global');
    }

    res.json(announcements);
});

// Admin authentication (legacy token login still supported)
app.post('/admin/login', (req, res) => {
    const { token } = req.body;
    const admins = localstorage.getItem('admins') || [];

    if (admins.includes(token)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid admin token' });
    }
});

// User registration and login (JWT)
app.post('/users/register', async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const users = localstorage.getItem('users') || {};
    if (users[username]) return res.status(409).json({ error: 'User already exists' });

    const hash = await bcrypt.hash(password, 10);
    users[username] = {
        username,
        passwordHash: hash,
        displayName: displayName || username,
        friendlist: [],
        ownedGames: [],
        achievements: [],
        createdAt: new Date().toISOString()
    };
    localstorage.setItem('users', users);
    res.json({ success: true, user: { username, displayName: users[username].displayName } });
});

app.post('/users/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });

    const users = localstorage.getItem('users') || {};
    const user = users[username];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    // Determine isAdmin: user is admin if their username is in admins list
    const admins = localstorage.getItem('admins') || [];
    const isAdminUser = admins.includes(username);

    const token = jwt.sign({ username, displayName: user.displayName, isAdmin: isAdminUser }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, isAdmin: isAdminUser });
});

// Admin user management
app.post('/admin/users', isAdmin, (req, res) => {
    const { action, token } = req.body;
    const admins = localstorage.getItem('admins');

    if (action === 'add') {
        if (!admins.includes(token)) {
            admins.push(token);
            localstorage.setItem('admins', admins);
        }
    } else if (action === 'remove') {
        const index = admins.indexOf(token);
        if (index > -1) {
            admins.splice(index, 1);
            localstorage.setItem('admins', admins);
        }
    }

    res.json({ success: true });
});

// Templates management (get and set)
app.get('/templates', (req, res) => {
    const templates = localstorage.getItem('templates');
    res.json(templates || {});
});

app.post('/admin/templates', isAdmin, (req, res) => {
    // Accept { scope: 'global'|'perGame', gameId?, template }
    const { scope, gameId, template } = req.body;
    const templates = localstorage.getItem('templates') || { global: '', perGame: {} };
    if (scope === 'global') {
        templates.global = template;
    } else if (scope === 'perGame' && gameId) {
        templates.perGame[gameId] = template;
    } else {
        return res.status(400).json({ error: 'Invalid template payload' });
    }
    localstorage.setItem('templates', templates);
    res.json(templates);
});

// Health and status endpoints
app.get('/', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/status', (req, res) => {
    const status = getWatcherStatus();
    res.json({
        server: {
            status: 'ok',
            time: new Date().toISOString()
        },
        watcher: status
    });
});

// Admin: list all stored games and their version history
app.get('/admin/games', isAdmin, (req, res) => {
    const games = localstorage.getItem('games') || {};
    res.json(games);
});

// Download helper: return or redirect to download URL for a specific version if available
app.get('/games/:gameId/versions/download', (req, res) => {
    const { gameId } = req.params;
    const { version } = req.query;
    const games = localstorage.getItem('games') || {};
    const gameInfo = games[gameId];
    if (!gameInfo || !gameInfo.versions) return res.status(404).json({ error: 'Version not found' });
    const v = gameInfo.versions.find(x => x.id === version);
    if (!v) return res.status(404).json({ error: 'Version not found' });

    // try to find a URL in meta
    const url = (v.meta && (v.meta.file && v.meta.file.url)) || v.meta && (v.meta.url || v.meta.download_url);
    if (url) {
        // redirect to the file URL
        return res.redirect(url);
    }

    res.status(404).json({ error: 'No download URL available for this version' });
});

// Launcher communication endpoints
const launcherInstructions = new Map(); // gameId -> {version, action, timestamp}

// Launcher polls this endpoint to check for instructions
app.get('/launcher/poll', (req, res) => {
    const { gameId, clientId } = req.query;
    if (!gameId || !clientId) {
        return res.status(400).json({ error: 'Missing gameId or clientId' });
    }

    const instruction = launcherInstructions.get(gameId);
    if (instruction && Date.now() - instruction.timestamp < 30000) { // Instructions expire after 30s
        launcherInstructions.delete(gameId); // Consume the instruction
        res.json(instruction);
    } else {
        res.json({ action: 'idle' });
    }
});

// Frontend uses this to request a game launch
app.post('/launcher/launch', (req, res) => {
    const { gameId, version } = req.body;
    if (!gameId || !version) {
        return res.status(400).json({ error: 'Missing gameId or version' });
    }

    // Store launch instruction for the launcher to poll
    launcherInstructions.set(gameId, {
        action: 'launch',
        gameId,
        version,
        timestamp: Date.now()
    });

    res.json({ success: true });
});

// Start server and itch watcher
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    // Start the itch watcher after server is running
    startItchWatcher();
});
