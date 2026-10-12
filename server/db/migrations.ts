export interface Migration {
  id: number;
  name: string;
  sql: string;
  /** Table rebuilds need foreign keys switched off (must happen outside a transaction). */
  foreignKeysOff?: boolean;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  pin TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('SETUP','REGISTRATION_OPEN','LOBBY','ROUND_READY','ROUND_RUNNING','ROUND_PAUSED','ROUND_ENDED','QUALIFICATION','EVENT_COMPLETED')),
  current_round_id INTEGER,
  settings TEXT NOT NULL,
  qualification_frozen INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE admin_sessions (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quiz','puzzle')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','ended')),
  config TEXT NOT NULL,
  instructions TEXT NOT NULL,
  started_at INTEGER,
  deadline_at INTEGER,
  remaining_ms INTEGER,
  heartbeat_at INTEGER,
  ended_at INTEGER,
  answers_revealed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, level)
);

-- Level 1 questions and Level 2/3 puzzle stages share one ordered table.
CREATE TABLE challenges (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('choice','number','text')),
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT,
  answers TEXT NOT NULL,
  points INTEGER NOT NULL,
  hint TEXT,
  UNIQUE (round_id, position)
);

CREATE TABLE teams (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  team_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','removed')),
  qualified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (event_id, team_code)
);
-- Team names must be unique among teams that still hold a slot.
CREATE UNIQUE INDEX idx_teams_active_name ON teams(event_id, name_key) WHERE status IN ('pending','approved');
CREATE INDEX idx_teams_event ON teams(event_id, status);

CREATE TABLE team_sessions (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_team_sessions_team ON team_sessions(team_id);

-- One row per team per round: position == number of challenges already completed.
CREATE TABLE team_stage_progress (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  unlocked_clock_ms INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER,
  PRIMARY KEY (team_id, round_id)
);

CREATE TABLE hints_used (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, challenge_id)
);

CREATE TABLE answer_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  session_id INTEGER,
  request_id TEXT NOT NULL,
  raw_answer TEXT NOT NULL,
  normalized TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct','incorrect','late','rejected')),
  points INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (team_id, request_id)
);
-- A challenge can be solved only once per team, enforced by the database itself.
CREATE UNIQUE INDEX idx_one_correct ON answer_submissions(team_id, challenge_id) WHERE outcome = 'correct';
CREATE INDEX idx_submissions_round ON answer_submissions(round_id, team_id);

CREATE TABLE score_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('answer','speed_bonus','time_bonus','completion_bonus','hint_penalty','wrong_penalty','admin_adjust')),
  points INTEGER NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_ledger_team ON score_ledger(event_id, team_id);
CREATE INDEX idx_ledger_round ON score_ledger(round_id, team_id);

CREATE TABLE event_state_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  round_id INTEGER,
  actor TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_event ON audit_logs(event_id, id);

-- Official standings captured when a round ends and when the event completes.
CREATE TABLE leaderboard_snapshots (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  total_points INTEGER NOT NULL,
  round_points INTEGER NOT NULL,
  solved INTEGER NOT NULL,
  qualified INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, scope, team_id)
);
`,
  },
  {
    id: 2,
    name: 'live_games',
    foreignKeysOff: true,
    sql: `
-- rounds: new game kinds + live-phase columns
CREATE TABLE rounds_new (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quiz','puzzle','lightning','showdown')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','ended')),
  config TEXT NOT NULL,
  instructions TEXT NOT NULL,
  started_at INTEGER,
  deadline_at INTEGER,
  remaining_ms INTEGER,
  heartbeat_at INTEGER,
  ended_at INTEGER,
  answers_revealed INTEGER NOT NULL DEFAULT 0,
  live_index INTEGER NOT NULL DEFAULT 0,
  live_phase TEXT CHECK (live_phase IN ('open','reveal')),
  live_clock_start INTEGER NOT NULL DEFAULT 0,
  live_q_start INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, level)
);
INSERT INTO rounds_new (id, event_id, level, name, kind, status, config, instructions, started_at, deadline_at, remaining_ms, heartbeat_at, ended_at, answers_revealed)
  SELECT id, event_id, level, name, kind, status, config, instructions, started_at, deadline_at, remaining_ms, heartbeat_at, ended_at, answers_revealed FROM rounds;
