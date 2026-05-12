/**
 * GameClient — módulo de cliente del juego.
 *
 * Este módulo se encarga de:
 *  - Capturar input del teclado (WASD / flechas) y emitir "intenciones de movimiento".
 *  - Correr el game loop de renderizado a 60 FPS.
 *  - Dibujar el estado de juego en un canvas.
 *
 * El servidor es autoritativo:
 *  - El cliente NO calcula posiciones.
 *  - El cliente solo manda intenciones.
 *  - El servidor decide posición, velocidad, límites del mundo y replica el estado.
 */

export function createGame(config) {
  const {
    canvas,
    onIntent,
    getRenderState,
    localPlayerId,
    options = {}
  } = config;

  if (!canvas) throw new Error('createGame: canvas es requerido');
  if (typeof onIntent !== 'function') throw new Error('createGame: onIntent es requerido');
  if (typeof getRenderState !== 'function') throw new Error('createGame: getRenderState es requerido');

  const opts = {
    worldWidth: 800,
    worldHeight: 600,
    playerRadius: 20,
    backgroundColor: '#0f1419',
    gridColor: '#1f2730',
    gridSize: 40,
    ...options
  };

  canvas.width = opts.worldWidth;
  canvas.height = opts.worldHeight;

  const ctx = canvas.getContext('2d');

  // --- Input handling ---
  const keys = new Set();
  let lastIntent = { x: 0, y: 0 };

  function computeDirection() {
    let x = 0;
    let y = 0;

    if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;

    return { x, y };
  }

  function maybeEmitIntent() {
    const dir = computeDirection();

    if (dir.x !== lastIntent.x || dir.y !== lastIntent.y) {
      lastIntent = dir;
      onIntent({ type: 'move', dir });
    }
  }

  function onKeyDown(e) {
    if (
      e.target &&
      (e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT')
    ) {
      return;
    }

    if (keys.has(e.code)) return;

    keys.add(e.code);

    if (isMovementKey(e.code)) {
      e.preventDefault();
      maybeEmitIntent();
    }
  }

  function onKeyUp(e) {
    if (!keys.has(e.code)) return;

    keys.delete(e.code);

    if (isMovementKey(e.code)) {
      e.preventDefault();
      maybeEmitIntent();
    }
  }

  function onBlur() {
    if (keys.size === 0) return;

    keys.clear();
    maybeEmitIntent();
  }

  function isMovementKey(code) {
    return [
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'KeyA',
      'KeyD',
      'KeyW',
      'KeyS'
    ].includes(code);
  }

  // --- Render ---
  function drawBackground() {
    ctx.fillStyle = opts.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = opts.gridColor;
    ctx.lineWidth = 1;

    for (let x = 0; x <= canvas.width; x += opts.gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let y = 0; y <= canvas.height; y += opts.gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawPlayer(p) {
    if (
      !p ||
      typeof p.x !== 'number' ||
      typeof p.y !== 'number' ||
      typeof p.username !== 'string'
    ) {
      return;
    }

    const isLocal = String(p.userId) === String(localPlayerId);

    const color =
      p.extras && typeof p.extras.color === 'string'
        ? p.extras.color
        : colorFromId(p.userId);

    // Cuerpo
    ctx.beginPath();
    ctx.arc(p.x, p.y, opts.playerRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Borde
    ctx.lineWidth = isLocal ? 3 : 1.5;
    ctx.strokeStyle = isLocal ? '#ffffff' : '#000000';
    ctx.stroke();

    // Badge de provider
    if (p.provider === 'google') {
      ctx.beginPath();
      ctx.arc(
        p.x + opts.playerRadius - 3,
        p.y + opts.playerRadius - 3,
        6,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = '#111827';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('G', p.x + opts.playerRadius - 3, p.y + opts.playerRadius - 3);
    }

    // Username
    ctx.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = '#e6e6e6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const text = p.username + (isLocal ? ' (tú)' : '');

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(text, p.x, p.y - opts.playerRadius - 4);
    ctx.fillText(text, p.x, p.y - opts.playerRadius - 4);
  }

  function colorFromId(userId) {
    const numericId = Number(userId) || 1;
    const hue = (numericId * 137.508) % 360;
    return `hsl(${hue}, 70%, 55%)`;
  }

  function render() {
    const state = getRenderState();

    drawBackground();

    if (!state || !Array.isArray(state.players)) return;

    const sorted = [...state.players].sort((a, b) => {
      if (String(a.userId) === String(localPlayerId)) return 1;
      if (String(b.userId) === String(localPlayerId)) return -1;
      return 0;
    });

    for (const player of sorted) {
      drawPlayer(player);
    }
  }

  // --- Game loop ---
  let running = false;
  let rafId = null;

  function loop() {
    if (!running) return;

    render();
    rafId = requestAnimationFrame(loop);
  }

  // --- API pública ---
  function start() {
    if (running) return;

    running = true;

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    loop();
  }

  function stop() {
    running = false;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  function destroy() {
    stop();
    keys.clear();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return {
    start,
    stop,
    destroy,
    options: opts
  };
}