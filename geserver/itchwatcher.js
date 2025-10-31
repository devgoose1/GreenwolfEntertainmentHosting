require('dotenv').config();
const axios = require('axios');
const { localstorage } = require('./localstorage');

const API_KEY = process.env.ITCH_API_KEY;
// Support multiple game IDs via comma-separated env var
const GAME_IDS = (process.env.GAME_IDS || process.env.GAME_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const POLL_INTERVAL = (process.env.POLL_INTERVAL_MS && Number(process.env.POLL_INTERVAL_MS)) || 1000 * 60 * 10; // default 10 minutes
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || null;

// Watcher status
let watcherStatus = {
    lastCheck: null,
    lastSuccess: null,
    lastError: null,
    checksCount: 0,
    updatesFound: 0,
    perGame: {}
};

async function notifyDiscord(message) {
    if (!DISCORD_WEBHOOK) return;
    try {
        await axios.post(DISCORD_WEBHOOK, { content: message });
    } catch (err) {
        console.error('Discord notify failed:', err.message);
    }
}

async function checkItchUpdates() {
    watcherStatus.lastCheck = new Date().toISOString();
    watcherStatus.checksCount++;

    for (const GAME_ID of GAME_IDS) {
        watcherStatus.perGame[GAME_ID] = watcherStatus.perGame[GAME_ID] || {
            lastCheck: null,
            lastSuccess: null,
            lastError: null,
            updatesFound: 0
        };
        watcherStatus.perGame[GAME_ID].lastCheck = new Date().toISOString();

        try {
            const response = await axios.get(`https://itch.io/api/1/${API_KEY}/game/${GAME_ID}/uploads`);
            const uploads = response.data.uploads || [];

            watcherStatus.lastSuccess = new Date().toISOString();
            watcherStatus.perGame[GAME_ID].lastSuccess = new Date().toISOString();

            if (!uploads.length) continue;

            // Sort uploads by date (latest first)
            uploads.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

            const games = localstorage.getItem('games') || {};
            if (!games[GAME_ID]) games[GAME_ID] = { version: null, patchNotes: null, lastUpdated: null, versions: [] };

            let latestUpload = uploads[0];
            let newVersionDetected = false;

            // Loop through uploads to populate versions array
            for (const upload of uploads) {
                const exists = games[GAME_ID].versions.find(v => v.id === upload.id);
                if (!exists) {
                    const now = new Date().toISOString();
                    const downloadUrl = upload.url || `https://itch.io/my-game/${GAME_ID}/uploads/${upload.id}`;
                    games[GAME_ID].versions.unshift({
                        id: upload.id,
                        patchNotes: `New build uploaded at ${upload.updated_at}`,
                        detectedAt: now,
                        uploadedAt: upload.updated_at,
                        url: downloadUrl,
                        meta: upload
                    });
                }
            }

            // Check if the latest upload is a new version
            if (games[GAME_ID].version !== latestUpload.id) {
                newVersionDetected = true;
                games[GAME_ID].version = latestUpload.id;
                games[GAME_ID].patchNotes = `New build uploaded at ${latestUpload.updated_at}`;
                games[GAME_ID].lastUpdated = new Date().toISOString();
                console.log(`New version detected for ${GAME_ID}! Upload ID: ${latestUpload.id}`);
            } else {
                console.log(`No new version found for ${GAME_ID}.`);
            }

            localstorage.setItem('games', games);

            // Automatic announcement only if new version detected
            if (newVersionDetected) {
                try {
                    const templates = localstorage.getItem('templates') || { global: '', perGame: {} };
                    const tpl = (templates.perGame && templates.perGame[GAME_ID]) || templates.global || "New update for {gameId}: version {version}\n\n{patchNotes}";
                    const content = tpl
                        .replace(/{gameId}/g, GAME_ID)
                        .replace(/{version}/g, latestUpload.id)
                        .replace(/{patchNotes}/g, games[GAME_ID].patchNotes);

                    const announcements = localstorage.getItem('announcements') || [];
                    const newAnnouncement = {
                        id: Date.now().toString(),
                        title: `New Update: ${GAME_ID} - ${latestUpload.id}`,
                        content,
                        type: 'game-specific',
                        gameId: GAME_ID,
                        date: new Date().toISOString()
                    };
                    announcements.unshift(newAnnouncement);
                    localstorage.setItem('announcements', announcements);

                    watcherStatus.updatesFound++;
                    watcherStatus.perGame[GAME_ID].updatesFound = (watcherStatus.perGame[GAME_ID].updatesFound || 0) + 1;
                    console.log('Created automatic announcement for new version:', latestUpload.id);
                } catch (e) {
                    console.error('Failed to create announcement:', e.message);
                }
            }

        } catch (err) {
            console.error(`Error checking itch.io updates for ${GAME_ID}:`, err.message);
            watcherStatus.lastError = { time: new Date().toISOString(), message: err.message };
            watcherStatus.perGame[GAME_ID].lastError = { time: new Date().toISOString(), message: err.message };
            if (DISCORD_WEBHOOK) {
                await notifyDiscord(`Watcher error for game ${GAME_ID}: ${err.message}`);
            }
        }
    }
}

function getWatcherStatus() {
    return {
        ...watcherStatus,
        pollIntervalMinutes: POLL_INTERVAL / (1000 * 60),
        gameIds: GAME_IDS
    };
}

function startItchWatcher() {
    if (!GAME_IDS.length) {
        console.warn('No GAME_ID or GAME_IDS configured; itch watcher will not run.');
        return;
    }
    checkItchUpdates();
    setInterval(checkItchUpdates, POLL_INTERVAL);
    console.log('Itch.io watcher started for games:', GAME_IDS.join(', '));
}

module.exports = { startItchWatcher, getWatcherStatus };
