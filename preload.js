const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Dependencies
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),

  // Downloads
  downloadVideo: (url) => ipcRenderer.invoke('download-video', url),
  downloadPlaylistUrl: (url) => ipcRenderer.invoke('download-playlist-url', url),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
  exportPlaylist: (playlistId) => ipcRenderer.invoke('export-playlist', { playlistId }),

  // Songs
  getSongs: () => ipcRenderer.invoke('get-songs'),
  deleteSong: (songId) => ipcRenderer.invoke('delete-song', songId),
  getSongPath: (songId) => ipcRenderer.invoke('get-song-path', songId),

  // Playlists
  getPlaylists: () => ipcRenderer.invoke('get-playlists'),
  createPlaylist: (name) => ipcRenderer.invoke('create-playlist', name),
  renamePlaylist: (playlistId, name) => ipcRenderer.invoke('rename-playlist', { playlistId, name }),
  deletePlaylist: (playlistId) => ipcRenderer.invoke('delete-playlist', playlistId),
  addToPlaylist: (playlistId, songId) => ipcRenderer.invoke('add-to-playlist', { playlistId, songId }),
  removeFromPlaylist: (playlistId, songId) => ipcRenderer.invoke('remove-from-playlist', { playlistId, songId }),
  reorderPlaylist: (playlistId, songIds) => ipcRenderer.invoke('reorder-playlist', { playlistId, songIds }),

  // Session
  getSession: () => ipcRenderer.invoke('get-session'),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Mini player
  sendMiniPlayerState: (data) => ipcRenderer.send('mini-player-state', data),
  onMiniPlayerCommand: (callback) => {
    ipcRenderer.on('mini-player-command', (event, command) => callback(command));
  },
  onRequestPlayerState: (callback) => {
    ipcRenderer.on('request-player-state', () => callback());
  }
});
