const sqlite3 = require('sqlite3').verbose();
const BetterSqlite3 = require('better-sqlite3');
const path = require('path');

const fs = require('fs');
const dbPath = process.env.VINIZ_DB_PATH || path.join(__dirname, 'data', 'viniz.db');
const navidromeDbPath = process.env.NAVIDROME_DB_PATH || path.join(__dirname, 'navidrome', 'navidrome.db');

// Ensure parent directories exist
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}
const naviDbDir = path.dirname(navidromeDbPath);
if (!fs.existsSync(naviDbDir)) {
    fs.mkdirSync(naviDbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);
db.on('error', err => console.error('db error:', err));

// Enable WAL mode for better resilience and performance
db.serialize(() => {
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
});

let naviDb = null;
if (fs.existsSync(navidromeDbPath) && fs.statSync(navidromeDbPath).isFile()) {
    try {
        naviDb = new BetterSqlite3(navidromeDbPath, { readonly: true });
    } catch (err) {
        console.error('Failed to initialize Navidrome database:', err.message);
    }
}

if (!naviDb) {
    console.warn("Warning: Navidrome database not found/configured. Please link your Navidrome database to enable track duration lookups.");
}

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
        genre TEXT DEFAULT '',
        event_type TEXT,
        timestamp INTEGER
    )`);

    db.run(`ALTER TABLE history ADD COLUMN genre TEXT DEFAULT ''`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Alter table error:', err.message);
        }
    });
});

module.exports = { db, naviDb };
