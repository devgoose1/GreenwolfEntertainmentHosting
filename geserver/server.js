const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const { localstorage } = require('./localstorage.js');
const { startItchWatcher } = require('./itchwatcher.js');

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
    games[gameId] = {
        version,
        patchNotes,
        lastUpdated: new Date().toISOString()
    };
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

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// Start server and itch watcher
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    // Start the itch watcher after server is running
    startItchWatcher();
});
