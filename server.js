const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { db, naviDb, ready: dbReady } = require('./database');

let utcOffset = 5.5;
db.get(`SELECT value FROM settings WHERE key = 'utc_offset'`, (err, row) => {
    if (!err && row) {
        utcOffset = parseFloat(row.value) || 5.5;
    }
});

const app = express();
const PORT = process.env.PORT || 4096;

app.use(cors());
app.use(bodyParser.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/apis/listenbrainz/1/validate-token', (req, res) => {
    res.status(200).json({
        code: 200,
        message: "Token valid.",
        valid: true,
        user_name: "Vincent"
    });
});

app.post('/apis/listenbrainz/1/submit-listens', (req, res) => {
    console.log("RECEIVED LISTEN:", JSON.stringify(req.body));
    const listens = req.body.payload;
    const listenType = req.body.listen_type;
    
    if (!listens || listens.length === 0) {
        return res.status(200).json({status: "ok"});
    }
    
    const eventType = listenType === 'playing_now' ? 'view' : 'play';
    const timestamp = Math.floor(Date.now() / 1000);
    
    listens.forEach(listen => {
        const trackName = listen.track_metadata.track_name || 'Unknown';
        const artistName = listen.track_metadata.artist_name || 'Unknown';
        const albumName = listen.track_metadata.release_name || 'Unknown';
        const userName = req.headers.authorization || 'Unknown';
        
        let row = null;
        if (naviDb) {
            try {
                const dbQuery = naviDb.prepare(`SELECT id as track_id, album_id, artist_id, duration, genre FROM media_file 
                                                WHERE title = ? AND artist = ?`);
                row = dbQuery.get(trackName, artistName);
                if (!row) {
                    const cleanTitle = trackName.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').replace(/\s*feat\..*/i, '').trim();
                    if (cleanTitle !== trackName) {
                        row = dbQuery.get(cleanTitle, artistName);
                    }
                }
                if (!row) {
                    const fuzzy = trackName.replace(/[%_]/g, '\\$&').substring(0, 50);
                    row = naviDb.prepare(`SELECT id as track_id, album_id, artist_id, duration, genre FROM media_file 
                                          WHERE title LIKE ? AND artist = ?`).get(`%${fuzzy}%`, artistName);
                }
            } catch (e) {
                console.error('naviDb query error:', e);
            }
        }

        let trackId = '', albumId = '', artistId = '', duration = 0, genre = '';
        if (row) {
            trackId = row.track_id;
            albumId = row.album_id;
            artistId = row.artist_id;
            duration = row.duration || 0;
            genre = row.genre || '';
        }
        
        if (!duration && listen.track_metadata.additional_info?.duration_ms) {
            duration = Math.round(listen.track_metadata.additional_info.duration_ms / 1000);
        }
        
        db.run(`INSERT INTO history (user_name, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, genre, event_type, timestamp) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userName, trackName, artistName, albumName, trackId, albumId, artistId, duration, genre, eventType, timestamp],
            (err) => {
                if (err) console.error('db.run error:', err);
                else console.log('Successfully inserted history record');
            }
        );
    });

    res.status(200).json({status: "ok"});
});

// Returns the UTC unix second of local Monday 00:00 for the current week.
function getWeekStart() {
    const offsetSeconds = utcOffset * 3600;
    const localNow = new Date(Date.now() + offsetSeconds * 1000);
    localNow.setUTCHours(0, 0, 0, 0);          // local midnight
    const dow = localNow.getUTCDay();          // 0=Sun .. 6=Sat
    const daysSinceMonday = (dow + 6) % 7;     // Mon=0 … Sun=6
    localNow.setUTCDate(localNow.getUTCDate() - daysSinceMonday);
    return Math.floor((localNow.getTime() - offsetSeconds * 1000) / 1000);
}

function getTimeCondition(filter) {
    const now = Math.floor(Date.now() / 1000);
    const offsetSeconds = utcOffset * 3600;
    switch(filter) {
        case 'today': {
            const localNow = Date.now() + offsetSeconds * 1000;
            const dayStart = new Date(localNow);
            dayStart.setUTCHours(0, 0, 0, 0);
            const utcMidnight = dayStart.getTime() - offsetSeconds * 1000;
            return `timestamp >= ${Math.floor(utcMidnight / 1000)}`;
        }
        case 'week': return `timestamp >= ${getWeekStart()}`;
        case '7d': return `timestamp >= ${now - 7*86400}`;
        case '14d': return `timestamp >= ${now - 14*86400}`;
        case '1m': return `timestamp >= ${now - 30*86400}`;
        case '3m': return `timestamp >= ${now - 90*86400}`;
        case '6m': return `timestamp >= ${now - 180*86400}`;
        case '1y': return `timestamp >= ${now - 365*86400}`;
        default: return '1=1';
    }
}

function localDateStr(offsetSeconds, ts) {
    const d = new Date((ts || Date.now()) + offsetSeconds * 1000);
    return d.toISOString().split('T')[0];
}

function backfillAlbumIds() {
    if (!naviDb) return;
    db.all(`SELECT id, track_name, artist_name FROM history WHERE album_id IS NULL OR album_id = ''`, [], (err, rows) => {
        if (err || !rows.length) return;
        const stmt = db.prepare(`UPDATE history SET album_id = ?, track_id = ?, artist_id = ?, duration = ?, genre = ? WHERE id = ?`);
        let count = 0;
        rows.forEach(row => {
            try {
                const match = naviDb.prepare(`SELECT id as track_id, album_id, artist_id, duration, genre FROM media_file WHERE title = ? AND artist = ?`).get(row.track_name, row.artist_name);
                if (match) {
                    stmt.run(match.album_id || '', match.track_id || '', match.artist_id || '', match.duration || '', match.genre || '', row.id, () => count++);
                }
            } catch (e) {}
        });
        stmt.finalize();
        if (count > 0) console.log(`Backfilled ${count} album_ids`);
    });
}

app.get('/api/stats/summary', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.get(`SELECT 
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition}`, [], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(row);
    });
});

app.get('/api/stats/top-tracks', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.all(`SELECT track_name, artist_name, album_name, MAX(track_id) as track_id, MAX(album_id) as album_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition}
            GROUP BY track_name, artist_name, album_name
            ORDER BY playtime DESC, plays DESC, views DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/top-albums', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.all(`SELECT album_name, artist_name, MAX(album_id) as album_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND album_name != 'Unknown'
            GROUP BY album_name, artist_name
            ORDER BY playtime DESC, plays DESC, views DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/top-artists', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.all(`SELECT artist_name, MAX(artist_id) as artist_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition}
            GROUP BY artist_name
            ORDER BY playtime DESC, plays DESC, views DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/artist/:name', (req, res) => {
    const artistName = req.params.name;
    const condition = getTimeCondition(req.query.filter);
    
    db.get(`SELECT artist_name, MAX(artist_id) as artist_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND artist_name = ?
            GROUP BY artist_name`, [artistName], (err, summary) => {
        if (err) return res.status(500).json({error: err.message});
        
        db.all(`SELECT track_name, MAX(track_id) as track_id, MAX(album_id) as album_id,
                SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND artist_name = ?
                GROUP BY track_name
                ORDER BY playtime DESC, plays DESC, views DESC LIMIT 10`, [artistName], (err, tracks) => {
            if (err) return res.status(500).json({error: err.message});
            
            db.all(`SELECT album_name, MAX(album_id) as album_id,
                    SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE ${condition} AND artist_name = ? AND album_name != 'Unknown'
                    GROUP BY album_name
                    ORDER BY playtime DESC, plays DESC, views DESC LIMIT 10`, [artistName], (err, albums) => {
                if (err) return res.status(500).json({error: err.message});
                
                res.json({
                    summary: summary || { views: 0, plays: 0, playtime: 0, artist_name: artistName },
                    top_tracks: tracks,
                    top_albums: albums
                });
            });
        });
    });
});

app.get('/api/stats/album/:name', (req, res) => {
    const albumName = req.params.name;
    const condition = getTimeCondition(req.query.filter);

    db.get(`SELECT album_name, artist_name, MAX(album_id) as album_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND album_name = ? AND album_name != 'Unknown'
            GROUP BY album_name`, [albumName], (err, summary) => {
        if (err) return res.status(500).json({error: err.message});

        db.all(`SELECT track_name, artist_name, MAX(track_id) as track_id,
                SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND album_name = ?
                GROUP BY track_name
                ORDER BY playtime DESC, plays DESC, views DESC`, [albumName], (err, tracks) => {
            if (err) return res.status(500).json({error: err.message});

            db.all(`SELECT date(timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as day,
                    SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays
                    FROM history WHERE album_name = ? AND album_name != 'Unknown'
                    GROUP BY day ORDER BY day ASC`, [albumName], (err, chart) => {
                if (err) return res.status(500).json({error: err.message});

                res.json({
                    summary: summary || { views: 0, plays: 0, playtime: 0, album_name: albumName, artist_name: '' },
                    tracks: tracks,
                    chart: chart
                });
            });
        });
    });
});

app.get('/api/stats/chart', (req, res) => {
    db.all(`SELECT date(timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as day,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays
            FROM history
            WHERE timestamp >= strftime('%s', 'now', '-7 days')
            GROUP BY day
            ORDER BY day ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/this-week', (req, res) => {
    const uo = Math.round(utcOffset * 3600);
    const ws = getWeekStart();
    const wsPrev = ws - 7 * 86400;

    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

    const summaryQ = `SELECT
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            COUNT(DISTINCT track_name) as unique_tracks,
            COUNT(DISTINCT date(timestamp + ${uo}, 'unixepoch')) as active_days
            FROM history WHERE timestamp >= ${ws}`;
    const dailyQ = `SELECT date(timestamp + ${uo}, 'unixepoch') as day,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE timestamp >= ${ws}
            GROUP BY day ORDER BY day ASC`;
    const topTrackQ = `SELECT track_name, artist_name, album_name, MAX(track_id) as track_id, MAX(album_id) as album_id,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays
            FROM history WHERE timestamp >= ${ws}
            GROUP BY track_name, artist_name, album_name
            ORDER BY playtime DESC, plays DESC LIMIT 1`;
    const prevQ = `SELECT
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE timestamp >= ${wsPrev} AND timestamp < ${ws}`;

    Promise.all([
        dbGet(summaryQ),
        dbAll(dailyQ),
        dbGet(topTrackQ),
        dbGet(prevQ)
    ]).then(([summary, dailyRows, topTrack, prev]) => {
        const norm = (v) => (v == null ? 0 : v);
        // Build the Mon–Sun daily array from the local Monday midnight.
        const monday = new Date(Date.now() + uo * 1000);
        monday.setUTCHours(0, 0, 0, 0);
        const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
        monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);

        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        const daily = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday.getTime() + i * 86400000);
            const dateStr = d.toISOString().split('T')[0];
            const row = dailyRows.find(r => r.day === dateStr);
            daily.push({
                day_index: i,
                label: DOW[i],
                date: dateStr,
                plays: row ? norm(row.plays) : 0,
                playtime: row ? norm(row.playtime) : 0
            });
        }
        const sunday = new Date(monday.getTime() + 6 * 86400000);
        const fmt = (dt) => `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
        const s = summary || {};

        res.json({
            week_range: {
                start: daily[0].date,
                end: daily[6].date,
                label: `${fmt(monday)} – ${fmt(sunday)}`
            },
            summary: {
                plays: norm(s.plays),
                playtime: norm(s.playtime),
                views: norm(s.views),
                unique_tracks: norm(s.unique_tracks),
                active_days: norm(s.active_days)
            },
            daily,
            top_track: topTrack && topTrack.track_name ? topTrack : null,
            prev: { plays: norm(prev && prev.plays), playtime: norm(prev && prev.playtime) }
        });
    }).catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/stats/search', (req, res) => {
    const query = `%${req.query.q}%`;
    const condition = getTimeCondition(req.query.filter);
    
    db.all(`SELECT track_name, MAX(track_id) as track_id, MAX(album_id) as album_id, artist_name,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND track_name LIKE ?
            GROUP BY track_name
            ORDER BY playtime DESC, plays DESC, views DESC LIMIT 5`, [query], (err, tracks) => {
        if (err) return res.status(500).json({error: err.message});
        
        db.all(`SELECT album_name, MAX(album_id) as album_id, artist_name,
                SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND album_name LIKE ? AND album_name != 'Unknown'
                GROUP BY album_name
                ORDER BY playtime DESC, plays DESC, views DESC LIMIT 5`, [query], (err, albums) => {
            if (err) return res.status(500).json({error: err.message});
            
            db.all(`SELECT artist_name, MAX(artist_id) as artist_id,
                    SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE ${condition} AND artist_name LIKE ?
                    GROUP BY artist_name
                    ORDER BY playtime DESC, plays DESC, views DESC LIMIT 5`, [query], (err, artists) => {
                if (err) return res.status(500).json({error: err.message});
                
                res.json({
                    tracks: tracks,
                    albums: albums,
                    artists: artists
                });
            });
        });
    });
});

