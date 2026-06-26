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
  return { songs: [], playlists: [], session: { lastSongId: null, lastPlaylistId: null, volume: 0.8, shuffle: false, repeat: 'none' }, settings: { miniPlayerOnMinimize: true, theme: 'rose' } };
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8');
}

let db = loadDB();

function normalizePlaylist(playlist) {
  if (typeof playlist.nextSongDelaySeconds !== 'number') {
    playlist.nextSongDelaySeconds = 0;
  }
  return playlist;
}

function normalizePlaylists() {
  db.playlists = (db.playlists || []).map(normalizePlaylist);
}

normalizePlaylists();

// Drop any songs whose underlying file no longer exists (e.g. deleted from the
// folder outside the app). Also strips them from playlists and cleans up
// orphaned cover art. Returns the removed song objects.
function pruneMissingSongs() {
  const removed = [];
  db.songs = (db.songs || []).filter(s => {
    if (fs.existsSync(s.filePath)) return true;
    removed.push(s);
    return false;
  });

  if (removed.length) {
    const removedIds = new Set(removed.map(s => s.id));
    db.playlists.forEach(p => {
      p.songs = (p.songs || []).filter(id => !removedIds.has(id));
    });
    removed.forEach(s => {
      if (s.coverPath) { try { fs.unlinkSync(s.coverPath); } catch { /* ignore */ } }
    });
    saveDB(db);
  }
  return removed;
}

// ── Check Dependencies & Resolve Paths ────────────────────────────
let ytdlpPath = 'yt-dlp';
let ffmpegPath = 'ffmpeg';

// Get the path to bundled binaries (works both in dev and production)
function getBundledBinPath(name) {
  // In production (asar), the app path is inside the asar, so we use resourcesPath
  // In development, we use __dirname
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', name);
  } else {
    return path.join(__dirname, 'assets', 'bin', name);
  }
}

function findExecutable(name) {
  // 1. Check bundled binaries first
  const bundledPath = getBundledBinPath(`${name}.exe`);
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  // 2. Check system PATH
  try {
    execSync(`where ${name}`, { stdio: 'ignore' });
    return name; // available on PATH
  } catch { /* not on PATH */ }

  // 3. Search common winget install locations
  const wingetPkgs = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(wingetPkgs)) {
    const found = findFileRecursive(wingetPkgs, `${name}.exe`, 3);
    if (found) return found;
  }

  // 4. Check common manual install paths
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
let miniPlayerWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'playgen-icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // Handle Ctrl+Arrow shortcuts at main process level (before Chromium's word navigation)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.alt && !input.meta && input.type === 'keyDown') {
      if (input.key === 'ArrowLeft') {
        event.preventDefault();
        mainWindow.webContents.send('shortcut-prev');
      } else if (input.key === 'ArrowRight') {
        event.preventDefault();
        mainWindow.webContents.send('shortcut-next');
      }
    }
  });

  // Mini-player on minimize
  mainWindow.on('minimize', () => {
    const settings = db.settings || { miniPlayerOnMinimize: true };
    console.log('[PlayGen] Window minimized, miniPlayerOnMinimize:', settings.miniPlayerOnMinimize);
    if (settings.miniPlayerOnMinimize !== false) {
      createMiniPlayer();
    }
  });

  mainWindow.on('restore', () => {
    destroyMiniPlayer();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    destroyMiniPlayer();
  });
}

// ── Mini Player ───────────────────────────────────────────────────
function createMiniPlayer() {
  if (miniPlayerWindow) return;
  console.log('[PlayGen] Creating mini player...');

  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  miniPlayerWindow = new BrowserWindow({
    width: 320,
    height: 80,
    x: width - 340,
    y: height - 100,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    hasShadow: true,
    roundedCorners: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets', 'playgen-icon.png')
  });

  miniPlayerWindow.loadFile(path.join(__dirname, 'src', 'mini-player.html'));
  miniPlayerWindow.setMenuBarVisibility(false);

  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null;
  });

  // Send current state after mini player loads
  miniPlayerWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('request-player-state');
  });
}

function destroyMiniPlayer() {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
  }
  miniPlayerWindow = null;
}

// ── Watch downloads folder for external changes ───────────────────
// If a file is deleted straight from the folder, prune it and tell the
// renderer to refresh so it disappears from the library/playlists.
let downloadsWatcher = null;
let watchDebounceTimer = null;

function startDownloadsWatcher() {
  if (downloadsWatcher) return;
  try {
    downloadsWatcher = fs.watch(downloadsPath, () => {
      clearTimeout(watchDebounceTimer);
      watchDebounceTimer = setTimeout(() => {
        const removed = pruneMissingSongs();
        if (removed.length && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('library-changed', { removedIds: removed.map(s => s.id) });
        }
      }, 400);
    });
    downloadsWatcher.on('error', (err) => console.error('[PlayGen] Downloads watcher error:', err));
  } catch (e) {
    console.error('[PlayGen] Failed to watch downloads folder:', e);
  }
}

