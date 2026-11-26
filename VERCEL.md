# Deploying Crown & Oak to Vercel

The site is a Vite static build. The old `server/` WebSocket server is not used on Vercel; hosted online rooms use Supabase Realtime instead. The standalone `CrownAndOak.html` and the WebSocket fallback remain in the repo.

## 1. Supabase setup

1. Create a Supabase project.
2. Open **Project Settings → API** and copy:
   - **Project URL**
   - **anon public / publishable** key
3. Open **Project Settings → API → Realtime** and make sure Realtime is enabled. No game tables are required: rooms use Realtime Broadcast and Presence only.
4. Leave Realtime "Allow public access" enabled. The game uses public `crown-oak-<ROOM_CODE>` channels, so no database tables are needed. If your project has public access disabled or custom Realtime RLS, run `SUPABASE_SETUP.sql` in the SQL Editor to allow anon/authenticated Broadcast and Presence messages.

> Use only the public anon/publishable key in browser code and environment variables. Never use a service-role/secret key in Vercel frontend env vars or in `CrownAndOak.html`.

The standalone `CrownAndOak.html` also uses these public Supabase values from `js/script.js`, loaded through the Supabase JS CDN before the game bundle. It still falls back to the WebSocket room fields when the CDN or Supabase is unavailable.

## 2. Vercel environment variables

In the Vercel project, add:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | your Supabase anon public key |

These are injected at build time by Vite. Redeploy after changing them.

## 3. Build settings

Vercel should use the included `vercel.json`:

- Framework: `vite`
- Build command: `npm run build`
- Output directory: `dist`

`npm run build` automatically runs:

1. `python tools/build-standalone.py` — regenerates `CrownAndOak.html` from source.
2. `node tools/copy-worker.mjs` — copies the generated AI worker and standalone HTML into `public/`.
3. `vite build` — produces `dist/`.

Local equivalents:

```powershell
npm run dev       # local Vite server
npm run build     # production build
npm run preview   # preview dist/
npm run standalone
```

## 4. Online room behaviour

- If both Supabase env vars are present, the **Game server** field is hidden and invite links contain only `?room=CODE`.
- If they are absent, the original WebSocket client is used and the `ws://` / `wss://` field remains available.
- The room creator is the host. Click-level moves are validated in the browser with the shared rules engine before the host broadcasts one authoritative state update to both players.
- Room credentials and the latest snapshot are saved in `localStorage`, so a reload can reattach to the same seat.
- Presence tracks connection state. If the host reloads, its local snapshot restores the room. If the host disappears entirely, a remaining player with a cached snapshot can take over.

This is client-validated, not server-authoritative. A determined player could modify their own browser, so Supabase Realtime mode is intended for trusted invitations. For tamper-proof public matches, add a serverless/Database validation layer later.

## 5. Files

- `vite.config.js` — Vite config and build-time Supabase env injection.
- `js/script.js` — public Supabase config bridge used by both hosted and standalone builds.
- `js/supabase-net.js` — Supabase Realtime transport compatible with `js/net.js`.
- `SUPABASE_SETUP.sql` — one-time Realtime policies required for remote rooms.
- `tools/copy-worker.mjs` — copies runtime worker/standalone assets into the Vite build.
- `vercel.json`, `.vercelignore`, `.env.example` — deployment configuration.

## 6. GitHub

Keep source files, `package.json`, `package-lock.json`, build tools, and `CrownAndOak.html` in the repository. `node_modules/`, `dist/`, and `public/` are generated and ignored.
