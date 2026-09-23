-- ============================================================
-- AURA MUSIC — Cloudflare D1 database schema
-- Run:  npx wrangler d1 execute aura-db --file=./schema.sql --remote
-- (or --local for local dev)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------------- users ----------------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_key    TEXT,
  is_premium    INTEGER NOT NULL DEFAULT 0,
  premium_until TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- admin users ----------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- sessions ----------------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_type  TEXT NOT NULL CHECK (user_type IN ('user','admin')),
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------- password resets ----------------
CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- genres / moods ----------------
CREATE TABLE IF NOT EXISTS genres (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moods (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- artists ----------------
CREATE TABLE IF NOT EXISTS artists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  bio         TEXT NOT NULL DEFAULT '',
  image_key   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- albums ----------------
CREATE TABLE IF NOT EXISTS albums (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  artist_id    TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  cover_key    TEXT,
  release_date TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_id);

-- ---------------- songs ----------------
CREATE TABLE IF NOT EXISTS songs (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  artist_id     TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  album_id      TEXT REFERENCES albums(id) ON DELETE SET NULL,
  genre_id      TEXT REFERENCES genres(id) ON DELETE SET NULL,
  mood_id       TEXT REFERENCES moods(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',
  cover_key     TEXT,
  audio_key     TEXT NOT NULL,
  duration      INTEGER NOT NULL DEFAULT 0,
  release_date  TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  is_trending   INTEGER NOT NULL DEFAULT 0,
  is_featured   INTEGER NOT NULL DEFAULT 0,
  play_count    INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_album  ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_trending ON songs(is_trending);
CREATE INDEX IF NOT EXISTS idx_songs_featured ON songs(is_featured);

-- ---------------- playlists ----------------
CREATE TABLE IF NOT EXISTS playlists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_key   TEXT,
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id     TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (playlist_id, song_id)
);

-- ---------------- likes ----------------
CREATE TABLE IF NOT EXISTS likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id    TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, song_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_song ON likes(song_id);

-- ---------------- listening history ----------------
CREATE TABLE IF NOT EXISTS listening_history (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  song_id   TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  played_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_user ON listening_history(user_id, played_at DESC);

-- ---------------- follows ----------------
CREATE TABLE IF NOT EXISTS follows (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id  TEXT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, artist_id)
);

-- ---------------- saved albums ----------------
CREATE TABLE IF NOT EXISTS saved_albums (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, album_id)
);

-- ---------------- search history ----------------
CREATE TABLE IF NOT EXISTS search_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_search_history_user ON search_history(user_id, created_at DESC);

-- ---------------- notifications ----------------
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE CASCADE, -- NULL = broadcast
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT 'info',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- per-user read markers for broadcast (user_id IS NULL) notifications
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  read_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, notification_id)
);

-- ---------------- subscriptions ----------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','cancelled','expired')),
  started_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- ---------------- home sections (admin managed) ----------------
CREATE TABLE IF NOT EXISTS home_sections (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('trending','new_releases','popular_artists','popular_albums','featured_playlists','recommended','moods')),
  position   INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- media objects (R2 tracking / storage stats) ----------------
CREATE TABLE IF NOT EXISTS media_objects (
  id           TEXT PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('audio','cover','avatar')),
  size         INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT '',
  uploaded_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
