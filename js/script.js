import { createClient } from '@supabase/supabase-js';

// ==============================
// CHECKERS ONLINE ROOM SYSTEM
// ==============================

const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const copyRoomCodeBtn = document.getElementById("copy-room-code-btn");

const roomCodeInput = document.getElementById("room-code-input");
const roomCodeDisplay = document.getElementById("room-code-display");
const createdRoomDiv = document.getElementById("created-room");
const roomStatus = document.getElementById("room-status");

let currentRoom = null;
// ==============================
// REALTIME ROOM LISTENER
// ==============================

let roomChannel = null;

function subscribeToRoom(roomId) {

  // Remove any previous subscription
  if (roomChannel) {
    supabaseClient.removeChannel(roomChannel);
  }

  roomStatus.textContent = "Connecting to live game...";

  roomChannel = supabaseClient
    .channel("room-" + roomId)

    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "matchrooms",
        filter: "id=eq." + roomId
      },
      (payload) => {

        // Updated room data from Supabase
        currentRoom = payload.new;

        console.log("Realtime room update:", payload.new);

        if (payload.new.status === "playing") {
          roomStatus.textContent = "Opponent connected! Game is ready.";
        }

        if (payload.new.status === "finished") {
          roomStatus.textContent = "Game finished.";
        }

        // We'll connect the board rendering here in Step 10
        if (typeof handleRoomUpdate === "function") {
          handleRoomUpdate(payload.new);
        }
      }
    )

    .subscribe((status) => {
      console.log("Realtime subscription status:", status);

      if (status === "SUBSCRIBED") {
        roomStatus.textContent = "Connected to live room.";
      }

      if (status === "CHANNEL_ERROR") {
        roomStatus.textContent = "Realtime connection error.";
      }
    });
}

// Create room
createRoomBtn.addEventListener("click", async () => {
  roomStatus.textContent = "Creating room...";

  const user = await authenticatePlayer();

  if (!user) {
    roomStatus.textContent = "Authentication failed.";
    return;
  }

  const { data, error } = await supabaseClient.rpc("create_room");

  if (error) {
    console.error(error);
    roomStatus.textContent = error.message;
    return;
  }

  currentRoom = data;
  subscribeToRoom(data.id);

  roomCodeDisplay.textContent = data.room_code;
  createdRoomDiv.style.display = "block";

  roomStatus.textContent = "Room created! Waiting for another player.";

  console.log("Created room:", data);
});

// Join room
joinRoomBtn.addEventListener("click", async () => {
  const code = roomCodeInput.value.trim().toUpperCase();

  if (code.length !== 6) {
    roomStatus.textContent = "Enter a valid 6-character room code.";
    return;
  }

  roomStatus.textContent = "Joining room...";

  const user = await authenticatePlayer();

  if (!user) {
    roomStatus.textContent = "Authentication failed.";
    return;
  }

  const { data, error } = await supabaseClient.rpc("join_room", {
    p_room_code: code
  });

  if (error) {
    console.error(error);
    roomStatus.textContent = error.message;
    return;
  }

  currentRoom = data;
  subscribeToRoom(data.id);

  roomStatus.textContent = "You joined the room successfully!";

  console.log("Joined room:", data);
});

// Copy room code
copyRoomCodeBtn.addEventListener("click", async () => {
  const code = roomCodeDisplay.textContent;

  try {
    await navigator.clipboard.writeText(code);
    roomStatus.textContent = "Room code copied!";
  } catch (error) {
    roomStatus.textContent = "Unable to copy code.";
    console.error(error);
  }
});

// ==============================
// CROWN & OAK COMPATIBILITY LAYER
// ==============================
// The room panel above uses bare `supabaseClient` / `authenticatePlayer()`.
// main.js imports the helpers below, so both APIs stay available.

const SUPABASE_URL = 'https://kfzjikhynazkojqxyyhw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hOYd-U2WZFLIS0sloJJpfA_Bm84WsPt';

const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_KEY,
};

function readBuildConfig() {
  if (typeof __SUPABASE_CONFIG__ === 'undefined') return null;
  return __SUPABASE_CONFIG__ && typeof __SUPABASE_CONFIG__ === 'object'
    ? __SUPABASE_CONFIG__
    : null;
}

