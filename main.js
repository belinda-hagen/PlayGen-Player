const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// ── Paths ──────────────────────────────────────────────────────────
const userDataPath = app.getPath('userData');
const downloadsPath = path.join(userDataPath, 'downloads');
const dbPath = path.join(userDataPath, 'playgen-db.json');

// Ensure directories exist
if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });

// ── Database ───────────────────────────────────────────────────────
function loadDB() {
  try {
    if (fs.existsSync(dbPath)) {
      return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load DB:', e);
  }
  return { songs: [], playlists: [], session: { lastSongId: null, lastPlaylistId: null, volume: 0.8, shuffle: false, repeat: 'none' } };
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

let db = loadDB();

// ── Check Dependencies & Resolve Paths ────────────────────────────
let ytdlpPath = 'yt-dlp';
let ffmpegPath = 'ffmpeg';

function findExecutable(name) {
  // 1. Check system PATH
  try {
    execSync(`where ${name}`, { stdio: 'ignore' });
    return name; // available on PATH
  } catch { /* not on PATH */ }

  // 2. Search common winget install locations
  const wingetPkgs = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetPkgs)) {
    const found = findFileRecursive(wingetPkgs, `${name}.exe`, 3);
    if (found) return found;
  }

  // 3. Check common manual install paths
  const commonPaths = [
    path.join(process.env.USERPROFILE || '', name + '.exe'),
    path.join(process.env.USERPROFILE || '', 'Downloads', name + '.exe'),
    path.join('C:\\', name, name + '.exe'),
    path.join('C:\\', name, 'bin', name + '.exe'),
    path.join(process.env.PROGRAMFILES || '', name, name + '.exe'),
    path.join(process.env.PROGRAMFILES || '', name, 'bin', name + '.exe'),
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

function findFileRecursive(dir, filename, maxDepth, depth = 0) {
  if (depth > maxDepth) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      if (entry.isDirectory() && depth < maxDepth) {
        const result = findFileRecursive(fullPath, filename, maxDepth, depth + 1);
        if (result) return result;
      }
    }
  } catch { /* permission errors etc */ }
  return null;
}

function resolveDependencies() {
  const yt = findExecutable('yt-dlp');
  const ff = findExecutable('ffmpeg');
  if (yt) ytdlpPath = yt;
  if (ff) ffmpegPath = ff;
  return { ytdlp: !!yt, ffmpeg: !!ff };
}

// Resolve on startup
const depsStatus = resolveDependencies();

// ── Window ─────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC: Window Controls ──────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── IPC: Check Dependencies ──────────────────────────────────────
ipcMain.handle('check-dependencies', async () => depsStatus);

// ── IPC: Get Paths ────────────────────────────────────────────────
ipcMain.handle('get-downloads-path', () => downloadsPath);

// ── IPC: Download ─────────────────────────────────────────────────
ipcMain.handle('download-video', async (event, url) => {
  // Validate URL — accept standard youtube links and music.youtube
  const ytRegex = /^(https?:\/\/)?(www\.|music\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/;
  if (!ytRegex.test(url)) {
    return { success: false, error: 'Invalid YouTube URL' };
  }

  // Clean URL — strip tracking params, keep only the core URL
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (u.hostname.includes('youtube.com') && u.searchParams.has('v')) {
      url = `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`;
    }
  } catch { /* keep original */ }

  console.log('[PlayGen] Download requested:', url);
  console.log('[PlayGen] yt-dlp path:', ytdlpPath);
  console.log('[PlayGen] ffmpeg path:', ffmpegPath);

  return new Promise((resolve) => {
    // Step 1: Get metadata
    const infoArgs = ['--dump-json', '--no-download', url];
    console.log('[PlayGen] Getting info:', ytdlpPath, infoArgs.join(' '));
    const infoProc = spawn(ytdlpPath, infoArgs, { windowsHide: true });
    let infoData = '';
    let infoError = '';

    infoProc.stdout.on('data', (data) => { infoData += data.toString(); });
    infoProc.stderr.on('data', (data) => { infoError += data.toString(); });

    infoProc.on('error', (err) => {
      console.error('[PlayGen] Info process error:', err);
      return resolve({ success: false, error: `Failed to run yt-dlp: ${err.message}` });
    });

    infoProc.on('close', (code) => {
      console.log('[PlayGen] Info process exited with code:', code);
      if (code !== 0) {
        console.error('[PlayGen] Info error:', infoError);
        return resolve({ success: false, error: infoError || 'Failed to get video info' });
      }

      let info;
      try {
        info = JSON.parse(infoData);
      } catch (e) {
        return resolve({ success: false, error: 'Failed to parse video info' });
      }

      const videoId = info.id;
      const title = info.title || 'Unknown';
      const thumbnail = info.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const duration = info.duration || 0;
      const channel = info.channel || info.uploader || 'Unknown';

      // Check if already downloaded
      const existing = db.songs.find(s => s.id === videoId);
      if (existing && fs.existsSync(existing.filePath)) {
        return resolve({ success: false, error: 'Song already downloaded' });
      }

      const outputPath = path.join(downloadsPath, `${videoId}.%(ext)s`);

      // Step 2: Download audio
      const ffmpegLocation = ffmpegPath !== 'ffmpeg' ? path.dirname(ffmpegPath) : null;
      const dlArgs = [
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', outputPath,
        '--no-playlist',
        '--newline',
      ];
      if (ffmpegLocation) {
        dlArgs.push('--ffmpeg-location', ffmpegLocation);
      }
      dlArgs.push(url);

      console.log('[PlayGen] Downloading:', ytdlpPath, dlArgs.join(' '));
      const dlProc = spawn(ytdlpPath, dlArgs, { windowsHide: true });

      let dlError = '';

      // yt-dlp outputs progress to BOTH stdout and stderr
      function handleOutput(data) {
        const str = data.toString();
        const match = str.match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow?.webContents.send('download-progress', {
            videoId,
            progress: parseFloat(match[1]),
            title
          });
        }
      }

      dlProc.stdout.on('data', handleOutput);
      dlProc.stderr.on('data', (data) => {
        const str = data.toString();
        dlError += str;
        handleOutput(data);
      });

      dlProc.on('error', (err) => {
        console.error('[PlayGen] Download process error:', err);
        return resolve({ success: false, error: `Failed to run yt-dlp: ${err.message}` });
      });

      dlProc.on('close', (dlCode) => {
        console.log('[PlayGen] Download process exited with code:', dlCode);
        const filePath = path.join(downloadsPath, `${videoId}.mp3`);
        console.log('[PlayGen] Expected file:', filePath, 'exists:', fs.existsSync(filePath));

        if (dlCode !== 0 || !fs.existsSync(filePath)) {
          console.error('[PlayGen] Download error output:', dlError);
          return resolve({ success: false, error: dlError || 'Download failed' });
        }

        // Save to database
        const song = {
          id: videoId,
          title,
          thumbnail,
          duration,
          channel,
          filePath,
          dateAdded: new Date().toISOString()
        };

        // Remove existing entry if re-downloading
        db.songs = db.songs.filter(s => s.id !== videoId);
        db.songs.unshift(song);
        saveDB(db);

        resolve({ success: true, song });
      });
    });
  });
});