app.get('/api/export', (req, res) => {
    db.all(`SELECT * FROM history`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/import', (req, res) => {
    const data = req.body;
    if (!Array.isArray(data)) {
        return res.status(400).json({error: 'Invalid data format. Expected an array.'});
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(`INSERT OR REPLACE INTO history 
            (id, user_name, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, genre, event_type, timestamp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        let errorOccurred = false;
        data.forEach(row => {
            stmt.run([
                row.id, row.user_name, row.track_name, row.artist_name, row.album_name,
                row.track_id, row.album_id, row.artist_id, row.duration, row.genre || '', row.event_type, row.timestamp
            ], (err) => {
                if (err) errorOccurred = true;
            });
        });

        stmt.finalize();

        if (errorOccurred) {
            db.run('ROLLBACK');
            res.status(500).json({error: 'Failed to import data.'});
        } else {
            db.run('COMMIT');
            res.json({status: 'ok', message: `Successfully imported ${data.length} records.`});
        }
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        NAVIDROME_HOST: process.env.NAVIDROME_HOST || 'localhost',
        NAVIDROME_PORT: process.env.NAVIDROME_PORT || '4533',
    });
});

app.get('/api/settings', (req, res) => {
    res.json({ utc_offset: utcOffset });
});

app.post('/api/settings', (req, res) => {
    const { utc_offset } = req.body;
    if (typeof utc_offset !== 'number') {
        return res.status(400).json({ error: 'utc_offset must be a number' });
    }
    utcOffset = utc_offset;
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('utc_offset', ?)`, [String(utc_offset)]);
    res.json({ status: 'ok', utc_offset: utcOffset });
});

app.post('/api/backfill-cover-art', (req, res) => {
    if (!naviDb) return res.json({ status: 'ok', backfilled: 0, message: 'Navidrome DB not available' });
    db.all(`SELECT id, track_name, artist_name FROM history WHERE album_id IS NULL OR album_id = ''`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!rows.length) return res.json({ status: 'ok', backfilled: 0 });
        const stmt = db.prepare(`UPDATE history SET album_id = ?, track_id = ?, artist_id = ?, duration = ?, genre = ? WHERE id = ?`);
        let backfilled = 0, failed = 0;
        rows.forEach(row => {
            try {
                const match = naviDb.prepare(`SELECT id as track_id, album_id, artist_id, duration, genre FROM media_file WHERE title = ? AND artist = ?`).get(row.track_name, row.artist_name);
                if (match) {
                    stmt.run(match.album_id || '', match.track_id || '', match.artist_id || '', match.duration || '', match.genre || '', row.id);
                    backfilled++;
                } else {
                    failed++;
                }
            } catch (e) { failed++; }
        });
        stmt.finalize();
        res.json({ status: 'ok', backfilled, failed, total: rows.length });
    });
});

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect fill="#333" width="300" height="300"/><circle fill="#555" cx="150" cy="135" r="40"/><rect fill="#555" x="110" y="175" width="80" height="90" rx="6"/></svg>';

