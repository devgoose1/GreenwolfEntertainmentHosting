const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const { localstorage } = require('./localstorage');
const { startItchWatcher, getWatcherStatus } = require('./itchwatcher');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const IORedis = require('ioredis');
const axios = require('axios');

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.options(/.*/, cors());   // handles all preflight requests


// Rate limiting configuration
const defaultLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,                  // 100 requests per window
    message: { error: 'Too many requests, please try again later' }
});

// Note: we'll use a Redis-backed, username-aware limiter for auth routes (rate-limiter-flexible)
// Fallback to in-memory limiter when REDIS_URL is not provided
const AUTH_WINDOW_SECONDS = 15 * 60; // 15 minutes
const AUTH_POINTS = process.env.TEST_MODE === 'true' ? 1000 : 10; // 1000 attempts in test mode, 10 in production
const TEST_MODE = process.env.TEST_MODE === 'true';

if (TEST_MODE) {
    console.log('Running in TEST_MODE - auth rate limits increased');
}

let redisClient = null;
if (process.env.REDIS_URL) {
    try {
        redisClient = new IORedis(process.env.REDIS_URL);
        redisClient.on('error', (e) => console.warn('Redis error', e));
    } catch (e) {
        console.warn('Failed to initialize Redis client, falling back to memory limiter', e);
        redisClient = null;
    }
}