function stopDownloadsWatcher() {
  if (watchDebounceTimer) { clearTimeout(watchDebounceTimer); watchDebounceTimer = null; }
  if (downloadsWatcher) { downloadsWatcher.close(); downloadsWatcher = null; }
}

app.whenReady().then(() => {
  createWindow();
  startDownloadsWatcher();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopDownloadsWatcher();
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
    const infoArgs = ['--dump-json', '--no-download', '--no-playlist', url];
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

// ── IPC: Download YouTube Playlist ────────────────────────────────
ipcMain.handle('download-playlist-url', async (event, url) => {
  // Validate playlist URL
  const plRegex = /^(https?:\/\/)?(www\.|music\.)?(youtube\.com\/(playlist\?list=|watch\?.*list=))/;
  if (!plRegex.test(url)) {
    return { success: false, error: 'Invalid YouTube playlist URL' };
  }

  // Extract playlist ID
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const listId = u.searchParams.get('list');
    if (!listId) return { success: false, error: 'No playlist ID found in URL' };
    url = `https://www.youtube.com/playlist?list=${listId}`;
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  console.log('[PlayGen] Playlist download requested:', url);

  return new Promise((resolve) => {
    // Step 1: Get playlist entries via --flat-playlist
    const infoArgs = ['--flat-playlist', '--dump-json', url];
    const infoProc = spawn(ytdlpPath, infoArgs, { windowsHide: true });
    let infoData = '';
    let infoError = '';

    infoProc.stdout.on('data', (data) => { infoData += data.toString(); });
    infoProc.stderr.on('data', (data) => { infoError += data.toString(); });

    infoProc.on('error', (err) => {
      return resolve({ success: false, error: `Failed to run yt-dlp: ${err.message}` });
    });

    infoProc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ success: false, error: infoError || 'Failed to get playlist info' });
      }

      // Each line is a JSON object for one video
      const entries = infoData.trim().split('\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      if (entries.length === 0) {
        return resolve({ success: false, error: 'Playlist is empty or could not be parsed' });
      }

      const videoUrls = entries.map(e => {
        // Prefer constructing from id for consistency
        if (e.id) return `https://www.youtube.com/watch?v=${e.id}`;
        if (e.url && e.url.startsWith('http')) return e.url;
        if (e.url) return `https://www.youtube.com/watch?v=${e.url}`;
        return null;
      }).filter(Boolean);

      const playlistTitle = entries[0]?.playlist_title || entries[0]?.playlist || 'YouTube Playlist';

      console.log(`[PlayGen] Found ${videoUrls.length} videos in playlist "${playlistTitle}"`);

      // Send playlist info back so renderer can download one by one
      resolve({
        success: true,
        playlistTitle,
        videoUrls,
        totalCount: videoUrls.length
      });
    });
  });
});

// ── IPC: Import local audio files (drag & drop) ───────────────────
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus', '.webm']);

// Run ffmpeg and capture stderr (ffmpeg writes media info there).
function runFfmpeg(args) {
  return new Promise((resolve) => {
    let stderr = '';
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', () => resolve({ code: -1, stderr }));
    proc.on('close', (code) => resolve({ code, stderr }));
  });
}

// Read duration + embedded title/artist tags from the file's ffmpeg banner.
// ffmpeg exits non-zero when no output file is given, but still prints the info.
async function probeMetadata(filePath) {
  const { stderr } = await runFfmpeg(['-i', filePath]);
  let duration = 0;
  const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dm) duration = (+dm[1]) * 3600 + (+dm[2]) * 60 + parseFloat(dm[3]);
  const tm = stderr.match(/^\s*title\s*:\s*(.+?)\s*$/im);
  const am = stderr.match(/^\s*(?:artist|album_artist)\s*:\s*(.+?)\s*$/im);
  return {
    duration: Math.round(duration),
    title: tm ? tm[1].trim() : null,
    artist: am ? am[1].trim() : null
  };
}

// Best-effort guess of "Artist - Title" from a file name when the file has no
// embedded tags. Handles a leading track number ("01 - ", "01. ") and the
// common " - " / " – " / " — " separator. Parentheses are left intact so real
// titles like "Song (Live)" survive.
function parseTitleArtistFromName(baseName) {
  let name = String(baseName || '').replace(/_/g, ' ').trim();
  name = name.replace(/^\s*\d{1,3}\s*[-.\s]\s*/, ''); // strip leading track number
  const m = name.match(/^(.*?)\s[-–—]\s(.*)$/);       // split on first separator
  if (m) {
    const artist = m[1].trim();
    const title = m[2].trim();
    if (artist && title) return { artist, title };
  }
  return { artist: null, title: name || baseName };
}