app.get('/api/cover-art/:id', (req, res) => {
    if (!req.params.id) {
        return res.status(200).set('Content-Type', 'image/svg+xml').end(PLACEHOLDER_SVG);
    }
    // Local cover art assets shipped with the app (e.g. /api/cover-art/manchild.svg)
    if (req.params.id.endsWith('.svg') || req.params.id.endsWith('.png') || req.params.id.endsWith('.jpg') || req.params.id.endsWith('.jpeg') || req.params.id.endsWith('.webp')) {
        const safeName = path.basename(req.params.id);
        const localPath = path.join(__dirname, 'public', 'covers', safeName);
        if (fs.existsSync(localPath)) {
            const ext = path.extname(localPath).slice(1).toLowerCase();
            const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
            res.set('Content-Type', mime);
            res.set('Cache-Control', 'public, max-age=86400');
            return fs.createReadStream(localPath).pipe(res);
        }
    }
    const navHost = process.env.NAVIDROME_HOST || 'localhost';
    const navPort = process.env.NAVIDROME_PORT || '4533';
    const navUser = process.env.NAVIDROME_USER || '';
    const navPass = process.env.NAVIDROME_PASS || '';
    const url = `http://${navHost}:${navPort}/rest/getCoverArt?id=${req.params.id}&u=${navUser}&p=${navPass}&v=1.12.0&c=Viniz`;

    http.get(url, (proxyRes) => {
        if (proxyRes.statusCode !== 200) {
            return res.status(200).set('Content-Type', 'image/svg+xml').end(PLACEHOLDER_SVG);
        }
        if (proxyRes.headers['content-type']) {
            res.set('Content-Type', proxyRes.headers['content-type']);
        } else {
            res.set('Content-Type', 'image/jpeg');
        }
        res.set('Cache-Control', 'public, max-age=86400');
        proxyRes.pipe(res);
    }).on('error', (err) => {
        console.error('Cover art proxy error:', err.message);
        res.status(200).set('Content-Type', 'image/svg+xml').end(PLACEHOLDER_SVG);
    });
});

