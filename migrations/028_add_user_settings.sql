-- User-level privacy settings synced from the app.
-- Currently holds the leaderboard opt-out flag; additional boolean
-- columns can be added here as new server-enforced settings are needed.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id      INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  hide_from_leaderboard BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