// Extract embedded cover art (if any) to a jpg. Returns true on success.
async function extractCover(filePath, coverPath) {
  const { code } = await runFfmpeg(['-i', filePath, '-an', '-frames:v', '1', '-y', coverPath]);
  if (code === 0 && fs.existsSync(coverPath) && fs.statSync(coverPath).size > 0) return true;
  try { if (fs.existsSync(coverPath)) fs.unlinkSync(coverPath); } catch { /* ignore */ }
  return false;
}

ipcMain.handle('import-local-files', async (event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { success: false, error: 'No files', imported: [], failed: [] };
  }

  const imported = [];
  const failed = [];

  for (const srcPath of filePaths) {
    try {
      if (!srcPath || !fs.existsSync(srcPath)) { failed.push({ srcPath, error: 'File not found' }); continue; }

      const ext = path.extname(srcPath).toLowerCase();
      if (!AUDIO_EXTS.has(ext)) { failed.push({ srcPath, error: 'Unsupported file type' }); continue; }

      const stat = fs.statSync(srcPath);
      const baseName = path.basename(srcPath, ext);

      // Dedup identical re-drops by original name + byte size.
      const importKey = `${path.basename(srcPath)}:${stat.size}`;
      if (db.songs.some(s => s.importKey === importKey)) { failed.push({ srcPath, error: 'Already imported' }); continue; }

      const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const destPath = path.join(downloadsPath, `${id}${ext}`);
      fs.copyFileSync(srcPath, destPath);

      const meta = await probeMetadata(destPath);
      const coverPath = path.join(downloadsPath, `${id}.jpg`);
      const hasCover = await extractCover(destPath, coverPath);

      // Prefer embedded tags; fall back to "Artist - Title" parsed from the
      // file name; finally fall back to the raw name / a placeholder artist.
      const guessed = parseTitleArtistFromName(baseName);

      const song = {
        id,
        title: meta.title || guessed.title || baseName,
        thumbnail: hasCover ? `file://${coverPath}` : '',
        coverPath: hasCover ? coverPath : null,
        duration: meta.duration || 0,
        channel: meta.artist || guessed.artist || 'Local file',
        filePath: destPath,
        source: 'local',
        importKey,
        dateAdded: new Date().toISOString()
      };

      db.songs.unshift(song);
      imported.push(song);
    } catch (err) {
      console.error('[PlayGen] Import failed for', srcPath, err);
      failed.push({ srcPath, error: err.message });
    }
  }

  if (imported.length) saveDB(db);
  return { success: true, imported, failed };
});

// ── IPC: Songs ────────────────────────────────────────────────────
ipcMain.handle('get-songs', () => {
  // Verify files still exist (also cleans playlists + orphan covers)
  pruneMissingSongs();
  return db.songs;
});

ipcMain.handle('delete-song', (event, songId) => {
  const song = db.songs.find(s => s.id === songId);
  if (song) {
    try { fs.unlinkSync(song.filePath); } catch (e) { /* ignore */ }
    if (song.coverPath) { try { fs.unlinkSync(song.coverPath); } catch (e) { /* ignore */ } }
    db.songs = db.songs.filter(s => s.id !== songId);
    // Remove from all playlists
    db.playlists.forEach(p => {
      p.songs = p.songs.filter(id => id !== songId);
    });
    saveDB(db);
  }
  return { success: true };
});

// Rename / edit a song's display info (title and/or artist). Only touches the
// database entry — the underlying audio file is left untouched.
ipcMain.handle('update-song', (event, payload = {}) => {
  const { songId } = payload;
  const updates = payload.updates || {};
  const song = db.songs.find(s => s.id === songId);
  if (!song) return { success: false, error: 'Song not found' };

  if (Object.prototype.hasOwnProperty.call(updates, 'title')) {
    const title = String(updates.title).trim();
    if (title) song.title = title; // never allow an empty title
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'channel')) {
    song.channel = String(updates.channel).trim();
  }

  saveDB(db);
  return { success: true, song };
});

