const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const { db, naviDb } = require('./database');

const app = express();
const PORT = 4096;

app.use(cors());
app.use(bodyParser.json());
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
        
        naviDb.get(`SELECT id as track_id, album_id, artist_id, duration FROM media_file 
                    WHERE title = ? AND artist = ?`, [trackName, artistName], (err, row) => {
            let trackId = '', albumId = '', artistId = '', duration = 0;
            if (row) {
                trackId = row.track_id;
                albumId = row.album_id;
                artistId = row.artist_id;
                duration = row.duration || 0;
            }
            
            // Fallback to Navidrome metadata if Navidrome database didn't have duration
            if (!duration && listen.track_metadata.additional_info?.duration_ms) {
                duration = Math.round(listen.track_metadata.additional_info.duration_ms / 1000);
            }
            
            db.run(`INSERT INTO history (user_name, track_name, artist_name, album_name, track_id, album_id, artist_id, duration, event_type, timestamp) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userName, trackName, artistName, albumName, trackId, albumId, artistId, duration, eventType, timestamp]
            );
        });
    });

    res.status(200).json({status: "ok"});
});

function getTimeCondition(filter) {
    const now = Math.floor(Date.now() / 1000);
    switch(filter) {
        case 'today': return `timestamp >= ${now - 86400}`;
        case '7d': return `timestamp >= ${now - 7*86400}`;
        case '14d': return `timestamp >= ${now - 14*86400}`;
        case '1m': return `timestamp >= ${now - 30*86400}`;
        case '3m': return `timestamp >= ${now - 90*86400}`;
        case '6m': return `timestamp >= ${now - 180*86400}`;
        default: return '1=1'; // all time
    }
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
            ORDER BY plays DESC, views DESC LIMIT 10`, [], (err, rows) => {
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
            ORDER BY plays DESC, views DESC LIMIT 10`, [], (err, rows) => {
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
            ORDER BY plays DESC, views DESC LIMIT 10`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.get('/api/stats/artist/:name', (req, res) => {
    const artistName = req.params.name;
    const condition = getTimeCondition(req.query.filter);
    
    // 1. Get summary
    db.get(`SELECT artist_name, MAX(artist_id) as artist_id,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND artist_name = ?
            GROUP BY artist_name`, [artistName], (err, summary) => {
        if (err) return res.status(500).json({error: err.message});
        
        // 2. Get Top Tracks
        db.all(`SELECT track_name, MAX(track_id) as track_id, MAX(album_id) as album_id,
                SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND artist_name = ?
                GROUP BY track_name
                ORDER BY plays DESC, views DESC LIMIT 10`, [artistName], (err, tracks) => {
            if (err) return res.status(500).json({error: err.message});
            
            // 3. Get Top Albums
            db.all(`SELECT album_name, MAX(album_id) as album_id,
                    SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE ${condition} AND artist_name = ? AND album_name != 'Unknown'
                    GROUP BY album_name
                    ORDER BY plays DESC, views DESC LIMIT 10`, [artistName], (err, albums) => {
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

app.get('/api/stats/chart', (req, res) => {
    // Last 7 days chart data
    db.all(`SELECT date(timestamp, 'unixepoch', 'localtime') as day,
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
    
    // Search Tracks
    db.all(`SELECT track_name, MAX(track_id) as track_id, MAX(album_id) as album_id, artist_name,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
            SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
            SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
            FROM history WHERE ${condition} AND track_name LIKE ?
            GROUP BY track_name
            ORDER BY plays DESC, views DESC LIMIT 5`, [query], (err, tracks) => {
        if (err) return res.status(500).json({error: err.message});
        
        // Search Albums
        db.all(`SELECT album_name, MAX(album_id) as album_id, artist_name,
                SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                FROM history WHERE ${condition} AND album_name LIKE ? AND album_name != 'Unknown'
                GROUP BY album_name
                ORDER BY plays DESC, views DESC LIMIT 5`, [query], (err, albums) => {
            if (err) return res.status(500).json({error: err.message});
            
            // Search Artists
            db.all(`SELECT artist_name, MAX(artist_id) as artist_id,
                    SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) as views,
                    SUM(CASE WHEN event_type='play' THEN 1 ELSE 0 END) as plays,
                    SUM(CASE WHEN event_type='play' THEN duration ELSE 0 END) as playtime
                    FROM history WHERE ${condition} AND artist_name LIKE ?
                    GROUP BY artist_name
                    ORDER BY plays DESC, views DESC LIMIT 5`, [query], (err, artists) => {
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Viniz server running on port ${PORT}`);
});
