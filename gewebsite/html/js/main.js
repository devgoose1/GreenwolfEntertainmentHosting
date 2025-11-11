// API endpoint configuration
const API_BASE_URL = 'https://greenwolfentertainmenthosting.onrender.com';

fetch(`${API_BASE_URL}/status`, { method: "GET" })
  .then(res => res.json())
  .then(console.log)
  .catch(console.error);




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
    return await apiRequest('/users/login', {
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
        if (resp.token && resp.isAdmin) {
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
            console.log('DEBUG: Fetching versions from backend...');
            const response = await fetch(`${API_BASE_URL}/itch/versions`);
            console.log('DEBUG: Raw response status:', response.status);
            const data = await response.json();
            console.log('DEBUG: Parsed versions data:', data);

            const versions = Array.isArray(data) ? data : data.versions || [];
            const sel = document.getElementById('avVersionSelect');
            const versionInfo = document.getElementById('versionInfo');

            if (!sel) {
                console.error('DEBUG: Version select element not found');
                return;
            }

            if (versions.length === 0) {
                sel.innerHTML = `<option disabled selected>No versions available</option>`;
                if (versionInfo) versionInfo.textContent = '';
                console.warn('DEBUG: No versions available');
                return;
            }

            // Populate dropdown
            sel.innerHTML = versions.map(v =>
                `<option value="${v.id}">${v.version}</option>`
            ).join('');

            if (versionInfo)
                versionInfo.textContent = versions[0]?.filename || '';

            // Update displayed filename when selection changes
            sel.addEventListener('change', (e) => {
                const selected = versions.find(v => v.id == e.target.value);
                console.log('DEBUG: Selected version changed:', selected);
                versionInfo.textContent = selected ? selected.filename : '';
            });

            // Handle download button
            document.getElementById('downloadVersion').addEventListener('click', async () => {
                const selectedId = sel.value;
                console.log('DEBUG: Download button clicked, selectedId:', selectedId);

                if (!selectedId) {
                    alert('Please select a version first');
                    return;
                }

                try {
                    const resp = await fetch(`${API_BASE_URL}/itch/download/${selectedId}`);
                    console.log('DEBUG: /itch/download response status:', resp.status);
                    const downloadData = await resp.json();
                    console.log('DEBUG: /itch/download response data:', downloadData);

                    if (downloadData.url) {
                        console.log('DEBUG: Opening download URL:', downloadData.url);
                        window.open(downloadData.url, '_blank');
                    } else {
                        alert('Failed to get download link: no URL returned');
                        console.error('DEBUG: No URL returned from download endpoint');
                    }
                } catch (err) {
                    console.error('DEBUG: Error fetching download link:', err);
                    alert('Failed to get download link (see console for details)');
                }
            });

        } catch (err) {
            console.error('DEBUG: Failed to load game versions:', err);
            const sel = document.getElementById('avVersionSelect');
            if (sel) sel.innerHTML = `<option disabled selected>Error loading versions</option>`;
        }
    }


    console.log('Main element:', document.querySelector('main'));
    


    loadGameVersions();


    console.log('Website initialized');

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('gw_token'); // remove stored token
            alert('Logged out successfully!');
            window.location.reload(); // refresh page to show login
        });
    }

    // User Registering
    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
        registerForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const data = {
                username: e.target.username.value,
                password: e.target.password.value,
                displayName: e.target.username.value
            };

            try {
                const result = await apiRequest("/users/register", {
                    method: "POST",
                    body: JSON.stringify(data),
                });

                document.getElementById("message").textContent = result.success
                    ? "Registration successful!"
                    : result.error || "Registration failed.";
            } catch (err) {
                console.error(err);
                document.getElementById("message").textContent = "Error connecting to server.";
            }
        });
    } else {
        console.warn("registerForm not found");
    }

    // Backup
    const backupBtn = document.getElementById('backupBtn');
    if (backupBtn) {
        backupBtn.addEventListener('click', async () => {
            console.log('Backup button clicked'); // debug log
            try {
                const response = await fetch('https://greenwolfentertainmenthosting.onrender.com/admin/backup', {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup-${Date.now()}.json`; // timestamped backup
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                alert('Backup downloaded!');
            } catch (err) {
                console.error('Backup failed', err);
                alert('Backup failed! Check console.');
            }
        });
    } else {
        console.warn("backupBtn not found");
    }

    // Restore
    const restoreForm = document.getElementById('restoreForm');
    if (restoreForm) {
        restoreForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('backupFile');
            if (!fileInput.files.length) return alert('Select a backup file');

            const formData = new FormData();
            formData.append('backupFile', fileInput.files[0]);

            try {
                const response = await fetch('https://greenwolfentertainmenthosting.onrender.com/admin/restore', {
                    method: 'POST',
                    body: formData,
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });

                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                alert(await response.text());
            } catch (err) {
                console.error('Restore failed', err);
                alert('Restore failed! Check console.');
            }
        });
    } else {
        console.warn("restoreForm not found");
    }

});


