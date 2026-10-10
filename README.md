# BRAINBYTE ARENA

A real-time, local-network multiplayer quiz/puzzle competition for a live tech-student event: 20 teams of 2, one phone per team, one host laptop, one projector. Everything runs from a single Node process and a single SQLite file. **No internet is needed during the event** (no CDNs, no remote fonts, no cloud services).

| View | URL | Who |
| --- | --- | --- |
| Team (phones) | `http://<laptop-ip>:3000/` (or scan the QR code) | participants |
| Projector | `http://<laptop-ip>:3000/display` | audience, read-only, no login |
| Admin | `http://<laptop-ip>:3000/admin` | host, password protected |

The game: **Level 1 Quick Brain** (12 timed questions, one answer each) → **Level 2 Codebreaker** (5 chained cipher stages) → qualification (top *N* teams, default 5) → **Level 3 The Final Hack** (4 chained stages, finalists only) → podium.

---

## 1. Requirements and install

* **Node.js 24 or newer** (uses the built-in `node:sqlite`, so there is nothing native to compile) and npm.
* Install once, while you still have internet:

```bash
npm install
npx playwright install chromium   # only needed to run the browser tests
npm run build
```

After that the laptop can be offline.

## 2. Run it

```bash
cp .env.example .env              # optional; defaults work
npm run admin:create -- host      # asks for a password (min 10 chars), stores only a scrypt hash
npm start                         # production: serves API + UI + sockets on :3000
```

The server prints the admin, projector and phone URLs on start-up. `npm run dev` runs the API (tsx watch) plus the Vite dev server with hot reload on <http://localhost:5173> (API proxied to `:3000`).

| Script | What it does |
| --- | --- |
| `npm run dev` | API with auto-restart + Vite dev server |
| `npm run build` | compile server (`dist/server`) and bundle UI (`dist/web`) |
| `npm start` | run the compiled production server |
| `npm test` | Vitest unit + integration tests |
| `npm run test:e2e` | Playwright browser tests (builds nothing; run `npm run build` first) |
| `npm run typecheck` / `npm run lint` | TypeScript (server, web, tests) / ESLint |
| `npm run db:migrate` | apply pending migrations (also runs automatically at start-up) |
| `npm run db:seed` | create a default event with the sample content if no event exists |
| `npm run db:backup` | consistent copy of the database into `data/backups/` (safe while running) |
| `npm run admin:create -- <user>` / `npm run admin:reset-password -- <user>` | manage admin accounts |
| `npm run loadtest -- <url>` | 20-team simultaneous-answer load test (see §9) |

Configuration (`.env`, never commit it): `PORT`, `HOST`, `DB_PATH`, `PUBLIC_URL`, `ADMIN_SESSION_HOURS`, `COOKIE_SECURE`, `RATE_LIMIT_ANSWER_MAX`. There is **no default admin password**; an admin must be created with the command above. For scripted use set `ADMIN_PASSWORD` in the environment instead of typing it.

**Resetting an admin password:** `npm run admin:reset-password -- host` (also signs that admin out everywhere).

## 3. Hosting on the local network

1. Put the laptop and all phones on the same Wi-Fi/LAN.
2. Find the laptop's LAN IPv4 address:
   * **macOS:** `ipconfig getifaddr en0` (Wi-Fi; try `en1` if empty), or System Settings → Wi-Fi → Details.
   * **Windows:** `ipconfig` → *Wireless LAN adapter Wi-Fi* → *IPv4 Address*.
   * **Linux:** `hostname -I` or `ip -4 addr show`.
3. `npm start`. The console lists `http://<ip>:3000/`; the admin dashboard and projector show the same join link as a QR code. If the detected IP is wrong (VPNs, several adapters), set `PUBLIC_URL=http://192.168.x.y:3000` in `.env`.
4. **Projector:** open `http://localhost:3000/display` on the laptop (or any browser on the LAN), full-screen it (F11), and drag it to the projector. It needs no login and cannot control anything.
5. **Phones:** scan the QR code on the projector or open the URL and type the 6-digit room PIN.
   A second phone for the same team: open the site, choose *"add this phone"*, and enter the team code shown on the first phone's lobby screen.

**Firewall / connectivity troubleshooting**

* Windows: allow Node.js on *Private* networks when prompted, or `netsh advfirewall firewall add rule name="BrainByte" dir=in action=allow protocol=TCP localport=3000`. Mark the Wi-Fi network as *Private*.
* macOS: System Settings → Network → Firewall → allow incoming connections for `node`.
* Linux: `sudo ufw allow 3000/tcp`.
* Many venue/guest Wi-Fi networks enable **client isolation**, which blocks phone-to-laptop traffic. Use a phone hotspot or a small travel router if phones cannot reach the laptop even though the firewall is open.
* Sanity check from a phone browser: `http://<ip>:3000/api/health` should show `{"ok":true,...}`.

