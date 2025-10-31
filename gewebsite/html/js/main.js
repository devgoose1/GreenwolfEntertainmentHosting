// API endpoint configuration
const API_BASE_URL = 'https://greenwolfentertainmenthosting.onrender.com';

// Utility function for making API requests
async function apiRequest(endpoint, options = {}) {
    try {
        const token = localStorage.getItem('gw_token');
        const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...authHeader,
                ...options.headers
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// ------------------ Game-related functions ------------------
async function getGameDetails(gameId) {
    return await apiRequest(`/games/${gameId}`);
}

async function checkGameAvailability(gameId) {
    return await apiRequest(`/games/${gameId}/availability`);
}

// User authentication functions
async function login(credentials) {
    return await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
    });
}

// Launcher-related functions
async function getLauncherVersion() {
    return await apiRequest('/launcher/version');
}

async function checkForUpdates(gameId) {
    return await apiRequest(`/launcher/updates/${gameId}`);
}

async function getGameVersion(gameId) {
    return await apiRequest(`/games/${gameId}/version`);
}

// ------------------ Admin functions ------------------
async function handleAdminLogin() {
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;

    try {
        if (!username || !password) return alert('Enter username and password');
        const resp = await apiRequest('/users/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (resp.token) {
            localStorage.setItem('gw_token', resp.token);
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadAnnouncements();
            loadStoredGames();
            loadTemplatesToUI();
            return;
        }
        alert('Invalid login');
    } catch (error) {
        console.error('Admin login failed', error);
        alert('Invalid admin credentials');
    }
}

async function createAnnouncement() {
    const title = document.getElementById('announcementTitle').value;
    const content = document.getElementById('announcementContent').value;
    const type = document.getElementById('announcementType').value;
    const gameId = type === 'game-specific' ? document.getElementById('gameSelect').value : null;

    try {
        await apiRequest('/admin/announcements', {
            method: 'POST',
            body: JSON.stringify({ title, content, type, gameId })
        });

        document.getElementById('announcementTitle').value = '';
        document.getElementById('announcementContent').value = '';
        loadAnnouncements();
    } catch (error) {
        alert('Failed to create announcement');
    }
}

// Admin: fetch all stored games
async function getAllGames() {
    return await apiRequest('/admin/games', { method: 'GET' });
}

// Templates
async function getTemplates() {
    return await apiRequest('/templates');
}

async function saveTemplate(scope, gameId, template) {
    return await apiRequest('/admin/templates', {
        method: 'POST',
        body: JSON.stringify({ scope, gameId, template })
    });
}

async function loadTemplatesToUI() {
    try {
        const templates = await getTemplates();
        document.getElementById('globalTemplate').value = templates.global || '';
        document.getElementById('perGameTemplate').value = '';
        document.getElementById('tplGameId').value = '';
    } catch (e) {
        console.error('Failed to load templates', e);
    }
}

function saveGlobalTemplate() {
    const tpl = document.getElementById('globalTemplate').value;
    saveTemplate('global', null, tpl)
        .then(() => alert('Global template saved'))
        .catch(e => alert('Failed to save template'));
}

function savePerGameTemplate() {
    const gameId = document.getElementById('tplGameId').value;
    const tpl = document.getElementById('perGameTemplate').value;
    if (!gameId) return alert('Enter a gameId');
    saveTemplate('perGame', gameId, tpl)
        .then(() => alert('Per-game template saved'))
        .catch(e => alert('Failed to save template'));
}

function renderStoredGames(games) {
    const container = document.getElementById('storedGames');
    if (!container) return;

    const keys = Object.keys(games || {});
    if (keys.length === 0) {
        container.innerHTML = '<p>No games stored yet.</p>';
        return;
    }

    container.innerHTML = keys.map(gameId => {
        const g = games[gameId] || {};
        const current = g.version || '—';
        const lastUpdated = g.lastUpdated ? new Date(g.lastUpdated).toLocaleString() : '—';
        const versions = (g.versions || []).map(v => `
            <li>${v.id} <small>(${v.detectedAt ? new Date(v.detectedAt).toLocaleString() : ''})</small></li>
        `).join('');

        return
    }).join('');
}

async function loadStoredGames() {
    try {
        const games = await getAllGames();
        renderStoredGames(games);
    } catch (err) {
        console.error('Failed to load stored games:', err);
        alert('Failed to load stored games (check admin token)');
    }
}