// ── IPC: Songs ────────────────────────────────────────────────────
ipcMain.handle('get-songs', () => {
  // Verify files still exist
  db.songs = db.songs.filter(s => fs.existsSync(s.filePath));
  saveDB(db);
  return db.songs;
});

ipcMain.handle('delete-song', (event, songId) => {
  const song = db.songs.find(s => s.id === songId);
  if (song) {
    try { fs.unlinkSync(song.filePath); } catch (e) { /* ignore */ }
    db.songs = db.songs.filter(s => s.id !== songId);
    // Remove from all playlists
    db.playlists.forEach(p => {
      p.songs = p.songs.filter(id => id !== songId);
    });
    saveDB(db);
  }
  return { success: true };
});

ipcMain.handle('get-song-path', (event, songId) => {
  const song = db.songs.find(s => s.id === songId);
  if (song && fs.existsSync(song.filePath)) {
    return song.filePath;
  }
  return null;
});

// ── IPC: Playlists ────────────────────────────────────────────────
ipcMain.handle('get-playlists', () => db.playlists);

ipcMain.handle('create-playlist', (event, name) => {
  const playlist = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    name,
    songs: [],
    dateCreated: new Date().toISOString()
  };
  db.playlists.push(playlist);
  saveDB(db);
  return playlist;
});

ipcMain.handle('rename-playlist', (event, { playlistId, name }) => {
  const pl = db.playlists.find(p => p.id === playlistId);
  if (pl) {
    pl.name = name;
    saveDB(db);
  }
  return { success: true };
});

ipcMain.handle('delete-playlist', (event, playlistId) => {
  db.playlists = db.playlists.filter(p => p.id !== playlistId);
  saveDB(db);
  return { success: true };
});

ipcMain.handle('add-to-playlist', (event, { playlistId, songId }) => {
  const pl = db.playlists.find(p => p.id === playlistId);
  if (pl && !pl.songs.includes(songId)) {
    pl.songs.push(songId);
    saveDB(db);
  }
  return { success: true };
});

ipcMain.handle('remove-from-playlist', (event, { playlistId, songId }) => {
  const pl = db.playlists.find(p => p.id === playlistId);
  if (pl) {
    pl.songs = pl.songs.filter(id => id !== songId);
    saveDB(db);
  }
  return { success: true };
});

ipcMain.handle('reorder-playlist', (event, { playlistId, songIds }) => {
  const pl = db.playlists.find(p => p.id === playlistId);
  if (pl) {
    pl.songs = songIds;
    saveDB(db);
  }
  return { success: true };
});

// ── IPC: Session ──────────────────────────────────────────────────
ipcMain.handle('get-session', () => db.session);

ipcMain.handle('save-session', (event, session) => {
  db.session = { ...db.session, ...session };
  saveDB(db);
  return { success: true };
});

// ── IPC: Open folder ─────────────────────────────────────────────
ipcMain.handle('open-downloads-folder', () => {
  shell.openPath(downloadsPath);
});