## 4. Running the event (host checklist)

1. **Event tab:** set name, capacity (≤ 20), finalists count, auto-approve, live-scores on/off. **Rounds & scoring:** preview every question (tick *show answer keys*), adjust timers/points/hint penalties. Scoring locks once a round starts.
2. **Control → Open registration.** The projector shows the PIN and QR code and fills 20 team slots live.
3. **Teams tab:** approve/reject/remove (only before the first round). **Close registration & confirm teams** moves everyone to the lobby.
4. **Prepare Level 1** (teams see the instructions) → **Start round**. Pause/Resume/End as needed. After the round ends, optionally **Reveal answers** on the projector and phones.
5. Repeat for Level 2. After Level 2 ends, **Run qualification**: finalists are chosen and announced. You can change the number of finalists, or reopen qualification before Level 3 starts. Level 3 starting **freezes** qualification.
6. **Prepare/Start Level 3** (only finalists can play), **End round**, then **Finish event & show winners**: the projector shows the podium and champion.
7. **Leaderboard tab → Export CSV.** Manual score corrections (with a mandatory reason) live in the same tab and appear in the audit log.

If the server or laptop crashes mid-round: restart `npm start`. All scores, sessions and progress are on disk. A round that was running comes back **paused with exactly the time that was left** (±1 s heartbeat); press *Resume*. Phones reconnect by themselves.

## 5. Game rules as implemented

| | Level 1 – Quick Brain | Level 2 – Codebreaker | Level 3 – The Final Hack |
| --- | --- | --- | --- |
| Content | 12 Kerala / Malayalam film questions (choice + numeric) | Binary reel code → Poster alphabet shift → Box-office number lock → Caesar → Final vault | Atbash cipher (film title) → Logic grid (3 film posters) → Hidden pattern (acrostic) → Final vault |
| Pacing | Each team works through the questions at its own speed; **one answer per question**, wrong answers still use the question | Stages unlock one at a time, **unlimited tries**, wrong answers never advance | same as Level 2, finalists only |
| Points | 100/question (+ speed bonus 0–20, default 10, decays over a configurable window) | 200 / 200 / 200 / 300 / 500 (+ time bonus ≤ 200, proportional to round time left) | 300 / 300 / 300 / 400 + completion bonus 500 + time bonus ≤ 200 |
| Hints | off | on, −50 once per stage | on, −100 once per stage |
| Wrong penalty | 0 (configurable) | 0 (configurable) | 0 (configurable) |

Final vault passwords are derived from earlier answers (L2: *stage 4 word* `-` *stage 3 number* *stage 1 letter* = `BALAN-42M`; L3: *hidden word* `-` *logic code* `-` *first 3 letters of the cipher word* = `MOHANLAL-231-PRE`). The vault is never solvable by guessing the earlier stages out of order. The stage texts explain the construction.

**Answer normalisation** (server side only): Unicode NFKC, trim, collapse whitespace, case-fold. Punctuation and inner characters are preserved (`BALAN-42M` ≠ `BALAN42M`). Numeric answers parse strictly (`42`, `42.0`, `042` match; `4 2`, `1e1` do not). Multiple-choice compares option ids. Alternatives can be listed in a challenge's `answers` array.

**Ranking and tie-breaker** (one function, `server/game/ranking.ts`, used by the backend, admin, projector, phones, CSV and podium):
1. finalists above non-finalists once Level 3 has begun; then
2. highest total score; 3. highest score in the most recently played level; 4. most challenges solved; 5. earliest timestamp of the last solve; 6. lowest team id (only to keep the order deterministic). Rows still tied after step 5 are flagged **tie** in every view.

**Timing policy.** The server clock is the only clock. A round stores its deadline; pausing stores the remaining milliseconds and resuming sets `deadline = now + remaining`. A submission is accepted iff the round is running and `server receipt time ≤ deadline` (**inclusive**). Submissions are processed one at a time in arrival order inside a database transaction, so two answers in the same millisecond are ordered by their submission id. Late answers are stored for audit (`outcome = late`), score nothing and do not consume a question. Bonuses use the pause-safe "active play" clock, not wall time. Browsers only interpolate a countdown between server syncs.

## 6. Architecture

