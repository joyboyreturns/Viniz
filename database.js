const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const fs = require('fs');
const dbPath = '/mnt/cloud_storage/nextcloud/viniz_data/viniz.db';
const navidromeDbPath = '/mnt/cloud_storage/nextcloud/navidrome_data/navidrome.db';

const db = new sqlite3.Database(dbPath);
const naviDb = new sqlite3.Database(navidromeDbPath, sqlite3.OPEN_READONLY);

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