// ── NEW ENDPOINTS ──

app.get('/api/stats/recent', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    db.all(`SELECT id, user_name, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, event_type, timestamp
            FROM history ORDER BY id DESC LIMIT ${limit}`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/heatmap', (req, res) => {
    const days = parseInt(req.query.days) || 365;
    db.all(`SELECT date(timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as day,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views
            FROM history
            WHERE timestamp >= strftime('%s', 'now', '-${days} days')
            GROUP BY day
            ORDER BY day ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/hourly', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.all(`SELECT CAST(strftime('%H', timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') AS INTEGER) as hour,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views
            FROM history WHERE ${condition}
            GROUP BY hour
            ORDER BY hour ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        const filled = Array.from({length: 24}, (_, i) => {
            const found = rows.find(r => r.hour === i);
            return { hour: i, plays: found ? found.plays : 0, views: found ? found.views : 0 };
        });
        res.json(filled);
    });
});

app.get('/api/stats/streaks', (req, res) => {
    db.all(`SELECT DISTINCT date(timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as day
            FROM history
            WHERE event_type='play'
            ORDER BY day DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});

        const dates = rows.map(r => r.day);
        if (dates.length === 0) {
            return res.json({ current: 0, longest: 0, total_active_days: 0 });
        }

        let current = 0;
        const offsetMs = utcOffset * 3600 * 1000;
        const today = new Date(Date.now() + offsetMs).toISOString().split('T')[0];
        const yesterday = new Date(Date.now() + offsetMs - 86400000).toISOString().split('T')[0];

        if (dates[0] === today || dates[0] === yesterday) {
            let check = dates[0] === today ? today : yesterday;
            for (const d of dates) {
                if (d === check) {
                    current++;
                    const prev = new Date(new Date(check).getTime() - 86400000).toISOString().split('T')[0];
                    check = prev;
                } else if (d < check) {
                    break;
                }
            }
        }

        let longest = 0;
        let streak = 1;
        for (let i = 1; i < dates.length; i++) {
            const prev = new Date(new Date(dates[i-1]).getTime() - 86400000).toISOString().split('T')[0];
            if (dates[i] === prev) {
                streak++;
            } else {
                longest = Math.max(longest, streak);
                streak = 1;
            }
        }
        longest = Math.max(longest, streak);

        res.json({
            current,
            longest,
            total_active_days: dates.length
        });
    });
});

app.get('/api/stats/unique-counts', (req, res) => {
    db.all(`SELECT 'artists' as type, COUNT(DISTINCT artist_name) as count FROM history WHERE artist_name != 'Unknown'
            UNION ALL
            SELECT 'albums' as type, COUNT(DISTINCT album_name) as count FROM history WHERE album_name != 'Unknown'
            UNION ALL
            SELECT 'tracks' as type, COUNT(DISTINCT track_name) as count FROM history WHERE track_name != 'Unknown'
            UNION ALL
            SELECT 'total' as type, COUNT(*) as count FROM history`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        const result = {};
        rows.forEach(r => result[r.type] = r.count);
        res.json(result);
    });
});

app.get('/api/stats/growth', (req, res) => {
    db.all(`SELECT strftime('%Y-%m', timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as month,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays
            FROM history
            GROUP BY month
            ORDER BY month ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        let cumulative = 0;
        const result = rows.map(r => {
            cumulative += r.plays;
            return { month: r.month, plays: r.plays, cumulative };
        });
        res.json(result);
    });
});

app.get('/api/stats/now-playing', (req, res) => {
    db.get(`SELECT id, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, timestamp
            FROM history WHERE event_type='view'
            ORDER BY id DESC LIMIT 1`, [], (err, row) => {
        if (err) return res.status(500).json({error: err.message});
        if (!row) return res.json(null);
        const cutoff = Math.floor(Date.now() / 1000) - 300;
        if (row.timestamp < cutoff) return res.json(null);
        res.json(row);
    });
});

app.get('/api/stats/top-genres', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    if (!naviDb) {
        db.all(`SELECT genre, COUNT(*) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND genre != '' AND genre IS NOT NULL
                GROUP BY genre
                ORDER BY playtime DESC LIMIT 20`, [], (err, rows) => {
            if (err) return res.status(500).json({error: err.message});
            return res.json(rows);
        });
    } else {
        db.all(`SELECT h.genre, COUNT(*) as plays,
                SUM(CASE WHEN h.event_type='play' THEN h.duration ELSE 0 END) as playtime
                FROM history h WHERE ${condition} AND h.genre != '' AND h.genre IS NOT NULL
                GROUP BY h.genre
                ORDER BY playtime DESC LIMIT 20`, [], (err, rows) => {
            if (err) return res.status(500).json({error: err.message});
            res.json(rows);
        });
    }
});

