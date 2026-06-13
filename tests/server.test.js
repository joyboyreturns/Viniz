const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');

const fixturesDir = path.join(__dirname, 'fixtures');
const vinizDbPath = path.join(fixturesDir, 'test_viniz.db');
const navidromeDbPath = path.join(fixturesDir, 'test_navidrome.db');

function cleanup() {
    const files = [
        vinizDbPath,
        `${vinizDbPath}-wal`,
        `${vinizDbPath}-shm`,
        navidromeDbPath,
        `${navidromeDbPath}-wal`,
        `${navidromeDbPath}-shm`
    ];
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        } catch (err) {
            // ignore
        }
    }
}

test.describe('Server Integration Test', () => {
    let serverProcess;

    test.before(() => {
        // Create tests/fixtures directory if it does not exist
        if (!fs.existsSync(fixturesDir)) {
            fs.mkdirSync(fixturesDir, { recursive: true });
        }
        
        // Clean up any stale files from previous runs
        cleanup();

        // Pre-create test_navidrome.db
        const naviDb = new BetterSqlite3(navidromeDbPath);
        naviDb.exec(`CREATE TABLE IF NOT EXISTS media_file (
            id TEXT PRIMARY KEY,
            album_id TEXT,
            artist_id TEXT,
            duration INTEGER,
            title TEXT,
            artist TEXT
        )`);
        
        // Pre-populate test_navidrome.db with a mock track in media_file
        naviDb.prepare(`INSERT OR REPLACE INTO media_file (id, album_id, artist_id, duration, title, artist)
                        VALUES (?, ?, ?, ?, ?, ?)`).run('t1', 'al1', 'ar1', 180, 'Track A', 'Artist A');
        naviDb.close();
    });

    test.after(async () => {
        if (serverProcess) {
            // Cleanly terminate the spawned child process via SIGTERM
            serverProcess.kill('SIGTERM');
            
            // Wait for the process to exit to release file locks before deleting
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    serverProcess.kill('SIGKILL');
                    resolve();
                }, 1500);
                
                serverProcess.on('exit', () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        
        // Clean up the temporary database files (including WAL/SHM files)
        cleanup();
    });

    test('should spawn server and respond to validate-token', async () => {
        // Spawn the Express server (node server.js) passing isolated environment variables
        serverProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                VINIZ_DB_PATH: vinizDbPath,
                NAVIDROME_DB_PATH: navidromeDbPath
            }
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`[Server stdout] ${data.toString().trim()}`);
        });
        serverProcess.stderr.on('data', (data) => {
            console.error(`[Server stderr] ${data.toString().trim()}`);
        });

        // Poll validate-token endpoint until it starts listening (max timeout 5 seconds)
        const startTime = Date.now();
        let connected = false;
        let lastStatus = null;
        let lastBody = null;

        while (Date.now() - startTime < 5000) {
            try {
                const res = await fetch('http://localhost:4096/apis/listenbrainz/1/validate-token');
                lastStatus = res.status;
                lastBody = await res.json();
                if (lastStatus === 200 && lastBody && lastBody.valid === true) {
                    connected = true;
                    break;
                }
            } catch (e) {
                // Ignore connection errors during startup polling
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        assert.strictEqual(connected, true, `Server failed to respond correctly within 5s. Status: ${lastStatus}, Body: ${JSON.stringify(lastBody)}`);
        assert.strictEqual(lastStatus, 200);
        assert.strictEqual(lastBody.valid, true);
    });

    test('should start up successfully on default startup without env variables and print warning', async () => {
        // Spawn with no database environment variables (purging VINIZ_DB_PATH and NAVIDROME_DB_PATH) but specifying PORT
        const defaultProcess = spawn('node', ['server.js'], {
            cwd: path.join(__dirname, '..'),
            env: {
                PATH: process.env.PATH,
                PORT: '4097'
            }
        });

        let warningLogged = false;
        let stderrOutput = '';
        defaultProcess.stderr.on('data', (data) => {
            const str = data.toString();
            stderrOutput += str;
            if (str.includes("Warning: Navidrome database not found/configured. Please link your Navidrome database to enable track duration lookups.")) {
                warningLogged = true;
            }
        });

        // Poll validate-token endpoint until it starts listening on port 4097 (max timeout 5 seconds)
        const startTime = Date.now();
        let connected = false;
        while (Date.now() - startTime < 5000) {
            try {
                const res = await fetch('http://localhost:4097/apis/listenbrainz/1/validate-token');
                if (res.status === 200) {
                    connected = true;
                    break;
                }
            } catch (e) {
                // Ignore connection errors during startup polling
            }
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Cleanly kill the spawned default server process
        defaultProcess.kill('SIGTERM');
        await new Promise((resolve) => {
            defaultProcess.on('exit', resolve);
        });

        assert.strictEqual(connected, true, 'Server failed to start up successfully on defaults without env variables');
        assert.strictEqual(warningLogged, true, `Expected Navidrome missing warning in stderr, but got: ${stderrOutput}`);
    });

    test('should return nulls when stats summary is queried on empty database', async () => {
        const res = await fetch('http://localhost:4096/api/stats/summary');
        assert.strictEqual(res.status, 200);
        const body = await res.json();
        assert.deepStrictEqual(body, { views: null, plays: null, playtime: null });
    });

    test('should ingest tracks and verify correct database contents', async () => {
        // A. Standard scrobble ingestion test
        const response1 = await fetch('http://localhost:4096/apis/listenbrainz/1/submit-listens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'User Vincent'
            },
            body: JSON.stringify({
                listen_type: 'single',
                payload: [
                    {
                        track_metadata: {
                            track_name: 'Track A',
                            artist_name: 'Artist A',
                            release_name: 'Album A'
                        }
                    }
                ]
            })
        });
        assert.strictEqual(response1.status, 200);
        const body1 = await response1.json();
        assert.deepStrictEqual(body1, { status: 'ok' });

        const sqlite3 = require('sqlite3').verbose();
        const queryDb = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                const db = new sqlite3.Database(vinizDbPath, sqlite3.OPEN_READONLY, (err) => {
                    if (err) return reject(err);
                });
                db.all(sql, params, (err, rows) => {
                    db.close();
                    if (err) return reject(err);
                    resolve(rows);
                });
            });
        };

        // Poll history table until Track A is inserted (as db.run is async in Express)
        let rows1 = [];
        for (let i = 0; i < 20; i++) {
            rows1 = await queryDb("SELECT * FROM history WHERE track_name = 'Track A'");
            if (rows1.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.strictEqual(rows1.length, 1);
        const row1 = rows1[0];
        assert.strictEqual(row1.user_name, 'User Vincent');
        assert.strictEqual(row1.track_name, 'Track A');
        assert.strictEqual(row1.artist_name, 'Artist A');
        assert.strictEqual(row1.album_name, 'Album A');
        assert.strictEqual(row1.track_id, 't1');
        assert.strictEqual(row1.album_id, 'al1');
        assert.strictEqual(row1.artist_id, 'ar1');
        assert.strictEqual(row1.duration, 180);
        assert.strictEqual(row1.event_type, 'play');

        // B. Ingestion with Fallback Duration
        const response2 = await fetch('http://localhost:4096/apis/listenbrainz/1/submit-listens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'User Vincent'
            },
            body: JSON.stringify({
                listen_type: 'single',
                payload: [
                    {
                        track_metadata: {
                            track_name: 'Track B',
                            artist_name: 'Artist B',
                            release_name: 'Album B',
                            additional_info: {
                                duration_ms: 240000
                            }
                        }
                    }
                ]
            })
        });
        assert.strictEqual(response2.status, 200);

        let rows2 = [];
        for (let i = 0; i < 20; i++) {
            rows2 = await queryDb("SELECT * FROM history WHERE track_name = 'Track B'");
            if (rows2.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.strictEqual(rows2.length, 1);
        const row2 = rows2[0];
        assert.strictEqual(row2.duration, 240);
        assert.strictEqual(row2.event_type, 'play');

        // C. Ingestion with listen_type 'playing_now'
        const response3 = await fetch('http://localhost:4096/apis/listenbrainz/1/submit-listens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'User Vincent'
            },
            body: JSON.stringify({
                listen_type: 'playing_now',
                payload: [
                    {
                        track_metadata: {
                            track_name: 'Track C',
                            artist_name: 'Artist C',
                            release_name: 'Album C',
                            additional_info: {
                                duration_ms: 300000
                            }
                        }
                    }
                ]
            })
        });
        assert.strictEqual(response3.status, 200);

        let rows3 = [];
        for (let i = 0; i < 20; i++) {
            rows3 = await queryDb("SELECT * FROM history WHERE track_name = 'Track C'");
            if (rows3.length > 0) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.strictEqual(rows3.length, 1);
        const row3 = rows3[0];
        assert.strictEqual(row3.event_type, 'view');
    });

    test('should check stats summary with filters and seeded data', async () => {
        const sqlite3 = require('sqlite3').verbose();
        const runDb = (sql, params = []) => {
            return new Promise((resolve, reject) => {
                const db = new sqlite3.Database(vinizDbPath, (err) => {
                    if (err) return reject(err);
                });
                db.run(sql, params, function(err) {
                    db.close();
                    if (err) return reject(err);
                    resolve(this);
                });
            });
        };

        // Clear history table to seed exact data
        await runDb("DELETE FROM history");

        const now = Math.floor(Date.now() / 1000);

        // Play 1: within 7 days (now), duration 100, play
        await runDb(`INSERT INTO history (user_name, track_name, artist_name, album_name, duration, event_type, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                     ['User Vincent', 'Track 7d', 'Artist 7d', 'Album 7d', 100, 'play', now]);

        // Play 2: outside 7 days but within 1 month (8 days ago), duration 200, play
        await runDb(`INSERT INTO history (user_name, track_name, artist_name, album_name, duration, event_type, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                     ['User Vincent', 'Track 8d', 'Artist 8d', 'Album 8d', 200, 'play', now - 8 * 86400]);

        // Play 3: outside 1 month (35 days ago), duration 300, play
        await runDb(`INSERT INTO history (user_name, track_name, artist_name, album_name, duration, event_type, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                     ['User Vincent', 'Track 35d', 'Artist 35d', 'Album 35d', 300, 'play', now - 35 * 86400]);

        // View 4: within 7 days (now), duration 150, view (playing_now)
        await runDb(`INSERT INTO history (user_name, track_name, artist_name, album_name, duration, event_type, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                     ['User Vincent', 'Track View', 'Artist View', 'Album View', 150, 'view', now]);

        // Verify total / default (invalid filter or no filter)
        // plays: 3
        // playtime: 100 + 200 + 300 = 600
        // views: 1
        const resAll = await fetch('http://localhost:4096/api/stats/summary');
        assert.strictEqual(resAll.status, 200);
        const bodyAll = await resAll.json();
        assert.deepStrictEqual(bodyAll, { views: 1, plays: 3, playtime: 600 });

        // Verify filter=7d
        // plays: 1 (Track 7d)
        // playtime: 100
        // views: 1 (Track View)
        const res7d = await fetch('http://localhost:4096/api/stats/summary?filter=7d');
        assert.strictEqual(res7d.status, 200);
        const body7d = await res7d.json();
        assert.deepStrictEqual(body7d, { views: 1, plays: 1, playtime: 100 });

        // Verify filter=1m
        // plays: 2 (Track 7d + Track 8d)
        // playtime: 300
        // views: 1 (Track View)
        const res1m = await fetch('http://localhost:4096/api/stats/summary?filter=1m');
        assert.strictEqual(res1m.status, 200);
        const body1m = await res1m.json();
        assert.deepStrictEqual(body1m, { views: 1, plays: 2, playtime: 300 });

        // Verify filter=invalid
        const resInvalid = await fetch('http://localhost:4096/api/stats/summary?filter=invalid');
        assert.strictEqual(resInvalid.status, 200);
        const bodyInvalid = await resInvalid.json();
        assert.deepStrictEqual(bodyInvalid, { views: 1, plays: 3, playtime: 600 });
    });

    test('should return HTTP 500 when database query fails', async () => {
        const sqlite3 = require('sqlite3').verbose();
        const runDb = (sql) => {
            return new Promise((resolve, reject) => {
                const db = new sqlite3.Database(vinizDbPath, (err) => {
                    if (err) return reject(err);
                });
                db.run(sql, (err) => {
                    db.close();
                    if (err) return reject(err);
                    resolve();
                });
            });
        };

        // Drop the history table to simulate database failure
        await runDb("DROP TABLE history");

        const res = await fetch('http://localhost:4096/api/stats/summary');
        assert.strictEqual(res.status, 500);
        const body = await res.json();
        assert.ok(body.error !== undefined);
    });
});
