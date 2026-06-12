const sqlite3 = require('sqlite3').verbose();
const BetterSqlite3 = require('better-sqlite3');
const path = require('path');

const fs = require('fs');
const dbPath = process.env.VINIZ_DB_PATH || '/app/data/viniz.db';
const navidromeDbPath = process.env.NAVIDROME_DB_PATH || '/app/navidrome/navidrome.db';

const db = new sqlite3.Database(dbPath);
db.on('error', err => console.error('db error:', err));
const naviDb = new BetterSqlite3(navidromeDbPath, { readonly: true });

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_name TEXT,
        track_name TEXT,
        artist_name TEXT,
        album_name TEXT,
        track_id TEXT,
        album_id TEXT,
        artist_id TEXT,
        duration INTEGER,
        event_type TEXT,
        timestamp INTEGER
    )`);
});

module.exports = { db, naviDb };
