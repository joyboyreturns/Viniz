const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { db, naviDb } = require('./database');

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

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect fill="#333" width="300" height="300"/><circle fill="#555" cx="150" cy="135" r="40"/><rect fill="#555" x="110" y="175" width="80" height="90" rx="6"/></svg>';

app.get('/api/cover-art/:id', (req, res) => {
    if (!req.params.id) {
        return res.status(200).set('Content-Type', 'image/svg+xml').end(PLACEHOLDER_SVG);
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Viniz server running on port ${PORT}`);
});