DROP TABLE rounds;
ALTER TABLE rounds_new RENAME TO rounds;

-- answer_submissions: 'locked' is not stored, but live answers carry the clock and Double Down flag; 'skipped' is new
CREATE TABLE answer_submissions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  session_id INTEGER,
  request_id TEXT NOT NULL,
  raw_answer TEXT NOT NULL,
  normalized TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct','incorrect','late','rejected','skipped')),
  points INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  clock_ms INTEGER,
  double_down INTEGER NOT NULL DEFAULT 0,
  UNIQUE (team_id, request_id)
);
INSERT INTO answer_submissions_new (id, event_id, round_id, challenge_id, team_id, session_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at)
  SELECT id, event_id, round_id, challenge_id, team_id, session_id, request_id, raw_answer, normalized, outcome, points, received_at, created_at FROM answer_submissions;
DROP TABLE answer_submissions;
ALTER TABLE answer_submissions_new RENAME TO answer_submissions;
CREATE UNIQUE INDEX idx_one_correct ON answer_submissions(team_id, challenge_id) WHERE outcome = 'correct';
CREATE INDEX idx_submissions_round ON answer_submissions(round_id, team_id);

-- score_ledger: new bonus kinds for the live games
CREATE TABLE score_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('answer','speed_bonus','time_bonus','completion_bonus','hint_penalty','wrong_penalty','admin_adjust','fastest_bonus','streak_bonus','double_down','steal','stolen','survivor_bonus')),
  points INTEGER NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO score_ledger_new SELECT * FROM score_ledger;
DROP TABLE score_ledger;
ALTER TABLE score_ledger_new RENAME TO score_ledger;
CREATE INDEX idx_ledger_team ON score_ledger(event_id, team_id);
CREATE INDEX idx_ledger_round ON score_ledger(round_id, team_id);

-- Per-team live state (streak, lives, Double Down) and a log of resolved/voided live questions.
CREATE TABLE live_team_state (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  streak INTEGER NOT NULL DEFAULT 0,
  lives INTEGER,
  eliminated INTEGER NOT NULL DEFAULT 0,
  double_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, round_id)
);
CREATE TABLE live_question_log (
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('resolved','voided')),
  resolved_at INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (round_id, challenge_id)
);
`,
  },
  {
    id: 3,
    name: 'faces_and_bingo',
    foreignKeysOff: true,
    sql: `
-- rounds: the two new game kinds
CREATE TABLE rounds_new (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quiz','puzzle','lightning','showdown','faces','bingo')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','paused','ended')),
  config TEXT NOT NULL,
  instructions TEXT NOT NULL,
  started_at INTEGER,
  deadline_at INTEGER,
  remaining_ms INTEGER,
  heartbeat_at INTEGER,
  ended_at INTEGER,
  answers_revealed INTEGER NOT NULL DEFAULT 0,
  live_index INTEGER NOT NULL DEFAULT 0,
  live_phase TEXT CHECK (live_phase IN ('open','reveal')),
  live_clock_start INTEGER NOT NULL DEFAULT 0,
  live_q_start INTEGER NOT NULL DEFAULT 0,
  UNIQUE (event_id, level)
);
INSERT INTO rounds_new SELECT * FROM rounds;
DROP TABLE rounds;
ALTER TABLE rounds_new RENAME TO rounds;

-- score_ledger: bingo bonuses
CREATE TABLE score_ledger_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  challenge_id INTEGER REFERENCES challenges(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('answer','speed_bonus','time_bonus','completion_bonus','hint_penalty','wrong_penalty','admin_adjust','fastest_bonus','streak_bonus','double_down','steal','stolen','survivor_bonus','bingo_line','bingo_blackout')),
  points INTEGER NOT NULL,
  reason TEXT,
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO score_ledger_new SELECT * FROM score_ledger;
DROP TABLE score_ledger;
ALTER TABLE score_ledger_new RENAME TO score_ledger;
CREATE INDEX idx_ledger_team ON score_ledger(event_id, team_id);
CREATE INDEX idx_ledger_round ON score_ledger(round_id, team_id);

-- challenges: optional picture (Tech Faces)
ALTER TABLE challenges ADD COLUMN image TEXT;
`,
  },
];