```
shared/    types + socket event contract used by both sides
server/
  game/    pure logic: normalize, scoring, timer, stateMachine, ranking   (unit tested)
  engine/  context (db, clock, audit), events (state machine + rounds), teams, play (submit/hint),
           admin (adjustments, config, CSV), standings, views (per-audience snapshots)
  http/    express app, auth (scrypt), middleware (CSRF, origin, rate limit), schemas (zod)
  realtime/ socket.io auth, coalesced broadcasts, ticker
  db/      node:sqlite wrapper, migrations
  content/ seeded questions/stages (+ cipher generators)
web/       React + Vite + Tailwind: Team, Display, Admin
tests/     unit/, integration/ (Vitest, real server + sockets), e2e/ (Playwright)
scripts/   admin, migrate, seed, backup, loadtest, dev, e2e-server
```

**Event state machine** (`server/game/stateMachine.ts`; invalid moves return HTTP 409):

```
SETUP ⇄ REGISTRATION_OPEN → LOBBY → ROUND_READY → ROUND_RUNNING ⇄ ROUND_PAUSED → ROUND_ENDED
                  ↑___________|          ↑                                         │
                                         └──── QUALIFICATION ←─ (after L2) ────────┤
ROUND_ENDED → ROUND_READY (next level) | QUALIFICATION | EVENT_COMPLETED
```
Extra guards live in the engine: Level 3 can only be prepared from QUALIFICATION; qualification can be reopened only from ROUND_READY of Level 3; teams can be approved/removed only before play; scoring/timers are locked once a round starts. `Reset event` (typed confirmation) is an admin operation outside the normal flow.

