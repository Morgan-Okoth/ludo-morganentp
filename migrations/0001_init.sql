CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  winner_id TEXT,
  player_count INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
