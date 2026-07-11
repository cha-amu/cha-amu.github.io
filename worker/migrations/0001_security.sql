CREATE TABLE guestbook_entry_ips (
  entry_id TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  hash_version TEXT NOT NULL CHECK (hash_version = 'v1'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'active')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX guestbook_entry_ips_hash_state_idx
  ON guestbook_entry_ips (ip_hash, state);

CREATE TABLE ip_bans (
  scope TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source_entry_id TEXT,
  banned_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (scope, ip_hash)
);

CREATE INDEX ip_bans_active_idx
  ON ip_bans (scope, ip_hash, revoked_at);

CREATE TABLE ip_ban_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ban', 'unban')),
  source_entry_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX ip_ban_events_hash_idx
  ON ip_ban_events (scope, ip_hash, created_at);