**Real-time contract** (`shared/contract.ts`). Server → client: `state:public` (projector + phones: no answers, no private data), `team:state` (only that team's room), `admin:state` (admin room, includes answer keys), `timer:sync`, `announce`, `session:ended`. Client → server (with acks): `answer:submit`, `hint:request`. Sockets authenticate in the handshake (`display` = public/read-only; `team` and `admin` require their HttpOnly cookie) and every handler re-checks the live session. Admin *commands* use authenticated REST (`/api/admin/*`) so they get CSRF protection and are trivially testable; the same submission service backs both `POST /api/team/answer` and the socket event, and a phone falls back to HTTP with the *same request id* if the socket acknowledgement times out. Broadcasts are coalesced (60 ms) so a burst of 20 answers produces one snapshot per audience.

**Database** (`server/db/migrations.ts`, SQLite, WAL, foreign keys on): `events`, `admin_users`, `admin_sessions`, `rounds`, `challenges` (Level 1 questions *and* Level 2/3 puzzle stages, ordered), `teams`, `team_sessions`, `team_stage_progress`, `hints_used`, `answer_submissions`, `score_ledger`, `event_state_history`, `audit_logs`, `leaderboard_snapshots` (official standings written when each round ends and when the event completes). Integrity is enforced by the database itself: unique room PIN, partial unique index on active team names, unique `(team, request_id)`, partial unique index allowing only one *correct* submission per team and challenge, and a unique `idempotency_key` on every ledger row. **Scores are never stored; they are `SUM(score_ledger.points)`.** All timestamps are UTC (ISO text, plus epoch ms for timing).

**Main HTTP endpoints:** `POST /api/team/join|link|answer|hint|logout`, `GET /api/team/me`, `GET /api/public/state|event`, `POST /api/admin/login|logout`, `GET /api/admin/state|export.csv`, `POST /api/admin/event|event/reset|event/complete|registration/*|round/*|qualification/open|teams/:id/status|teams/:id/score`, `PATCH /api/admin/event|round/:level/config|challenges/:id`.

## 7. Security notes

* Admin passwords: scrypt with a per-user salt, constant-time comparison; failed logins are rate limited (8 / 10 min / IP) and audited; sessions are random 256-bit tokens, stored hashed, with a CSRF token required on every state-changing admin request, `HttpOnly; SameSite=Strict` cookies, and an Origin check on all unsafe `/api` requests and WebSocket handshakes.
* Team identity comes **only** from an HttpOnly session cookie issued at registration (stored hashed). Names/ids in request bodies are ignored; a second phone needs the private team code.
* Input is validated with Zod on every route and socket event; SQL is parameterised; responses never include stack traces or SQL errors; CSV cells beginning with `= + - @` are neutralised.
* Answer keys exist only in the database and the `admin:state` payload. Teams get the prompt only (never the key); the projector/phones receive answers only after the host reveals them for a finished round.
* Rate limits: answers (12 / 10 s / team, shared by socket and HTTP), hints, joins, device links, logins.
* **A local network is not a trusted network.** Anyone on the same Wi-Fi who knows the PIN can try to register while registration is open, and traffic is plain HTTP (cookies cannot be `Secure`, and can be sniffed on open Wi-Fi). Use a WPA2/3-protected network, keep registration closed except when needed, use `autoApprove=false` for open venues, and choose a strong admin password. Do not expose port 3000 to the internet. Put it behind an HTTPS reverse proxy and set `COOKIE_SECURE=true` if you ever must.

## 8. Tests (what was actually run)

```bash
npm run typecheck && npm run lint
npm test                 # 93 tests: 31 unit + 62 integration
npm run build && npm run test:e2e   # 3 Playwright journeys in Chromium
```

Last full run on macOS (Node 26.5): **93/93 Vitest tests pass, 3/3 Playwright tests pass, typecheck and lint clean.**

* **Unit** (`tests/unit`): normalisation, alternatives, numeric parsing, speed/time bonus, config validation, timer pause/resume/deadline, ranking and every tie-break step, finalist selection, state machine, and independent re-derivation of every seeded puzzle answer (including brute-forcing that the logic grid has exactly one solution).
* **Integration** (`tests/integration`, real HTTP server + Socket.IO + SQLite): admin auth/CSRF/origin/logout/rate limit; socket authorisation; no answer-key leakage; registration limits, duplicate and near-duplicate names, concurrent joins (26 → exactly 20), registration closing mid-join; Level 1/2 scoring, retries, duplicates, concurrent submissions, deadline (inclusive), ticker expiry, repeated pause/resume, hints charged once, stage skipping/replay, two devices on one team; qualification, freezing and reopening, tie at the cutoff, finalist-only Level 3, podium, CSV and ledger = snapshot = displayed totals; admin adjustments, reset, audit log; DB write failure rolls back and the same request id can be retried; server restart mid-round (paused, remaining time intact), restart after completion; 20 simultaneous socket submissions.
* **E2E** (`tests/e2e`): the full event through the real UI (admin login → create → registration → 2 phones → projector updates → Level 1 → Level 2 progression, wrong code, single advance → qualification → Level 3 → podium/champion → CSV equals leaderboard → audit log); offline/online reconnection and page refresh; responsive checks (320, 375, 768, 1280, 1920 px, 20 teams, no horizontal overflow, projector fits 20 rows without scrolling), touch target size, keyboard selection, reduced motion, and **axe-core WCAG 2.1 A/AA scans** on join, team play, projector (registration and live) and admin.

**Not verified:** real phones (iOS Safari / Android Chrome) on a physical Wi-Fi network, Windows and Linux hosts, and a real projector. Phone behaviour was tested with Chromium mobile emulation only.

## 9. Load test

```bash
DB_PATH=./data/loadtest.db RATE_LIMIT_ANSWER_MAX=1000 npm start     # terminal 1 (spare database!)
DB_PATH=./data/loadtest.db ADMIN_PASSWORD=... npm run admin:create -- host   # once
ADMIN_USER=host ADMIN_PASSWORD=... npm run loadtest -- http://localhost:3000   # terminal 2
```
It registers 20 teams, connects 20 sockets plus a projector, and fires all 20 answers for each of the 12 Level 1 questions at the same instant (240 bursts), then checks every acknowledgement and every final score. On the development laptop: 0 failures, ack latency p50 ≈ 3.5 ms, p95 ≈ 12 ms. It creates a new event, so never run it against a live one.

## 10. Backup and restore

* Backup (any time, even mid-event): `npm run db:backup` → `data/backups/brainbyte-<timestamp>.db`. Or copy `data/brainbyte.db` *together with* its `-wal`/`-shm` files while the server is stopped.
* Restore: stop the server, replace `data/brainbyte.db` with the backup (delete any `brainbyte.db-wal`/`-shm`), start the server. Teams' cookies stay valid because sessions are in the database.

## 11. Known limitations

* One active event at a time (previous events are archived in the database, not browsable in the UI).
* Question/answer text is seeded from `server/content/seed.ts`; the dashboard edits points, hints and scoring but not prompts or answer keys. To change content, edit the seed file and create a new event.
* Levels are fixed at 1 → 2 → qualification → 3, with a 20-team cap; qualification happens after Level 2.
* Level 1 is self-paced per team (not host-paced question by question); the projector therefore shows round instructions, progress and standings, not a single shared question.
* After a server restart a running round always returns *paused* and needs a host *Resume*. The remaining time is accurate to the 1 s heartbeat.
* In-memory rate limiting resets on restart. Plain HTTP on the LAN (see §7).
