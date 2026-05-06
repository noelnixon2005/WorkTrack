const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { exec } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const port = Number(process.env.PORT || 3000);
const dbPath = process.env.WORKTRACK_DB || path.join(__dirname, 'worktrack.sqlite');
const publicDir = path.join(__dirname, 'public');
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY,
    job TEXT NOT NULL CHECK (job IN ('v', 's')),
    date TEXT NOT NULL,
    hrs REAL NOT NULL CHECK (hrs > 0 AND hrs <= 24),
    level INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 4),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const getName = db.prepare("SELECT value FROM settings WHERE key = 'userName'");
const setName = db.prepare(`
  INSERT INTO settings (key, value) VALUES ('userName', ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const listShifts = db.prepare('SELECT id, job, date, hrs, level FROM shifts ORDER BY date DESC, id DESC');
const insertShift = db.prepare('INSERT INTO shifts (id, job, date, hrs, level) VALUES (?, ?, ?, ?, ?)');
const deleteShiftStmt = db.prepare('DELETE FROM shifts WHERE id = ?');

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function normalizeShift(input) {
  const job = input.job;
  const hrs = Number(input.hrs);
  const level = job === 'v' ? Number(input.level) : null;

  if (job !== 'v' && job !== 's') return { error: 'Job must be VIPeople or Scape.' };
  if (!isIsoDate(input.date)) return { error: 'Please choose a valid shift date.' };
  if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 24) return { error: 'Hours must be between 0.5 and 24.' };
  if (job === 'v' && (!Number.isInteger(level) || level < 1 || level > 4)) return { error: 'VIPeople pay level must be L1, L2, L3, or L4.' };

  return {
    shift: {
      id: Number.isSafeInteger(Number(input.id)) ? Number(input.id) : Date.now(),
      job,
      date: input.date,
      hrs,
      level,
    },
  };
}

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEmpty(res, statusCode) {
  res.writeHead(statusCode);
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body is too large.'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      resolve(JSON.parse(body));
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    sendEmpty(res, 403);
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendEmpty(res, 404);
      return;
    }

    const ext = path.extname(filePath);
    const contentType = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const nameRow = getName.get();
    sendJson(res, 200, {
      userName: nameRow ? nameRow.value : '',
      shifts: listShifts.all(),
    });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/name') {
    const body = await readBody(req);
    const userName = String(body.userName || '').trim().slice(0, 30);
    if (!userName) {
      sendJson(res, 400, { error: 'Name is required.' });
      return;
    }

    setName.run(userName);
    sendJson(res, 200, { userName });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shifts') {
    const body = await readBody(req);
    const result = normalizeShift(body);
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }

    const shift = result.shift;
    insertShift.run(shift.id, shift.job, shift.date, shift.hrs, shift.level);
    sendJson(res, 201, shift);
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/shifts\/(\d+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const info = deleteShiftStmt.run(Number(deleteMatch[1]));
    if (info.changes === 0) {
      sendJson(res, 404, { error: 'Shift not found.' });
      return;
    }

    sendEmpty(res, 204);
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(error => {
      sendJson(res, 500, { error: error.message });
    });
    return;
  }

  serveStatic(req, res);
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`WorkTrack is running at ${url}`);
  console.log(`SQLite database: ${dbPath}`);

  if (!process.env.WT_NO_OPEN) {
    const command = process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
    exec(command);
  }
});