async function addAdminUser() {
    const username = document.getElementById('newAdminToken').value;
    if (!username) return alert('Enter a username to promote');
    try {
        await apiRequest('/admin/users', {
            method: 'POST',
            body: JSON.stringify({ action: 'add', token: username })
        });
        alert('Admin user added successfully');
        document.getElementById('newAdminToken').value = '';
    } catch (error) {
        alert('Failed to add admin user');
    }
}

async function loadAnnouncements() {
    try {
        const announcements = await apiRequest('/announcements');
        const container = document.getElementById('recentAnnouncements');
        
        container.innerHTML = announcements.map(announcement => `
            <div class="announcement-item">
                <h4>${announcement.title}</h4>
                <div class="announcement-meta">
                    ${announcement.type === 'game-specific' ? `Game: ${announcement.gameId} • ` : ''}
                    ${new Date(announcement.date).toLocaleDateString()}
                </div>
                <p>${announcement.content}</p>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load announcements:', error);
    }
}

// ------------------ Event listeners and initialization ------------------
document.addEventListener('DOMContentLoaded', () => {

    const GAME_ID = '3999675';

    const launcherVersion = document.getElementById('launcherVersion');
    const gameVersion = document.getElementById('gameVersion');

    if (launcherVersion) {
        getLauncherVersion()
            .then(version => launcherVersion.textContent = version.current)
            .catch(error => console.error('Failed to fetch launcher version:', error));
    }

    if (gameVersion) {
        getGameVersion(GAME_ID)
            .then(version => {
                gameVersion.textContent = version.current;
                if (version.patchNotes) {
                    const gameInfo = document.querySelector('.game-info');
                    const patchNotesSection = document.createElement('div');
                    patchNotesSection.innerHTML = `
                        <h3>Latest Updates</h3>
                        <div class="patch-notes">${version.patchNotes}</div>
                    `;
                    gameInfo.appendChild(patchNotesSection);
                }
            })
            .catch(error => console.error('Failed to fetch game version:', error));
    }

    // Admin panel initialization
    if (window.location.pathname.includes('admin.html')) {
        const token = localStorage.getItem('gw_token');
        if (token) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadAnnouncements();
        }

        document.getElementById('announcementType').addEventListener('change', (e) => {
            document.getElementById('gameSelect').style.display =
                e.target.value === 'game-specific' ? 'block' : 'none';
        });
    }

    // Adventure Valley page
    async function loadGameVersions() {
        try {
            console.log('Fetching versions from backend...');
            const response = await fetch(`${API_BASE_URL}/itch/versions`);
            const data = await response.json();
            console.log('Backend response:', data);

            const versions = Array.isArray(data) ? data : data.versions || [];
            const sel = document.getElementById('avVersionSelect');
            const versionInfo = document.getElementById('versionInfo');

            if (!sel) return console.error('Version select element not found');

            if (versions.length === 0) {
                sel.innerHTML = `<option disabled selected>No versions available</option>`;
                if (versionInfo) versionInfo.textContent = '';
                return;
            }

            sel.innerHTML = versions.map(v =>
                `<option value="${v.id}">${v.version}</option>`
            ).join('');

            if (versionInfo)
                versionInfo.textContent = versions[0]?.filename || '';

            sel.addEventListener('change', (e) => {
                const selected = versions.find(v => v.id == e.target.value);
                versionInfo.textContent = selected ? selected.filename : '';
            });

            document.getElementById('downloadVersion').addEventListener('click', async () => {
                const selected = sel.value;
                try {
                    const resp = await fetch(`${API_BASE_URL}/games/${GAME_ID}/versions/download?version=${selected}`);
                    const data = await resp.json();
                    if (data.url) {
                        window.open(data.url, '_blank');
                    } else {
                        alert('Failed to get download link');
                    }
                } catch (err) {
                    console.error(err);
                    alert('Failed to get download link');
                }
            });

        } catch (err) {
            console.error('Failed to load game versions:', err);
            const sel = document.getElementById('avVersionSelect');
            if (sel) sel.innerHTML = `<option disabled selected>Error loading versions</option>`;
        }
    }


    console.log('Main element:', document.querySelector('main'));
    


    loadGameVersions();


    console.log('Website initialized');
});
