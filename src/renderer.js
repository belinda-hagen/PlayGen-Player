// ═══════════════════════════════════════════════════════════════════
// PlayGen — Renderer (App Logic, Player, Visualizer)
// ═══════════════════════════════════════════════════════════════════

(() => {
  'use strict';

  // ── State ───────────────────────────────────────────────────────
  const state = {
    songs: [],
    playlists: [],
    currentView: 'all',         // 'all' or playlist id
    currentSong: null,           // song object
    currentQueue: [],            // array of song objects (current play queue)
    currentQueueIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 'none',              // 'none', 'all', 'one'
    volume: 0.8,
    searchQuery: '',
    isDownloading: false,
    dragSongId: null
  };

  // ── Audio ───────────────────────────────────────────────────────
  const audio = new Audio();
  audio.volume = state.volume;
  let audioContext = null;
  let analyser = null;
  let audioSource = null;
  let animationFrameId = null;

  // ── DOM References ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    // Titlebar
    btnMinimize: $('#btn-minimize'),
    btnMaximize: $('#btn-maximize'),
    btnClose: $('#btn-close'),

    // Top bar
    urlInput: $('#url-input'),
    btnDownload: $('#btn-download'),
    searchInput: $('#search-input'),

    // Download progress
    downloadProgressContainer: $('#download-progress-container'),
    downloadProgressTitle: $('#download-progress-title'),
    downloadProgressPercent: $('#download-progress-percent'),
    downloadProgressFill: $('#download-progress-fill'),

    // Sidebar
    navAll: $('#nav-all'),
    playlistList: $('#playlist-list'),
    btnNewPlaylist: $('#btn-new-playlist'),
    btnOpenFolder: $('#btn-open-folder'),

    // Main area
    viewTitle: $('#view-title'),
    songCount: $('#song-count'),
    viewHeaderRight: $('#view-header-right'),
    songList: $('#song-list'),
    emptyState: $('#empty-state'),
    depsWarning: $('#deps-warning'),
    depsWarningText: $('#deps-warning-text'),

    // Player
    playerThumbnail: $('#player-thumbnail'),
    playerThumbImg: $('#player-thumb-img'),
    playerTitle: $('#player-title'),
    playerChannel: $('#player-channel'),
    visualizerCanvas: $('#visualizer-canvas'),
    btnShuffle: $('#btn-shuffle'),
    btnPrev: $('#btn-prev'),
    btnPlay: $('#btn-play'),
    playIcon: $('#play-icon'),
    btnNext: $('#btn-next'),
    btnRepeat: $('#btn-repeat'),
    timeCurrent: $('#time-current'),
    timeTotal: $('#time-total'),
    progressTrack: $('#progress-track'),
    progressFill: $('#progress-fill'),
    progressThumb: $('#progress-thumb'),
    btnVolumeIcon: $('#btn-volume-icon'),
    volumeIcon: $('#volume-icon'),
    volumeTrack: $('#volume-track'),
    volumeFill: $('#volume-fill'),
    volumeThumb: $('#volume-thumb'),

    // Context menu
    contextMenu: $('#context-menu'),
    contextMenuItems: $('#context-menu-items'),

    // Modal
    modalOverlay: $('#modal-overlay'),
    modalTitle: $('#modal-title'),
    modalInput: $('#modal-input'),
    modalCancel: $('#modal-cancel'),
    modalConfirm: $('#modal-confirm'),

    // Toast
    toastContainer: $('#toast-container')
  };

  // ── Utility ─────────────────────────────────────────────────────
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── Modal ───────────────────────────────────────────────────────
  let modalResolve = null;

  function showModal(title, placeholder = '', defaultValue = '', confirmText = 'CREATE') {
    return new Promise((resolve) => {
      modalResolve = resolve;
      dom.modalTitle.textContent = title;
      dom.modalInput.placeholder = placeholder;
      dom.modalInput.value = defaultValue;
      dom.modalConfirm.textContent = confirmText;
      dom.modalOverlay.classList.add('visible');
      setTimeout(() => dom.modalInput.focus(), 100);
    });
  }

  function hideModal(value = null) {
    dom.modalOverlay.classList.remove('visible');
    if (modalResolve) {
      modalResolve(value);
      modalResolve = null;
    }
  }

  dom.modalCancel.addEventListener('click', () => hideModal(null));
  dom.modalConfirm.addEventListener('click', () => hideModal(dom.modalInput.value.trim()));
  dom.modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hideModal(dom.modalInput.value.trim());
    if (e.key === 'Escape') hideModal(null);
  });
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) hideModal(null);
  });

  // ── Context Menu ────────────────────────────────────────────────
  function showContextMenu(x, y, items) {
    dom.contextMenuItems.innerHTML = '';
    items.forEach(item => {
      if (item.divider) {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        dom.contextMenuItems.appendChild(div);
        return;
      }

      if (item.submenu) {
        const wrapper = document.createElement('div');
        wrapper.className = 'context-menu-submenu';
        const trigger = document.createElement('div');
        trigger.className = 'context-menu-item';
        trigger.textContent = item.label + ' ▸';
        wrapper.appendChild(trigger);

        const sub = document.createElement('div');
        sub.className = 'context-menu-submenu-items';
        item.submenu.forEach(subItem => {
          const el = document.createElement('div');
          el.className = 'context-menu-item';
          el.textContent = subItem.label;
          el.addEventListener('click', () => { hideContextMenu(); subItem.action(); });
          sub.appendChild(el);
        });
        wrapper.appendChild(sub);
        dom.contextMenuItems.appendChild(wrapper);
        return;
      }

      const el = document.createElement('div');
      el.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
      el.textContent = item.label;
      el.addEventListener('click', () => { hideContextMenu(); item.action(); });
      dom.contextMenuItems.appendChild(el);
    });

    // Position
    dom.contextMenu.style.left = x + 'px';
    dom.contextMenu.style.top = y + 'px';
    dom.contextMenu.classList.add('visible');

    // Adjust if off-screen
    requestAnimationFrame(() => {
      const rect = dom.contextMenu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        dom.contextMenu.style.left = (x - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight) {
        dom.contextMenu.style.top = (y - rect.height) + 'px';
      }
    });
  }

  function hideContextMenu() {
    dom.contextMenu.classList.remove('visible');
  }

  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.song-item') && !e.target.closest('.nav-item[data-playlist-id]')) {
      hideContextMenu();
    }
  });

  // ── Initialize ──────────────────────────────────────────────────
  async function init() {
    // Check dependencies
    const deps = await window.api.checkDependencies();
    if (!deps.ytdlp || !deps.ffmpeg) {
      const missing = [];
      if (!deps.ytdlp) missing.push('yt-dlp');
      if (!deps.ffmpeg) missing.push('ffmpeg');
      dom.depsWarningText.textContent = `Missing: ${missing.join(', ')}. Please install ${missing.join(' and ')} to use PlayGen.`;
      dom.depsWarning.style.display = 'block';
    }

    // Load data
    state.songs = await window.api.getSongs();
    state.playlists = await window.api.getPlaylists();

    // Load session
    const session = await window.api.getSession();
    if (session) {
      state.volume = session.volume ?? 0.8;
      state.shuffle = session.shuffle ?? false;
      state.repeat = session.repeat ?? 'none';
      audio.volume = state.volume;
    }

    // Render
    renderSidebar();
    renderSongList();
    updatePlayerUI();
    updateVolumeUI();
    updateShuffleUI();
    updateRepeatUI();

    // Restore session
    if (session?.lastPlaylistId) {
      const pl = state.playlists.find(p => p.id === session.lastPlaylistId);
      if (pl) {
        state.currentView = pl.id;
        highlightActiveNav();
        renderSongList();
      }
    }
    if (session?.lastSongId) {
      const song = state.songs.find(s => s.id === session.lastSongId);
      if (song) {
        state.currentSong = song;
        updatePlayerSongInfo();
      }
    }

    // Download progress listener
    window.api.onDownloadProgress((data) => {
      dom.downloadProgressContainer.classList.add('active');
      dom.downloadProgressTitle.textContent = `Downloading: ${data.title}`;
      dom.downloadProgressPercent.textContent = `${Math.round(data.progress)}%`;
      dom.downloadProgressFill.style.width = `${data.progress}%`;
    });

    setupEventListeners();
  }

  // ── Render: Sidebar ─────────────────────────────────────────────
  function renderSidebar() {
    dom.playlistList.innerHTML = '';
    state.playlists.forEach(pl => {
      const item = document.createElement('div');
      item.className = `nav-item ${state.currentView === pl.id ? 'active' : ''}`;
      item.dataset.playlistId = pl.id;
      item.dataset.view = pl.id;
      item.draggable = false;

      // Drop zone for songs
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        item.classList.add('drag-over');
      });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const songId = e.dataTransfer.getData('text/song-id');
        if (songId) {
          await window.api.addToPlaylist(pl.id, songId);
          state.playlists = await window.api.getPlaylists();
          renderSidebar();
          if (state.currentView === pl.id) renderSongList();
          const song = state.songs.find(s => s.id === songId);
          showToast(`Added "${song?.title || 'song'}" to ${pl.name}`, 'success');
        }
      });

      item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
        <span class="playlist-name">${escapeHtml(pl.name)}</span>
        <span class="playlist-count">${pl.songs.length}</span>
      `;

      item.addEventListener('click', () => switchView(pl.id));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showPlaylistContextMenu(e.clientX, e.clientY, pl);
      });

      dom.playlistList.appendChild(item);
    });
  }

  function showPlaylistContextMenu(x, y, pl) {
    showContextMenu(x, y, [
      { label: '▶ Play All', action: () => playPlaylist(pl.id) },
      { divider: true },
      { label: '✎ Rename', action: () => renamePlaylist(pl) },
      { label: '✕ Delete', danger: true, action: () => deletePlaylist(pl) }
    ]);
  }

  function highlightActiveNav() {
    $$('.nav-item').forEach(n => n.classList.remove('active'));
    if (state.currentView === 'all') {
      dom.navAll.classList.add('active');
    } else {
      const el = $(`.nav-item[data-playlist-id="${state.currentView}"]`);
      if (el) el.classList.add('active');
    }
  }

  // ── Render: Song List ───────────────────────────────────────────
  function renderSongList() {
    let songs = [];
    let viewTitle = 'All Downloads';
    let isPlaylistView = false;

    if (state.currentView === 'all') {
      songs = state.songs;
    } else {
      const pl = state.playlists.find(p => p.id === state.currentView);
      if (pl) {
        viewTitle = pl.name;
        isPlaylistView = true;
        songs = pl.songs.map(id => state.songs.find(s => s.id === id)).filter(Boolean);
      }
    }

    // Apply search filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      songs = songs.filter(s =>
        s.title.toLowerCase().includes(q) ||
        (s.channel && s.channel.toLowerCase().includes(q))
      );
    }

    dom.viewTitle.textContent = viewTitle;
    dom.songCount.textContent = `${songs.length} song${songs.length !== 1 ? 's' : ''}`;

    // Play All button for playlists
    dom.viewHeaderRight.innerHTML = '';
    if (songs.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn-play-all';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <polygon points="5,3 19,12 5,21"/>
        </svg>
        <span>PLAY ALL</span>
      `;
      btn.addEventListener('click', () => {
        if (state.currentView === 'all') {
          playAllSongs();
        } else {
          playPlaylist(state.currentView);
        }
      });
      dom.viewHeaderRight.appendChild(btn);
    }

    // Show/hide empty state
    dom.songList.innerHTML = '';
    if (songs.length === 0 && !state.searchQuery) {
      dom.emptyState.classList.add('visible');
      dom.songList.style.display = 'none';
    } else {
      dom.emptyState.classList.remove('visible');
      dom.songList.style.display = '';

      songs.forEach((song, index) => {
        const item = createSongItem(song, index, isPlaylistView);
        dom.songList.appendChild(item);
      });
    }
  }

  function createSongItem(song, index, isPlaylistView) {
    const item = document.createElement('div');
    item.className = `song-item ${state.currentSong?.id === song.id ? 'playing' : ''}`;
    item.dataset.songId = song.id;
    item.draggable = true;

    item.innerHTML = `
      <div class="song-index">
        <span class="song-index-number">${index + 1}</span>
        <div class="song-playing-indicator">
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
        </div>
      </div>
      <div class="song-thumb">
        <img src="${escapeHtml(song.thumbnail)}" alt="" loading="lazy">
      </div>
      <div class="song-info">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-channel">${escapeHtml(song.channel || '')}</div>
      </div>
      <div class="song-duration">${formatTime(song.duration)}</div>
      <div class="song-actions">
        <button class="song-action-btn add-to-playlist" title="Add to playlist">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        ${isPlaylistView ? `
          <button class="song-action-btn remove-from-playlist" title="Remove from playlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        ` : ''}
        <button class="song-action-btn delete" title="Delete song">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    // Double-click to play
    item.addEventListener('dblclick', () => playSong(song));

    // Single click - select
    item.addEventListener('click', (e) => {
      if (e.target.closest('.song-action-btn')) return;
      // Just highlight for now
    });

    // Context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showSongContextMenu(e.clientX, e.clientY, song, isPlaylistView);
    });

    // Add to playlist button
    const addBtn = item.querySelector('.add-to-playlist');
    addBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = addBtn.getBoundingClientRect();
      showAddToPlaylistMenu(rect.left, rect.bottom, song.id);
    });

    // Remove from playlist button
    const removeBtn = item.querySelector('.remove-from-playlist');
    removeBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.removeFromPlaylist(state.currentView, song.id);
      state.playlists = await window.api.getPlaylists();
      renderSidebar();
      renderSongList();
      showToast('Removed from playlist', 'info');
    });

    // Delete button
    const deleteBtn = item.querySelector('.delete');
    deleteBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSong(song);
    });

    // Drag start
    item.addEventListener('dragstart', (e) => {
      state.dragSongId = song.id;
      e.dataTransfer.setData('text/song-id', song.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      state.dragSongId = null;
      $$('.drag-over-above, .drag-over-below').forEach(el => {
        el.classList.remove('drag-over-above', 'drag-over-below');
      });
    });

    // Drag over (for reordering within playlist)
    if (isPlaylistView) {
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        item.classList.remove('drag-over-above', 'drag-over-below');
        if (e.clientY < midY) {
          item.classList.add('drag-over-above');
        } else {
          item.classList.add('drag-over-below');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over-above', 'drag-over-below');
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/song-id');
        const targetId = song.id;
        item.classList.remove('drag-over-above', 'drag-over-below');

        if (draggedId && draggedId !== targetId) {
          const pl = state.playlists.find(p => p.id === state.currentView);
          if (pl) {
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midY;

            let songIds = [...pl.songs];
            // If dragged song is already in playlist, remove it first
            const fromIdx = songIds.indexOf(draggedId);
            if (fromIdx !== -1) songIds.splice(fromIdx, 1);

            // Insert at new position
            const targetIdx = songIds.indexOf(targetId);
            if (targetIdx !== -1) {
              songIds.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedId);
            } else {
              songIds.push(draggedId);
            }

            await window.api.reorderPlaylist(state.currentView, songIds);
            state.playlists = await window.api.getPlaylists();
            renderSongList();
          }
        }
      });
    }

    return item;
  }

  function showSongContextMenu(x, y, song, isPlaylistView) {
    const items = [
      { label: '▶ Play', action: () => playSong(song) },
      { divider: true }
    ];

    // Add to playlist submenu
    if (state.playlists.length > 0) {
      items.push({
        label: '+ Add to Playlist',
        submenu: state.playlists.map(pl => ({
          label: pl.name,
          action: async () => {
            await window.api.addToPlaylist(pl.id, song.id);
            state.playlists = await window.api.getPlaylists();
            renderSidebar();
            if (state.currentView === pl.id) renderSongList();
            showToast(`Added to "${pl.name}"`, 'success');
          }
        }))
      });
    }

    if (isPlaylistView) {
      items.push({
        label: '− Remove from Playlist',
        action: async () => {
          await window.api.removeFromPlaylist(state.currentView, song.id);
          state.playlists = await window.api.getPlaylists();
          renderSidebar();
          renderSongList();
          showToast('Removed from playlist', 'info');
        }
      });
    }

    items.push({ divider: true });
    items.push({
      label: '✕ Delete Song',
      danger: true,
      action: () => deleteSong(song)
    });

    showContextMenu(x, y, items);
  }

  function showAddToPlaylistMenu(x, y, songId) {
    if (state.playlists.length === 0) {
      showToast('Create a playlist first', 'info');
      return;
    }

    const items = state.playlists.map(pl => ({
      label: pl.name,
      action: async () => {
        await window.api.addToPlaylist(pl.id, songId);
        state.playlists = await window.api.getPlaylists();
        renderSidebar();
        if (state.currentView === pl.id) renderSongList();
        const song = state.songs.find(s => s.id === songId);
        showToast(`Added to "${pl.name}"`, 'success');
      }
    }));

    showContextMenu(x, y, items);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── View Switching ──────────────────────────────────────────────
  function switchView(viewId) {
    state.currentView = viewId;
    highlightActiveNav();
    renderSongList();
    saveSession();
  }

  // ── Download ────────────────────────────────────────────────────
  async function downloadVideo() {
    const url = dom.urlInput.value.trim();
    if (!url) {
      showToast('Please paste a YouTube URL', 'error');
      dom.urlInput.focus();
      return;
    }

    if (state.isDownloading) return;
    state.isDownloading = true;
    dom.btnDownload.classList.add('downloading');

    // Show progress
    dom.downloadProgressContainer.classList.add('active');
    dom.downloadProgressTitle.textContent = 'Starting download...';
    dom.downloadProgressPercent.textContent = '0%';
    dom.downloadProgressFill.style.width = '0%';

    try {
      const result = await window.api.downloadVideo(url);
      if (result.success) {
        dom.urlInput.value = '';
        state.songs = await window.api.getSongs();
        renderSongList();
        showToast(`Downloaded: ${result.song.title}`, 'success');
      } else {
        showToast(result.error || 'Download failed', 'error');
        console.error('Download failed:', result.error);
      }
    } catch (err) {
      showToast('Download error: ' + (err.message || err), 'error');
      console.error('Download exception:', err);
    } finally {
      state.isDownloading = false;
      dom.btnDownload.classList.remove('downloading');
      setTimeout(() => {
        dom.downloadProgressContainer.classList.remove('active');
      }, 1500);
    }
  }

  // ── Playlist Management ─────────────────────────────────────────
  async function createPlaylist() {
    const name = await showModal('NEW PLAYLIST', 'Enter playlist name...', '', 'CREATE');
    if (!name) return;
    await window.api.createPlaylist(name);
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    showToast(`Created playlist "${name}"`, 'success');
  }

  async function renamePlaylist(pl) {
    const name = await showModal('RENAME PLAYLIST', 'Enter new name...', pl.name, 'RENAME');
    if (!name) return;
    await window.api.renamePlaylist(pl.id, name);
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    if (state.currentView === pl.id) {
      dom.viewTitle.textContent = name;
    }
    showToast(`Renamed to "${name}"`, 'success');
  }

  async function deletePlaylist(pl) {
    await window.api.deletePlaylist(pl.id);
    state.playlists = await window.api.getPlaylists();
    if (state.currentView === pl.id) {
      state.currentView = 'all';
    }
    renderSidebar();
    highlightActiveNav();
    renderSongList();
    showToast(`Deleted playlist "${pl.name}"`, 'info');
  }

  async function deleteSong(song) {
    if (state.currentSong?.id === song.id) {
      audio.pause();
      state.currentSong = null;
      state.isPlaying = false;
      updatePlayerUI();
    }
    await window.api.deleteSong(song.id);
    state.songs = await window.api.getSongs();
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    renderSongList();
    showToast(`Deleted "${song.title}"`, 'info');
  }

  // ── Player ──────────────────────────────────────────────────────
  async function playSong(song) {
    const filePath = await window.api.getSongPath(song.id);
    if (!filePath) {
      showToast('Audio file not found', 'error');
      return;
    }

    state.currentSong = song;
    state.isPlaying = true;

    // Build queue from current view
    buildQueue();

    // Find index in queue
    state.currentQueueIndex = state.currentQueue.findIndex(s => s.id === song.id);

    audio.src = `file://${filePath}`;
    audio.play().catch(err => {
      console.error('Play error:', err);
      showToast('Failed to play audio', 'error');
    });

    updatePlayerUI();
    updatePlayerSongInfo();
    renderSongList(); // Update playing indicator
    initVisualizer();
    saveSession();
  }

  function buildQueue() {
    if (state.currentView === 'all') {
      state.currentQueue = [...state.songs];
    } else {
      const pl = state.playlists.find(p => p.id === state.currentView);
      if (pl) {
        state.currentQueue = pl.songs.map(id => state.songs.find(s => s.id === id)).filter(Boolean);
      } else {
        state.currentQueue = [...state.songs];
      }
    }

    if (state.shuffle) {
      // Shuffle but keep current song at current position
      const currentId = state.currentSong?.id;
      state.currentQueue = shuffleArray(state.currentQueue);
      if (currentId) {
        const idx = state.currentQueue.findIndex(s => s.id === currentId);
        if (idx > 0) {
          const [song] = state.currentQueue.splice(idx, 1);
          state.currentQueue.unshift(song);
        }
      }
    }
  }

  function shuffleArray(arr) {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function playAllSongs() {
    if (state.songs.length === 0) return;
    state.currentView = 'all';
    highlightActiveNav();
    renderSongList();
    playSong(state.songs[0]);
  }

  function playPlaylist(playlistId) {
    const pl = state.playlists.find(p => p.id === playlistId);
    if (!pl || pl.songs.length === 0) {
      showToast('Playlist is empty', 'info');
      return;
    }
    state.currentView = playlistId;
    highlightActiveNav();
    renderSongList();
    const firstSong = state.songs.find(s => s.id === pl.songs[0]);
    if (firstSong) playSong(firstSong);
  }

  function togglePlay() {
    if (!state.currentSong) return;
    if (state.isPlaying) {
      audio.pause();
      state.isPlaying = false;
    } else {
      audio.play();
      state.isPlaying = true;
    }
    updatePlayerUI();
  }

  function playNext() {
    if (state.currentQueue.length === 0) return;

    if (state.repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      return;
    }

    let nextIndex = state.currentQueueIndex + 1;
    if (nextIndex >= state.currentQueue.length) {
      if (state.repeat === 'all') {
        nextIndex = 0;
      } else {
        state.isPlaying = false;
        updatePlayerUI();
        return;
      }
    }

    const nextSong = state.currentQueue[nextIndex];
    if (nextSong) playSong(nextSong);
  }

  function playPrev() {
    if (state.currentQueue.length === 0) return;

    // If more than 3 seconds into song, restart it
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    let prevIndex = state.currentQueueIndex - 1;
    if (prevIndex < 0) {
      if (state.repeat === 'all') {
        prevIndex = state.currentQueue.length - 1;
      } else {
        audio.currentTime = 0;
        return;
      }
    }

    const prevSong = state.currentQueue[prevIndex];
    if (prevSong) playSong(prevSong);
  }

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    updateShuffleUI();
    if (state.currentQueue.length > 0) {
      buildQueue();
      if (state.currentSong) {
        state.currentQueueIndex = state.currentQueue.findIndex(s => s.id === state.currentSong.id);
      }
    }
    saveSession();
  }

  function toggleRepeat() {
    const modes = ['none', 'all', 'one'];
    const idx = modes.indexOf(state.repeat);
    state.repeat = modes[(idx + 1) % modes.length];
    updateRepeatUI();
    saveSession();
  }

  // ── Player UI Updates ───────────────────────────────────────────
  function updatePlayerUI() {
    // Play/Pause icon
    if (state.isPlaying) {
      dom.playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
      dom.playIcon.innerHTML = '<polygon points="5,3 19,12 5,21"/>';
    }
  }

  function updatePlayerSongInfo() {
    if (state.currentSong) {
      dom.playerTitle.textContent = state.currentSong.title;
      dom.playerChannel.textContent = state.currentSong.channel || '';
      dom.playerThumbImg.src = state.currentSong.thumbnail;
      dom.playerThumbImg.classList.add('visible');
      dom.playerThumbnail.classList.add('active');
    } else {
      dom.playerTitle.textContent = 'No song playing';
      dom.playerChannel.textContent = '';
      dom.playerThumbImg.classList.remove('visible');
      dom.playerThumbnail.classList.remove('active');
    }
  }

  function updateShuffleUI() {
    dom.btnShuffle.classList.toggle('active', state.shuffle);
  }

  function updateRepeatUI() {
    dom.btnRepeat.classList.toggle('active', state.repeat !== 'none');
    if (state.repeat === 'one') {
      dom.btnRepeat.title = 'Repeat: One';
      dom.btnRepeat.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          <text x="12" y="14" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="bold">1</text>
        </svg>
      `;
    } else {
      dom.btnRepeat.title = state.repeat === 'all' ? 'Repeat: All' : 'Repeat: Off';
      dom.btnRepeat.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      `;
    }
  }

  function updateVolumeUI() {
    const pct = state.volume * 100;
    dom.volumeFill.style.width = pct + '%';
    dom.volumeThumb.style.left = pct + '%';

    // Volume icon
    if (state.volume === 0) {
      dom.volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <line x1="23" y1="9" x2="17" y2="15" stroke-width="2"/>
        <line x1="17" y1="9" x2="23" y2="15" stroke-width="2"/>
      `;
    } else if (state.volume < 0.5) {
      dom.volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      `;
    } else {
      dom.volumeIcon.innerHTML = `
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      `;
    }
  }

  // ── Progress & Volume Sliders ───────────────────────────────────
  function setupProgressBar() {
    let isDragging = false;

    function updateProgress(e) {
      const rect = dom.progressTrack.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      dom.progressFill.style.width = (pct * 100) + '%';
      dom.progressThumb.style.left = (pct * 100) + '%';
      return pct;
    }

    dom.progressTrack.addEventListener('mousedown', (e) => {
      isDragging = true;
      const pct = updateProgress(e);
      if (audio.duration) {
        audio.currentTime = pct * audio.duration;
      }
      dom.progressThumb.style.opacity = '1';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const pct = updateProgress(e);
      if (audio.duration) {
        audio.currentTime = pct * audio.duration;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        dom.progressThumb.style.opacity = '';
      }
    });
  }

  function setupVolumeBar() {
    let isDragging = false;

    function updateVolume(e) {
      const rect = dom.volumeTrack.getBoundingClientRect();
      let pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      state.volume = pct;
      audio.volume = pct;
      updateVolumeUI();
      return pct;
    }

    dom.volumeTrack.addEventListener('mousedown', (e) => {
      isDragging = true;
      updateVolume(e);
      dom.volumeThumb.style.opacity = '1';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      updateVolume(e);
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        dom.volumeThumb.style.opacity = '';
        saveSession();
      }
    });
  }

  // ── Audio Events ────────────────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    dom.progressFill.style.width = pct + '%';
    dom.progressThumb.style.left = pct + '%';
    dom.timeCurrent.textContent = formatTime(audio.currentTime);
    dom.timeTotal.textContent = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    playNext();
  });

  audio.addEventListener('play', () => {
    state.isPlaying = true;
    updatePlayerUI();
  });

  audio.addEventListener('pause', () => {
    state.isPlaying = false;
    updatePlayerUI();
  });

  // ── Visualizer ──────────────────────────────────────────────────
  function initVisualizer() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;
      audioSource = audioContext.createMediaElementSource(audio);
      audioSource.connect(analyser);
      analyser.connect(audioContext.destination);
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    if (!animationFrameId) {
      drawVisualizer();
    }
  }

  function drawVisualizer() {
    const canvas = dom.visualizerCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    function draw() {
      animationFrameId = requestAnimationFrame(draw);

      if (!analyser || !state.isPlaying) {
        ctx.clearRect(0, 0, width, height);
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, width, height);

      // Draw bars from bottom
      const barCount = 12;
      const barWidth = width / barCount - 1;
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barHeight = value * height * 0.8;

        const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, 'rgba(192, 109, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(255, 107, 170, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 140, 66, 0.5)');

        ctx.fillStyle = gradient;
        ctx.fillRect(
          i * (barWidth + 1),
          height - barHeight,
          barWidth,
          barHeight
        );

        // Glow effect
        ctx.shadowColor = 'rgba(192, 109, 255, 0.3)';
        ctx.shadowBlur = 4;
      }

      ctx.shadowBlur = 0;
    }

    draw();
  }

  // ── Session ─────────────────────────────────────────────────────
  function saveSession() {
    window.api.saveSession({
      lastSongId: state.currentSong?.id || null,
      lastPlaylistId: state.currentView !== 'all' ? state.currentView : null,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat
    });
  }

  // ── Search ──────────────────────────────────────────────────────
  let searchTimeout = null;
  function onSearchInput(e) {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = e.target.value.trim();
      renderSongList();
    }, 200);
  }

  // ── Event Listeners ─────────────────────────────────────────────
  function setupEventListeners() {
    // Window controls
    dom.btnMinimize.addEventListener('click', () => window.api.minimize());
    dom.btnMaximize.addEventListener('click', () => window.api.maximize());
    dom.btnClose.addEventListener('click', () => window.api.close());

    // Download
    dom.btnDownload.addEventListener('click', downloadVideo);
    dom.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') downloadVideo();
    });

    // Search
    dom.searchInput.addEventListener('input', onSearchInput);

    // Navigation
    dom.navAll.addEventListener('click', () => switchView('all'));

    // New playlist
    dom.btnNewPlaylist.addEventListener('click', createPlaylist);

    // Open folder
    dom.btnOpenFolder.addEventListener('click', () => window.api.openDownloadsFolder());

    // Player controls
    dom.btnPlay.addEventListener('click', togglePlay);
    dom.btnNext.addEventListener('click', playNext);
    dom.btnPrev.addEventListener('click', playPrev);
    dom.btnShuffle.addEventListener('click', toggleShuffle);
    dom.btnRepeat.addEventListener('click', toggleRepeat);

    // Volume mute toggle
    let volumeBeforeMute = state.volume;
    dom.btnVolumeIcon.addEventListener('click', () => {
      if (state.volume > 0) {
        volumeBeforeMute = state.volume;
        state.volume = 0;
      } else {
        state.volume = volumeBeforeMute || 0.8;
      }
      audio.volume = state.volume;
      updateVolumeUI();
      saveSession();
    });

    // Progress & volume bars
    setupProgressBar();
    setupVolumeBar();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          if (e.ctrlKey) playNext();
          else if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) playPrev();
          else if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          state.volume = Math.min(1, state.volume + 0.05);
          audio.volume = state.volume;
          updateVolumeUI();
          break;
        case 'ArrowDown':
          e.preventDefault();
          state.volume = Math.max(0, state.volume - 0.05);
          audio.volume = state.volume;
          updateVolumeUI();
          break;
        case 'KeyS':
          toggleShuffle();
          break;
        case 'KeyR':
          toggleRepeat();
          break;
        case 'KeyF':
          if (e.ctrlKey) {
            e.preventDefault();
            dom.searchInput.focus();
          }
          break;
      }
    });

    // Paste URL shortcut - if nothing focused, paste into URL input
    document.addEventListener('paste', (e) => {
      if (document.activeElement.tagName !== 'INPUT') {
        const text = e.clipboardData.getData('text');
        if (text && (text.includes('youtube.com') || text.includes('youtu.be'))) {
          dom.urlInput.value = text;
          dom.urlInput.focus();
        }
      }
    });
  }

  // ── Start ───────────────────────────────────────────────────────
  init();
})();
