# Taller 4 - Proyecto Final Parte I: Identidad y Sesiones

Sistema distribuido con tres procesos separados:

1. **Auth Service**: HTTP en puerto `4000`. Registra usuarios, valida credenciales, guarda usuarios en SQLite y emite JWT.
2. **Coordinator**: HTTP + WebSocket en puerto `5000`. Valida JWT y mantiene en memoria la lista de jugadores conectados.
3. **Client Web**: HTML + JavaScript plano servido en puerto `3000`. Permite registro, login, lobby en vivo y cierre de sesión.

## Arquitectura

```text
+-------------------+       HTTP /register, /login       +----------------------+
|   Cliente Web     | ----------------------------------> |   Auth Service       |
|   Puerto 3000     |                                     |   Puerto 4000        |
|   HTML + JS       | <---------------------------------- |   SQLite + JWT       |
+-------------------+             token JWT               +----------------------+
          |
          | WebSocket autenticado: /connect?token=JWT
          v
+----------------------+
|   Coordinator        |
|   Puerto 5000        |
|   Valida JWT         |
|   Map de jugadores   |
|   Broadcast en vivo  |
+----------------------+
```

## Estructura del repositorio

```text
auth-service/
  index.js
  package.json
  .env.example
coordinator/
  index.js
  package.json
  .env.example
client/
  index.html
  lobby.html
  app.js
  style.css
  js/config.js
  package.json
  .env.example
.gitignore
README.md
```

## Configuración inicial

Cada servicio usa su propio archivo `.env`. No se debe subir `.env` al repositorio.

### Auth Service

```bash
cd auth-service
cp .env.example .env
npm install
npm start
```

Ejemplo de `auth-service/.env`:

```env
PORT=4000
JWT_SECRET=super-secret-key-change-it
JWT_EXPIRES_IN=1h
DATABASE_FILE=users.db
ALLOW_ORIGIN=http://localhost:3000
```

### Coordinator

Usa la misma `JWT_SECRET` que el servicio de autenticación.

```bash
cd coordinator
cp .env.example .env
npm install
npm start
```

Ejemplo de `coordinator/.env`:

```env
PORT=5000
JWT_SECRET=super-secret-key-change-it
```

### Client Web

```bash
cd client
npm install
npm start
```

El cliente queda disponible en:

```text
http://localhost:3000
```

La configuración de URLs del cliente está en `client/js/config.js`:

```js
window.APP_CONFIG = {
  AUTH_URL: 'http://localhost:4000',
  COORDINATOR_WS: 'ws://localhost:5000'
};
```

## Pruebas con curl

### Registro

```bash
curl -X POST http://localhost:4000/register \
-H "Content-Type: application/json" \
-d '{"username":"alice","password":"secret123"}'
```

Respuesta esperada:

```json
{
  "userId": 1,
  "username": "alice"
}
```

### Login

```bash
curl -X POST http://localhost:4000/login \
-H "Content-Type: application/json" \
-d '{"username":"alice","password":"secret123"}'
```

Respuesta esperada:

```json
{
  "token": "eyJhbGciOi...",
  "username": "alice"
}
```

## Prueba del WebSocket con wscat

Instalar:

```bash
npm install -g wscat
```

Conectar con un token real obtenido en `/login`:

```bash
wscat -c "ws://localhost:5000/connect?token=PEGA_AQUI_EL_TOKEN"
```

Si el token es válido, el coordinador envía mensajes:

```json
{
  "type": "players_update",
  "players": [
    {
      "userId": "1",
      "username": "alice"
    }
  ]
}
```

## Ngrok

Abrir tres terminales:

```bash
ngrok http 4000
ngrok http 5000
ngrok http 3000
```

Luego actualizar `client/js/config.js` con las URLs públicas:

```js
window.APP_CONFIG = {
  AUTH_URL: 'https://URL-AUTH.ngrok-free.app',
  COORDINATOR_WS: 'wss://URL-COORDINATOR.ngrok-free.app'
};
```

Cuando el cliente se sirve por HTTPS mediante ngrok, el WebSocket debe usar `wss://`, no `ws://`.

## Decisiones de diseño

### Doble pestaña o sesión duplicada

Si el mismo usuario abre una segunda pestaña, el coordinador cierra la conexión anterior con código `4000` y conserva la conexión más reciente.

Justificación: el `Map` del coordinador está indexado por `userId`, por lo que debe existir una sola sesión activa por usuario para evitar duplicados en el lobby y estados inconsistentes.

### Validación del JWT

El JWT se valida en el evento `upgrade` del servidor HTTP, antes de emitir una conexión válida en `wss.on('connection')`. Si el token falta, está vencido, está malformado o fue firmado con otra clave, el socket se cierra con código `4001` y mensaje `invalid token`.

### Contraseñas

Las contraseñas se guardan únicamente como `password_hash` usando `bcrypt` con 10 rounds. La contraseña original no se retorna en respuestas ni se imprime en logs.

### Broadcast

Cada vez que entra o sale un jugador, el coordinador envía a todos los clientes conectados:

```json
{
  "type": "players_update",
  "players": [
    {
      "userId": "1",
      "username": "alice"
    }
  ]
}
```

## Pruebas de sustentación

1. Registrar un usuario nuevo.
2. Hacer login.
3. Entrar al lobby.
4. Abrir dos navegadores con usuarios distintos y mostrar que ambos aparecen en vivo.
5. Cerrar una pestaña y verificar que el usuario desaparece del lobby.
6. Ensuciar el token en `localStorage`, recargar y verificar rechazo con `4001`.
7. Cambiar temporalmente `JWT_EXPIRES_IN=30s`, reiniciar auth, hacer login, esperar 30 segundos y verificar que el coordinador rechaza el token vencido.

## Notas de entrega

No subir al repositorio:

```text
node_modules/
.env
*.db
```

El historial debe tener commits incrementales, no un único commit final.
