const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp-worktrack-'));
const dbPath = path.join(tmpDir, 'test.sqlite');
const port = 4010 + Math.floor(Math.random() * 1000);
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), WORKTRACK_DB: dbPath, WT_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start in time.')), 5000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('WorkTrack is running')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('error', reject);
  });
});

test.after(() => {
  if (server) server.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('persists the user name and shifts through the API', async () => {
  const base = `http://localhost:${port}`;

  const nameResponse = await fetch(`${base}/api/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName: 'Noel' }),
  });
  assert.equal(nameResponse.status, 200);

  const shiftResponse = await fetch(`${base}/api/shifts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 12345, job: 'v', date: '2026-05-06', hrs: 8, level: 2 }),
  });
  assert.equal(shiftResponse.status, 201);

  const state = await fetch(`${base}/api/state`).then(res => res.json());
  assert.equal(state.userName, 'Noel');
  assert.deepEqual(state.shifts, [{ id: 12345, job: 'v', date: '2026-05-06', hrs: 8, level: 2 }]);

  const deleteResponse = await fetch(`${base}/api/shifts/12345`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 204);

  const updated = await fetch(`${base}/api/state`).then(res => res.json());
  assert.deepEqual(updated.shifts, []);
});