app.get('/api/stats/day-of-week', (req, res) => {
    const condition = getTimeCondition(req.query.filter);
    db.all(`SELECT CAST(strftime('%w', timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') AS INTEGER) as day,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays
            FROM history WHERE ${condition}
            GROUP BY day
            ORDER BY day ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const filled = Array.from({length: 7}, (_, i) => {
            const found = rows.find(r => r.day === i);
            return { day: i, day_name: dayNames[i], plays: found ? found.plays : 0 };
        });
        res.json(filled);
    });
});

app.get('/api/stats/history', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const search = req.query.q ? `%${req.query.q}%` : null;
    const type = req.query.type || null;

    let where = '1=1';
    const params = [];
    if (search) {
        where = `(track_name LIKE ? OR artist_name LIKE ? OR album_name LIKE ?)`;
        params.push(search, search, search);
    }
    if (type === 'play' || type === 'view') {
        where += ` AND event_type = ?`;
        params.push(type);
    }

    db.get(`SELECT COUNT(*) as total FROM history WHERE ${where}`, params, (err, countResult) => {
        if (err) return res.status(500).json({error: err.message});

        db.all(`SELECT id, user_name, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, event_type, timestamp
                FROM history WHERE ${where}
                ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`, params, (err, rows) => {
            if (err) return res.status(500).json({error: err.message});
            res.json({
                data: rows,
                total: countResult.total,
                page,
                limit,
                total_pages: Math.ceil(countResult.total / limit)
            });
        });
    });
});

app.get('/api/stats/library', (req, res) => {
    const tab = req.query.tab || 'artists';
    const search = req.query.q || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = (page - 1) * limit;

    const searchClause = search ? `AND ${tab === 'artists' ? 'artist_name' : tab === 'albums' ? 'album_name' : 'track_name'} LIKE ?` : '';
    const params = search ? [`%${search}%`] : [];

    if (tab === 'artists') {
        db.get(`SELECT COUNT(DISTINCT artist_name) as total FROM history WHERE artist_name != 'Unknown' ${searchClause}`,
            params, (err, countRes) => {
            if (err) return res.status(500).json({error: err.message});
            db.all(`SELECT artist_name, MAX(artist_id) as artist_id,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE artist_name != 'Unknown' ${searchClause}
                    GROUP BY artist_name
                    ORDER BY artist_name ASC LIMIT ${limit} OFFSET ${offset}`, params, (err, rows) => {
                if (err) return res.status(500).json({error: err.message});
                res.json({ data: rows, total: countRes.total, page, limit });
            });
        });
    } else if (tab === 'albums') {
        db.get(`SELECT COUNT(DISTINCT album_name) as total FROM history WHERE album_name != 'Unknown' ${searchClause}`,
            params, (err, countRes) => {
            if (err) return res.status(500).json({error: err.message});
            db.all(`SELECT album_name, artist_name, MAX(album_id) as album_id,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE album_name != 'Unknown' ${searchClause}
                    GROUP BY album_name, artist_name
                    ORDER BY album_name ASC LIMIT ${limit} OFFSET ${offset}`, params, (err, rows) => {
                if (err) return res.status(500).json({error: err.message});
                res.json({ data: rows, total: countRes.total, page, limit });
            });
        });
    } else {
        db.get(`SELECT COUNT(*) as total FROM history WHERE 1=1 ${searchClause}`,
            params, (err, countRes) => {
            if (err) return res.status(500).json({error: err.message});
            db.all(`SELECT track_name, artist_name, album_name, MAX(track_id) as track_id, MAX(album_id) as album_id, MAX(artist_id) as artist_id,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE 1=1 ${searchClause}
                    GROUP BY track_name, artist_name, album_name
                    ORDER BY track_name ASC LIMIT ${limit} OFFSET ${offset}`, params, (err, rows) => {
                if (err) return res.status(500).json({error: err.message});
                res.json({ data: rows, total: countRes.total, page, limit });
            });
        });
    }
});

// ── Player / Streaming ──

app.get('/api/ping', (req, res) => { res.json({ msg: 'pong from new code' }); });

app.get('/api/stats/years', (req, res) => {
    db.all(`SELECT DISTINCT strftime('%Y', timestamp + ${Math.round(utcOffset * 3600)}, 'unixepoch') as year
            FROM history ORDER BY year DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => parseInt(r.year)));
    });
});

