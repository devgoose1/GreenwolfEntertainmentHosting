// API endpoint configuration
const API_BASE_URL = 'https://greenwolfentertainmenthosting.onrender.com';

// Utility function for making API requests
async function apiRequest(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
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

// Game-related functions
async function getGameDetails(gameId) {
    return await apiRequest(`/games/${gameId}`);
}

async function checkGameAvailability(gameId) {
    return await apiRequest(`/games/${gameId}/availability`);
}

// User authentication functions (if needed)
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

// Admin functions
async function handleAdminLogin() {
    const username = document.getElementById('adminUsername').value;
    const password = document.getElementById('adminPassword').value;
    const legacyToken = document.getElementById('adminToken').value;

    try {
        if (username && password) {
            // Try JWT login
            const resp = await apiRequest('/users/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            if (resp.token) {
                localStorage.setItem('adminToken', `Bearer ${resp.token}`);
                document.getElementById('loginSection').style.display = 'none';
                document.getElementById('adminPanel').style.display = 'block';
                loadAnnouncements();
                loadStoredGames();
                loadTemplatesToUI();
                return;
            }
        }

        if (legacyToken) {
            const response = await apiRequest('/admin/login', {
                method: 'POST',
                body: JSON.stringify({ token: legacyToken })
            });

            if (response.success) {
                // store legacy token directly
                localStorage.setItem('adminToken', legacyToken);
                document.getElementById('loginSection').style.display = 'none';
                document.getElementById('adminPanel').style.display = 'block';
                loadAnnouncements();
                loadStoredGames();
                loadTemplatesToUI();
                return;
            }
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
            headers: {
                'Authorization': localStorage.getItem('adminToken')
            },
            body: JSON.stringify({ title, content, type, gameId })
        });

        // Clear form and reload announcements
        document.getElementById('announcementTitle').value = '';
        document.getElementById('announcementContent').value = '';
        loadAnnouncements();
    } catch (error) {
        alert('Failed to create announcement');
    }
}

// Admin: fetch all stored games (requires admin token)
async function getAllGames() {
    return await apiRequest('/admin/games', {
        method: 'GET',
        headers: {
            'Authorization': localStorage.getItem('adminToken') || ''
        }
    });
}

// Templates
async function getTemplates() {
    return await apiRequest('/templates');
}

async function saveTemplate(scope, gameId, template) {
    return await apiRequest('/admin/templates', {
        method: 'POST',
        headers: {
            'Authorization': localStorage.getItem('adminToken') || ''
        },
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

        return `
            <div class="game-item">
                <h4>${gameId}</h4>
                <div class="announcement-meta">Current: ${current} • Last updated: ${lastUpdated}</div>
                <details>
                    <summary>Version history (${(g.versions || []).length})</summary>
                    <ul>
                        ${versions || '<li>No versions recorded</li>'}
                    </ul>
                </details>
            </div>
        `;
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
    const token = document.getElementById('newAdminToken').value;
    try {
        await apiRequest('/admin/users', {
            method: 'POST',
            headers: {
                'Authorization': localStorage.getItem('adminToken')
            },
            body: JSON.stringify({ action: 'add', token })
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

// Event listeners and initialization
document.addEventListener('DOMContentLoaded', () => {
    // Update version information if on launcher or game pages
    const launcherVersion = document.getElementById('launcherVersion');
    const gameVersion = document.getElementById('gameVersion');

    if (launcherVersion) {
        getLauncherVersion()
            .then(version => {
                launcherVersion.textContent = version.current;
            })
            .catch(error => console.error('Failed to fetch launcher version:', error));
    }

    if (gameVersion) {
        // You can replace 'adventure-valley' with the actual game ID
        getGameVersion('adventure-valley')
            .then(version => {
                gameVersion.textContent = version.current;
                if (version.patchNotes) {
                    // Add patch notes to the page if they exist
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
        const token = localStorage.getItem('adminToken');
        if (token) {
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadAnnouncements();
        }

        // Show/hide game select based on announcement type
        document.getElementById('announcementType').addEventListener('change', (e) => {
            document.getElementById('gameSelect').style.display = 
                e.target.value === 'game-specific' ? 'block' : 'none';
        });
    }

    // Load relevant announcements on game pages
    if (window.location.pathname.includes('adventurevalley.html')) {
        const GAME_ID = '3999675'; // map to itch game id
        apiRequest(`/announcements?type=game-specific&gameId=${GAME_ID}`)
            .then(announcements => {
                if (announcements.length > 0) {
                    const gameInfo = document.querySelector('.game-info');
                    const announcementsSection = document.createElement('div');
                    announcementsSection.innerHTML = `
                        <h3>Announcements</h3>
                        ${announcements.map(a => `
                            <div class="announcement-item">
                                <h4>${a.title}</h4>
                                <div class="announcement-meta">${new Date(a.date).toLocaleDateString()}</div>
                                <p>${a.content}</p>
                            </div>
                        `).join('')}
                    `;
                    gameInfo.appendChild(announcementsSection);
                }
            })
            .catch(error => console.error('Failed to load game announcements:', error));

        // Version selector UI
        const versionContainer = document.createElement('div');
        versionContainer.className = 'admin-section';
        versionContainer.innerHTML = `
            <h3>Versions</h3>
            <div>
                <select id="versionSelect"></select>
                <button class="cta-button" id="downloadVersion">Download</button>
                <button class="cta-button" id="launchVersion">Launch</button>
            </div>
            <div id="versionInfo"></div>
        `;
        document.querySelector('main').prepend(versionContainer);

        async function loadGameVersions() {
            try {
                const data = await apiRequest(`/games/${GAME_ID}/versions`);
                const versions = data.versions || [];
                const sel = document.getElementById('versionSelect');
                sel.innerHTML = versions.map(v => `<option value="${v.id}">${v.id} ${v.detectedAt ? '- ' + new Date(v.detectedAt).toLocaleString() : ''}</option>`).join('');
                if (versions.length > 0) {
                    document.getElementById('versionInfo').textContent = versions[0].patchNotes || '';
                }

                sel.addEventListener('change', (e) => {
                    const v = versions.find(x => x.id === e.target.value);
                    document.getElementById('versionInfo').textContent = v ? (v.patchNotes || '') : '';
                });

                document.getElementById('downloadVersion').addEventListener('click', () => {
                    const selected = sel.value;
                    // If meta contains a download URL, open it; otherwise, fallback to direct download endpoint
                    const v = versions.find(x => x.id === selected);
                    if (v && v.meta && v.meta.file && v.meta.file.url) {
                        window.open(v.meta.file.url, '_blank');
                    } else {
                        window.open(`${API_BASE_URL}/games/${GAME_ID}/versions/download?version=${selected}`, '_blank');
                    }
                });

                document.getElementById('launchVersion').addEventListener('click', () => {
                    alert('Launcher integration not implemented yet. This would instruct the launcher to use version: ' + sel.value);
                });

            } catch (e) {
                console.error('Failed to load versions', e);
            }
        }

        loadGameVersions();
    }

    // Initialize any necessary features or UI elements
    console.log('Website initialized');
});
