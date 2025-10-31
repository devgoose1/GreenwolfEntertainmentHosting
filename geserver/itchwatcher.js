require('dotenv').config();
const axios = require('axios');
const { localstorage } = require('./localstorage');

const API_KEY = process.env.ITCH_API_KEY;
const GAME_ID = process.env.GAME_ID;
const POLL_INTERVAL = 1000 * 60 * 10; // 10 minutes

async function checkItchUpdates() {
    try {
        const response = await axios.get(`https://itch.io/api/1/${API_KEY}/game/${GAME_ID}/uploads`);
        const uploads = response.data.uploads;

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

            // Since we're running in the same process, just call the storage directly
            const games = localstorage.getItem('games') || {};
            games[GAME_ID] = {
                version: latest.id,
                patchNotes,
                lastUpdated: new Date().toISOString()
            };
            localstorage.setItem('games', games);

            console.log('Backend updated successfully.');
        } else {
            console.log('No new version found.');
        }

    } catch (err) {
        console.error('Error checking itch.io updates:', err.message);
    }
}

// Export the function to start watching
function startItchWatcher() {
    // Run once on startup, then every interval
    checkItchUpdates();
    setInterval(checkItchUpdates, POLL_INTERVAL);
    console.log('Itch.io watcher started');
}

module.exports = { startItchWatcher };
