# STARSPHERE ONLINE

Multiplayer STARSPHERE: up to **8 friends share the home cluster** of one
universe, with accounts, invite codes, and a SQLite-backed server that
keeps ticking whether anyone is watching or not. The single-player
`../starsphere.html` is untouched and keeps working offline.

## Run it

```bash
cd sphere
./start.sh           # installs deps on first run, listens on http://localhost:8777
                     # auto-restarts if the server crashes; PORT=9000 ./start.sh for another port
./start.sh --tunnel  # additionally opens a public https URL (cloudflared quick tunnel)
                     # and prints it — share that link with friends, works on phones
```

(Or manually: `npm install` once, then `npm start`.) The `--tunnel` URL is
ephemeral — each start gets a new one. Accounts and universes live in
`sphere.db` on this machine, so a changing URL loses nothing.

Open http://localhost:8777 — register, then either **create a round**
(you pick the tick pace: 1 tick/hour or 1 tick/min, and you get a 6-letter
invite code) or **join a friend's round** with their code. Joiners take
home-cluster slots in order; unfilled slots stay AI. Late joiners get
their own 72-tick raid-protection window from the moment they join.

All state lives in `sphere.db` (SQLite, WAL mode) — back up that one file
and you've backed up every universe.

- `PORT=1234 npm start` — change the port.
- `DEV_TICK=1 npm start` — enables `POST /api/dev/tick {id, n}` to
  fast-forward a game while testing. Never run this in production.

## Playing with friends over the internet

**ngrok (quickest):**
```bash
npm start            # terminal 1
ngrok http 8777      # terminal 2 — share the https URL it prints
```

**VPS (the real deal):** copy this folder, `npm install`, then keep it
alive with systemd:

```ini
# /etc/systemd/system/starsphere.service
[Unit]
Description=STARSPHERE ONLINE
After=network.target

[Service]
WorkingDirectory=/opt/starsphere
ExecStart=/usr/bin/node server.js
Restart=always
Environment=PORT=8777

[Install]
WantedBy=multi-user.target
```

Put nginx/caddy in front for HTTPS if you want browser notifications to
work away from localhost.

## What's multiplayer right now

- Shared universe: one tick clock, one AI world of 25 clusters / 199 rivals.
- Friends appear in your cluster (Galaxy screen), the universe map,
  rankings, and the news feed.
- **Aid convoys to friends actually transfer resources** (800 ore /
  800 crystal / 400 flux, 12-tick cooldown).
- Raids, scans, and covert ops against *fellow commanders* are blocked
  ("not yet allowed") — PvP is the designed next phase, alongside joint
  defense against raids and in-game chat.

## How it's put together

| File | Role |
|---|---|
| `game.js` | All game rules as pure functions over a universe object — the single source of truth, runs only on the server. |
| `server.js` | Express + better-sqlite3: accounts (scrypt-hashed passwords), sessions, invite codes, lazy tick catch-up on every request plus a 5s background pump. |
| `public/index.html` | The client — generated from `../starsphere.html` by `make-client.py`. Rendering is identical to single-player; persistence and actions go through `/api`. |
| `make-client.py` | Regenerates the client after you change `../starsphere.html` (run `python3 make-client.py`). |

The client polls game state every 5 seconds (the game ticks at most once
a minute, so that's plenty) and re-renders only when the tick advances.
Every action is validated server-side; the browser is just a viewer.
