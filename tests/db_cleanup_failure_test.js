const fs = require('fs');
const path = require('path');
const BetterSqlite3 = require('better-sqlite3');

console.log('Starting DB Cleanup Failure Adversarial Test...');

const fixturesDir = path.join(__dirname, 'fixtures');
const vinizDbPath = path.join(fixturesDir, 'test_viniz.db');
const navidromeDbPath = path.join(fixturesDir, 'test_navidrome.db');

// Ensure directory exists
if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
}

// 1. Pre-create the database files
fs.writeFileSync(vinizDbPath, 'dummy data');
fs.writeFileSync(navidromeDbPath, 'dummy data');

// 2. Lock one of the files by holding an open file descriptor or DB connection
let dbConn;
try {
    dbConn = new BetterSqlite3(vinizDbPath);
    // Keep it open to lock it on some OSes or at least keep it in use
} catch (e) {
    console.error('Failed to open test connection:', e);
}

// 3. Define the cleanup function from server.test.js
function cleanup() {
    const files = [
        vinizDbPath,
        `${vinizDbPath}-wal`,
        `${vinizDbPath}-shm`,
        navidromeDbPath,
        `${navidromeDbPath}-wal`,
        `${navidromeDbPath}-shm`
    ];
    let errors = 0;
    for (const file of files) {
        try {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`Unlinked: ${file}`);
            }
        } catch (err) {
            console.warn(`Failed to unlink ${file}: ${err.message}`);
            errors++;
        }
    }
    return errors;
}

// 4. Run cleanup
console.log('Running cleanup while DB is in use/locked...');
const errorsOccurred = cleanup();

console.log(`Cleanup execution finished. Stale database files still exist:`);
console.log(`test_viniz.db exists: ${fs.existsSync(vinizDbPath)}`);
console.log(`test_navidrome.db exists: ${fs.existsSync(navidromeDbPath)}`);

if (dbConn) {
    dbConn.close();
}

// Clean up for real
cleanup();

console.log('PASS: DB cleanup failure simulation completed.');
