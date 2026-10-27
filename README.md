# BRAINBYTE ARENA

A real-time, local-network multiplayer tech competition for a live student event: 20 teams of 2, one phone per team, one host laptop, one projector. Everything runs from a single Node process and a single SQLite file. **No internet is needed during the event** (no CDNs, no remote fonts, no cloud services).

| View | URL | Who |
| --- | --- | --- |
| Team (phones) | `http://<laptop-ip>:3000/` (or scan the QR code) | participants |
| Projector | `http://<laptop-ip>:3000/display` | audience, read-only, no login |
| Admin | `http://<laptop-ip>:3000/admin` | host, password protected |
| Coordinator | `http://<laptop-ip>:3000/coordinator` | whoever conducts the live rounds; same admin sign-in, shows the answer keys |

The game, five rounds of tech: **Level 1 Tech Faces** (live: identify the tech personality in the picture) → **Level 2 Tech Bingo** (live: a shuffled 4x4 bingo card per team, host-called clues, line and blackout bonuses) → **Level 3 Quick Brain** (self-paced quiz, with a Skip button) → **Level 4 Reel Rush** (live: speed, streaks, Double Down) → qualification (top *N* teams, default 5; the host can also cut the field after Levels 1-3) → **Level 5 Final Showdown** (finalists only: lives, steals, last team standing) → podium.

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

Configuration (`.env`, never commit it): `PORT`, `HOST`, `DB_PATH`, `PUBLIC_URL`, `ADMIN_SESSION_HOURS`, `COOKIE_SECURE`, `RATE_LIMIT_ANSWER_MAX`, `RATE_LIMIT_LOGIN_MAX` (default 8 sign-ins per 10 minutes; only raise it for automated tests). There is **no default admin password**; an admin must be created with the command above. For scripted use set `ADMIN_PASSWORD` in the environment instead of typing it.

**Resetting an admin password:** `npm run admin:reset-password -- host` (also signs that admin out everywhere).

## 3. Hosting on the local network

1. Put the laptop and all phones on the same Wi-Fi/LAN.
2. Find the laptop's LAN IPv4 address:
   * **macOS:** `ipconfig getifaddr en0` (Wi-Fi; try `en1` if empty), or System Settings → Wi-Fi → Details.
   * **Windows:** `ipconfig` → *Wireless LAN adapter Wi-Fi* → *IPv4 Address*.
   * **Linux:** `hostname -I` or `ip -4 addr show`.
3. `npm start`. The console lists `http://<ip>:3000/`; the admin dashboard and projector show the same join link as a QR code. If the detected IP is wrong (VPNs, several adapters), set `PUBLIC_URL=http://192.168.x.y:3000` in `.env`.
4. **Projector:** open `http://localhost:3000/display` on the laptop (or any browser on the LAN), full-screen it (F11), and drag it to the projector. It needs no login and cannot control anything.
   **Reading the projector.** It never scrolls: the type scales with the screen (16:9, 4:3 or a laptop). During a live question the left side shows the question, the timer ring and the four coloured answers (the same colours and shapes as on the phones) with a "N / M teams locked in" meter; the right side is the scoreboard, with the score as the biggest number, medals for the top three and a bar under each name showing the gap to the leader. Each team's row says **✓ Locked in** or *answering…* while the question is open (who has answered, never which answer), then **▲ +N** or **✗ wrong** at the reveal, and the answer tiles show how many teams chose each one. Quick Brain (Level 3) shows each team's progress through its questions instead. If the host turns off live scores the numbers stay hidden until the round ends.
5. **Phones:** scan the QR code on the projector or open the URL and type the 6-digit room PIN.
   A second phone for the same team: open the site, choose *"add this phone"*, and enter the team code shown on the first phone's lobby screen.

**Firewall / connectivity troubleshooting**

