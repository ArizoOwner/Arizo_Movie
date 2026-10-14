-- Schema for Arizo_Movie Cloudflare D1 Database

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS user_sessions (
    chat_id INTEGER PRIMARY KEY,
    state TEXT,
    data TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS user_channels (
    chat_id INTEGER PRIMARY KEY,
    channel_id TEXT NOT NULL,
    channel_title TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS post_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER,
    channel_id TEXT,
    post_id TEXT,
    tmdb_id TEXT,
    media_type TEXT,
    title_en TEXT,
    title_fa TEXT,
    created_at INTEGER
);
