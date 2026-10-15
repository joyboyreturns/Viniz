const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const cache = new Map();
const pending = new Map();
let active = 0;
const countries = 'ZZ AR AU AT BE BO BR CA CL CO CR CZ DK DO EC EG SV EE FI FR DE GT HN HK HU IS IN ID IE IL IT JP KE LU MY MX NL NZ NI NG NO PA PY PE PH PL PT RO RU SA RS SG ZA KR ES SE CH TW TZ TH TR UG UA AE GB US UY VN ZW'.split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const countryList = countries.map(code => ({ code, name: code === 'ZZ' ? 'Worldwide' : names.of(code) })).sort((a, b) => a.code === 'ZZ' ? -1 : b.code === 'ZZ' ? 1 : a.name.localeCompare(b.name));

async function requestMusic(operation, country, value = '') {
    const key = JSON.stringify([operation, country, value]);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.data;
    if (pending.has(key)) return pending.get(key);
    if (active >= 4) {
        const error = new Error('Music discovery is busy. Try again in a moment.');
        error.status = 429;
        throw error;
    }
    active++;
    const task = (async () => {
        try {
            const { stdout } = await run(process.env.MUSIC_IMPORT_PYTHON || '/opt/music-env/bin/python',
                [path.join(__dirname, 'music_provider.py'), operation, country, value],
                { timeout: 90_000, maxBuffer: 12 * 1024 * 1024, windowsHide: true });
            const data = JSON.parse(stdout);
            if (operation.endsWith('-art') && !data.image) return data;
            if (cache.size >= 128) cache.delete(cache.keys().next().value);
            cache.set(key, { data, expires: Date.now() + 15 * 60_000 });
            return data;
        } finally {
            active--;
            pending.delete(key);
        }
    })();
    pending.set(key, task);
    return task;
}

module.exports = { requestMusic, countries, countryList };
