const API_URL = `${window.location.origin}/auth`;
const WS_URL = `${window.location.origin.replace(/^http/, 'ws')}/ws`;

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const msgContainer = document.getElementById('message-container');

    // UI Toggles
    const showRegister = document.getElementById('show-register');
    const showLogin = document.getElementById('show-login');
    const loginSection = document.getElementById('login-section');
    const registerSection = document.getElementById('register-section');

    if (showRegister) {
        showRegister.onclick = (e) => {
            e.preventDefault();
            loginSection.classList.add('hidden');
            registerSection.classList.remove('hidden');
        };
    }

    if (showLogin) {
        showLogin.onclick = (e) => {
            e.preventDefault();
            registerSection.classList.add('hidden');
            loginSection.classList.remove('hidden');
        };
    }

    function showMessage(text, type = 'error') {
        if (!msgContainer) return;
        msgContainer.textContent = text;
        msgContainer.className = type === 'error' ? 'msg-error' : 'msg-success';
        setTimeout(() => msgContainer.textContent = '', 5000);
    }

    // Logic for Auth
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;

            try {
                const res = await fetch(`${API_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('username', data.username);
                    window.location.href = 'lobby.html';
                } else {
                    showMessage(data.error || 'Login failed');
                }
            } catch (err) {
                showMessage('Network error connecting to Auth service');
            }
        };
    }

    if (registerForm) {
        registerForm.onsubmit = async (e) => {
            e.preventDefault();
            const username = document.getElementById('reg-username').value;
            const password = document.getElementById('reg-password').value;

            try {
                const res = await fetch(`${API_URL}/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                const data = await res.json();
                if (res.ok) {
                    showMessage('Account created! You can now login.', 'success');
                    registerSection.classList.add('hidden');
                    loginSection.classList.remove('hidden');
                } else {
                    showMessage(data.error || 'Registration failed');
                }
            } catch (err) {
                showMessage('Network error connecting to Auth service');
            }
        };
    }

    // Lobby Logic
    if (window.location.pathname.includes('lobby.html')) {
        const token = localStorage.getItem('token');
        const myUsername = localStorage.getItem('username');

        if (!token) {
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('display-username').textContent = myUsername;
        const statusBadge = document.getElementById('connection-status');
        const playersList = document.getElementById('players-list');
        const logoutBtn = document.getElementById('logout-btn');

        logoutBtn.onclick = () => {
            localStorage.clear();
            window.location.href = 'index.html';
        };

        const ws = new WebSocket(`${WS_URL}/connect?token=${token}`);

        ws.onopen = () => {
            statusBadge.textContent = 'Connected to Coordinator';
            statusBadge.className = 'status-badge online-badge';
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'players_update') {
                renderPlayers(data.players);
            }
        };

        ws.onclose = (event) => {
            statusBadge.textContent = 'Disconnected';
            statusBadge.className = 'status-badge offline-badge';
            
            if (event.code === 4001) {
                alert('Session expired or invalid token. Please login again.');
            } else if (event.code === 4000) {
                alert('Logged in from another device. This session is closed.');
            } else {
                alert('Lost connection to server.');
            }
            
            localStorage.clear();
            window.location.href = 'index.html';
        };

        function renderPlayers(players) {
            playersList.innerHTML = '';
            players.forEach(p => {
                const card = document.createElement('div');
                card.className = 'player-card';
                card.innerHTML = `
                    <div class="player-avatar">${p.username[0].toUpperCase()}</div>
                    <span>${p.username} ${p.username === myUsername ? '(You)' : ''}</span>
                `;
                playersList.appendChild(card);
            });
        }
    }
});
