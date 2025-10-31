require('dotenv').config();
const axios = require('axios');
const { localstorage } = require('./localstorage');

const API_KEY = process.env.ITCH_API_KEY;
const GAME_ID = process.env.GAME_ID;
const POLL_INTERVAL = 1000 * 60 * 10; // 10 minutes

// Track watcher status
let watcherStatus = {
    lastCheck: null,
    lastSuccess: null,
    lastError: null,
    checksCount: 0,
    updatesFound: 0
};

async function checkItchUpdates() {
    watcherStatus.lastCheck = new Date();
    watcherStatus.checksCount++;
    
    try {
        const response = await axios.get(`https://itch.io/api/1/${API_KEY}/game/${GAME_ID}/uploads`);
        const uploads = response.data.uploads;
        watcherStatus.lastSuccess = new Date();

        if (!uploads || uploads.length === 0) return;

        // Sort uploads by date (latest first)
        const latest = uploads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];

        const games = localstorage.getItem('games') || {};
        const storedVersion = games[GAME_ID]?.version || null;

        // Compare by upload ID or timestamp
        if (storedVersion !== latest.id) {
            console.log(`New version detected! Upload ID: ${latest.id}`);

            // Optional: fetch patch notes or changelog manually from your own system
            const patchNotes = `New build uploaded at ${latest.updated_at}`;

            // Update game version info
            const games = localstorage.getItem('games') || {};
            games[GAME_ID] = {
                version: latest.id,
                patchNotes,
                lastUpdated: new Date().toISOString()
            };
            localstorage.setItem('games', games);

            // Create automatic announcement for the update
            const announcements = localstorage.getItem('announcements') || [];
            const newAnnouncement = {
                id: Date.now().toString(),
                title: "New Game Update Available!",
                content: `Adventure Valley has been updated!\n\nPatch Notes:\n${patchNotes}`,
                type: "game-specific",
                gameId: GAME_ID,
                date: new Date().toISOString()
            };
            announcements.unshift(newAnnouncement);
            localstorage.setItem('announcements', announcements);
            
            console.log('Created automatic announcement for new version:', latest.id);
            watcherStatus.updatesFound++;

            console.log('Backend updated successfully.');
        } else {
            console.log('No new version found.');
        }

    } catch (err) {
        console.error('Error checking itch.io updates:', err.message);
        watcherStatus.lastError = {
            time: new Date(),
            message: err.message
        };
    }
}

// Export the function to start watching
function getWatcherStatus() {
    return {
        ...watcherStatus,
        pollIntervalMinutes: POLL_INTERVAL / (1000 * 60),
        gameId: GAME_ID
    };
}

function startItchWatcher() {
    // Run once on startup, then every interval
    checkItchUpdates();
    setInterval(checkItchUpdates, POLL_INTERVAL);
    console.log('Itch.io watcher started');
}

module.exports = { startItchWatcher, getWatcherStatus };
