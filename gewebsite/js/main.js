// API endpoint configuration
const API_BASE_URL = 'http://localhost:3000'; // Update this with your actual backend URL

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
    const token = document.getElementById('adminToken').value;
    try {
        const response = await apiRequest('/admin/login', {
            method: 'POST',
            body: JSON.stringify({ token })
        });

        if (response.success) {
            localStorage.setItem('adminToken', token);
            document.getElementById('loginSection').style.display = 'none';
            document.getElementById('adminPanel').style.display = 'block';
            loadAnnouncements();
        }
    } catch (error) {
        alert('Invalid admin token');
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
        apiRequest('/announcements?type=game-specific&gameId=adventure-valley')
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
    }

    // Initialize any necessary features or UI elements
    console.log('Website initialized');
});