function resolveConfig(config = {}) {
  const buildConfig = readBuildConfig();
  const runtimeConfig = globalThis.__CROWN_OAK_SUPABASE_CONFIG__;
  const source = config?.url && config?.anonKey
    ? config
    : buildConfig?.url && buildConfig?.anonKey
      ? buildConfig
      : runtimeConfig?.url && runtimeConfig?.anonKey
        ? runtimeConfig
        : SUPABASE_CONFIG;

  return {
    url: String(source.url || '').replace(/\/$/, ''),
    anonKey: String(source.anonKey || ''),
  };
}

function getSupabaseClient(config = {}) {
  const effective = resolveConfig(config);
  if (!effective.url || !effective.anonKey) return null;
  if (globalThis.__crownOakSupabaseClient) return globalThis.__crownOakSupabaseClient;

  const create = globalThis.supabase?.createClient || createClient;
  if (typeof create !== 'function') return null;

  const client = create(effective.url, effective.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  globalThis.__crownOakSupabaseClient = client;
  return client;
}

async function authenticatePlayer(client) {
  const supabase = client || supabaseClient;
  if (!supabase) {
    console.error('Supabase is not available');
    return null;
  }

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('Supabase session error:', sessionError.message);
      return null;
    }

    if (sessionData?.session) {
      return sessionData.session.user;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error('Supabase anonymous sign-in failed:', error.message);
      return null;
    }
    return data?.user || null;
  } catch (error) {
    console.error('Supabase authentication error:', error);
    return null;
  }
}

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function extractRoomCode(data, depth = 0) {
  if (depth > 3 || data === null || data === undefined) return null;

  if (typeof data === 'string') {
    return normalizeRoomCode(data) || null;
  }

  if (Array.isArray(data)) {
    for (const entry of data) {
      const code = extractRoomCode(entry, depth + 1);
      if (code && code.length === 6) return code;
    }
    return null;
  }

  if (typeof data === 'object') {
    for (const key of ['room_code', 'roomCode', 'code', 'room', 'id']) {
      if (data[key] === null || data[key] === undefined) continue;
      const code = extractRoomCode(data[key], depth + 1);
      if (code && code.length === 6) return code;
    }
  }

  return null;
}

function isMissingRpc(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return code === 'PGRST202'
    || code === '42883'
    || code === '42704'
    || message.includes('could not find the function')
    || message.includes('function public.create_room')
    || message.includes('function public.join_room')
    || message.includes('schema cache')
    || (code === 'P0001' && message.includes('room not found'));
}

async function callRoomRpc(name, params, config) {
  const client = getSupabaseClient(config);
  if (!client) return null;

  const user = await authenticatePlayer(client);
  if (!user) {
    console.info(`Supabase RPC ${name} skipped: anonymous authentication is unavailable.`);
    return null;
  }

  const { data, error } = params
    ? await client.rpc(name, params)
    : await client.rpc(name);

  if (error) {
    if (isMissingRpc(error)) {
      console.info(`Supabase RPC ${name} is not available; using the Realtime room flow.`);
      return null;
    }
    throw new Error(error.message || `Supabase ${name} failed`);
  }

  return { data, code: extractRoomCode(data) };
}

async function createRoomViaRpc(config = {}) {
  return callRoomRpc('create_room', null, config);
}

async function joinRoomViaRpc(code, config = {}) {
  const clean = normalizeRoomCode(code);
  if (clean.length !== 6) {
    throw new Error('Enter a valid 6-character room code.');
  }

  const result = await callRoomRpc('join_room', { p_room_code: clean }, config);
  return result ? { ...result, code: result.code || clean } : null;
}

async function copyRoomCode(code) {
  const clean = normalizeRoomCode(code);
  if (clean.length !== 6) {
    throw new Error('Enter a valid 6-character room code.');
  }
  await navigator.clipboard.writeText(clean);
  return clean;
}

function getCurrentRoom() {
  return currentRoom;
}

function bindRoomControls() {
  // The listeners above are bound when this module loads; this export exists
  // so main.js and the standalone bundle can call it safely.
  for (const button of [createRoomBtn, joinRoomBtn, copyRoomCodeBtn]) {
    if (button) button.dataset.crownOakRoomBound = 'true';
  }
}

const supabaseClient = getSupabaseClient();

if (globalThis.supabase?.createClient) {
  globalThis.__CROWN_OAK_SUPABASE_CONFIG__ = SUPABASE_CONFIG;
  if (supabaseClient) authenticatePlayer(supabaseClient);
}

bindRoomControls();

export {
  SUPABASE_CONFIG,
  authenticatePlayer,
  getSupabaseClient,
  createRoomViaRpc,
  joinRoomViaRpc,
  copyRoomCode,
  normalizeRoomCode,
  bindRoomControls,
  getCurrentRoom,
};