app.get('/api/track/lookup', (req, res) => {
    const { track, artist } = req.query;
    if (!track || !artist) return res.status(400).json({ error: 'track and artist required' });
    db.get('SELECT track_id, album_id, artist_id, duration, genre FROM history WHERE track_name = ? AND artist_name = ? AND track_id != \'\' ORDER BY id DESC LIMIT 1', [track, artist], (err, row) => {
        if (row && row.track_id) return res.json({ ...row, stream_url: '/api/stream/' + row.track_id, cover_url: '/api/cover-art/' + (row.album_id || row.track_id) });
        if (!naviDb) return res.json({ track_id: '', stream_url: '', cover_url: '' });
        try {
            const match = naviDb.prepare('SELECT id as track_id, album_id, artist_id, duration, genre FROM media_file WHERE title = ? AND artist = ?').get(track, artist);
            if (match) return res.json({ ...match, stream_url: '/api/stream/' + match.track_id, cover_url: '/api/cover-art/' + (match.album_id || match.track_id) });
        } catch (e) {}
        res.json({ track_id: '', stream_url: '', cover_url: '' });
    });
});

app.get('/api/stream/:id', (req, res) => {
    if (!req.params.id) return res.status(400).end();
    const navHost = process.env.NAVIDROME_HOST || 'localhost';
    const navPort = process.env.NAVIDROME_PORT || '4533';
    const navUser = process.env.NAVIDROME_USER || '';
    const navPass = process.env.NAVIDROME_PASS || '';
    const streamUrl = 'http://' + navHost + ':' + navPort + '/rest/stream?id=' + req.params.id + '&u=' + navUser + '&p=' + navPass + '&v=1.12.0&c=Viniz&format=raw';
    const options = req.headers.range ? { headers: { 'Range': req.headers.range } } : {};
    http.get(streamUrl, options, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            http.get(proxyRes.headers.location, (redirectRes) => {
                res.status(redirectRes.statusCode);
                if (redirectRes.headers['content-type']) res.set('Content-Type', redirectRes.headers['content-type']);
                redirectRes.pipe(res);
            }).on('error', () => res.status(502).end());
            return;
        }
        res.status(proxyRes.statusCode);
        if (proxyRes.headers['content-type']) res.set('Content-Type', proxyRes.headers['content-type']);
        proxyRes.pipe(res);
    }).on('error', () => res.status(502).end());
});

