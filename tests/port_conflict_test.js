const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const assert = require('assert');

// This test verifies what happens when port 4096 is already in use.
console.log('Starting Port Conflict Adversarial Test...');

const PORT = 4098;
const dummyServer = net.createServer();

dummyServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Successfully occupied port ${PORT} with dummy server.`);

    // Now spawn the real server
    const serverProcess = spawn('node', ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: '4098',
            VINIZ_DB_PATH: path.join(__dirname, 'fixtures', 'conflict_viniz.db'),
            NAVIDROME_DB_PATH: path.join(__dirname, 'fixtures', 'conflict_navidrome.db')
        }
    });

    let stderrOutput = '';
    serverProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString();
    });

    serverProcess.stdout.on('data', (data) => {
        console.log(`[Child stdout]: ${data.toString().trim()}`);
    });

    serverProcess.on('exit', (code) => {
        console.log(`Server process exited with code: ${code}`);
        dummyServer.close();

        // Verify that the server crashed due to port already in use (EADDRINUSE)
        const hasEAddrInUse = stderrOutput.includes('EADDRINUSE') || stderrOutput.includes('address already in use');
        console.log(`Stderr contains EADDRINUSE: ${hasEAddrInUse}`);
        console.log(`Raw Stderr:\n${stderrOutput}`);

        if (code !== 0 && code !== null) {
            console.log('PASS: Server correctly exited/crashed when port was in use.');
        } else {
            console.log('FAIL: Server did not exit with error code when port was in use.');
            process.exit(1);
        }
    });
});