// Find album art online from a song's title + artist via the free iTunes Search
// API (no key required). Done in the main process so there is no CORS issue.
// Downloads the best match to a fresh cover file and updates the song's thumbnail.
ipcMain.handle('fetch-cover-art', async (event, payload = {}) => {
  const { songId } = payload;
  const song = db.songs.find(s => s.id === songId);
  if (!song) return { success: false, error: 'Song not found' };

  const artist = (song.channel && song.channel !== 'Local file') ? song.channel : '';
  const term = `${artist} ${song.title}`.trim();
  if (!term) return { success: false, error: 'Need a title to search' };

  try {
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5`;
    const res = await fetch(searchUrl);
    if (!res.ok) return { success: false, error: `Lookup failed (${res.status})` };

    const data = await res.json();
    const hit = (data.results || []).find(r => r.artworkUrl100);
    if (!hit) return { success: false, error: 'No matching cover found' };

    // iTMS serves a small 100x100 thumb; bump the size segment up for a crisp cover.
    const artworkUrl = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    const imgRes = await fetch(artworkUrl);
    if (!imgRes.ok) return { success: false, error: 'Failed to download cover' };

    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (!buf.length) return { success: false, error: 'Empty cover image' };

    // Write to a new filename so the renderer's file:// URL changes and reloads.
    const newCoverPath = path.join(downloadsPath, `${song.id}-cov${Date.now().toString(36)}.jpg`);
    fs.writeFileSync(newCoverPath, buf);
    if (song.coverPath && song.coverPath !== newCoverPath) {
      try { fs.unlinkSync(song.coverPath); } catch { /* ignore */ }
    }

    song.coverPath = newCoverPath;
    song.thumbnail = `file://${newCoverPath}`;
    saveDB(db);

    return {
      success: true,
      song,
      matched: { artist: hit.artistName, track: hit.trackName, album: hit.collectionName }
    };
  } catch (err) {
    console.error('[PlayGen] Cover lookup failed:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-song-path', (event, songId) => {
  const song = db.songs.find(s => s.id === songId);
  if (song && fs.existsSync(song.filePath)) {
    return song.filePath;
  }
  return null;
});

// ── IPC: Playlists ────────────────────────────────────────────────
ipcMain.handle('get-playlists', () => {
  normalizePlaylists();
  saveDB(db);
  return db.playlists;
});

ipcMain.handle('create-playlist', (event, name) => {
  const playlist = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    name,
    songs: [],
    nextSongDelaySeconds: 0,
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

ipcMain.handle('update-playlist', (event, payload = {}) => {
  const { playlistId } = payload;
  let { updates } = payload;
  const pl = db.playlists.find(p => p.id === playlistId);
  if (pl) {
    updates = updates || {};

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      pl.name = String(updates.name);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'nextSongDelaySeconds')) {
      pl.nextSongDelaySeconds = Math.max(0, Number(updates.nextSongDelaySeconds) || 0);
    }

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

// ── IPC: Export playlist to folder ────────────────────────────────
ipcMain.handle('export-playlist', async (event, { playlistId }) => {
  const playlist = db.playlists.find(p => p.id === playlistId);
  if (!playlist) return { success: false, error: 'Playlist not found' };
  if (!playlist.songs || playlist.songs.length === 0) return { success: false, error: 'Playlist is empty' };

  // Let user pick a parent folder
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Export "${playlist.name}"`,
    properties: ['openDirectory'],
    buttonLabel: 'Export Here'
  });

  if (result.canceled || !result.filePaths[0]) return { success: false, error: 'Cancelled' };

  const exportDir = path.join(result.filePaths[0], playlist.name.replace(/[<>:"/\\|?*]/g, '_'));
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  let copied = 0;
  let failed = 0;

  for (const songId of playlist.songs) {
    const song = db.songs.find(s => s.id === songId);
    if (!song || !fs.existsSync(song.filePath)) { failed++; continue; }

    const safeName = song.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
    const destPath = path.join(exportDir, `${safeName}.mp3`);

    try {
      fs.copyFileSync(song.filePath, destPath);
      copied++;
    } catch (err) {
      console.error(`[PlayGen] Failed to copy ${song.title}:`, err.message);
      failed++;
    }
  }

  // Open the exported folder
  shell.openPath(exportDir);

  return { success: true, copied, failed, exportDir };
});

// ── IPC: Settings ─────────────────────────────────────────────────
ipcMain.handle('get-settings', () => {
  return { miniPlayerOnMinimize: true, theme: 'rose', ...(db.settings || {}) };
});

ipcMain.handle('save-settings', (event, settings) => {
  db.settings = { ...(db.settings || {}), ...settings };
  saveDB(db);
  return { success: true };
});

// ── IPC: Mini Player Communication ────────────────────────────────
// Renderer sends player state updates → forward to mini player
ipcMain.on('mini-player-state', (event, data) => {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('mini-player-update', data);
  }
});

// Mini player sends commands → forward to main renderer
ipcMain.on('mini-player-command', (event, command) => {
  if (command === 'restore') {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.restore();
      mainWindow.focus();
    }
    destroyMiniPlayer();
  } else if (command === 'close') {
    destroyMiniPlayer();
  } else {
    // Forward toggle-play, next, prev to the main renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mini-player-command', command);
    }
  }
});
