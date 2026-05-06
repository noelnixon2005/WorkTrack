# WorkTrack

WorkTrack is a local shift tracker for VIPeople and Scape. It runs a tiny local Node.js server on your computer and stores everything in a local SQLite database file.

## Quick start on Windows

1. Install [Node.js](https://nodejs.org/) if it is not already installed.
2. Double-click `start.bat`.
3. Your browser opens to `http://localhost:3000`.
4. Add or delete shifts normally. Every change is saved instantly to `worktrack.sqlite` in this folder.

## Manual start

```bash
npm install
npm start
```

The app creates these local-only files when it runs:

- `worktrack.sqlite`
- `worktrack.sqlite-shm`
- `worktrack.sqlite-wal`

Those files are ignored by Git because they are your personal saved data.