app.get('/api/player/album-tracks/:albumId', (req, res) => {
    if (!naviDb) return res.json({ tracks: [] });
    try {
        const tracks = naviDb.prepare('SELECT id, title, artist, album, track_number, duration, album_id, artist_id FROM media_file WHERE album_id = ? ORDER BY track_number ASC').all(req.params.albumId);
        res.json(tracks.map(t => ({ track_id: t.id, track_name: t.title, artist_name: t.artist, album_name: t.album, track_number: t.track_number, duration: t.duration, album_id: t.album_id, artist_id: t.artist_id, stream_url: '/api/stream/' + t.id, cover_url: '/api/cover-art/' + (t.album_id || t.id) })));
    } catch (e) { res.json({ tracks: [] }); }
});

app.get('/api/player/artist-top-tracks/:artistId', (req, res) => {
    if (!naviDb) return res.json({ tracks: [] });
    try {
        const tracks = naviDb.prepare('SELECT id, title, artist, album, album_id, artist_id, duration FROM media_file WHERE artist_id = ? ORDER BY play_count DESC LIMIT 20').all(req.params.artistId);
        res.json(tracks.map(t => ({ track_id: t.id, track_name: t.title, artist_name: t.artist, album_name: t.album, album_id: t.album_id, artist_id: t.artist_id, duration: t.duration, stream_url: '/api/stream/' + t.id, cover_url: '/api/cover-art/' + (t.album_id || t.id) })));
    } catch (e) { res.json({ tracks: [] }); }
});

app.get('/api/recommendations/for-you', (req, res) => {
    db.all('SELECT genre, COUNT(*) as cnt FROM history WHERE genre != \'\' AND genre IS NOT NULL GROUP BY genre ORDER BY cnt DESC LIMIT 5', [], (err, topGenres) => {
        if (err) return res.status(500).json({ error: err.message });
        if (topGenres.length === 0) return res.json([]);
        const genres = topGenres.map(g => g.genre);
        db.all('SELECT DISTINCT artist_name FROM history', [], (err, listenedArtists) => {
            if (err) return res.status(500).json({ error: err.message });
            const placeholders = genres.map(() => '?').join(',');
            db.all('SELECT DISTINCT artist_name, MAX(artist_id) as artist_id, genre, COUNT(*) as play_count FROM history WHERE genre IN (' + placeholders + ') AND genre != \'\' GROUP BY artist_name ORDER BY play_count DESC LIMIT 10', genres, (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(rows.map(r => ({ artist_name: r.artist_name, artist_id: r.artist_id, genre: r.genre, reason: 'Genre: ' + r.genre })));
            });
        });
    });
});

app.get('/api/recommendations/discover', (req, res) => {
    if (!naviDb) return res.json([]);
    db.all('SELECT DISTINCT artist_name FROM history ORDER BY id DESC LIMIT 50', [], (err, artists) => {
        if (err) return res.status(500).json({ error: err.message });
        if (artists.length === 0) return res.json([]);
        db.all('SELECT DISTINCT track_name, artist_name FROM history', [], (err, listened) => {
            if (err) return res.status(500).json({ error: err.message });
            const listenedSet = new Set(listened.map(l => l.track_name + '||' + l.artist_name));
            const results = [];
            const seen = new Set();
            try {
                for (const a of artists) {
                    if (results.length >= 15) break;
                    const unplayed = naviDb.prepare('SELECT id, title, artist, album, album_id, artist_id, duration FROM media_file WHERE artist = ? ORDER BY RANDOM() LIMIT 5').all(a.artist_name);
                    for (const t of unplayed) {
                        if (results.length >= 15) break;
                        const key = t.title + '||' + t.artist;
                        if (!listenedSet.has(key) && !seen.has(key)) {
                            seen.add(key);
                            results.push({ track_id: t.id, track_name: t.title, artist_name: t.artist, album_name: t.album, album_id: t.album_id, artist_id: t.artist_id, duration: t.duration, cover_url: '/api/cover-art/' + (t.album_id || t.id), stream_url: '/api/stream/' + t.id });
                        }
                    }
                }
                res.json(results);
            } catch (e) { res.json([]); }
        });
    });
});

app.get('/api/recommendations/similar/:artist', (req, res) => {
    if (!naviDb) return res.json([]);
    try {
        const genres = naviDb.prepare('SELECT DISTINCT genre FROM media_file WHERE artist = ? AND genre != \'\'').all(req.params.artist).map(g => g.genre);
        if (genres.length === 0) return res.json([]);
        const conditions = genres.map(() => 'genre LIKE ?').join(' OR ');
        const params = genres.map(g => '%' + g + '%');
        params.push(req.params.artist);
        const similar = naviDb.prepare('SELECT DISTINCT artist, artist_id, genre FROM media_file WHERE (' + conditions + ') AND artist != ? GROUP BY artist ORDER BY COUNT(*) DESC LIMIT 8').all(...params);
        res.json(similar.map(s => ({ artist_name: s.artist, artist_id: s.artist_id, genre: s.genre })));
    } catch (e) { res.json([]); }
});

