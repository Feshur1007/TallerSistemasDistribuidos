const API_URL = window.APP_CONFIG.AUTH_URL;
const WS_URL = window.APP_CONFIG.COORDINATOR_WS;
const GOOGLE_CLIENT_ID = window.APP_CONFIG.GOOGLE_CLIENT_ID;

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

        setTimeout(() => {
            msgContainer.textContent = '';
            msgContainer.className = '';
        }, 5000);
    }

    async function validateStoredToken() {
        const token = localStorage.getItem('token');

        if (!token) {
            return false;
        }

        try {
            const res = await fetch(`${API_URL}/validate-token`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            const data = await res.json();

            if (!res.ok || !data.valid) {
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                return false;
            }

            if (data.user && data.user.username) {
                localStorage.setItem('username', data.user.username);
            }

            return true;
        } catch (err) {
            console.error('Error validando token guardado:', err);
            return false;
        }
    }

    async function redirectIfAlreadyAuthenticated() {
        const isAuthPage = Boolean(loginForm || registerForm);

        if (!isAuthPage) return;

        const tokenIsValid = await validateStoredToken();

        if (tokenIsValid) {
            window.location.href = 'lobby.html';
        }
    }

    async function finishLogin(data) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('username', data.username);
        window.location.href = 'lobby.html';
    }

    async function sendGoogleToken(idToken, username) {
        const body = { idToken };

        if (username) {
            body.username = username;
        }

        const res = await fetch(`${API_URL}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (res.ok) {
            await finishLogin(data);
            return;
        }

        if (res.status === 409 && data.error === 'username_required') {
            const selectedUsername = window.prompt('Primer login con Google. Elige un username:');

            if (!selectedUsername || !selectedUsername.trim()) {
                showMessage('Debes elegir un username para continuar con Google.');
                return;
            }

            return sendGoogleToken(idToken, selectedUsername.trim());
        }

        if (res.status === 409 && data.error === 'username_taken') {
            const selectedUsername = window.prompt('Ese username ya existe. Elige otro username:');

            if (!selectedUsername || !selectedUsername.trim()) {
                showMessage('Debes elegir un username disponible para continuar con Google.');
                return;
            }

            return sendGoogleToken(idToken, selectedUsername.trim());
        }

        showMessage(data.error || 'Login con Google fallido');
    }

    function initializeGoogleLogin() {
        const googleButton = document.getElementById('google-signin-button');

        if (!googleButton) return;

        if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'tu-client-id.apps.googleusercontent.com') {
            showMessage('Falta configurar GOOGLE_CLIENT_ID real para usar Google Login.');
            return;
        }

        if (!window.google || !window.google.accounts || !window.google.accounts.id) {
            setTimeout(initializeGoogleLogin, 500);
            return;
        }

        window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
                try {
                    await sendGoogleToken(response.credential);
                } catch (err) {
                    console.error('Google login error:', err);
                    showMessage('Error de red usando Google Login');
                }
            }
        });

        window.google.accounts.id.renderButton(googleButton, {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width: 260
        });
    }

    // Si ya hay token válido y estás en index.html, ir directo al lobby.
    redirectIfAlreadyAuthenticated();

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
                    await finishLogin(data);
                } else {
                    showMessage(data.hint || data.error || 'Login fallido');
                }
            } catch (err) {
                console.error('Login request error:', err);
                showMessage('Error de red conectando con el servicio de autenticación');
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
                    showMessage('Cuenta creada. Ahora puedes iniciar sesión.', 'success');
                    registerSection.classList.add('hidden');
                    loginSection.classList.remove('hidden');
                } else {
                    showMessage(data.error || 'Registro fallido');
                }
            } catch (err) {
                console.error('Register request error:', err);
                showMessage('Error de red conectando con el servicio de autenticación');
            }
        };
    }

    initializeGoogleLogin();

    // Lobby Logic
    if (document.getElementById('players-list')) {
        const token = localStorage.getItem('token');
        const myUsername = localStorage.getItem('username');

        if (!token) {
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('display-username').textContent = myUsername || 'Jugador';

        const statusBadge = document.getElementById('connection-status');
        const playersList = document.getElementById('players-list');
        const logoutBtn = document.getElementById('logout-btn');
        const gameCanvas = document.getElementById('game');
        const colorInput = document.getElementById('player-color');
        const colorBtn = document.getElementById('color-btn');

        let intentionalLogout = false;
        let ws = null;
        let game = null;
        let currentGameState = { players: [] };
        let myUserId = null;
        let lastPlayersSignature = '';

        window.lastState = currentGameState;

        function setStatus(text, className) {
            if (!statusBadge) return;
            statusBadge.textContent = text;
            statusBadge.className = className;
        }

        function sendWsMessage(message) {
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                console.warn('No se envió mensaje WS porque el socket no está abierto:', message);
                return;
            }

            ws.send(JSON.stringify(message));
        }

        function buildPlayersSignature(players) {
            if (!Array.isArray(players)) return '';

            return players
                .map((p) => {
                    const color = p.extras && p.extras.color ? p.extras.color : '';
                    return `${p.userId}|${p.username}|${p.provider || 'local'}|${color}`;
                })
                .join(';');
        }

        function renderPlayersIfChanged(players) {
            const signature = buildPlayersSignature(players);

            if (signature === lastPlayersSignature) {
                return;
            }

            lastPlayersSignature = signature;
            renderPlayers(players);
        }

        async function initializeGame(world) {
            if (!gameCanvas) return;
            if (game) return;

            try {
                const module = await import('./game.js');
                const createGame = module.createGame;

                game = createGame({
                    canvas: gameCanvas,
                    onIntent: (intent) => {
                        sendWsMessage({
                            type: 'intent',
                            intent
                        });
                    },
                    getRenderState: () => currentGameState,
                    localPlayerId: myUserId,
                    options: {
                        worldWidth: world.width,
                        worldHeight: world.height,
                        playerRadius: world.playerRadius
                    }
                });

                game.start();
            } catch (err) {
                console.error('Error inicializando el juego:', err);
                alert('No se pudo inicializar el juego. Revisa que exista client/game.js.');
            }
        }

        function connectWebSocket() {
            const wsUrl = `${WS_URL}/connect?token=${encodeURIComponent(token)}`;
            console.log('Conectando WebSocket a:', wsUrl);

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('WebSocket abierto correctamente');
                setStatus('Connected to Coordinator', 'status-badge online-badge');
            };

            ws.onmessage = async (event) => {
                let data;

                try {
                    data = JSON.parse(event.data);
                } catch (err) {
                    console.warn('Mensaje WS inválido:', event.data);
                    return;
                }

                if (data.type === 'welcome') {
                    console.log('Welcome recibido:', data);

                    myUserId = data.you.userId;

                    if (data.you.username) {
                        localStorage.setItem('username', data.you.username);
                        document.getElementById('display-username').textContent = data.you.username;
                    }

                    if (data.world) {
                        await initializeGame(data.world);
                    }

                    return;
                }

                if (data.type === 'players_update') {
                    renderPlayersIfChanged(data.players || []);
                    return;
                }

                if (data.type === 'state') {
                    currentGameState = {
                        players: Array.isArray(data.players) ? data.players : []
                    };

                    window.lastState = currentGameState;

                    /*
                     * El servidor envía "state" 20 veces por segundo.
                     * No se debe reconstruir la lista en cada tick porque parpadea.
                     * Solo se redibuja si realmente cambió la lista, el provider o el color.
                     */
                    renderPlayersIfChanged(currentGameState.players);
                    return;
                }
            };

            ws.onclose = (event) => {
                console.log('WS cerrado:', {
                    code: event.code,
                    reason: event.reason,
                    wasClean: event.wasClean
                });

                if (intentionalLogout) return;

                if (game) {
                    game.destroy();
                    game = null;
                }

                setStatus('Disconnected', 'status-badge offline-badge');

                if (event.code === 4001) {
                    alert('Sesión vencida o token inválido. Inicia sesión de nuevo.');
                    localStorage.clear();
                    window.location.href = 'index.html';
                    return;
                }

                if (event.code === 4000) {
                    alert('Se abrió otra sesión con este usuario. Esta pestaña quedará desconectada.');

                    setStatus('Session replaced', 'status-badge offline-badge');

                    /*
                     * No se limpia localStorage aquí.
                     * En el mismo navegador, localStorage es compartido entre pestañas.
                     * Si lo borramos, cerramos también la sesión válida de la nueva pestaña.
                     */

                    return;
                }

                alert(
                    `Se cerró la conexión WebSocket.\n\nCódigo: ${event.code}\nRazón: ${event.reason || '(sin razón)'}\nLimpio: ${event.wasClean}`
                );
            };

            ws.onerror = (event) => {
                console.error('Error de WebSocket:', event);
                setStatus('Connection error', 'status-badge offline-badge');
            };
        }

        if (logoutBtn) {
            logoutBtn.onclick = () => {
                intentionalLogout = true;

                if (game) {
                    game.destroy();
                    game = null;
                }

                localStorage.clear();

                if (ws) {
                    ws.close(1000, 'logout');
                }

                window.location.href = 'index.html';
            };
        }

        if (colorBtn && colorInput) {
            colorBtn.onclick = () => {
                const color = colorInput.value;

                sendWsMessage({
                    type: 'extras_update',
                    extras: {
                        color
                    }
                });
            };
        }

        function renderPlayers(players) {
            playersList.innerHTML = '';

            players.forEach((p) => {
                if (!p || !p.username) return;

                const card = document.createElement('div');
                card.className = 'player-card';

                const isMe =
                    String(p.userId) === String(myUserId) ||
                    p.username === myUsername;

                const color = p.extras && p.extras.color ? p.extras.color : null;
                const providerText = p.provider === 'google' ? 'Google' : 'Local';

                card.innerHTML = `
                    <div class="player-avatar" ${color ? `style="background:${color}"` : ''}>
                        ${p.username[0].toUpperCase()}
                    </div>
                    <span>${p.username} ${isMe ? '(Tú)' : ''}</span>
                    <small>${providerText}</small>
                `;

                playersList.appendChild(card);
            });
        }

        connectWebSocket();
    }
});