* Windows: allow Node.js on *Private* networks when prompted, or `netsh advfirewall firewall add rule name="BrainByte" dir=in action=allow protocol=TCP localport=3000`. Mark the Wi-Fi network as *Private*.
* macOS: System Settings → Network → Firewall → allow incoming connections for `node`.
* Linux: `sudo ufw allow 3000/tcp`.
* Many venue/guest Wi-Fi networks enable **client isolation**, which blocks phone-to-laptop traffic. Use a phone hotspot or a small travel router if phones cannot reach the laptop even though the firewall is open.
* Sanity check from a phone browser: `http://<ip>:3000/api/health` should show `{"ok":true,...}`.

## 4. Running the event (host checklist)

1. **Event tab:** set name, capacity (1 to 60, default 20), auto-approve, live-scores on/off, and **Advancement** (below). **Rounds & scoring:** preview every question (tick *show answer keys*), adjust timers/points/hint penalties, and **edit questions and answers** (below). Scoring and content lock once a round starts.
2. **Control → Open registration.** The projector shows the PIN and QR code and fills the team slots live (as many as the capacity you set).
3. **Teams tab:** approve/reject/remove (only before the first round). **Close registration & confirm teams** moves everyone to the lobby.
4. **Add the Tech Faces photos** (see §5a) before the event, then **Prepare Level 1** (the projector and every phone show that game's rules in English and Malayalam, see §5b) → **Start round**. Levels 1, 2, 4 and 5 are live: use **Close question now / Next question** to move at your own pace (or let the timers run), or hand the loop to a coordinator (below). Pause/Resume/End as needed. After a round ends, optionally **Reveal answers** on the projector and phones.
   **Coordinator desk** (`/coordinator`, open it from the admin header or on a second device and sign in with an admin account): during a live round it shows the current question with its answer key, the countdown and how many teams have locked in, with one big button that runs the loop **Reveal answer → Next question → repeat** (the last reveal reads *Finish round*). After the reveal it lists how many teams picked each option, the fastest finger, steals, eliminations and bingos so they can be announced. *Pause/Resume* sit next to the button, *Answers shown/hidden* masks every key if the screen is shared, and before a round starts (and during the self-paced Level 3) it shows the full question-and-answer sheet. The timers still apply: the question closes and the next one opens by themselves unless the round is paused. A tap on a stale screen (the timer moved the game on a moment earlier) is ignored by the server, so it can never skip a reveal.
5. Repeat for Levels 2 and 3. After Level 4 ends, **Run qualification**: finalists are chosen and announced. You can change the number of finalists, or reopen qualification before Level 5 starts. Level 5 starting **freezes** qualification.

   **Editing questions and answers** (Rounds & scoring tab, tick *Show answer keys*, then **✎ Edit question & answer** on a question; the form closes again if you hide the keys). You can change the title and wording, the text of each option and which one is correct (multiple choice), the accepted answers (numeric questions take plain numbers, text questions accept several spellings, one per line), and the "did you know" line of a Tech Faces question. Tech Bingo has a **Bingo tiles** panel for the 16 shared tiles (name and emoji; a rename shows on every clue and card) and each clue picks the one tile it describes (the list warns if two clues name the same tile, and a round with duplicates will not start). Option letters, the number of options and the kind of question stay fixed. Everything locks when the round starts, mistakes are explained next to the form, and each change is written to the audit log with the old and new values.

   **Advancement (round cut-offs).** The Event tab has one row per round: how many teams enter it and how many carry on after it. Put a number in the box for Level 1, 2 or 3 to keep only that many teams (top of the leaderboard, same tie-breakers as everywhere else); leave it empty to keep everyone. The box on the Level 4 row is the finalist count. Example for 20 teams: keep 15 after Level 1, 10 after Level 2, 8 after Level 3, 5 finalists → Level 5 (the form shows the field size, `20 → 15 → 10 → 8 → 5`). Rules:
   * The cut is applied **the moment the round ends**. The projector shows "N teams move on / M are out" and puts an **Out · L1** badge next to cut teams, phones tell each team whether it is through, and the Control tab lists who is out.
   * Cut teams sit out every later round (they can still watch and see the leaderboard) and rank below every team that got further, the earlier the cut the lower.
   * Until you **Prepare** the next round the cut follows the leaderboard: a score correction or a different number moves the line at once. After that it is final. If two teams are tied across the line the Control tab warns you; settle it with a score adjustment.
   * Each cut must keep the same number of teams as the cut before it, or fewer (the form explains it and the server refuses it otherwise). More finalists than teams left simply qualifies everyone who is left.
6. **Prepare/Start Level 5** (only finalists can play), **End round**, then **Finish event & show winners**: the projector shows the podium and champion.
7. **Leaderboard tab → Export CSV.** Manual score corrections (with a mandatory reason) live in the same tab and appear in the audit log.

If the server or laptop crashes mid-round: restart `npm start`. All scores, sessions and progress are on disk. A round that was running comes back **paused with exactly the time that was left** (±1 s heartbeat); press *Resume*. Phones reconnect by themselves.

## 5. The five games

| | **L1 Tech Faces** | **L2 Tech Bingo** | **L3 Quick Brain** | **L4 Reel Rush** | **L5 Final Showdown** |
| --- | --- | --- | --- | --- | --- |
| Who plays | every team | every team | every team | every team | finalists only |
| Format | 10 **live** "who is this?" picture questions, 4 names to pick from (20 s + 8 s reveal) | 16 **live** clue calls (15 s + 6 s reveal). Every team holds its **own shuffled 4x4 card** of the same 16 tech tiles; tap the tile the clue describes | 12 questions (choice + numeric), **self-paced**, one answer per question, whole-round timer (10 min) | 12 **live** questions (20 s + 7 s reveal) | 10 **live** questions (25 s + 8 s reveal), harder |
| Points | 100 per question + speed bonus 0-50 + **fastest finger** 30 + **streak** 20 per consecutive correct answer (cap x3) | 50 per correct tile + speed bonus 0-25, **75 per completed line** (4 rows + 4 columns + 2 diagonals) and a **250 blackout** for the whole card | 100 per question + speed bonus 0-20 (default 10) | 100 per question + speed bonus up to 100 + **fastest finger** 50 + **streak** 25 per consecutive correct answer (cap x4) | 200 per question + speed up to 150 + **fastest finger** 100 |
| Twist | After each reveal a short "did you know" about the person | Called tiles are crossed off for everyone, so the choices shrink as the game goes on. The projector shows the master board and shouts **BINGO!** when a team completes a line | **Skip button**: a team may skip a question (no points, no penalty) | **Double Down** (once per team): right = double points, wrong = lose the base points | **3 lives**: a wrong or missing answer costs a life, 0 lives = eliminated. The fastest correct team **steals 75** from the top-scoring team that just slipped. **Last team standing** wins; every team still alive at the end gets a 300 survivor bonus. If everyone would be knocked out at once, nobody is. |
| Host controls | pause / resume / end, **Close question now / Next question**, **Skip (void) question** | same | pause / resume / end | same as Faces | same as Faces |
| Everything above is configurable in the admin dashboard (Rounds & scoring), until the round starts. | | | | | |

### 5a. Tech Faces photos

The ten default photos are bundled (downloaded from Wikimedia Commons under free licences; authors and licences are listed in [`web/public/faces/CREDITS.txt`](web/public/faces/CREDITS.txt), and the projector shows a credit line). To use your own, replace the files in [`web/public/faces/`](web/public/faces/) before running `npm run build`, named by position (`.jpg`, `.png`, `.webp` or `.jpeg`). The numbered names keep the answer out of the picture URL:

| File | Person | | File | Person |
| --- | --- | --- | --- | --- |
| `01` | Steve Jobs | | `06` | Satya Nadella |
| `02` | Bill Gates | | `07` | Jeff Bezos |
| `03` | Elon Musk | | `08` | Larry Page |
| `04` | Mark Zuckerberg | | `09` | Linus Torvalds |
| `05` | Sundar Pichai | | `10` | Jensen Huang |

Any photo that is missing is replaced by a "photo not added" silhouette, so you can rehearse the whole round without them; the dashboard's *Rounds & scoring* tab previews each picture next to its question. To change who appears, edit `server/content/faces.ts` (names, options, the "did you know" text and the picture path), rebuild and create a new event. Use a portrait or square crop with the face in the upper half: pictures are shown with `object-fit: cover`.

### 5b. Rules shown at the start of every game (English and Malayalam)

When the host presses **Prepare** for a level, the room sees that game's rules before anything starts: the projector shows two full-width panels (**Rules** | **നിയമങ്ങൾ**) under the level title, and each phone shows the same lists stacked under "Waiting for the host to press start". The leaderboard returns on the projector with the first question. The text lives in [`shared/rules.ts`](shared/rules.ts), one entry per game with the same number of lines in each language (a unit test checks this), so it applies to events created earlier too. Game words that appear on screen (Level, Lock in, Streak, Double Down, Skip, Steal, lives) stay in English inside the Malayalam, as in the printed Malayalam rules sheet. No point values are written into the text because the host can change them before a round starts; the scoring numbers are in the rules PDFs.

Malayalam needs a Malayalam system font (no web fonts, the event is offline). Current iPhones, Android phones, Macs and Windows 10+ have one; test one older phone before the event.

How a live question works: it is **open** (answers are locked in but *not scored* and correctness is not revealed) → **reveal** (the question is resolved in one transaction: correct answer, answer distribution, bonuses, streaks, lives, steals) → the next question opens automatically. The question closes early when every team still playing has answered. Phases run on the round's pause-safe clock, so pausing freezes the question timer. Skipping *voids* the question (nobody scores, no life lost). Level 1's **Skip** is per team and idempotent; the host can switch it off.

**Answer normalisation** (server side only): Unicode NFKC, trim, collapse whitespace, case-fold. Punctuation and inner characters are preserved (`BALAN-42M` ≠ `BALAN42M`). Numeric answers parse strictly (`42`, `42.0`, `042` match; `4 2`, `1e1` do not). Multiple-choice compares option ids. Alternatives can be listed in a challenge's `answers` array.

**Tech Bingo** is a live round like the others (every call is one question with a 15 s window and a reveal). The 16 tiles are the same for everyone; each team's card order is a deterministic shuffle of its team id, so cards differ but are stable across phones and reloads. A tile is marked only when the call is **resolved**: locked-in answers are not shown on the card (or the projector's master board) until the reveal, exactly like the other live rounds. Lines are paid once each, at the call that completes them (idempotent ledger keys), and the blackout once. A voided call (host *Skip*) is never "called" and marks nothing.