app.get('/api/recommendations/at-this-hour', (req, res) => {
    const localHour = new Date(Date.now() + utcOffset * 3600 * 1000).getUTCHours();
    db.all('SELECT track_name, artist_name, album_name, MAX(track_id) as track_id, MAX(album_id) as album_id, COUNT(*) as play_count FROM history WHERE event_type=\'play\' AND CAST(strftime(\'%H\', timestamp + ' + Math.round(utcOffset * 3600) + ', \'unixepoch\') AS INTEGER) = ? GROUP BY track_name, artist_name ORDER BY play_count DESC LIMIT 10', [localHour], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ hour: localHour, tracks: rows });
    });
});

app.get('/api/stats/yearly/:year', (req, res) => {
    const year = parseInt(req.params.year);
    if (!year) return res.status(400).json({ error: 'year required' });
    const startTs = Math.floor(new Date(year + '-01-01').getTime() / 1000);
    const endTs = Math.floor(new Date((year + 1) + '-01-01').getTime() / 1000);
    const cond = 'timestamp >= ' + startTs + ' AND timestamp < ' + endTs;
    const uo = Math.round(utcOffset * 3600);
    db.get('SELECT SUM(CASE WHEN event_type=\'play\' THEN duration ELSE 0 END) as total_playtime, SUM(CASE WHEN event_type=\'play\' THEN 1 ELSE 0 END) as total_plays, COUNT(DISTINCT track_name) as unique_tracks, COUNT(DISTINCT artist_name) as unique_artists, COUNT(DISTINCT album_name) as unique_albums, COUNT(DISTINCT date(timestamp + ' + uo + ', \'unixepoch\')) as active_days FROM history WHERE ' + cond, [], (err, summary) => {
        if (err) return res.status(500).json({ error: err.message });
        db.all('SELECT artist_name, MAX(artist_id) as artist_id, SUM(CASE WHEN event_type=\'play\' THEN duration ELSE 0 END) as playtime, COUNT(*) as plays FROM history WHERE ' + cond + ' AND artist_name != \'Unknown\' GROUP BY artist_name ORDER BY playtime DESC LIMIT 5', [], (err, topArtists) => {
            if (err) return res.status(500).json({ error: err.message });
            db.all('SELECT track_name, artist_name, MAX(track_id) as track_id, MAX(album_id) as album_id, SUM(CASE WHEN event_type=\'play\' THEN duration ELSE 0 END) as playtime, COUNT(*) as plays FROM history WHERE ' + cond + ' GROUP BY track_name, artist_name ORDER BY playtime DESC LIMIT 5', [], (err, topTracks) => {
                if (err) return res.status(500).json({ error: err.message });
                db.all('SELECT album_name, artist_name, MAX(album_id) as album_id, SUM(CASE WHEN event_type=\'play\' THEN duration ELSE 0 END) as playtime, COUNT(*) as plays FROM history WHERE ' + cond + ' AND album_name != \'Unknown\' GROUP BY album_name, artist_name ORDER BY playtime DESC LIMIT 5', [], (err, topAlbums) => {
                    if (err) return res.status(500).json({ error: err.message });
                    db.all('SELECT strftime(\'%Y-%m\', timestamp + ' + uo + ', \'unixepoch\') as month, SUM(CASE WHEN event_type=\'play\' THEN duration ELSE 0 END) as playtime, COUNT(*) as plays FROM history WHERE ' + cond + ' GROUP BY month ORDER BY month ASC', [], (err, monthly) => {
                        if (err) return res.status(500).json({ error: err.message });
                        let peakMonth = { month: '', plays: 0 };
                        monthly.forEach(m => { if (m.plays > peakMonth.plays) peakMonth = m; });
                        db.get('SELECT date(timestamp + ' + uo + ', \'unixepoch\') as day, COUNT(*) as plays FROM history WHERE ' + cond + ' AND event_type=\'play\' GROUP BY day ORDER BY plays DESC LIMIT 1', [], (err, peakDay) => {
                            res.json({ year, summary: summary || {}, top_artists: topArtists, top_tracks: topTracks, top_albums: topAlbums, monthly, peak_month: peakMonth, peak_day: peakDay || {} });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/stats/mood-calendar', (req, res) => {
    const days = parseInt(req.query.days) || 90;
    db.all('SELECT date(timestamp + ' + Math.round(utcOffset * 3600) + ', \'unixepoch\') as day, genre, COUNT(*) as plays FROM history WHERE timestamp >= strftime(\'%s\', \'now\', \'-' + days + ' days\') AND genre != \'\' GROUP BY day, genre ORDER BY day ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const moodMap = {};
        rows.forEach(r => { if (!moodMap[r.day]) moodMap[r.day] = {}; moodMap[r.day][r.genre] = (moodMap[r.day][r.genre] || 0) + r.plays; });
        const result = Object.entries(moodMap).map(([day, genres]) => {
            let topGenre = '', topCount = 0;
            Object.entries(genres).forEach(([genre, count]) => { if (count > topCount) { topGenre = genre; topCount = count; } });
            return { day, genre: topGenre, plays: topCount };
        });
        res.json(result);
    });
});

dbReady.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log('Viniz server running on port ' + PORT);
        backfillAlbumIds();
    });
}).catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});
