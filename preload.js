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
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  getDownloadsPath: () => ipcRenderer.invoke('get-downloads-path'),
  openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),

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
  saveSession: (session) => ipcRenderer.invoke('save-session', session)
});
