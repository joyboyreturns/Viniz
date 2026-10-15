// Credit strings are presentation data, not artist identities. Keep history intact.
const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const protectedNames = new Set(['Earth, Wind & Fire', 'Tyler, The Creator', 'Crosby, Stills & Nash', 'Crosby, Stills, Nash & Young', 'Blood, Sweat & Tears', 'Emerson, Lake & Palmer', 'Peter, Paul and Mary'].map(normalize));
const artistId = name => 'artist-' + Buffer.from(normalize(name)).toString('base64url');
const artistNameFromId = id => String(id).startsWith('artist-') ? Buffer.from(id.slice(7), 'base64url').toString('utf8') : null;
function splitCredit(credit, participants) {
    let structured;
    try { structured = typeof participants === 'string' ? JSON.parse(participants)?.artist : participants?.artist; } catch (_) {}
    // Real multiple-value tags take precedence and preserve punctuation in band names.
    const names = structured?.length > 1 ? structured.map(a => a.name) :
        protectedNames.has(normalize(credit)) ? [credit] : String(credit || 'Unknown').split(/\s*(?:;|,\s+|\s+(?:feat\.?|ft\.?|featuring)\s+)\s*/i);
    return [...new Map(names.filter(Boolean).map(name => {
        const clean = String(name).normalize('NFKC').trim().replace(/\s+/g, ' ');
        return [normalize(clean), { name: clean, id: artistId(clean) }];
    })).values()];
}
function createArtistCredits(db, naviDb) {
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, err => err ? reject(err) : resolve()));
    const hasParticipants = Boolean(naviDb?.prepare('PRAGMA table_info(media_file)').all().some(c => c.name === 'participants'));
    const creditExpression = alias => `viniz_artists(${alias ? alias + '.' : ''}artist, ${hasParticipants ? (alias ? alias + '.' : '') + 'participants' : 'NULL'})`;
    naviDb?.function('viniz_artists', { deterministic: true }, (credit, participants) => JSON.stringify(splitCredit(credit, participants)));
    let ready, pending, refreshedAt = 0, generation = 0;
    const known = new Map();
    async function init() {
        await run('CREATE TABLE IF NOT EXISTS artist_credits (credit TEXT PRIMARY KEY, artists TEXT NOT NULL)');
        await run(`CREATE VIEW IF NOT EXISTS artist_history AS SELECT h.id, h.user_name, h.track_name,
            json_extract(a.value, '$.name') AS artist_name, h.artist_name AS original_artist_name,
            h.album_name, h.track_id, h.album_id, json_extract(a.value, '$.id') AS artist_id,
            h.duration, h.genre, h.event_type, h.timestamp
            FROM history h JOIN json_each(COALESCE((SELECT artists FROM artist_credits WHERE credit=h.artist_name),
                json_array(json_object('name', h.artist_name, 'id', h.artist_id)))) a`);
    }
    async function refresh(force = false) {
        if (pending) return pending;
        if (!force && Date.now() - refreshedAt < 30_000) return;
        const started = generation;
        pending = (async () => {
            await (ready ||= init());
            const library = naviDb ? naviDb.prepare(`SELECT DISTINCT artist ${hasParticipants ? ', participants' : ''} FROM media_file WHERE missing=0`).all() : [];
            const local = new Map(library.map(row => [row.artist, row]));
            const history = await all('SELECT DISTINCT artist_name FROM history');
            const credits = new Set([...local.keys(), ...history.map(row => row.artist_name)]);
            for (const credit of credits) {
                const json = JSON.stringify(splitCredit(credit, local.get(credit)?.participants));
                if(known.get(credit) !== json) { await run('INSERT INTO artist_credits(credit, artists) VALUES (?,?) ON CONFLICT(credit) DO UPDATE SET artists=excluded.artists', [credit || 'Unknown', json]); known.set(credit,json); }
            }
            refreshedAt = started === generation ? Date.now() : 0;
        })().finally(() => { pending = null; });
        return pending;
    }
    function artistRows(where) {
        return `SELECT json_extract(c.value,'$.name') AS name, json_extract(c.value,'$.name') AS artist,
            '' AS album, COUNT(*) AS tracks, SUM(m.size) AS bytes, json_extract(c.value,'$.id') AS id,
            MIN(m.album_id) AS album_id, MAX(m.updated_at) AS updatedAt
            FROM (SELECT * FROM media_file ${where}) m JOIN json_each(${creditExpression('m')}) c
            GROUP BY json_extract(c.value,'$.id')`;
    }
    return { refresh, all, creditExpression, artistRows, splitCredit, invalidate: () => { generation++; refreshedAt=0; } };
}
module.exports = { normalize, splitCredit, artistId, artistNameFromId, createArtistCredits };
