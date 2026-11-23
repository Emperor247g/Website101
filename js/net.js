/**
 * WebSocket client for Crown & Oak online matches.
 *
 * The server is authoritative: this client only sends room commands and
 * click-level moves ({ from, to }). It never sends board state or claims that a
 * move was legal. Room credentials are kept in localStorage so a reload or a
 * brief network drop can reattach the player to the same seat.
 */

const ROOM_STORAGE_KEY = 'crown-and-oak-online-room-v1';

function makeToken() {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function loadStoredRoom() {
  try {
    const stored = JSON.parse(localStorage.getItem(ROOM_STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return null;
    if (typeof stored.code !== 'string' || typeof stored.token !== 'string') return null;
    return { code: stored.code.toUpperCase(), token: stored.token };
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} NetClientOptions
 * @property {(message: object) => void} [onEvent] Called for every parsed server message.
 * @property {(status: string) => void} [onStatus] Called on connection state changes.
 */

export class NetClient {
  /** @param {NetClientOptions} options */
  constructor({ onEvent, onStatus } = {}) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});

    this.url = '';
    this.ws = null;
    this.status = 'offline';

    this.code = null;
    this.token = null;
    this.color = null;
    this.opponentConnected = false;
    this.opponentNickname = '';

    this.shouldReconnect = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.openWaiters = [];
    this.requestWaiters = new Map();
    this.nextRequestId = 1;
    this.queuedMessages = [];
  }

  get connected() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  get inRoom() {
    return Boolean(this.code && this.token);
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }

  /** Open (or reuse) a WebSocket connection. Resolves when the socket is open. */
  connect(url) {
    const clean = String(url || '').trim();
    if (!clean) return Promise.reject(new Error('No server URL supplied'));

    if (this.url === clean && this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
      if (this.ws.readyState === WebSocket.CONNECTING) {
        return new Promise((resolve, reject) => this.openWaiters.push({ resolve, reject }));
      }
    }

    this.url = clean;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this._clearReconnect();
    this._open();
    return new Promise((resolve, reject) => this.openWaiters.push({ resolve, reject }));
  }

  _open() {
    this._setStatus(this.reconnectAttempt ? 'reconnecting' : 'connecting');

    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this._rejectOpenWaiters(error);
      this._scheduleReconnect();
      return;
    }

    this.ws = socket;

    socket.addEventListener('open', () => {
      if (this.ws !== socket) return;
      this.reconnectAttempt = 0;
      this._setStatus('connected');
      this._resolveOpenWaiters();

      const stored = loadStoredRoom();
      if (stored && stored.code && stored.token) {
        this._sendRaw({ type: 'resume', code: stored.code, token: stored.token });
      }
      this._flushQueue();
    });

    socket.addEventListener('message', (event) => {
      if (this.ws !== socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;

      const id = message.id;
      if (id != null && this.requestWaiters.has(id)) {
        const waiter = this.requestWaiters.get(id);
        this.requestWaiters.delete(id);
        window.clearTimeout(waiter.timer);
        if (message.ok === false) waiter.reject(new Error(message.message || 'Server error'));
        else waiter.resolve(message);
      }
      this.onEvent(message);
    });

    socket.addEventListener('error', () => {
      // The close event handles state and reconnection; error details can leak
      // browser internals and are not useful to the player.
    });

    socket.addEventListener('close', () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this._rejectOpenWaiters(new Error('Connection closed'));
      this._rejectAllRequests(new Error('Connection closed'));
      if (this.shouldReconnect) {
        this._setStatus('reconnecting');
        this._scheduleReconnect();
      } else {
        this._setStatus('offline');
      }
    });
  }

  _resolveOpenWaiters() {
    const waiters = this.openWaiters.splice(0);
    waiters.forEach((waiter) => waiter.resolve());
  }

  _rejectOpenWaiters(error) {
    const waiters = this.openWaiters.splice(0);
    waiters.forEach((waiter) => waiter.reject(error));
  }

  _rejectAllRequests(error) {
    for (const waiter of this.requestWaiters.values()) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.requestWaiters.clear();
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(8000, 450 * 2 ** (this.reconnectAttempt - 1));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, delay);
  }

  _sendRaw(message) {
    if (!this.connected) return false;
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  _flushQueue() {
    const queued = this.queuedMessages.splice(0);
    queued.forEach((message) => this._sendRaw(message));
  }

  _send(message) {
    if (this._sendRaw(message)) return;
    this.queuedMessages.push(message);
  }

  /** Send a command and resolve when the server acknowledges it. */
  request(payload, timeoutMs = 8000) {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.requestWaiters.delete(id);
        reject(new Error('Server did not respond'));
      }, timeoutMs);

      this.requestWaiters.set(id, { resolve, reject, timer });
      if (!this._sendRaw({ ...payload, id })) {
        this.requestWaiters.delete(id);
        window.clearTimeout(timer);
        reject(new Error('Not connected'));
      }
    });
  }

  createRoom(nickname = '') {
    return this.request({ type: 'create_room', nickname });
  }

  joinRoom(code, nickname = '') {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return Promise.reject(new Error('Enter a room code'));
    return this.request({ type: 'join_room', code: clean, nickname });
  }

  /** Adopt credentials from a room_created / room_joined / room_resumed message. */
  adoptRoom(message) {
    if (!message || !message.code || !message.token) return;
    this.code = String(message.code).toUpperCase();
    this.token = String(message.token);
    if (message.color) this.color = message.color;
    this.opponentConnected = false;
    this.opponentNickname = '';
    this._storeRoom();
  }

  clearRoom() {
    this.code = null;
    this.token = null;
    this.color = null;
    this.opponentConnected = false;
    this.opponentNickname = '';
    try {
      localStorage.removeItem(ROOM_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private mode.
    }
  }

  _storeRoom() {
    if (!this.code || !this.token) return;
    try {
      localStorage.setItem(ROOM_STORAGE_KEY, JSON.stringify({ code: this.code, token: this.token }));
    } catch {
      // Storage can be unavailable in private mode.
    }
  }

  sendMove(from, to) {
    if (!this.inRoom) return false;
    this._send({ type: 'move', code: this.code, token: this.token, from, to });
    return true;
  }

  requestState() {
    if (!this.inRoom) return false;
    this._send({ type: 'request_state', code: this.code, token: this.token });
    return true;
  }

  requestRematch() {
    if (!this.inRoom) return false;
    this._send({ type: 'rematch', code: this.code, token: this.token });
    return true;
  }

  leaveRoom() {
    if (this.inRoom) this._send({ type: 'leave_room', code: this.code, token: this.token });
    this.clearRoom();
  }

  disconnect() {
    this.shouldReconnect = false;
    this._clearReconnect();
    if (this.connected) {
      if (this.inRoom) this.leaveRoom();
      this.ws.close(1000, 'Client closed');
    }
    this.ws = null;
    this._setStatus('offline');
  }
}

export { ROOM_STORAGE_KEY };
