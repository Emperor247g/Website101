# Crown & Oak game server

This is the authoritative WebSocket server for the **Play Online** mode. It uses
the same `js/engine.js` rules engine as the board, so the server — not the
browser — decides whether every move is legal.

## Run locally

```bash
cd server
npm install
npm start
```

The server listens on `ws://localhost:8787` by default. Open `index.html` from a
local web server (not `file://`), open **Menu → Play Online**, and enter that URL
as the game server.

To host the frontend and backend together during development:

```bash
python -m http.server 8123   # from the project root, in another terminal
```

Then visit `http://localhost:8123/`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listening port. Most hosts inject this automatically. |
| `HOST` | `0.0.0.0` | Listening address. |
| `ALLOWED_ORIGIN` | unset | If set, only this exact browser origin may connect. |

Example:

```bash
ALLOWED_ORIGIN=https://your-name.github.io PORT=8787 npm start
```

## Deploy

GitHub Pages can host the static frontend, but it cannot run this Node server.
Deploy `server/` to any host with WebSocket support, for example Render, Fly.io,
Railway, or a small VPS. Then put the public `wss://…` URL in the game's online
menu. Invite links include the server URL for the other player.

A minimal `Dockerfile` is also included:

```bash
docker build -f server/Dockerfile -t crown-oak-server .
docker run -p 8787:8787 crown-oak-server
```

## Protocol summary

Client → server:

- `create_room { nickname }`
- `join_room { code, nickname }`
- `resume { code, token }`
- `move { code, token, from, to }`
- `request_state { code, token }`
- `rematch { code, token }`
- `leave_room { code, token }`

Server → clients:

- `room_created` / `room_joined` / `room_resumed` with `code`, `token`, `color`, `version`, `state`
- `move_applied { version, by, from, to, capture, promoted, pending, state }`
- `game_reset { version, state }`
- `room_state`, `opponent_status`, `opponent_joined`, `rematch_status`, `room_closed`, `error`

The client sends only click-level `from`/`to` coordinates. Full multi-jump
sequences are assembled from those validated steps, exactly like local play.
