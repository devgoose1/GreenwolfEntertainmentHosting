const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const { localstorage } = require('./localstorage');
const { startItchWatcher, getWatcherStatus } = require('./itchwatcher');

const app = express();
const PORT = process.env.PORT || 5000;

// Helper functions
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

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

// Middleware to check admin authentication
const isAdmin = (req, res, next) => {
    const authToken = req.headers.authorization;
    if (!authToken) {
        return res.status(401).json({ error: 'No authentication token provided' });
    }

    const adminUsers = localstorage.getItem('admins');
    if (adminUsers.includes(authToken)) {
        next();
    } else {
        res.status(403).json({ error: 'Not authorized' });
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

// Admin authentication
app.post('/admin/login', (req, res) => {
    const { token } = req.body;
    const admins = localstorage.getItem('admins');

    if (admins.includes(token)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Invalid admin token' });
    }
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

// Start server and itch watcher
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    // Start the itch watcher after server is running
    startItchWatcher();
});