const authLimiterStore = redisClient ? new RateLimiterRedis({
    storeClient: redisClient,
    points: AUTH_POINTS,
    duration: AUTH_WINDOW_SECONDS,
    keyPrefix: TEST_MODE ? 'rl_auth_test' : 'rl_auth'
}) : new RateLimiterMemory({
    points: AUTH_POINTS,
    duration: AUTH_WINDOW_SECONDS
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
// Use express-rate-limit for general admin routes, but use authLimiterStore for username-aware login/register
app.use('/admin', adminLimiter);      // Moderate limit for admin routes

// Middleware to rate-limit auth routes by username (fallback to IP when username missing)
async function authRateLimiterMiddleware(req, res, next) {
    const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : null;
    const key = username ? `auth_${username}` : `ip_${req.ip}`;
    try {
        await authLimiterStore.consume(key, 1);
        return next();
    } catch (rejRes) {
        // rate limited
        return res.status(429).json({ error: 'Too many login attempts, please try again later' });
    }
}

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

// ADMIN_INIT support: on first run, allow creating a repeatable admin user from env vars
// Set ADMIN_INIT=username and ADMIN_INIT_PASSWORD=pass in your Render env to auto-create an admin user
console.log('Available env vars:', {
    ADMIN_INIT: process.env.ADMIN_INIT,
    TEST_MODE: process.env.TEST_MODE,
    // Don't log passwords in production
    HAS_ADMIN_PASS: !!process.env.ADMIN_INIT_PASSWORD
});

if (process.env.ADMIN_INIT) {
    const adminName = process.env.ADMIN_INIT;
    const adminPass = process.env.ADMIN_INIT_PASSWORD || null;
    console.log('ADMIN_INIT debug:', { 
        existingUsers: localstorage.getItem('users'),
        existingAdmins: localstorage.getItem('admins'),
        willCreateUser: true
    });
    
    const users = localstorage.getItem('users') || {};
    const admins = localstorage.getItem('admins') || [];

    (async () => {
        console.log('ADMIN_INIT: Starting user creation/update for', adminName);
        
        // Always update password if ADMIN_INIT_PASSWORD is provided
        if (adminPass) {
            const hash = await bcrypt.hash(adminPass, 10);
            if (!users[adminName]) {
                // Create new user
                users[adminName] = {
                    username: adminName,
                    passwordHash: hash,
                    displayName: adminName,
                    friendlist: [],
                    ownedGames: [],
                    achievements: [],
                    createdAt: new Date().toISOString()
                };
                console.log(`ADMIN_INIT: Created new user ${adminName}`);
            } else {
                // Update existing user's password
                users[adminName].passwordHash = hash;
                console.log(`ADMIN_INIT: Updated password for ${adminName}`);
            }
            
            try {
                localstorage.setItem('users', users);
                console.log('Updated users storage:', localstorage.getItem('users'));
            } catch (err) {
                console.error('ADMIN_INIT: Failed to save user:', err);
            }
        } else {
            console.log('ADMIN_INIT: Skipping password update (no ADMIN_INIT_PASSWORD provided)');
        }

        if (!admins.includes(adminName)) {
            admins.push(adminName);
            localstorage.setItem('admins', admins);
            console.log(`ADMIN_INIT: made ${adminName} an admin`);
        }
    })();
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

// Return version history for a game (try localstorage first; if empty, attempt itch.io fetch & populate)
app.get('/games/:gameId/versions', async (req, res) => {
    const { gameId } = req.params;
    console.log(`GET /games/${gameId}/versions`);
    const games = localstorage.getItem('games') || {};
    let gameInfo = games[gameId];

    // If we have no game or no versions, attempt to fetch from itch.io (best-effort)
    try {
        if (!gameInfo || !Array.isArray(gameInfo.versions) || gameInfo.versions.length === 0) {
            console.log(`No local versions for ${gameId} — attempting itch.io fetch...`);
            const uploads = await fetchItchUploadsForGame(gameId);

            if (uploads && uploads.length > 0) {
                // ensure game structure
                if (!gameInfo) {
                    gameInfo = { version: null, patchNotes: null, lastUpdated: null, versions: [] };
                    games[gameId] = gameInfo;
                }
                // map uploads into versions (most recent first)
                const newVersions = uploads
                    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
                    .map(normalizeUploadToVersion);

                // merge: avoid duplicates by id, put newest first
                const existingIds = new Set((gameInfo.versions || []).map(v => String(v.id)));
                for (const v of newVersions) {
                    if (!existingIds.has(String(v.id))) {
                        gameInfo.versions = gameInfo.versions || [];
                        gameInfo.versions.unshift(v);
                    }
                }

                // update current version if missing
                if (!gameInfo.version && gameInfo.versions.length > 0) {
                    gameInfo.version = gameInfo.versions[0].id;
                    gameInfo.patchNotes = gameInfo.versions[0].patchNotes;
                    gameInfo.lastUpdated = new Date().toISOString();
                }

                // persist
                localstorage.setItem('games', games);
                console.log(`Populated ${gameId} versions from itch.io (${gameInfo.versions.length} items)`);
            } else {
                console.log(`No uploads returned from itch.io for ${gameId}`);
            }
        }
    } catch (err) {
        console.warn(`Itch fetch/populate for ${gameId} failed:`, err.message);
        // proceed — we'll return whatever is present (likely empty)
    }

    // Re-fetch gameInfo after potential populate
    const refreshedGames = localstorage.getItem('games') || {};
    const refreshedGameInfo = refreshedGames[gameId];

    if (!refreshedGameInfo) {
        return res.json({ versions: [] });
    }

    return res.json({ versions: refreshedGameInfo.versions || [] });
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

app.get('/admin/backup', isAdmin, (req, res) => {
    const filePath = path.join(__dirname, 'db', 'localstorage.json');

    // Format timestamp as dd-mm-yyyy_hh-mm-ss
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timestamp = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;

    const backupFileName = `backup-${timestamp}.json`;
    const backupDir = path.join(__dirname, 'backups');
    const backupPath = path.join(backupDir, backupFileName);

    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);

    fs.copyFile(filePath, backupPath, (err) => {
        if (err) return res.status(500).send('Backup failed');
        res.download(backupPath, backupFileName, (err) => {
            if (err) console.error('Error sending backup:', err);
        });
    });
});



app.post('/admin/restore', isAdmin, upload.single('backupFile'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded');

    const tempPath = req.file.path;
    const targetDir = path.join(__dirname, 'db');
    const targetPath = path.join(targetDir, 'localstorage.json');

    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir);

    console.log('DEBUG: restoring from', tempPath, 'to', targetPath);

    fs.copyFile(tempPath, targetPath, (err) => {
        fs.unlink(tempPath, () => {}); // remove temp file
        if (err) {
            console.error('Restore failed:', err);
            return res.status(500).send('Restore failed');
        }
        res.send('Database restored successfully!');
    });
});



// User registration and login (JWT)
app.post('/users/register', authRateLimiterMiddleware, async (req, res) => {
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

app.post('/users/login', authRateLimiterMiddleware, async (req, res) => {
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

// Redirect to the itch.io download URL for a specific version
app.get('/games/:gameId/versions/download', async (req, res) => {
    const { gameId } = req.params;
    const { version } = req.query;

    const games = localstorage.getItem('games') || {};
    const gameInfo = games[gameId];
    if (!gameInfo) return res.status(404).json({ error: 'Version not found' });

    const v = gameInfo.versions.find(x => x.id.toString() === version.toString());
    if (!v) return res.status(404).json({ error: 'Version not found' });

    try {
        // Call itch.io API with API key
        const response = await axios.get(`https://itch.io/api/1/${process.env.ITCH_API_KEY}/upload/${v.id}/download`);
        if (!response.data.url) return res.status(404).json({ error: 'No download URL available' });

        // Return the URL to frontend
        res.json({ url: response.data.url });
    } catch (err) {
        console.error('Failed to get download link:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to get download link' });
    }
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

const ITCH_API_KEY = process.env.ITCH_API_KEY; // put your itch.io API key in .env
const ITCH_GAME_ID = '3999675'; // your itch.io game id

// Helper: fetch uploads from itch.io for a given gameId (returns array or throws)
async function fetchItchUploadsForGame(gameId) {
    if (!ITCH_API_KEY) throw new Error('ITCH_API_KEY not configured');

    const url = `https://itch.io/api/1/${ITCH_API_KEY}/game/${gameId}/uploads`;
    const resp = await axios.get(url, { timeout: 15000 });
    if (!resp || !resp.data) throw new Error('Invalid response from itch.io');
    return resp.data.uploads || [];
}

// Helper: normalize itch upload into the shape we store in localstorage
function normalizeUploadToVersion(upload) {
    const detectedAt = new Date().toISOString();
    return {
        id: String(upload.id),
        patchNotes: upload.metadata?.notes || `Upload ${upload.id}`,
        detectedAt,
        uploadedAt: upload.updated_at || null,
        meta: upload
    };
}


// Return all itch.io uploads (versions) for the configured ITCH_GAME_ID (useful for admin debugging)
app.get('/itch/versions', async (req, res) => {
    try {
        const url = `https://itch.io/api/1/${ITCH_API_KEY}/game/${ITCH_GAME_ID}/uploads`;
        console.log("Fetching from:", url);
        const response = await fetch(url);

        console.log("HTTP status:", response.status);
        const text = await response.text();
        console.log("Raw response:", text);

        if (!response.ok) {
            return res.status(response.status).json({ error: `Itch.io API error: ${text}` });
        }

        const data = JSON.parse(text);

        if (!data.uploads) {
            return res.json({ versions: [] });
        }

        const versions = data.uploads.map(u => ({
            id: u.id,
            filename: u.filename,
            platform: u.metadata?.platform || 'unknown',
            version: u.metadata?.version || u.filename
        }));

        res.json({ versions });
    } catch (err) {
        console.error("Detailed error:", err);
        res.status(500).json({ error: 'Failed to fetch itch.io versions' });
    }
});


/*// Get direct download link for a specific upload ID (uses itch API)
app.get('/itch/download/:uploadId', async (req, res) => {
    const { uploadId } = req.params;
    const ITCH_API_KEY = process.env.ITCH_API_KEY;

    try {
        const response = await axios.get(`https://itch.io/api/1/${ITCH_API_KEY}/upload/${uploadId}/download`);
        const data = response.data;

        if (data.url) {
            // Redirect browser directly to the itch.io signed URL
            return res.redirect(data.url);
        } else {
            return res.status(404).json({ error: 'No download URL available for this upload' });
        }
    } catch (err) {
        console.error('Error fetching itch.io download link:', err.response?.data || err.message);
        return res.status(500).json({ error: 'Failed to get download link' });
    }
});*/

// Get direct download link for a specific upload ID
app.get('/itch/download/:uploadId', async (req, res) => {
    const { uploadId } = req.params;
    const ITCH_API_KEY = process.env.ITCH_API_KEY;

    console.log('DEBUG: /itch/download called with uploadId:', uploadId);

    if (!ITCH_API_KEY) {
        console.error('DEBUG: Missing ITCH_API_KEY in env!');
        return res.status(500).json({ error: 'Server misconfiguration: missing ITCH_API_KEY' });
    }

    try {
        const response = await axios.get(`https://itch.io/api/1/${ITCH_API_KEY}/upload/${uploadId}/download`);
        console.log('DEBUG: Itch.io response data:', response.data);

        if (response.data && response.data.url) {
            return res.json({ url: response.data.url });
        } else {
            console.error('DEBUG: No URL returned from itch.io API for uploadId', uploadId);
            return res.status(404).json({ error: 'No download URL available for this upload' });
        }

    } catch (err) {
        console.error('DEBUG: Failed to get download link:', err.response?.data || err.message);
        return res.status(500).json({ error: 'Failed to get download link', details: err.response?.data || err.message });
    }
});


// Admin: force resync versions for a given game from itch.io
app.post('/admin/games/:gameId/sync', isAdmin, async (req, res) => {
    const { gameId } = req.params;
    try {
        const uploads = await fetchItchUploadsForGame(gameId);
        if (!uploads || uploads.length === 0) {
            return res.json({ success: true, message: 'No uploads found on itch.io' });
        }

        const games = localstorage.getItem('games') || {};
        if (!games[gameId]) games[gameId] = { version: null, patchNotes: null, lastUpdated: null, versions: [] };

        const normalized = uploads
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .map(normalizeUploadToVersion);

        // merge unique ids
        const existingIds = new Set((games[gameId].versions || []).map(v => String(v.id)));
        for (const v of normalized) {
            if (!existingIds.has(String(v.id))) games[gameId].versions.unshift(v);
        }

        // update current if missing or newer
        if (!games[gameId].version && games[gameId].versions.length > 0) {
            games[gameId].version = games[gameId].versions[0].id;
            games[gameId].patchNotes = games[gameId].versions[0].patchNotes;
            games[gameId].lastUpdated = new Date().toISOString();
        }

        localstorage.setItem('games', games);
        res.json({ success: true, versions: games[gameId].versions || [] });
    } catch (err) {
        console.error('Admin sync failed for', gameId, err.message || err);
        res.status(500).json({ error: 'Failed to sync from itch.io' });
    }
});


app.get('/debug/versions/:gameId', (req, res) => {
    const { gameId } = req.params;
    const games = localstorage.getItem('games') || {};
    console.log('DEBUG: /debug/versions for', gameId, games[gameId]?.versions);
    res.json({ versions: games[gameId]?.versions || [] });
});

app.get("/status", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});



// Start server and itch watcher
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    // Start the itch watcher after server is running
    startItchWatcher();
});
