/**
 * Supabase bridge for Crown & Oak.
 *
 * The hosted Vite build injects credentials at build time. The single-file
 * CrownAndOak.html cannot do that, so this module publishes the public
 * Supabase settings to the game before main.js starts. It also adapts the
 * optional create_room / join_room RPCs used by database-backed room systems.
 *
 * The Supabase JS CDN script must load before this module in standalone mode.
 * When Supabase is unavailable, the game falls back to its WebSocket rooms.
 */

import { createClient } from '@supabase/supabase-js';

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
  const supabase = client || getSupabaseClient();
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
    for (const key of ['room_code', 'roomCode', 'code', 'room']) {
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
  const supabase = getSupabaseClient(config);
  if (!supabase) return null;

  const user = await authenticatePlayer(supabase);
  if (!user) {
    console.info(`Supabase RPC ${name} skipped: anonymous authentication is unavailable.`);
    return null;
  }

  const { data, error } = params
    ? await supabase.rpc(name, params)
    : await supabase.rpc(name);

  if (error) {
    if (isMissingRpc(error)) {
      console.info(`Supabase RPC ${name} is not available; using the Realtime room flow.`);
      return null;
    }
    throw new Error(error.message || `Supabase ${name} failed`);
  }

  return { data, code: extractRoomCode(data) };
}

/** Register a room with the optional Supabase create_room RPC. */
async function createRoomViaRpc(config = {}) {
  return callRoomRpc('create_room', null, config);
}

/** Validate a room code with the optional Supabase join_room RPC. */
async function joinRoomViaRpc(code, config = {}) {
  const clean = normalizeRoomCode(code);
  if (clean.length !== 6) {
    throw new Error('Enter a valid 6-character room code.');
  }

  const result = await callRoomRpc('join_room', { p_room_code: clean }, config);
  return result ? { ...result, code: result.code || clean } : null;
}

/** Copy a room code. Crown & Oak's #onlineCopy button copies a full invite link. */
async function copyRoomCode(code) {
  const clean = normalizeRoomCode(code);
  if (clean.length !== 6) {
    throw new Error('Enter a valid 6-character room code.');
  }
  await navigator.clipboard.writeText(clean);
  return clean;
}

if (globalThis.supabase?.createClient) {
  // main.js reads this before it creates the Supabase Realtime transport.
  globalThis.__CROWN_OAK_SUPABASE_CONFIG__ = SUPABASE_CONFIG;
  const supabaseClient = getSupabaseClient();
  if (supabaseClient) authenticatePlayer(supabaseClient);
}

export {
  SUPABASE_CONFIG,
  authenticatePlayer,
  getSupabaseClient,
  createRoomViaRpc,
  joinRoomViaRpc,
  copyRoomCode,
  normalizeRoomCode,
};