**Ranking and tie-breaker** (one function, `server/game/ranking.ts`, used by the backend, admin, projector, phones, CSV and podium):
1. finalists above non-finalists once the Final Showdown has started, and in the Final Showdown a finalist who has lost all 3 lives ranks below every finalist still standing, even with more points (so a 5000-point team that is eliminated loses to a 3000-point survivor); then
2. highest total score (survivors include their 300 bonus); 3. highest score in the most recently played level; 4. most challenges solved; 5. earliest timestamp of the last solve; 6. lowest team id (only to keep the order deterministic). Rows still tied after step 5 are flagged **tie** in every view.

**Timing policy.** The server clock is the only clock. A round stores its deadline; pausing stores the remaining milliseconds and resuming sets `deadline = now + remaining`. A submission is accepted iff the round is running and `server receipt time ≤ deadline` (**inclusive**). Submissions are processed one at a time in arrival order inside a database transaction, so two answers in the same millisecond are ordered by their submission id. Late answers are stored for audit (`outcome = late`), score nothing and do not consume a question. Bonuses use the pause-safe "active play" clock, not wall time. Browsers only interpolate a countdown between server syncs.

## 6. Architecture

```
shared/    types + socket event contract used by both sides; rules.ts = the English/Malayalam rules shown before each game
server/
  game/    pure logic: normalize, scoring, timer, stateMachine, ranking, liveRules, bingo   (unit tested)
  games/   one module per game format: quiz.ts (Level 3), live.ts (Levels 1, 2, 4 and 5: phase machine,
           scoring resolution, bingo card marking, host controls, views), index.ts (dispatches by round kind)
  engine/  context (db, clock, audit), events (state machine + rounds), teams, cutoff (per-round cut-offs),
           admin (adjustments, config, CSV), standings, views (per-audience snapshots)
  http/    express app, auth (scrypt), middleware (CSRF, origin, rate limit), schemas (zod)
  realtime/ socket.io auth, coalesced broadcasts, ticker
  db/      node:sqlite wrapper, migrations
  content/ seeded tech content: faces.ts, bingo.ts, quiz.ts, lightning.ts, showdown.ts
web/       React + Vite + Tailwind: Team, Display, Admin, Coordinator
tests/     unit/, integration/ (Vitest, real server + sockets), e2e/ (Playwright)
scripts/   admin, migrate, seed, backup, loadtest, dev, e2e-server
```

