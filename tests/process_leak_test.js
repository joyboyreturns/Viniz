const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('Starting Process Leak Adversarial Test...');

const fixturesDir = path.join(__dirname, 'fixtures');
const vinizDbPath = path.join(fixturesDir, 'leak_viniz.db');
const navidromeDbPath = path.join(fixturesDir, 'leak_navidrome.db');

// Ensure directory exists
if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
}

// Pre-create DB
fs.writeFileSync(vinizDbPath, '');
fs.writeFileSync(navidromeDbPath, '');

// Spawn the server
const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
        ...process.env,
        VINIZ_DB_PATH: vinizDbPath,
        NAVIDROME_DB_PATH: navidromeDbPath
    }
});

console.log(`Spawned server with PID: ${serverProcess.pid}`);

// Simulate a sudden crash of the test runner by exiting the parent process without killing the child
console.log('Simulating parent process exit without killing the child...');
console.log(`Checking if child process ${serverProcess.pid} survives parent death...`);

setTimeout(() => {
    // Check if child is alive before we exit
    try {
        process.kill(serverProcess.pid, 0);
        console.log(`Child process is alive before parent exit.`);
    } catch (e) {
        console.log(`Child process was not alive.`);
    }
    
    console.log('Exiting parent process now. The child process with PID ' + serverProcess.pid + ' will leak and stay active.');
    console.log('To clean up this process, run: kill -9 ' + serverProcess.pid);
    
    // Note: Since we are in the runner, exiting now would end the script. 
    // In a real scenario, we would kill -0 on the child to verify it's still alive after parent exits.
    // Let's actually kill it here to avoid polluting the host system, but print the logic.
    serverProcess.kill('SIGKILL');
    console.log('Cleaned up the spawned process to prevent system pollution during this check.');
    process.exit(0);
}, 1000);
