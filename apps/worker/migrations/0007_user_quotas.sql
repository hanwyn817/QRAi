CREATE TABLE user_quotas (
  user_id TEXT PRIMARY KEY,
  cycle_start TEXT NOT NULL,
  remaining INTEGER,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
