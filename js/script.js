/**
 * Standalone Supabase bridge for Crown & Oak.
 *
 * The hosted Vite build injects credentials at build time. The single-file
 * CrownAndOak.html cannot do that, so this module publishes the public
 * Supabase settings to the game before main.js starts. The Supabase JS CDN
 * script must be loaded before this module; when it is unavailable (offline),
 * the game simply falls back to its WebSocket room fields.
 */

const SUPABASE_URL = 'https://kfzjikhynazkojqxyyhw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hOYd-U2WZFLIS0sloJJpfA_Bm84WsPt';

const SUPABASE_CONFIG = {
  url: SUPABASE_URL,
  anonKey: SUPABASE_KEY,
};

async function authenticatePlayer(client) {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) {
      console.error('Supabase session error:', sessionError.message);
      return null;
    }

    if (sessionData?.session) {
      return sessionData.session.user;
    }

    const { data, error } = await client.auth.signInAnonymously();
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

if (globalThis.supabase?.createClient) {
  // main.js reads this before it creates the Supabase Realtime transport.
  globalThis.__CROWN_OAK_SUPABASE_CONFIG__ = SUPABASE_CONFIG;

  const supabaseClient = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  globalThis.__crownOakSupabaseClient = supabaseClient;
  authenticatePlayer(supabaseClient);
}

export { SUPABASE_CONFIG, authenticatePlayer };
