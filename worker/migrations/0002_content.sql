-- Content shares SECURITY_DB with the existing IP security tables.
-- Keep blank cells as empty strings; rowid preserves the Sheets insertion order.
CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '""' CHECK (json_valid(tags)),
  status TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL DEFAULT '',
  publishedAt TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  storagePath TEXT NOT NULL DEFAULT '',
  bodyUrl TEXT NOT NULL DEFAULT '',
  syncStatus TEXT NOT NULL DEFAULT '',
  markdownBaseUrl TEXT NOT NULL DEFAULT '',
  markdownRootUrl TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra))
);
CREATE INDEX posts_status_idx ON posts (status);

CREATE TABLE post_deletions (
  id TEXT PRIMARY KEY NOT NULL,
  storagePath TEXT NOT NULL DEFAULT '',
  nonce TEXT NOT NULL DEFAULT '',
  deletedAt TEXT NOT NULL DEFAULT '',
  finalizedAt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX post_deletions_pending_idx ON post_deletions (finalizedAt);

CREATE TABLE guestbook_entries (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT '',
  passwordSalt TEXT NOT NULL DEFAULT '',
  passwordHash TEXT NOT NULL DEFAULT '',
  passwordHashAlgorithm TEXT NOT NULL DEFAULT '',
  passwordHashIterations NUMERIC NOT NULL DEFAULT '',
  hiddenReason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX guestbook_entries_status_idx ON guestbook_entries (status);

CREATE TABLE things (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  imageUrl TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  sortOrder NUMERIC NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra))
);
CREATE INDEX things_public_order_idx ON things (status, sortOrder, title, id);

CREATE TABLE asset_overrides (
  assetId TEXT PRIMARY KEY NOT NULL,
  displayName TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '""' CHECK (json_valid(tags)),
  sourceUrl TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  sortOrder NUMERIC NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra))
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  targetType TEXT NOT NULL DEFAULT '',
  targetId TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL DEFAULT ''
);
CREATE INDEX audit_log_created_idx ON audit_log (createdAt);
CREATE INDEX audit_log_target_idx ON audit_log (targetType, targetId, createdAt);

CREATE TABLE rate_limit_windows (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE INDEX rate_limit_windows_expiry_idx ON rate_limit_windows (reset_at);