**Event state machine** (`server/game/stateMachine.ts`; invalid moves return HTTP 409):

```
SETUP ⇄ REGISTRATION_OPEN → LOBBY → ROUND_READY → ROUND_RUNNING ⇄ ROUND_PAUSED → ROUND_ENDED
                  ↑___________|          ↑                                         │
                                         └──── QUALIFICATION ←─ (after L2) ────────┤
ROUND_ENDED → ROUND_READY (next level) | QUALIFICATION | EVENT_COMPLETED   (qualification runs after Level 4)
```
Extra guards live in the engine: Level 5 can only be prepared from QUALIFICATION; qualification can be reopened only from ROUND_READY of Level 5; teams can be approved/removed only before play; scoring/timers are locked once a round starts. `Reset event` (typed confirmation) is an admin operation outside the normal flow.

**Real-time contract** (`shared/contract.ts`). Server → client: `state:public` (projector + phones: no answers, no private data), `team:state` (only that team's room), `admin:state` (admin room, includes answer keys), `timer:sync`, `announce`, `session:ended`. Client → server (with acks): `answer:submit`, `hint:request`. Sockets authenticate in the handshake (`display` = public/read-only; `team` and `admin` require their HttpOnly cookie) and every handler re-checks the live session. Admin *commands* use authenticated REST (`/api/admin/*`) so they get CSRF protection and are trivially testable; the same submission service backs both `POST /api/team/answer` and the socket event, and a phone falls back to HTTP with the *same request id* if the socket acknowledgement times out. Broadcasts are coalesced (60 ms) so a burst of 20 answers produces one snapshot per audience.

**Database** (`server/db/migrations.ts`, SQLite, WAL, foreign keys on): `events`, `admin_users`, `admin_sessions`, `rounds`, `challenges` (the ordered questions of every round; Tech Faces rows carry an `image` path), `teams` (`qualified` = finalist, `out_level` = the level after which the host cut the team), `team_sessions`, `team_stage_progress` (quiz position), `live_team_state` (streak, lives, Double Down), `live_question_log`, `hints_used`, `answer_submissions`, `score_ledger`, `event_state_history`, `audit_logs`, `leaderboard_snapshots` (official standings written when each round ends and when the event completes). Integrity is enforced by the database itself: unique room PIN, partial unique index on active team names, unique `(team, request_id)`, partial unique index allowing only one *correct* submission per team and challenge (live questions also enforce one locked answer in code), and a unique `idempotency_key` on every ledger row. **Scores are never stored; they are `SUM(score_ledger.points)`.** All timestamps are UTC (ISO text, plus epoch ms for timing).

**Main HTTP endpoints:** `POST /api/team/join|link|answer|hint|logout`, `GET /api/team/me`, `GET /api/public/state|event`, `POST /api/admin/login|logout`, `GET /api/admin/state|export.csv`, `POST /api/admin/event|event/reset|event/complete|registration/*|round/*|qualification/open|teams/:id/status|teams/:id/score`, `PATCH /api/admin/event|round/:level/config|round/:level/tiles|challenges/:id`.

## 7. Security notes

* Admin passwords: scrypt with a per-user salt, constant-time comparison; failed logins are rate limited (8 / 10 min / IP) and audited; sessions are random 256-bit tokens, stored hashed, with a CSRF token required on every state-changing admin request, `HttpOnly; SameSite=Strict` cookies, and an Origin check on all unsafe `/api` requests and WebSocket handshakes.
* Team identity comes **only** from an HttpOnly session cookie issued at registration (stored hashed). Names/ids in request bodies are ignored; a second phone needs the private team code.
* Input is validated with Zod on every route and socket event; SQL is parameterised; responses never include stack traces or SQL errors; CSV cells beginning with `= + - @` are neutralised.
* Answer keys exist only in the database and the `admin:state` payload (which also feeds the coordinator desk, so `/coordinator` is behind the same admin sign-in; there is no separate coordinator role). Teams get the prompt only (never the key); the projector/phones receive answers only after the host reveals them for a finished round.
* Rate limits: answers (12 / 10 s / team, shared by socket and HTTP), hints, joins, device links, logins.
* **A local network is not a trusted network.** Anyone on the same Wi-Fi who knows the PIN can try to register while registration is open, and traffic is plain HTTP (cookies cannot be `Secure`, and can be sniffed on open Wi-Fi). Use a WPA2/3-protected network, keep registration closed except when needed, use `autoApprove=false` for open venues, and choose a strong admin password. Do not expose port 3000 to the internet. Put it behind an HTTPS reverse proxy and set `COOKIE_SECURE=true` if you ever must.

## 8. Tests (what was actually run)

```bash
npm run typecheck && npm run lint
npm test                 # 193 tests: 69 unit + 124 integration
npm run build && npm run test:e2e   # 10 Playwright tests in Chromium
```

Last full run on macOS (Node 26.5): **193/193 Vitest tests pass, 10/10 Playwright tests pass, typecheck and lint clean.**

* **Unit** (`tests/unit`): normalisation, alternatives, numeric parsing, speed bonus, config validation, timer pause/resume/deadline, ranking and every tie-break step, finalist selection, state machine, **every live scoring rule** (speed, fastest finger, streaks, Double Down, lives, steals, elimination, sudden-death protection) the **Tech Bingo rules** (10 lines on a 4x4 card, per-team shuffles, line detection) and the seeded tech answer keys.
* **Integration** (`tests/integration`, real HTTP server + Socket.IO + SQLite): admin auth/CSRF/origin/logout/rate limit; socket authorisation; no answer-key leakage; registration limits, duplicate and near-duplicate names, concurrent joins (26 → exactly 20; 46 → exactly 40 once the host raises the capacity), registration closing mid-join; Level 3 (Quick Brain) scoring, **Skip**, hints, retries, duplicates, concurrent submissions, deadline (inclusive), ticker expiry, repeated pause/resume; **Tech Faces and Tech Bingo** (pictures on the public state, hidden-until-reveal marks, per-team cards, lines and blackout paid exactly once, voided calls), **Reel Rush and Final Showdown** (hidden-until-reveal scoring, early close, Double Down, streaks, host advance/skip, pause freezing the question timer, lives/elimination/steals/survivor bonus, restart mid-question, sockets); upgrading a version-1 database in place (including the new round kinds and ledger rows); qualification, freezing and reopening, tie at the cutoff, finalist-only Level 5, podium, CSV and ledger = snapshot = displayed totals; admin adjustments, reset, audit log; DB write failure rolls back and the same request id can be retried; server restart mid-round (paused, remaining time intact), restart after completion; 20 and 40 simultaneous socket submissions.
* **E2E** (`tests/e2e`): the full event through the real UI (admin login → create → registration → 2 phones → projector updates → live Tech Faces → live Tech Bingo (tap, lock in, stamped card, master board) → Quick Brain incl. Skip → live Reel Rush with Double Down, host skip and reveal → qualification → Final Showdown with a steal, lives and an elimination → podium/champion → CSV equals leaderboard → audit log); offline/online reconnection and page refresh; responsive checks (320, 375, 768, 1280, 1920 px, 20 teams, no horizontal overflow, projector fits 20 rows without scrolling), touch target size, keyboard selection, reduced motion, and **axe-core WCAG 2.1 A/AA scans** on join, team play (faces, bingo, quiz, live), projector (registration, faces, bingo, live) and admin; the 1080p projector views of the picture and bingo rounds, the live question and reveal, qualification, the answer key and the podium fit with 20 teams and no scrolling; a 60-team room (capacity raised in the admin, registration, lobby, live question and round standings all fit the screen, boards capped at 20 rows).

**Not verified:** real phones (iOS Safari / Android Chrome) on a physical Wi-Fi network, Windows and Linux hosts, and a real projector. Phone behaviour was tested with Chromium mobile emulation only.

## 9. Load test

```bash
DB_PATH=./data/loadtest.db RATE_LIMIT_ANSWER_MAX=1000 npm start     # terminal 1 (spare database!)
DB_PATH=./data/loadtest.db ADMIN_PASSWORD=... npm run admin:create -- host   # once
ADMIN_USER=host ADMIN_PASSWORD=... npm run loadtest -- http://localhost:3000   # terminal 2
```
It registers 20 teams, connects 20 sockets plus a projector, and fires all 20 answers for each of the 12 Level 3 (Quick Brain) questions at the same instant (240 bursts), then checks every acknowledgement and every final score. On the development laptop: 0 failures, ack latency p50 ≈ 3.5 ms, p95 ≈ 12 ms. It creates a new event, so never run it against a live one.

## 10. Backup and restore

* Backup (any time, even mid-event): `npm run db:backup` → `data/backups/brainbyte-<timestamp>.db`. Or copy `data/brainbyte.db` *together with* its `-wal`/`-shm` files while the server is stopped.
* Restore: stop the server, replace `data/brainbyte.db` with the backup (delete any `brainbyte.db-wal`/`-shm`), start the server. Teams' cookies stay valid because sessions are in the database.

## 11. Known limitations

* One active event at a time (previous events are archived in the database, not browsable in the UI).
* Question/answer text is seeded from `server/content/` (`faces.ts`, `bingo.ts`, `quiz.ts`, `lightning.ts`, `showdown.ts`); the dashboard (Rounds & scoring) edits wording, option texts, answer keys, points, hints and the bingo tiles of the **current event**; those edits are kept by *Reset event* but a brand-new event starts again from the files. To change the built-in content for every new event, edit those files, `npm run build`, restart and create a new event. Questions cannot be added or removed from the dashboard, and the Tech Faces pictures are files (see §5a). **An event created by an earlier version (three Kerala-film levels) keeps its old rounds and levels; create a new event to get the five tech rounds.** Events created by the oldest version (with the puzzle rounds) cannot be started.
* Levels are fixed at 1 → 2 → 3 → 4 → qualification → 5. An event holds up to 60 teams (`MAX_TEAMS` in `shared/types.ts`; the Event tab's capacity defaults to 20). The projector layout is built for 20 rows, so with more teams its leaderboards show the top 20 plus a "+N more teams" line, while phones and the admin dashboard list every team; every projector screen, the podium included, fits one 1080p screen without scrolling. Cut-offs can be set after Levels 1-3; the finalist qualification always happens after Level 4.
* Level 3 is self-paced per team, so the projector shows instructions, progress and standings rather than a shared question; Levels 1, 2, 4 and 5 are live and fully shown on the projector.
* Tech Faces photos are Commons images (see §5a). Tech Bingo needs exactly 16 tiles and one call per tile; the card is 4x4 and not configurable.
* After a server restart a running round always returns *paused* and needs a host *Resume*. The remaining time is accurate to the 1 s heartbeat.
* In-memory rate limiting resets on restart. Plain HTTP on the LAN (see §7).
