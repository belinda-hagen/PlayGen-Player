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
    playingFromView: null,       // view where current song playback started
    currentSong: null,           // song object
    currentQueue: [],            // array of song objects (current play queue)
    currentQueueIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 'none',              // 'none', 'all', 'one'
    volume: 0.8,
    searchQuery: '',
    isDownloading: false,
    cancelDownload: false,
    theme: 'rose',
    dragSongId: null,
    dragSongIds: null,            // all song ids being dragged (multi-select)
    selectedSongIds: new Set(),   // multi-selected songs in the current view
    lastSelectedSongId: null      // anchor for shift-range selection
  };

  const NEXT_DELAY_OPTIONS = [
    { value: 0, label: 'Instant' },
    { value: 1, label: '1 second' },
    { value: 2, label: '2 seconds' },
    { value: 3, label: '3 seconds' },
    { value: 5, label: '5 seconds' },
    { value: 10, label: '10 seconds' },
    { value: 30, label: '30 seconds' }
  ];

  const THEME_KEYS = new Set(['rose', 'ocean', 'ember', 'violet']);

  // ── Play transition guards ──────────────────────────────────────
  let _playId = 0;
  let _currentPlayId = 0;  // The playId that event handlers should respond to
  let _isTransitioning = false;
  let nextSongTimer = null;

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
    btnClearTrack: $('#btn-clear-track'),
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
    modalMedia: $('#modal-media'),
    modalEyebrow: $('#modal-eyebrow'),
    modalTitle: $('#modal-title'),
    modalMessage: $('#modal-message'),
    modalInput: $('#modal-input'),
    modalCancel: $('#modal-cancel'),
    modalConfirm: $('#modal-confirm'),

    // Edit track modal
    editTrackOverlay: $('#edit-track-overlay'),
    editTitleInput: $('#edit-title-input'),
    editArtistInput: $('#edit-artist-input'),
    editCancel: $('#edit-cancel'),
    editConfirm: $('#edit-confirm'),

    // Toast
    toastContainer: $('#toast-container'),

    // Settings
    btnSettings: $('#btn-settings'),
    settingsOverlay: $('#settings-overlay'),
    settingsClose: $('#settings-close'),
    settingMiniPlayer: $('#setting-mini-player'),
    settingThemeInputs: $$('input[name="setting-theme"]'),

    // Listen Together
    btnParty: $('#btn-party'),
    partyPill: $('#party-pill'),
    partyPillText: $('#party-pill-text'),
    partyOverlay: $('#party-overlay'),
    partyClose: $('#party-close'),
    partyHeading: $('#party-heading'),
    partyNameInput: $('#party-name-input'),
    partyRequireCode: $('#party-require-code'),
    btnPartyHost: $('#btn-party-host'),
    partyScanning: $('#party-scanning'),
    partyDiscoveredList: $('#party-discovered-list'),
    partyAddressInput: $('#party-address-input'),
    partyCodeInput: $('#party-code-input'),
    btnPartyJoin: $('#btn-party-join'),
    partyInviteAddress: $('#party-invite-address'),
    partyInviteCodeRow: $('#party-invite-code-row'),
    partyInviteCode: $('#party-invite-code'),
    btnPartyCopy: $('#btn-party-copy'),
    partyHostCount: $('#party-host-count'),
    partyListenerList: $('#party-listener-list'),
    partyGuestControl: $('#party-guest-control'),
    btnPartyEnd: $('#btn-party-end'),
    partyConnection: $('#party-connection'),
    partyGuestName: $('#party-guest-name'),
    partyGuestStatus: $('#party-guest-status'),
    partyGuestHint: $('#party-guest-hint'),
    partyGuestCount: $('#party-guest-count'),
    partyGuestListenerList: $('#party-guest-listener-list'),
    btnPartyLeave: $('#btn-party-leave'),

    // Sidebar
    sidebar: $('#sidebar'),
    btnToggleSidebar: $('#btn-toggle-sidebar'),

    // Loading screen
    loadingScreen: $('#loading-screen')
  };

  // Fallback cover for songs without artwork (e.g. imported local files).
  const THUMB_PLACEHOLDER = `
    <div class="song-thumb-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </div>
  `;

  // ── Utility ─────────────────────────────────────────────────────
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function normalizeDelay(value) {
    return Math.max(0, Number(value) || 0);
  }

  function normalizeTheme(theme) {
    return THEME_KEYS.has(theme) ? theme : 'rose';
  }

  function applyTheme(theme) {
    state.theme = normalizeTheme(theme);
    document.documentElement.dataset.theme = state.theme;
  }

  function getThemeValue(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function getDelayLabel(value) {
    const delay = normalizeDelay(value);
    return NEXT_DELAY_OPTIONS.find(option => option.value === delay)?.label || `${delay} seconds`;
  }

  function getToastIcon(icon, type) {
    const icons = {
      playlist: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
          <path d="M3 6h4"/>
        </svg>
      `,
      download: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 3v12"/>
          <path d="m7 10 5 5 5-5"/>
          <path d="M5 21h14"/>
        </svg>
      `,
      music: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      `,
      plus: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14"/>
          <path d="M5 12h14"/>
        </svg>
      `,
      edit: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 20h9"/>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
        </svg>
      `,
      trash: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18"/>
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
      `,
      clock: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 7v5l3 2"/>
        </svg>
      `,
      export: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-7l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z"/>
          <path d="M12 11v6"/>
          <path d="M9.5 13.5 12 11l2.5 2.5"/>
        </svg>
      `,
      link: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/>
          <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>
        </svg>
      `,
      error: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 7v6"/>
          <path d="M12 17h.01"/>
        </svg>
      `,
      info: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 11v5"/>
          <path d="M12 8h.01"/>
        </svg>
      `,
      success: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      `,
      image: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="9" cy="9" r="2"/>
          <path d="m21 15-4.35-4.35a2 2 0 0 0-2.83 0L3 21"/>
        </svg>
      `
    };

    if (icon && icons[icon]) return icons[icon];
    if (type === 'error') return icons.error;
    if (type === 'info') return icons.info;
    return icons.success;
  }

  function showToast(message, type = 'info') {
    // Normalize plain strings into the rich toast shape so every toast
    // uses the same card style as the "added to playlist" notification.
    const data = (typeof message === 'object' && message !== null)
      ? message
      : { title: message };
    const toastType = data.type || type;

    const toast = document.createElement('div');
    toast.className = `toast ${toastType} toast-rich`;
    toast.setAttribute('role', toastType === 'error' ? 'alert' : 'status');

    const media = document.createElement('div');
    media.className = 'toast-media';

    if (data.thumbnail) {
      const img = document.createElement('img');
      img.src = data.thumbnail;
      img.alt = '';
      img.onerror = () => {
        media.classList.add('icon-only');
        media.innerHTML = getToastIcon(data.icon, toastType);
      };
      media.appendChild(img);
    } else {
      media.classList.add('icon-only');
      media.innerHTML = getToastIcon(data.icon, toastType);
    }

    const content = document.createElement('div');
    content.className = 'toast-content';

    if (data.eyebrow) {
      const eyebrow = document.createElement('div');
      eyebrow.className = 'toast-eyebrow';
      eyebrow.textContent = data.eyebrow;
      content.appendChild(eyebrow);
    }

    const title = document.createElement('div');
    title.className = 'toast-title';
    title.textContent = data.title || '';
    content.appendChild(title);

    if (data.detail) {
      const detail = document.createElement('div');
      detail.className = 'toast-detail';
      detail.textContent = data.detail;
      content.appendChild(detail);
    }

    toast.append(media, content);

    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  function showPlaylistAddToast(song, playlist) {
    showToast({
      type: 'success',
      icon: 'playlist',
      eyebrow: 'Added to playlist',
      title: playlist?.name || 'Playlist',
      detail: song?.title || 'Song added',
      thumbnail: song?.thumbnail
    });
  }

  function showPlaylistRemoveToast(song, playlist) {
    showToast({
      type: 'info',
      icon: 'playlist',
      eyebrow: 'Removed from playlist',
      title: playlist?.name || 'Playlist',
      detail: song?.title || 'Song removed',
      thumbnail: song?.thumbnail
    });
  }

  function showDownloadToast(song) {
    showToast({
      type: 'success',
      icon: 'download',
      eyebrow: 'Download complete',
      title: song?.title || 'Song downloaded',
      detail: song?.channel || 'Ready in your library',
      thumbnail: song?.thumbnail
    });
  }

  // ── Modal ───────────────────────────────────────────────────────
  let modalResolve = null;

  function showModal(title, placeholder = '', defaultValue = '', confirmText = 'CREATE', altText = null, opts = {}) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      dom.modalTitle.textContent = title;

      // Toast-style card chrome: icon media + eyebrow (shown when provided)
      if (opts.icon) {
        dom.modalMedia.innerHTML = getToastIcon(opts.icon, 'info');
        dom.modalMedia.style.display = '';
      } else {
        dom.modalMedia.style.display = 'none';
      }

      if (opts.eyebrow) {
        dom.modalEyebrow.textContent = opts.eyebrow;
        dom.modalEyebrow.style.display = '';
      } else {
        dom.modalEyebrow.style.display = 'none';
      }

      // Choice mode (two action buttons, no input) vs input mode
      if (altText) {
        dom.modalInput.style.display = 'none';
        dom.modalConfirm.textContent = confirmText;

        // In choice mode the descriptive text is shown as the message body
        if (placeholder) {
          dom.modalMessage.textContent = placeholder;
          dom.modalMessage.style.display = '';
        } else {
          dom.modalMessage.style.display = 'none';
        }

        // Create alt button if not exists
        let altBtn = dom.modalOverlay.querySelector('.modal-btn-alt');
        if (!altBtn) {
          altBtn = document.createElement('button');
          altBtn.className = 'modal-btn modal-btn-cancel modal-btn-alt';
          dom.modalConfirm.parentElement.insertBefore(altBtn, dom.modalConfirm);
        }
        altBtn.textContent = altText;
        altBtn.style.display = '';
        altBtn.onclick = () => {
          altBtn.style.display = 'none';
          dom.modalInput.style.display = '';
          hideModal('single');
        };
        // Override confirm for choice mode
        dom.modalConfirm.onclick = () => {
          altBtn.style.display = 'none';
          dom.modalInput.style.display = '';
          hideModal('playlist');
        };
      } else {
        dom.modalMessage.style.display = 'none';
        dom.modalInput.style.display = '';
        dom.modalInput.placeholder = placeholder;
        dom.modalInput.value = defaultValue;
        dom.modalConfirm.textContent = confirmText;

        // Remove alt button if exists
        const altBtn = dom.modalOverlay.querySelector('.modal-btn-alt');
        if (altBtn) altBtn.style.display = 'none';

        // Reset confirm handler
        dom.modalConfirm.onclick = () => hideModal(dom.modalInput.value.trim());
      }

      dom.modalOverlay.classList.add('visible');
      if (!altText) setTimeout(() => dom.modalInput.focus(), 100);
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
  dom.modalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') hideModal(dom.modalInput.value.trim());
    if (e.key === 'Escape') hideModal(null);
  });
  dom.modalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.modalOverlay) hideModal(null);
  });

  // ── Edit Track Modal ────────────────────────────────────────────
  // Two-field dialog (Title + Artist). Resolves with { title, artist } on save
  // or null on cancel. Kept separate from showModal so its own Enter/Escape
  // handling doesn't collide with the single-field playlist modal.
  let editTrackResolve = null;

  function showEditTrackModal(song) {
    return new Promise((resolve) => {
      editTrackResolve = resolve;
      dom.editTitleInput.value = song.title || '';
      dom.editArtistInput.value = song.channel || '';
      dom.editTrackOverlay.classList.add('visible');
      setTimeout(() => { dom.editTitleInput.focus(); dom.editTitleInput.select(); }, 100);
    });
  }

  function closeEditTrackModal(value) {
    dom.editTrackOverlay.classList.remove('visible');
    if (editTrackResolve) { editTrackResolve(value); editTrackResolve = null; }
  }

  function commitEditTrack() {
    const title = dom.editTitleInput.value.trim();
    const artist = dom.editArtistInput.value.trim();
    if (!title) { dom.editTitleInput.focus(); return; } // title is required
    closeEditTrackModal({ title, artist });
  }

  dom.editConfirm.addEventListener('click', commitEditTrack);
  dom.editCancel.addEventListener('click', () => closeEditTrackModal(null));
  [dom.editTitleInput, dom.editArtistInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commitEditTrack();
      if (e.key === 'Escape') closeEditTrackModal(null);
    });
  });
  dom.editTrackOverlay.addEventListener('click', (e) => {
    if (e.target === dom.editTrackOverlay) closeEditTrackModal(null);
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

    // Load settings
    const settings = await window.api.getSettings();
    applyTheme(settings.theme);
    dom.partyNameInput.value = settings.displayName || '';

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
        buildQueue();
        state.currentQueueIndex = state.currentQueue.findIndex(s => s.id === song.id);
        const filePath = await window.api.getSongPath(song.id);
        if (filePath) {
          audio.src = `file://${filePath}`;
          audio.pause(); // Loaded but not playing
        }
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
    setupPartyListeners();

    // A party survives a renderer reload, so pick it back up if one is live.
    const partyStatus = await window.api.partyStatus();
    if (partyStatus?.hosting) {
      party.host = partyStatus.party;
      party.listeners = partyStatus.party.listeners || [];
      party.allowGuestControl = partyStatus.party.allowGuestControl;
      setPartyMode('host');
    } else {
      setPartyMode('off');
    }

    // Hide loading screen
    dom.loadingScreen.classList.add('hidden');
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

        // Files dropped from the OS: import them straight into this playlist.
        // Flag it so the bubbling window handler skips a second library import
        // (it still runs to reset the drag state).
        if (isFileDrag(e)) {
          _fileDropHandled = true;
          await importLocalFiles(getDroppedFilePaths(e.dataTransfer), pl.id);
          return;
        }

        const songIds = readSongIds(e.dataTransfer);
        if (songIds.length) {
          for (const id of songIds) {
            await window.api.addToPlaylist(pl.id, id);
          }
          clearSongSelection();
          state.playlists = await window.api.getPlaylists();
          renderSidebar();
          if (state.currentView === pl.id) renderSongList();
          if (songIds.length === 1) {
            showPlaylistAddToast(state.songs.find(s => s.id === songIds[0]), pl);
          } else {
            showToast({
              type: 'success',
              icon: 'playlist',
              eyebrow: 'Added to playlist',
              title: pl.name,
              detail: `${songIds.length} songs added`
            });
          }
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

  function showPlaylistDelayMenu(x, y, pl) {
    const currentDelay = normalizeDelay(pl.nextSongDelaySeconds);
    showContextMenu(x, y, NEXT_DELAY_OPTIONS.map(option => ({
      label: `${option.label}${option.value === currentDelay ? ' (current)' : ''}`,
      action: () => updatePlaylistDelay(pl, option.value)
    })));
  }

  function showPlaylistContextMenu(x, y, pl) {
    const currentDelay = normalizeDelay(pl.nextSongDelaySeconds);
    showContextMenu(x, y, [
      { label: 'Play All', action: () => playPlaylist(pl.id) },
      { divider: true },
      { label: 'Export to folder', action: () => exportPlaylist(pl) },
      {
        label: 'Next song delay',
        submenu: NEXT_DELAY_OPTIONS.map(option => ({
          label: `${option.label}${option.value === currentDelay ? ' (current)' : ''}`,
          action: () => updatePlaylistDelay(pl, option.value)
        }))
      },
      { label: 'Rename', action: () => renamePlaylist(pl) },
      { label: 'Delete', danger: true, action: () => deletePlaylist(pl) }
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

  // ── Hero Cover Color ────────────────────────────────────────────
  // Derive a colour gradient for the hero banner from the cover art so the
  // background "adjusts" with the music. Falls back to the brand colours when
  // a cover can't be read (e.g. no song, or a tainted/blocked image).
  const heroPaletteCache = new Map();
  let _heroColorUrl = null;
  let _heroColorToken = 0;

  function colorDistance(a, b) {
    return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  }

  function shade(c, factor) {
    return {
      r: Math.round(c.r * factor),
      g: Math.round(c.g * factor),
      b: Math.round(c.b * factor)
    };
  }

  function getCoverPalette(img) {
    const size = 56;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size); // throws if the canvas is tainted

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 125) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const sat = max === 0 ? 0 : (max - min) / max;
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      let bk = buckets.get(key);
      if (!bk) { bk = { r: 0, g: 0, b: 0, n: 0, score: 0 }; buckets.set(key, bk); }
      bk.r += r; bk.g += g; bk.b += b; bk.n++;
      // Favour saturated, mid-bright colours; downweight near-black/white
      const lumWeight = 1 - Math.min(1, Math.abs(lum - 0.5) * 1.6);
      bk.score += (0.1 + sat) * Math.max(0.08, lumWeight);
    }
    if (buckets.size === 0) return null;

    const colors = [...buckets.values()].map(bk => ({
      r: Math.round(bk.r / bk.n),
      g: Math.round(bk.g / bk.n),
      b: Math.round(bk.b / bk.n),
      score: bk.score
    })).sort((a, b) => b.score - a.score);

    const dominant = colors[0];
    const secondary = colors.find(c => colorDistance(c, dominant) > 70) || shade(dominant, 0.6);
    return { dominant, secondary };
  }

  function setHeroColorVars(hero, pal) {
    if (!hero) return;
    if (!pal) {
      hero.style.removeProperty('--hero-c1');
      hero.style.removeProperty('--hero-c2');
      return;
    }
    hero.style.setProperty('--hero-c1', `${pal.dominant.r}, ${pal.dominant.g}, ${pal.dominant.b}`);
    hero.style.setProperty('--hero-c2', `${pal.secondary.r}, ${pal.secondary.g}, ${pal.secondary.b}`);
  }

  function applyHeroColor(url) {
    const hero = document.getElementById('view-hero');
    if (!hero) return;
    if (url === _heroColorUrl) return; // already applied / in-flight for this cover
    _heroColorUrl = url || null;
    const token = ++_heroColorToken;

    if (!url) { setHeroColorVars(hero, null); return; }

    if (heroPaletteCache.has(url)) {
      setHeroColorVars(hero, heroPaletteCache.get(url));
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let pal = null;
      try { pal = getCoverPalette(img); } catch { pal = null; }
      heroPaletteCache.set(url, pal);
      if (token === _heroColorToken) setHeroColorVars(hero, pal);
    };
    img.onerror = () => {
      heroPaletteCache.set(url, null);
      if (token === _heroColorToken) setHeroColorVars(hero, null);
    };
    img.src = url;
  }

  // ── Render: Song List ───────────────────────────────────────────
  function renderSongList() {
    let songs = [];
    let viewTitle = 'All Downloads';
    let isPlaylistView = false;
    let currentPlaylist = null;

    if (state.currentView === 'all') {
      songs = state.songs;
    } else {
      const pl = state.playlists.find(p => p.id === state.currentView);
      if (pl) {
        currentPlaylist = pl;
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

    // Update hero banner
    const heroBg = document.getElementById('view-hero-bg');
    const heroThumb = document.getElementById('view-hero-thumb');
    const heroLabel = document.getElementById('view-hero-label');

    if (heroLabel) {
      heroLabel.textContent = isPlaylistView ? 'PLAYLIST' : 'LIBRARY';
    }

    // Use currently playing song if it's in this view, otherwise first song
    const playingSongInView = state.currentSong && songs.find(s => s.id === state.currentSong.id);
    const heroSong = playingSongInView || (songs.length > 0 ? songs[0] : null);
    if (heroBg) {
      heroBg.style.backgroundImage = heroSong && heroSong.thumbnail ? `url("${heroSong.thumbnail}")` : '';
    }
    applyHeroColor(heroSong && heroSong.thumbnail ? heroSong.thumbnail : null);
    if (heroThumb) {
      if (heroSong && heroSong.thumbnail) {
        heroThumb.innerHTML = `<img src="${escapeHtml(heroSong.thumbnail)}" alt="">`;
      } else {
        heroThumb.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
      }
    }

    // Header actions
    dom.viewHeaderRight.innerHTML = '';
    if (songs.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn-play-all';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <polygon points="5,3 19,12 5,21"/>
        </svg>
        <span>Play All</span>
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

    if (isPlaylistView && currentPlaylist) {
      const delayBtn = document.createElement('button');
      delayBtn.className = 'btn-playlist-delay';
      delayBtn.title = `Playlist delay: ${getDelayLabel(currentPlaylist.nextSongDelaySeconds)}`;
      delayBtn.setAttribute('aria-label', 'Playlist delay settings');
      delayBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="4" y1="7" x2="20" y2="7"/>
          <line x1="4" y1="17" x2="20" y2="17"/>
          <circle cx="9" cy="7" r="2"/>
          <circle cx="15" cy="17" r="2"/>
        </svg>
        <span>${getDelayLabel(currentPlaylist.nextSongDelaySeconds)}</span>
      `;
      delayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = delayBtn.getBoundingClientRect();
        showPlaylistDelayMenu(rect.left, rect.bottom + 8, currentPlaylist);
      });
      dom.viewHeaderRight.appendChild(delayBtn);
    }

    // Show/hide empty state & column header
    const colHeader = document.getElementById('song-list-header');
    dom.songList.innerHTML = '';
    if (songs.length === 0 && !state.searchQuery) {
      dom.emptyState.classList.add('visible');
      dom.songList.style.display = 'none';
      if (colHeader) colHeader.style.display = 'none';
    } else {
      dom.emptyState.classList.remove('visible');
      dom.songList.style.display = '';
      if (colHeader) colHeader.style.display = '';

      songs.forEach((song, index) => {
        const item = createSongItem(song, index, isPlaylistView);
        dom.songList.appendChild(item);
      });
    }
  }

  // ── Multi-select ────────────────────────────────────────────────
  // Song ids currently displayed, in visual order — drives shift-range
  // selection and keeps a multi-drag in the order the user sees.
  function getDisplayedSongIds() {
    return [...dom.songList.querySelectorAll('.song-item')].map(el => el.dataset.songId);
  }

  function updateSelectionUI() {
    dom.songList.querySelectorAll('.song-item').forEach(el => {
      el.classList.toggle('selected', state.selectedSongIds.has(el.dataset.songId));
    });
  }

  function clearSongSelection() {
    if (state.selectedSongIds.size === 0) return;
    state.selectedSongIds.clear();
    state.lastSelectedSongId = null;
    updateSelectionUI();
  }

  function toggleSongSelection(id) {
    if (state.selectedSongIds.has(id)) state.selectedSongIds.delete(id);
    else state.selectedSongIds.add(id);
    state.lastSelectedSongId = id;
    updateSelectionUI();
  }

  function selectSongRange(id) {
    const ids = getDisplayedSongIds();
    const anchor = (state.lastSelectedSongId && ids.includes(state.lastSelectedSongId))
      ? state.lastSelectedSongId
      : id;
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(id);
    if (a === -1 || b === -1) {
      state.selectedSongIds.add(id);
    } else {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) state.selectedSongIds.add(ids[i]);
    }
    state.lastSelectedSongId = id;
    updateSelectionUI();
  }

  // Read dragged song ids from a drop event (multi-select aware, with a
  // single-id fallback for older drag sources).
  function readSongIds(dataTransfer) {
    const multi = dataTransfer.getData('text/song-ids');
    if (multi) {
      try {
        const arr = JSON.parse(multi);
        if (Array.isArray(arr) && arr.length) return arr;
      } catch { /* fall through */ }
    }
    const single = dataTransfer.getData('text/song-id');
    return single ? [single] : [];
  }

  // A small "N songs" chip used as the drag image for a multi-song drag.
  function makeMultiDragImage(count) {
    const chip = document.createElement('div');
    chip.className = 'multi-drag-chip';
    chip.textContent = `${count} songs`;
    document.body.appendChild(chip);
    // Remove on the next tick — the browser snapshots it synchronously.
    setTimeout(() => chip.remove(), 0);
    return chip;
  }

  function createSongItem(song, index, isPlaylistView) {
    const item = document.createElement('div');
    // Only show 'playing' class if this is the view where playback started
    const isPlayingHere = state.currentSong?.id === song.id && state.playingFromView === state.currentView;
    item.className = `song-item ${isPlayingHere ? 'playing' : ''} ${state.selectedSongIds.has(song.id) ? 'selected' : ''}`;
    item.dataset.songId = song.id;
    item.draggable = true;

    item.innerHTML = `
      <div class="song-index">
        <span class="song-index-number">${index + 1}</span>
        <span class="song-hover-play">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5,3 19,12 5,21"/></svg>
        </span>
        <div class="song-playing-indicator">
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
          <div class="playing-bar"></div>
        </div>
      </div>
      <div class="song-thumb">
        ${song.thumbnail
          ? `<img src="${escapeHtml(song.thumbnail)}" alt="" loading="lazy">`
          : THUMB_PLACEHOLDER}
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
        ` : `
        <button class="song-action-btn delete" title="Delete song permanently">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
        `}
      </div>
    `;

    // Click to play, or Ctrl/Shift+click to build a multi-selection for dragging
    item.addEventListener('click', (e) => {
      if (e.target.closest('.song-action-btn')) return;
      if (e.ctrlKey || e.metaKey) {
        toggleSongSelection(song.id);
        return;
      }
      if (e.shiftKey) {
        selectSongRange(song.id);
        return;
      }
      clearSongSelection();
      playSong(song);
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
      const fromView = state.currentView;
      // Stop playback if we're removing the song that's currently playing from this playlist.
      const wasPlayingHere = state.currentSong?.id === song.id && state.playingFromView === fromView;
      await window.api.removeFromPlaylist(fromView, song.id);
      if (wasPlayingHere) stopCurrentPlayback();
      state.playlists = await window.api.getPlaylists();
      renderSidebar();
      renderSongList();
      showPlaylistRemoveToast(song, state.playlists.find(p => p.id === fromView));
    });

    // Delete button
    const deleteBtn = item.querySelector('.delete');
    deleteBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSong(song);
    });

    // Drag start
    item.addEventListener('dragstart', (e) => {
      // Dragging a song that's part of a multi-selection drags the whole set
      // (in display order). Dragging an unselected song drags just that one.
      let ids;
      if (state.selectedSongIds.has(song.id) && state.selectedSongIds.size > 1) {
        ids = getDisplayedSongIds().filter(id => state.selectedSongIds.has(id));
      } else {
        ids = [song.id];
      }

      state.dragSongId = song.id;
      state.dragSongIds = ids;
      e.dataTransfer.setData('text/song-id', song.id);     // primary / legacy
      e.dataTransfer.setData('text/song-ids', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'copyMove';

      if (ids.length > 1) {
        e.dataTransfer.setDragImage(makeMultiDragImage(ids.length), -12, -12);
        ids.forEach(id => {
          dom.songList.querySelector(`.song-item[data-song-id="${id}"]`)?.classList.add('dragging');
        });
      } else {
        item.classList.add('dragging');
      }
    });

    item.addEventListener('dragend', () => {
      state.dragSongId = null;
      state.dragSongIds = null;
      dom.songList.querySelectorAll('.song-item.dragging').forEach(el => el.classList.remove('dragging'));
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
        const draggedIds = readSongIds(e.dataTransfer);
        const targetId = song.id;
        item.classList.remove('drag-over-above', 'drag-over-below');

        if (draggedIds.length && !draggedIds.includes(targetId)) {
          const pl = state.playlists.find(p => p.id === state.currentView);
          if (pl) {
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            const insertBefore = e.clientY < midY;

            // Pull the dragged songs out, then re-insert the block at the target.
            let songIds = pl.songs.filter(id => !draggedIds.includes(id));
            const targetIdx = songIds.indexOf(targetId);
            if (targetIdx !== -1) {
              songIds.splice(insertBefore ? targetIdx : targetIdx + 1, 0, ...draggedIds);
            } else {
              songIds.push(...draggedIds);
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
      { label: 'Play', action: () => playSong(song) },
      { label: 'Edit info', action: () => editSong(song) },
      { label: 'Find cover art', action: () => fetchCoverArt(song) },
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
            showPlaylistAddToast(song, pl);
          }
        }))
      });
    }

    if (isPlaylistView) {
      items.push({
        label: '− Remove from Playlist',
        action: async () => {
          const fromView = state.currentView;
          // Stop playback if we're removing the song that's currently playing from this playlist.
          const wasPlayingHere = state.currentSong?.id === song.id && state.playingFromView === fromView;
          await window.api.removeFromPlaylist(fromView, song.id);
          if (wasPlayingHere) stopCurrentPlayback();
          state.playlists = await window.api.getPlaylists();
          renderSidebar();
          renderSongList();
          showPlaylistRemoveToast(song, state.playlists.find(p => p.id === fromView));
        }
      });
    } else {
      // Permanent delete is only available in the Downloads (All) view —
      // inside a playlist a song can only be removed from that playlist.
      items.push({ divider: true });
      items.push({
        label: 'Delete Song',
        danger: true,
        action: () => deleteSong(song)
      });
    }

    showContextMenu(x, y, items);
  }

  function showAddToPlaylistMenu(x, y, songId) {
    if (state.playlists.length === 0) {
      showToast({
        type: 'info',
        icon: 'playlist',
        eyebrow: 'No playlists yet',
        title: 'Create a playlist first',
        detail: 'Make a playlist to start adding songs.'
      });
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
        showPlaylistAddToast(song, pl);
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
    state.selectedSongIds.clear();
    state.lastSelectedSongId = null;
    highlightActiveNav();

    // Trigger view transition animation
    const mainArea = document.getElementById('main-area');
    mainArea.classList.remove('view-transition');
    void mainArea.offsetWidth; // force reflow to restart animation
    mainArea.classList.add('view-transition');

    renderSongList();
    saveSession();
  }

  // ── Download ────────────────────────────────────────────────────
  function isPlaylistUrl(url) {
    return /[?&]list=/.test(url) || /youtube\.com\/playlist/.test(url);
  }

  async function downloadVideo() {
    const url = dom.urlInput.value.trim();
    if (!url) {
      showToast({
        type: 'error',
        icon: 'link',
        eyebrow: 'Missing link',
        title: 'Paste a YouTube URL',
        detail: 'Add a link to start downloading.'
      });
      dom.urlInput.focus();
      return;
    }

    if (state.isDownloading) return;

    // If it's a playlist URL, ask the user what they want to do
    if (isPlaylistUrl(url)) {
      const choice = await showModal(
        'Download the whole playlist?',
        'This link contains a playlist. Download every song, or just this one?',
        '',
        'DOWNLOAD ALL',
        'SINGLE ONLY',
        { icon: 'playlist', eyebrow: 'Playlist detected' }
      );
      if (choice === 'playlist') {
        await downloadPlaylist(url);
        return;
      } else if (choice === 'single') {
        // Continue with single video download below
      } else {
        return; // Cancelled
      }
    }

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
        showDownloadToast(result.song);
      } else {
        showToast({
          type: 'error',
          icon: 'download',
          eyebrow: 'Download failed',
          title: 'Could not download',
          detail: result.error || 'Something went wrong.'
        });
        console.error('Download failed:', result.error);
      }
    } catch (err) {
      showToast({
        type: 'error',
        icon: 'download',
        eyebrow: 'Download error',
        title: 'Could not download',
        detail: err.message || String(err)
      });
      console.error('Download exception:', err);
    } finally {
      state.isDownloading = false;
      dom.btnDownload.classList.remove('downloading');
      setTimeout(() => {
        dom.downloadProgressContainer.classList.remove('active');
      }, 1500);
    }
  }

  async function downloadPlaylist(url) {
    state.isDownloading = true;
    state.cancelDownload = false;
    dom.btnDownload.classList.add('downloading');

    dom.downloadProgressContainer.classList.add('active');
    dom.downloadProgressTitle.textContent = 'Fetching playlist info...';
    dom.downloadProgressPercent.textContent = '';
    dom.downloadProgressFill.style.width = '0%';

    // Show cancel button
    let cancelBtn = dom.downloadProgressContainer.querySelector('.btn-cancel-download');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-cancel-download';
      cancelBtn.textContent = 'Cancel';
      dom.downloadProgressContainer.querySelector('.download-progress-info').appendChild(cancelBtn);
    }
    cancelBtn.style.display = '';
    cancelBtn.onclick = () => {
      state.cancelDownload = true;
      cancelBtn.textContent = 'Cancelling...';
      cancelBtn.style.pointerEvents = 'none';
    };

    try {
      const result = await window.api.downloadPlaylistUrl(url);
      if (!result.success) {
        showToast({
          type: 'error',
          icon: 'playlist',
          eyebrow: 'Playlist error',
          title: 'Could not fetch playlist',
          detail: result.error || 'Something went wrong.'
        });
        return;
      }

      const { videoUrls, playlistTitle, totalCount } = result;
      showToast({
        type: 'info',
        icon: 'download',
        eyebrow: 'Downloading playlist',
        title: playlistTitle || 'Playlist',
        detail: `${totalCount} songs queued`
      });
      dom.urlInput.value = '';

      let downloaded = 0;
      let skipped = 0;
      let failed = 0;

      for (let i = 0; i < videoUrls.length; i++) {
        if (state.cancelDownload) {
          showToast({
            type: 'info',
            icon: 'download',
            eyebrow: 'Download cancelled',
            title: playlistTitle || 'Playlist',
            detail: `${downloaded} songs downloaded`
          });
          break;
        }

        const videoUrl = videoUrls[i];
        const current = i + 1;

        dom.downloadProgressTitle.textContent = `Playlist: ${current} / ${totalCount}`;
        dom.downloadProgressPercent.textContent = `${Math.round((current / totalCount) * 100)}%`;
        dom.downloadProgressFill.style.width = `${(current / totalCount) * 100}%`;

        try {
          const dlResult = await window.api.downloadVideo(videoUrl);
          if (dlResult.success) {
            downloaded++;
          } else if (dlResult.error === 'Song already downloaded') {
            skipped++;
          } else {
            failed++;
            console.warn(`Failed to download ${videoUrl}:`, dlResult.error);
          }
        } catch (err) {
          failed++;
          console.error(`Error downloading ${videoUrl}:`, err);
        }

        // Refresh song list periodically
        if (downloaded % 3 === 0 || current === videoUrls.length) {
          state.songs = await window.api.getSongs();
          renderSongList();
        }

        // Small delay between downloads to avoid rate limiting
        if (i < videoUrls.length - 1 && !state.cancelDownload) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Final refresh
      state.songs = await window.api.getSongs();
      renderSongList();

      let summary = `${downloaded} downloaded`;
      if (skipped > 0) summary += `, ${skipped} skipped`;
      if (failed > 0) summary += `, ${failed} failed`;
      showToast({
        type: downloaded > 0 ? 'success' : 'info',
        icon: 'download',
        eyebrow: 'Playlist complete',
        title: playlistTitle || 'Playlist',
        detail: summary
      });

    } catch (err) {
      showToast({
        type: 'error',
        icon: 'download',
        eyebrow: 'Download error',
        title: 'Playlist download failed',
        detail: err.message || String(err)
      });
      console.error('Playlist download exception:', err);
    } finally {
      state.isDownloading = false;
      state.cancelDownload = false;
      dom.btnDownload.classList.remove('downloading');
      const cb = dom.downloadProgressContainer.querySelector('.btn-cancel-download');
      if (cb) cb.style.display = 'none';
      setTimeout(() => {
        dom.downloadProgressContainer.classList.remove('active');
      }, 2000);
    }
  }

  // ── Import local files (drag & drop) ────────────────────────────
  // Set by a playlist drop target so the bubbling window handler cleans up
  // the drag state but skips the duplicate library import.
  let _fileDropHandled = false;

  function isFileDrag(e) {
    // OS file drags expose a 'Files' type; internal song drags carry 'text/song-id'.
    return Array.from(e.dataTransfer?.types || []).includes('Files');
  }

  function getDroppedFilePaths(dataTransfer) {
    const paths = [];
    const files = dataTransfer?.files || [];
    for (let i = 0; i < files.length; i++) {
      // Electron exposes the absolute path on dropped File objects.
      if (files[i].path) paths.push(files[i].path);
    }
    return paths;
  }

  // Import dropped files into the library. When playlistId is given, the
  // imported songs are also added to that playlist.
  async function importLocalFiles(paths, playlistId = null) {
    if (!paths || paths.length === 0) return;

    dom.downloadProgressContainer.classList.add('active');
    dom.downloadProgressTitle.textContent = paths.length > 1
      ? `Importing ${paths.length} files…`
      : 'Importing file…';
    dom.downloadProgressPercent.textContent = '';
    dom.downloadProgressFill.style.width = '40%';

    try {
      const result = await window.api.importFiles(paths);
      const imported = result?.imported || [];
      const failed = result?.failed || [];

      if (imported.length > 0) {
        state.songs = await window.api.getSongs();

        if (playlistId) {
          // Add every freshly imported song to the target playlist.
          for (const song of imported) {
            await window.api.addToPlaylist(playlistId, song.id);
          }
          state.playlists = await window.api.getPlaylists();
          const targetPlaylist = state.playlists.find(p => p.id === playlistId);
          renderSidebar();
          // Reveal the playlist so the additions are visible.
          if (state.currentView === playlistId) {
            renderSongList();
          } else {
            switchView(playlistId);
          }

          showToast({
            type: 'success',
            icon: 'playlist',
            eyebrow: 'Added to playlist',
            title: targetPlaylist?.name || 'Playlist',
            detail: imported.length === 1 ? imported[0].title : `${imported.length} songs added`,
            thumbnail: imported.length === 1 ? (imported[0].thumbnail || undefined) : undefined
          });
        } else {
          // Surface the new tracks in the library so the import is visible.
          if (state.currentView !== 'all') {
            switchView('all');
          } else {
            renderSongList();
          }

          if (imported.length === 1) {
            showToast({
              type: 'success',
              icon: 'music',
              eyebrow: 'Imported',
              title: imported[0].title,
              detail: imported[0].channel || 'Added to your library',
              thumbnail: imported[0].thumbnail || undefined
            });
          } else {
            showToast({
              type: 'success',
              icon: 'music',
              eyebrow: 'Imported',
              title: `${imported.length} songs added`,
              detail: 'Added to your library'
            });
          }
        }
      }

      if (failed.length > 0) {
        if (imported.length === 0) {
          const single = failed.length === 1;
          showToast({
            type: 'error',
            icon: 'music',
            eyebrow: 'Import failed',
            title: single ? (failed[0].error || 'Could not import') : `${failed.length} files skipped`,
            detail: single ? (paths[0]?.split(/[\\/]/).pop()) : 'Unsupported or duplicate files'
          });
        } else {
          showToast({
            type: 'info',
            icon: 'music',
            eyebrow: 'Some files skipped',
            title: `${imported.length} imported, ${failed.length} skipped`,
            detail: 'Unsupported or duplicate files'
          });
        }
      }
    } catch (err) {
      showToast({
        type: 'error',
        icon: 'music',
        eyebrow: 'Import error',
        title: 'Could not import files',
        detail: err.message || String(err)
      });
      console.error('Import exception:', err);
    } finally {
      dom.downloadProgressFill.style.width = '100%';
      setTimeout(() => dom.downloadProgressContainer.classList.remove('active'), 1200);
    }
  }

  function setupFileDrop() {
    const overlay = document.getElementById('drop-overlay');
    let dragDepth = 0;

    function setDragActive(active) {
      // 'file-dragging' lifts the sidebar above the overlay so playlists
      // stay visible and usable as drop targets.
      document.body.classList.toggle('file-dragging', active);
      overlay?.classList.toggle('visible', active);
    }

    window.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      setDragActive(true);
    });

    window.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    });

    // Fallback: a file dropped anywhere except a playlist lands in the library.
    // Playlist drop targets handle their own drop and stop propagation.
    window.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      // A playlist target already imported these files — just reset and bail.
      if (_fileDropHandled) {
        _fileDropHandled = false;
        return;
      }
      importLocalFiles(getDroppedFilePaths(e.dataTransfer));
    });
  }

  // ── Playlist Management ─────────────────────────────────────────
  async function createPlaylist() {
    const name = await showModal('New Playlist', 'Enter playlist name...', '', 'Create');
    if (!name) return;
    await window.api.createPlaylist(name);
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    showToast({
      type: 'success',
      icon: 'plus',
      eyebrow: 'Playlist created',
      title: name,
      detail: 'Ready for songs'
    });
  }

  async function renamePlaylist(pl) {
    const name = await showModal('Rename Playlist', 'Enter new name...', pl.name, 'Rename');
    if (!name) return;
    await window.api.renamePlaylist(pl.id, name);
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    if (state.currentView === pl.id) {
      dom.viewTitle.textContent = name;
    }
    showToast({
      type: 'success',
      icon: 'edit',
      eyebrow: 'Playlist renamed',
      title: name
    });
  }

  async function updatePlaylistDelay(pl, delaySeconds) {
    const delay = normalizeDelay(delaySeconds);
    await window.api.updatePlaylist(pl.id, { nextSongDelaySeconds: delay });
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    if (state.currentView === pl.id) renderSongList();
    showToast({
      type: 'success',
      icon: 'clock',
      eyebrow: 'Delay updated',
      title: pl.name,
      detail: `Next song delay: ${getDelayLabel(delay)}`
    });
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
    showToast({
      type: 'info',
      icon: 'trash',
      eyebrow: 'Playlist deleted',
      title: pl.name
    });
  }

  async function editSong(song) {
    const result = await showEditTrackModal(song);
    if (!result) return;

    // No-op if nothing actually changed
    if (result.title === song.title && result.artist === (song.channel || '')) return;

    await window.api.updateSong(song.id, { title: result.title, channel: result.artist });
    state.songs = await window.api.getSongs();

    // Keep the now-playing bar (and mini player) in sync if this is the active track
    if (state.currentSong?.id === song.id) {
      state.currentSong.title = result.title;
      state.currentSong.channel = result.artist;
      updatePlayerSongInfo();
    }

    renderSongList();
    showToast({
      type: 'success',
      icon: 'edit',
      eyebrow: 'Track updated',
      title: result.title,
      detail: result.artist || undefined,
      thumbnail: song.thumbnail
    });

    // Now that the metadata is correct, auto-find album art for tracks that
    // don't have any yet. Silent on failure so a rename never nags the user.
    const updated = state.songs.find(s => s.id === song.id);
    if (updated && !updated.thumbnail) {
      fetchCoverArt(updated, { announce: false });
    }
  }

  // Look up album art online (iTunes Search API) from the track's title + artist
  // and apply it. `announce: false` keeps it quiet unless a cover is actually found.
  async function fetchCoverArt(song, { announce = true } = {}) {
    if (announce) {
      showToast({ type: 'info', icon: 'image', eyebrow: 'Searching…', title: `Finding cover for "${song.title}"` });
    }

    const res = await window.api.fetchCoverArt(song.id);
    if (!res?.success) {
      if (announce) {
        showToast({ type: 'info', icon: 'image', eyebrow: 'No cover found', title: song.title, detail: res?.error });
      }
      return false;
    }

    state.songs = await window.api.getSongs();
    if (state.currentSong?.id === song.id) {
      state.currentSong.thumbnail = res.song.thumbnail;
      state.currentSong.coverPath = res.song.coverPath;
      updatePlayerSongInfo();
    }
    renderSongList();

    showToast({
      type: 'success',
      icon: 'image',
      eyebrow: 'Cover added',
      title: song.title,
      detail: res.matched ? `${res.matched.artist} — ${res.matched.album}` : undefined,
      thumbnail: res.song.thumbnail
    });
    return true;
  }

  async function deleteSong(song) {
    if (state.currentSong?.id === song.id) {
      stopCurrentPlayback();
    }
    await window.api.deleteSong(song.id);
    state.songs = await window.api.getSongs();
    state.playlists = await window.api.getPlaylists();
    renderSidebar();
    renderSongList();
    showToast({
      type: 'info',
      icon: 'trash',
      eyebrow: 'Song deleted',
      title: song.title,
      thumbnail: song.thumbnail
    });
  }

  // ── Player ──────────────────────────────────────────────────────
  function clearNextSongTimer() {
    if (!nextSongTimer) return;
    clearTimeout(nextSongTimer);
    nextSongTimer = null;
  }

  function scheduleNextSong() {
    clearNextSongTimer();

    state.isPlaying = false;
    updatePlayerUI();
    dom.playerThumbnail.classList.add('paused');
    dom.btnPlay.classList.remove('is-playing');
    document.body.classList.remove('audio-playing');
    sendMiniPlayerState();
    broadcastPartyState(true);

    const delayMs = getActiveNextSongDelay() * 1000;
    if (delayMs === 0) {
      playNext();
      return;
    }

    nextSongTimer = setTimeout(() => {
      nextSongTimer = null;
      playNext();
    }, delayMs);
  }

  function getActiveNextSongDelay() {
    if (state.playingFromView && state.playingFromView !== 'all') {
      const pl = state.playlists.find(p => p.id === state.playingFromView);
      return normalizeDelay(pl?.nextSongDelaySeconds);
    }

    return 0;
  }

  // Fully stop playback and clear the now-playing state/UI.
  function stopCurrentPlayback() {
    clearNextSongTimer();
    audio.pause();
    state.currentSong = null;
    state.playingFromView = null;
    state.isPlaying = false;
    state.currentQueueIndex = -1;
    state.currentQueue = [];
    dom.playerThumbnail.classList.add('paused');
    dom.btnPlay.classList.remove('is-playing');
    document.body.classList.remove('audio-playing');
    updatePlayerUI();
    updatePlayerSongInfo();
    broadcastPartyState(true);
  }

  // Clear the now-playing track from the player bar entirely: stop playback,
  // reset the transport, drop the "Playing" marker in the list, and forget it
  // so it isn't restored on next launch.
  function clearCurrentTrack() {
    // A guest's track belongs to the party, not to them — leaving is the
    // only way to clear it, otherwise the sync loop and the UI disagree.
    if (isPartyGuest()) return;
    stopCurrentPlayback();
    audio.removeAttribute('src');
    audio.load();
    dom.progressFill.style.width = '0%';
    dom.progressThumb.style.left = '0%';
    dom.timeCurrent.textContent = '0:00';
    dom.timeTotal.textContent = '0:00';
    renderSongList();
    saveSession();
  }

  // Reload songs/playlists from disk and re-render. Used when the downloads
  // folder changes outside the app (e.g. a file deleted manually).
  async function refreshLibrary() {
    state.songs = await window.api.getSongs();
    state.playlists = await window.api.getPlaylists();
    // If the track sitting in the player no longer exists, clear it. A guest's
    // track lives in the host's library, so it is never ours to clear.
    if (!isPartyGuest() && state.currentSong && !state.songs.some(s => s.id === state.currentSong.id)) {
      clearCurrentTrack();
    }
    renderSidebar();
    renderSongList();
  }

  function playSong(song) {
    if (isPartyGuest()) {
      showToast({
        type: 'info',
        icon: 'info',
        eyebrow: 'Listening party',
        title: `${party.guest.hostName} picks the music`,
        detail: 'Leave the party to play your own library'
      });
      return;
    }

    clearNextSongTimer();

    const playId = ++_playId;
    _currentPlayId = playId;  // Event handlers will check this
    _isTransitioning = true;

    // Stop current audio immediately for responsive feel
    audio.pause();

    // Update state immediately — fully synchronous, no async gaps
    state.currentSong = song;
    state.isPlaying = true;
    state.playingFromView = state.currentView;  // Track which view started playback

    // Build queue from current view
    buildQueue();

    // Find index in queue
    state.currentQueueIndex = state.currentQueue.findIndex(s => s.id === song.id);

    // Update UI immediately for instant visual feedback
    updatePlayerUI();
    updatePlayerSongInfo();
    renderSongList();

    // Set player classes immediately (don't wait for audio 'play' event)
    dom.playerThumbnail.classList.remove('paused');
    dom.btnPlay.classList.add('is-playing');
    document.body.classList.add('audio-playing');

    // Use filePath directly from song object — no async IPC needed
    if (!song.filePath) {
      _isTransitioning = false;
      showToast({
        type: 'error',
        icon: 'music',
        eyebrow: 'Playback error',
        title: 'Audio file not found',
        detail: song?.title
      });
      state.currentSong = null;
      state.playingFromView = null;
      state.isPlaying = false;
      state.currentQueueIndex = -1;
      updatePlayerUI();
      updatePlayerSongInfo();
      renderSongList();
      dom.btnPlay.classList.remove('is-playing');
      document.body.classList.remove('audio-playing');
      return;
    }

    // A party stream may have left the element in cross-origin mode.
    audio.removeAttribute('crossorigin');
    audio.playbackRate = 1;
    audio.src = `file://${song.filePath}`;
    audio.play().catch(err => {
      if (playId !== _playId) return;
      _isTransitioning = false;
      console.error('Play error:', err);
      showToast({
        type: 'error',
        icon: 'music',
        eyebrow: 'Playback error',
        title: 'Failed to play audio',
        detail: song?.title
      });
    });

    initVisualizer();
    saveSession();
    broadcastPartyState(true);
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
      showToast({
        type: 'info',
        icon: 'playlist',
        eyebrow: 'Nothing to play',
        title: 'Playlist is empty',
        detail: pl?.name
      });
      return;
    }
    state.currentView = playlistId;
    highlightActiveNav();
    renderSongList();
    const firstSong = state.songs.find(s => s.id === pl.songs[0]);
    if (firstSong) playSong(firstSong);
  }

  function currentViewHasSong(song) {
    if (!song) return false;
    if (state.currentView === 'all') return state.songs.some(s => s.id === song.id);

    const pl = state.playlists.find(p => p.id === state.currentView);
    return Boolean(pl?.songs.includes(song.id));
  }

  async function exportPlaylist(pl) {
    showToast({
      type: 'info',
      icon: 'export',
      eyebrow: 'Exporting playlist',
      title: pl.name,
      detail: 'Copying songs…'
    });
    try {
      const result = await window.api.exportPlaylist(pl.id);
      if (!result.success) {
        if (result.error !== 'Cancelled') {
          showToast({
            type: 'error',
            icon: 'export',
            eyebrow: 'Export failed',
            title: pl.name,
            detail: result.error
          });
        }
        return;
      }
      let summary = `${result.copied} songs copied`;
      if (result.failed > 0) summary += `, ${result.failed} failed`;
      showToast({
        type: 'success',
        icon: 'export',
        eyebrow: 'Export complete',
        title: pl.name,
        detail: summary
      });
    } catch (err) {
      showToast({
        type: 'error',
        icon: 'export',
        eyebrow: 'Export failed',
        title: pl.name,
        detail: err.message || String(err)
      });
    }
  }

  function togglePlay() {
    if (isPartyGuest()) {
      partyGuestRequest('toggle');
      return;
    }

    if (nextSongTimer) {
      clearNextSongTimer();
      playNext();
      return;
    }

    // If no song loaded, start playing from the current view
    if (!state.currentSong) {
      if (state.currentView === 'all') {
        if (state.songs.length > 0) playAllSongs();
      } else {
        playPlaylist(state.currentView);
      }
      return;
    }
    if (state.isPlaying) {
      audio.pause();
      state.isPlaying = false;
      dom.playerThumbnail.classList.add('paused');
      dom.btnPlay.classList.remove('is-playing');
      document.body.classList.remove('audio-playing');
    } else {
      if (currentViewHasSong(state.currentSong)) {
        state.playingFromView = state.currentView;
      }
      audio.play();
      state.isPlaying = true;
      dom.playerThumbnail.classList.remove('paused');
      dom.btnPlay.classList.add('is-playing');
      document.body.classList.add('audio-playing');
    }
    updatePlayerUI();
    renderSongList();
    broadcastPartyState(true);
  }

  function playNext() {
    if (isPartyGuest()) {
      partyGuestRequest('next');
      return;
    }

    clearNextSongTimer();
    if (state.currentQueue.length === 0) return;

    if (state.repeat === 'one') {
      audio.currentTime = 0;
      audio.play();
      broadcastPartyState(true);
      return;
    }

    let nextIndex = state.currentQueueIndex + 1;
    if (nextIndex >= state.currentQueue.length) {
      // Wrap around to the first song
      nextIndex = 0;
    }

    const nextSong = state.currentQueue[nextIndex];
    if (nextSong) playSong(nextSong);
  }

  function playPrev() {
    if (isPartyGuest()) {
      partyGuestRequest('prev');
      return;
    }

    clearNextSongTimer();
    if (state.currentQueue.length === 0) return;

    // If more than 3 seconds into song, restart it
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      broadcastPartyState(true);
      return;
    }

    let prevIndex = state.currentQueueIndex - 1;
    if (prevIndex < 0) {
      if (state.repeat === 'all') {
        prevIndex = state.currentQueue.length - 1;
      } else {
        audio.currentTime = 0;
        broadcastPartyState(true);
        return;
      }
    }

    const prevSong = state.currentQueue[prevIndex];
    if (prevSong) playSong(prevSong);
  }

  function toggleShuffle() {
    if (isPartyGuest()) return;
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
    if (isPartyGuest()) return;
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
      if (state.currentSong.thumbnail) {
        dom.playerThumbImg.src = state.currentSong.thumbnail;
        dom.playerThumbImg.classList.add('visible');
      } else {
        dom.playerThumbImg.classList.remove('visible');
        dom.playerThumbImg.removeAttribute('src');
      }
      dom.playerThumbnail.classList.add('active');
      dom.btnClearTrack?.classList.add('visible');
    } else {
      dom.playerTitle.textContent = 'No song playing';
      dom.playerChannel.textContent = '';
      dom.playerThumbImg.classList.remove('visible');
      dom.playerThumbnail.classList.remove('active');
      dom.btnClearTrack?.classList.remove('visible');
    }
    sendMiniPlayerState();
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
      // A guest never scrubs their own copy — they ask the host to move.
      if (isPartyGuest()) {
        const pct = updateProgress(e);
        const duration = party.remote?.duration || audio.duration || 0;
        if (duration) partyGuestRequest('seek', pct * duration);
        return;
      }
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
        // Tell the party where we landed rather than waiting for the tick.
        broadcastPartyState(true);
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
    sendMiniPlayerState();
    broadcastPartyState();
  });

  audio.addEventListener('ended', () => {
    if (_isTransitioning) return;
    // In a party the host decides what comes next; a guest just waits.
    if (isPartyGuest()) return;
    scheduleNextSong();
  });

  audio.addEventListener('play', () => {
    // Ignore stale play events from previous song loads
    if (_playId !== _currentPlayId) return;
    _isTransitioning = false;
    state.isPlaying = true;
    updatePlayerUI();
    dom.playerThumbnail.classList.remove('paused');
    dom.btnPlay.classList.add('is-playing');
    document.body.classList.add('audio-playing');
    sendMiniPlayerState();
    broadcastPartyState(true);
  });

  audio.addEventListener('pause', () => {
    if (_isTransitioning) return;
    // A guest pausing is a sync correction, not a change to the party.
    if (isPartyGuest()) return;
    state.isPlaying = false;
    updatePlayerUI();
    dom.playerThumbnail.classList.add('paused');
    dom.btnPlay.classList.remove('is-playing');
    document.body.classList.remove('audio-playing');
    sendMiniPlayerState();
    broadcastPartyState(true);
  });

  audio.addEventListener('error', () => {
    if (_isTransitioning) _isTransitioning = false;
    // An empty src is how we tear a track down, not a failure.
    if (!audio.getAttribute('src')) return;
    state.isPlaying = false;
    updatePlayerUI();
    dom.btnPlay.classList.remove('is-playing');
    document.body.classList.remove('audio-playing');
    showToast({
      type: 'error',
      icon: 'music',
      eyebrow: 'Playback error',
      title: isPartyGuest() ? 'Lost the stream from the host' : 'Audio file not found or corrupted',
      detail: state.currentSong?.title
    });
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
      const visualizerBottom = getThemeValue('--visualizer-bottom', 'rgba(232, 63, 121, 0.9)');
      const visualizerMid = getThemeValue('--visualizer-mid', 'rgba(242, 85, 138, 0.68)');
      const visualizerTop = getThemeValue('--visualizer-top', 'rgba(255, 155, 188, 0.46)');
      const visualizerGlow = getThemeValue('--visualizer-glow', 'rgba(232, 63, 121, 0.28)');

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barHeight = value * height * 0.8;

        const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, visualizerBottom);
        gradient.addColorStop(0.62, visualizerMid);
        gradient.addColorStop(1, visualizerTop);

        ctx.shadowColor = visualizerGlow;
        ctx.shadowBlur = 3;
        ctx.fillStyle = gradient;
        ctx.fillRect(
          i * (barWidth + 1),
          height - barHeight,
          barWidth,
          barHeight
        );

      }

      ctx.shadowBlur = 0;
    }

    draw();
  }

  // ── Settings ────────────────────────────────────────────────────
  async function openSettings() {
    const settings = await window.api.getSettings();
    applyTheme(settings.theme);
    dom.settingMiniPlayer.checked = settings.miniPlayerOnMinimize ?? true;
    dom.settingThemeInputs.forEach(input => {
      input.checked = input.value === state.theme;
    });
    dom.settingsOverlay.classList.add('visible');
  }

  function closeSettings() {
    dom.settingsOverlay.classList.remove('visible');
  }

  // ── Mini Player State ───────────────────────────────────────────
  function sendMiniPlayerState() {
    if (!window.api.sendMiniPlayerState) return;
    window.api.sendMiniPlayerState({
      title: state.currentSong?.title || 'No song playing',
      channel: state.currentSong?.channel || '',
      thumbnail: state.currentSong?.thumbnail || '',
      isPlaying: state.isPlaying,
      progress: audio.duration ? (audio.currentTime / audio.duration) * 100 : 0,
      theme: state.theme
    });
  }

  // ── Session ─────────────────────────────────────────────────────
  function saveSession() {
    // A guest's now-playing track belongs to the host's library, not ours.
    if (isPartyGuest()) return;
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

  // ── Listen Together ─────────────────────────────────────────────
  // One person hosts: their app serves the audio and keeps broadcasting
  // where the playhead is. Everyone else streams from them and nudges
  // their own playback until it lines up.
  const party = {
    mode: 'off',            // 'off' | 'host' | 'guest'
    host: null,             // host: party info returned by the main process
    guest: null,            // guest: { base, listenerId, partyName, hostName }
    listeners: [],
    discovered: [],
    allowGuestControl: false,
    connected: false,
    remote: null,           // last state payload received from the host
    remoteAt: 0,            // performance.now() when that payload landed
    remoteSongId: null,     // host-side id of the track we currently have loaded
    source: null,           // EventSource
    syncTimer: null,
    browsing: false,
    lastBroadcast: 0,
    disconnectedAt: 0       // when the event stream dropped, for the give-up timer
  };

  const PARTY_BROADCAST_MS = 1000;   // how often the host reports its playhead
  const PARTY_SYNC_MS = 500;         // how often a guest checks its drift
  const PARTY_HARD_SEEK = 1.5;       // drift (s) big enough to justify jumping
  const PARTY_NUDGE = 0.15;          // drift (s) we smooth out via playback rate
  const PARTY_GIVE_UP_MS = 30000;    // how long we wait out a silent host

  function isPartyGuest() {
    return party.mode === 'guest';
  }

  // ── Host ──────────────────────────────────────────────────────
  function partyStatePayload() {
    const song = state.currentSong;
    const remoteCover = /^https?:/i.test(song?.thumbnail || '') ? song.thumbnail : null;
    return {
      song: song ? {
        id: song.id,
        title: song.title,
        channel: song.channel || '',
        duration: song.duration || (Number.isFinite(audio.duration) ? audio.duration : 0),
        remoteCover,
        hasCover: Boolean(song.coverPath) || Boolean(remoteCover)
      } : null,
      isPlaying: Boolean(state.isPlaying) && !audio.paused,
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : (song?.duration || 0),
      hostName: party.host?.hostName || ''
    };
  }

  // `immediate` skips the throttle — use it whenever the playhead jumps
  // rather than simply advances, so guests never chase a stale position.
  function broadcastPartyState(immediate = false) {
    if (party.mode !== 'host') return;
    const now = performance.now();
    if (!immediate && now - party.lastBroadcast < PARTY_BROADCAST_MS) return;
    party.lastBroadcast = now;
    window.api.partySendState(partyStatePayload());
  }

  async function startPartyHost() {
    const hostName = (dom.partyNameInput.value || '').trim() || 'Host';
    dom.btnPartyHost.disabled = true;

    try {
      const result = await window.api.partyStart({
        hostName,
        partyName: `${hostName}'s party`,
        requireCode: dom.partyRequireCode.checked,
        allowGuestControl: dom.partyGuestControl.checked,
        state: partyStatePayload()
      });

      if (!result.ok) {
        showToast({
          type: 'error',
          icon: 'error',
          eyebrow: 'Listen together',
          title: 'Could not start the party',
          detail: result.error
        });
        return;
      }

      window.api.saveSettings({ displayName: hostName });
      party.host = result.party;
      party.listeners = result.party.listeners || [];
      party.allowGuestControl = result.party.allowGuestControl;
      stopPartyBrowse();
      setPartyMode('host');
      broadcastPartyState(true);

      showToast({
        type: 'success',
        icon: 'success',
        eyebrow: 'Listen together',
        title: 'Your party is live',
        detail: `Friends can join at ${result.party.invite}`
      });
    } finally {
      dom.btnPartyHost.disabled = false;
    }
  }

  async function endPartyHost() {
    await window.api.partyStop();
    party.host = null;
    party.listeners = [];
    setPartyMode('off');
    startPartyBrowse();
    showToast({
      type: 'info',
      icon: 'info',
      eyebrow: 'Listen together',
      title: 'Party ended'
    });
  }

  // ── Guest ─────────────────────────────────────────────────────
  function partyCoverUrl(songPayload) {
    if (!songPayload) return '';
    if (songPayload.remoteCover) return songPayload.remoteCover;
    if (songPayload.hasCover && party.guest) {
      return `${party.guest.base}/api/track/${encodeURIComponent(songPayload.id)}/cover?t=${party.guest.listenerId}`;
    }
    return '';
  }

  // Accepts "192.168.1.42", "192.168.1.42:8420" or a pasted http URL.
  function parsePartyAddress(raw) {
    let text = String(raw || '').trim();
    if (!text) return null;
    text = text.replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
    const [address, portText] = text.split(':');
    if (!address) return null;
    const port = portText ? parseInt(portText, 10) : 8420;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { address, port };
  }

  async function joinParty({ address, port, code, partyName, hostName }) {
    const base = `http://${address}:${port}`;
    const name = (dom.partyNameInput.value || '').trim() || 'Listener';

    dom.btnPartyJoin.disabled = true;
    try {
      const response = await fetch(`${base}/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code: (code || '').trim() })
      });

      if (!response.ok) {
        const detail = response.status === 401
          ? 'That join code is not right'
          : (response.status === 503 ? 'That host is not running a party' : `Host replied ${response.status}`);
        showToast({ type: 'error', icon: 'error', eyebrow: 'Listen together', title: 'Could not join', detail });
        return;
      }

      const data = await response.json();
      window.api.saveSettings({ displayName: name });

      party.guest = {
        base,
        listenerId: data.listenerId,
        partyName: data.party?.name || partyName || 'Listening party',
        hostName: data.party?.hostName || hostName || 'Host'
      };
      party.listeners = data.listeners || [];
      party.remote = null;
      party.remoteSongId = null;
      party.connected = false;

      stopPartyBrowse();
      setPartyMode('guest');
      stopCurrentPlayback();
      openPartyStream();

      clearInterval(party.syncTimer);
      party.syncTimer = setInterval(syncGuestPlayback, PARTY_SYNC_MS);

      if (data.state) handlePartyState(data.state);

      showToast({
        type: 'success',
        icon: 'success',
        eyebrow: 'Listen together',
        title: `Joined ${party.guest.partyName}`,
        detail: `Hosted by ${party.guest.hostName}`
      });
    } catch (err) {
      showToast({
        type: 'error',
        icon: 'error',
        eyebrow: 'Listen together',
        title: 'Could not reach that host',
        detail: 'Check the address, and that you are both on the same network'
      });
    } finally {
      dom.btnPartyJoin.disabled = false;
    }
  }

  // Joining from the discovered list: the announcement tells us up front
  // whether a code is needed, so ask for it rather than failing the join.
  async function joinDiscoveredParty(found) {
    let code = (dom.partyCodeInput.value || '').trim();

    if (found.requiresCode && !code) {
      code = await showModal(
        found.name,
        'Join code',
        '',
        'JOIN',
        null,
        { icon: 'link', eyebrow: `Ask ${found.hostName} for the 4-digit code` }
      );
      if (!code) return;
    }

    joinParty({
      address: found.address,
      port: found.port,
      code,
      partyName: found.name,
      hostName: found.hostName
    });
  }

  function openPartyStream() {
    closePartyStream();
    const { base, listenerId } = party.guest;
    const source = new EventSource(`${base}/api/events?listener=${encodeURIComponent(listenerId)}`);
    party.source = source;

    source.addEventListener('open', () => {
      party.connected = true;
      renderPartyPanel();
      updatePartyPill();
    });

    source.addEventListener('state', (event) => {
      try {
        handlePartyState(JSON.parse(event.data));
      } catch { /* ignore a malformed frame */ }
    });

    source.addEventListener('listeners', (event) => {
      try {
        party.listeners = JSON.parse(event.data).listeners || [];
      } catch { /* ignore a malformed frame */ }
      renderPartyPanel();
      updatePartyPill();
    });

    source.addEventListener('closed', (event) => {
      let reason = 'ended';
      try { reason = JSON.parse(event.data).reason || reason; } catch { /* use default */ }
      partyDropped(reason);
    });

    source.addEventListener('error', () => {
      party.connected = false;
      // A CLOSED stream means the host refused us outright — the party is
      // over or we were removed. Anything else is a blip worth waiting out.
      if (source.readyState === EventSource.CLOSED) {
        partyDropped('lost');
        return;
      }
      if (!party.disconnectedAt) party.disconnectedAt = performance.now();
      if (!audio.paused) audio.pause();
      renderPartyPanel();
      updatePartyPill();
    });
  }

  function closePartyStream() {
    if (!party.source) return;
    try { party.source.close(); } catch { /* already closed */ }
    party.source = null;
  }

  function handlePartyState(payload) {
    if (party.mode !== 'guest') return;

    party.remote = payload;
    party.remoteAt = performance.now();
    party.connected = true;
    party.disconnectedAt = 0;
    party.allowGuestControl = Boolean(payload.allowGuestControl);
    document.body.classList.toggle('party-guest-locked', !party.allowGuestControl);

    state.isPlaying = Boolean(payload.isPlaying);
    updatePlayerUI();
    dom.playerThumbnail.classList.toggle('paused', !state.isPlaying);
    dom.btnPlay.classList.toggle('is-playing', state.isPlaying);
    document.body.classList.toggle('audio-playing', state.isPlaying);

    syncGuestPlayback();
    renderPartyPanel();
    updatePartyPill();
  }

  // Where the host's playhead should be *now*, extrapolated from the last
  // report. Latency on a LAN is small, so this lands within a few ms.
  function partyTargetPosition() {
    const remote = party.remote;
    if (!remote) return 0;
    const elapsed = remote.isPlaying ? (performance.now() - party.remoteAt) / 1000 : 0;
    const target = (remote.position || 0) + elapsed;
    return remote.duration ? Math.min(target, remote.duration) : target;
  }

  function syncGuestPlayback() {
    if (party.mode !== 'guest' || !party.guest) return;

    // EventSource retries a dropped connection forever. Give a host that is
    // simply gone a generous window, then stop pretending we are in a party.
    if (party.disconnectedAt && performance.now() - party.disconnectedAt > PARTY_GIVE_UP_MS) {
      partyDropped('lost');
      return;
    }

    const remote = party.remote;

    if (!remote || !remote.song) {
      if (!audio.paused) audio.pause();
      if (state.currentSong) clearPartyTrack();
      return;
    }

    if (remote.song.id !== party.remoteSongId) {
      loadPartyTrack(remote.song);
      return;
    }

    if (remote.isPlaying) {
      if (audio.paused && audio.readyState > 0) audio.play().catch(() => { /* still buffering */ });
    } else if (!audio.paused) {
      audio.pause();
      audio.playbackRate = 1;
    }

    if (!audio.duration || audio.readyState < 2) return;

    const drift = audio.currentTime - partyTargetPosition();
    if (Math.abs(drift) > PARTY_HARD_SEEK) {
      audio.currentTime = Math.max(0, Math.min(partyTargetPosition(), audio.duration - 0.05));
      audio.playbackRate = 1;
    } else if (remote.isPlaying && Math.abs(drift) > PARTY_NUDGE) {
      // Easing back is inaudible; a seek every few seconds is not.
      audio.playbackRate = drift > 0 ? 0.97 : 1.03;
    } else if (audio.playbackRate !== 1) {
      audio.playbackRate = 1;
    }
  }

  function loadPartyTrack(songPayload) {
    party.remoteSongId = songPayload.id;

    state.currentSong = {
      id: `party:${songPayload.id}`,
      title: songPayload.title || 'Unknown track',
      channel: songPayload.channel || '',
      duration: songPayload.duration || 0,
      thumbnail: partyCoverUrl(songPayload)
    };
    state.currentQueue = [];
    state.currentQueueIndex = -1;
    state.playingFromView = null;

    _currentPlayId = ++_playId;
    _isTransitioning = true;

    // The host sends permissive CORS headers, so an anonymous request keeps
    // the stream untainted — a tainted one would play back silent through the
    // visualizer's audio graph.
    audio.crossOrigin = 'anonymous';
    // Drift is corrected by easing the rate, which must not bend the pitch.
    audio.preservesPitch = true;
    audio.src = `${party.guest.base}/api/track/${encodeURIComponent(songPayload.id)}/audio?t=${party.guest.listenerId}`;
    audio.load();

    updatePlayerSongInfo();
    renderSongList();

    const onReady = () => {
      audio.removeEventListener('loadedmetadata', onReady);
      if (party.mode !== 'guest' || party.remoteSongId !== songPayload.id) return;
      _isTransitioning = false;
      try {
        audio.currentTime = Math.max(0, partyTargetPosition());
      } catch { /* the element rejected an early seek; the sync loop retries */ }
      if (party.remote?.isPlaying) audio.play().catch(() => { /* still buffering */ });
    };
    audio.addEventListener('loadedmetadata', onReady);

    initVisualizer();
  }

  // Drop whatever the party had loaded and hand the element back to the
  // local library in a clean state.
  function clearPartyTrack() {
    party.remoteSongId = null;
    _isTransitioning = false;
    state.currentSong = null;
    state.currentQueue = [];
    state.currentQueueIndex = -1;
    state.playingFromView = null;
    state.isPlaying = false;

    audio.pause();
    audio.playbackRate = 1;
    audio.removeAttribute('src');
    audio.removeAttribute('crossorigin');
    audio.load();

    dom.playerThumbnail.classList.add('paused');
    dom.btnPlay.classList.remove('is-playing');
    document.body.classList.remove('audio-playing');
    dom.progressFill.style.width = '0%';
    dom.progressThumb.style.left = '0%';
    dom.timeCurrent.textContent = '0:00';
    dom.timeTotal.textContent = '0:00';

    updatePlayerUI();
    updatePlayerSongInfo();
    renderSongList();
  }

  async function leaveParty({ notifyHost = true } = {}) {
    const guest = party.guest;

    closePartyStream();
    clearInterval(party.syncTimer);
    party.syncTimer = null;

    if (guest && notifyHost) {
      // Best effort: the host also prunes us when the event stream drops.
      fetch(`${guest.base}/api/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listenerId: guest.listenerId })
      }).catch(() => { /* host already gone */ });
    }

    party.guest = null;
    party.remote = null;
    party.listeners = [];
    party.connected = false;
    party.disconnectedAt = 0;
    document.body.classList.remove('party-guest-locked');

    clearPartyTrack();
    setPartyMode('off');
    startPartyBrowse();
  }

  function partyDropped(reason) {
    if (party.mode !== 'guest') return;
    const hostName = party.guest?.hostName || 'The host';
    leaveParty({ notifyHost: false });

    const messages = {
      removed: { title: 'You were removed from the party', detail: `${hostName} ended your session` },
      ended: { title: 'The party ended', detail: `${hostName} closed the party` },
      lost: { title: 'Disconnected from the party', detail: 'The host is no longer reachable' }
    };
    const message = messages[reason] || messages.lost;
    showToast({ type: 'info', icon: 'info', eyebrow: 'Listen together', ...message });
  }

  // Guests can ask the host to change the track when the host allows it.
  function partyGuestRequest(action, value = 0) {
    if (party.mode !== 'guest' || !party.guest) return;

    if (!party.allowGuestControl) {
      showToast({
        type: 'info',
        icon: 'info',
        eyebrow: 'Listening party',
        title: `${party.guest.hostName} is in charge of playback`,
        detail: 'Your volume is still your own'
      });
      return;
    }

    fetch(`${party.guest.base}/api/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listenerId: party.guest.listenerId, action, value })
    }).catch(() => { /* the sync loop will surface a real disconnect */ });
  }

  // ── Discovery ─────────────────────────────────────────────────
  // Only listen for announcements while the panel is actually open on the
  // "not in a party" view — there is nothing to show otherwise.
  async function startPartyBrowse() {
    if (party.browsing || party.mode !== 'off') return;
    if (!dom.partyOverlay.classList.contains('visible')) return;
    party.browsing = true;
    await window.api.partyBrowseStart();
  }

  async function stopPartyBrowse() {
    if (!party.browsing) return;
    party.browsing = false;
    party.discovered = [];
    await window.api.partyBrowseStop();
  }

  // ── Party UI ──────────────────────────────────────────────────
  function setPartyMode(mode) {
    party.mode = mode;
    dom.partyOverlay.setAttribute('data-party-mode', mode);
    dom.partyHeading.textContent = mode === 'host'
      ? 'Your listening party'
      : (mode === 'guest' ? 'Listening together' : 'Listen Together');
    if (mode !== 'guest') document.body.classList.remove('party-guest-locked');
    updatePartyPill();
    renderPartyPanel();
  }

  function updatePartyPill() {
    const inParty = party.mode !== 'off';
    document.body.classList.toggle('in-party', inParty);
    if (!inParty) return;

    if (party.mode === 'host') {
      const count = party.listeners.length;
      dom.partyPillText.textContent = count === 1 ? '1 listener' : `${count} listeners`;
      dom.partyPill.classList.remove('is-disconnected');
    } else {
      dom.partyPillText.textContent = party.connected
        ? (party.guest?.partyName || 'In a party')
        : 'Reconnecting…';
      dom.partyPill.classList.toggle('is-disconnected', !party.connected);
    }
  }

  function partyInitial(name) {
    return (String(name || '?').trim()[0] || '?').toUpperCase();
  }

  function partyRow({ name, sub, tag, action }) {
    const row = document.createElement('div');
    row.className = 'party-row';

    const avatar = document.createElement('div');
    avatar.className = 'party-row-avatar';
    avatar.textContent = partyInitial(name);
    row.appendChild(avatar);

    const text = document.createElement('div');
    text.className = 'party-row-text';
    const nameEl = document.createElement('span');
    nameEl.className = 'party-row-name';
    nameEl.textContent = name;
    text.appendChild(nameEl);
    if (sub) {
      const subEl = document.createElement('span');
      subEl.className = 'party-row-sub';
      subEl.textContent = sub;
      text.appendChild(subEl);
    }
    row.appendChild(text);

    if (tag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'party-row-tag';
      tagEl.textContent = tag;
      row.appendChild(tagEl);
    }

    if (action) {
      const button = document.createElement('button');
      button.className = 'party-row-action' + (action.danger ? ' is-danger' : '');
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      row.appendChild(button);
    }

    return row;
  }

  function renderPartyEmpty(container, message) {
    const empty = document.createElement('div');
    empty.className = 'party-empty';
    empty.textContent = message;
    container.appendChild(empty);
  }

  function renderPartyPanel() {
    // Discovered parties (only meaningful while we are not in one).
    const discoveredList = dom.partyDiscoveredList;
    discoveredList.innerHTML = '';
    if (!party.discovered.length) {
      renderPartyEmpty(discoveredList, party.browsing
        ? 'No parties found yet. Ask a friend to start one.'
        : 'Not scanning right now.');
    } else {
      party.discovered.forEach(found => {
        const count = found.listeners === 1 ? '1 listener' : `${found.listeners} listeners`;
        discoveredList.appendChild(partyRow({
          name: found.name,
          sub: `${found.hostName} · ${count}`,
          tag: found.requiresCode ? 'Code' : null,
          action: {
            label: 'Join',
            onClick: () => joinDiscoveredParty(found)
          }
        }));
      });
    }
    dom.partyScanning.style.display = party.browsing ? '' : 'none';

    // Host view.
    if (party.mode === 'host' && party.host) {
      dom.partyInviteAddress.textContent = party.host.invite;
      dom.partyInviteCodeRow.style.display = party.host.joinCode ? '' : 'none';
      dom.partyInviteCode.textContent = party.host.joinCode || '';
      dom.partyGuestControl.checked = party.allowGuestControl;
      dom.partyHostCount.textContent = String(party.listeners.length);

      const list = dom.partyListenerList;
      list.innerHTML = '';
      if (!party.listeners.length) {
        renderPartyEmpty(list, 'Nobody has joined yet. Share the address above.');
      } else {
        party.listeners.forEach(listener => {
          list.appendChild(partyRow({
            name: listener.name,
            sub: listener.connected ? 'Listening' : 'Connecting…',
            action: {
              label: 'Remove',
              danger: true,
              onClick: () => window.api.partyKick(listener.id)
            }
          }));
        });
      }
    }

    // Guest view.
    if (party.mode === 'guest' && party.guest) {
      dom.partyGuestName.textContent = party.guest.partyName;
      dom.partyGuestStatus.textContent = party.connected
        ? `Hosted by ${party.guest.hostName}`
        : 'Reconnecting to the host…';
      dom.partyConnection.classList.toggle('is-offline', !party.connected);
      dom.partyGuestHint.textContent = party.allowGuestControl
        ? 'The host has opened up the controls — play, pause and skip apply to everyone.'
        : 'The host controls what plays. Your volume stays your own.';
      dom.partyGuestCount.textContent = String(party.listeners.length);

      const list = dom.partyGuestListenerList;
      list.innerHTML = '';
      const rows = [{ id: '__host__', name: party.guest.hostName, host: true }, ...party.listeners];
      rows.forEach(listener => {
        list.appendChild(partyRow({
          name: listener.name,
          sub: listener.host ? 'Host' : (listener.connected === false ? 'Connecting…' : 'Listening'),
          tag: listener.id === party.guest.listenerId ? 'You' : null
        }));
      });
    }
  }

  function openPartyPanel() {
    dom.partyOverlay.classList.add('visible');
    if (party.mode === 'off') {
      startPartyBrowse();
      dom.partyNameInput.focus();
    }
    renderPartyPanel();
  }

  function closePartyPanel() {
    dom.partyOverlay.classList.remove('visible');
    stopPartyBrowse();
    renderPartyPanel();
  }

  function setupPartyListeners() {
    dom.btnParty.addEventListener('click', openPartyPanel);
    dom.partyPill.addEventListener('click', openPartyPanel);
    dom.partyClose.addEventListener('click', closePartyPanel);
    dom.partyOverlay.addEventListener('click', (e) => {
      if (e.target === dom.partyOverlay) closePartyPanel();
    });

    dom.btnPartyHost.addEventListener('click', startPartyHost);
    dom.btnPartyEnd.addEventListener('click', endPartyHost);
    dom.btnPartyLeave.addEventListener('click', () => leaveParty());

    dom.btnPartyJoin.addEventListener('click', () => {
      const parsed = parsePartyAddress(dom.partyAddressInput.value);
      if (!parsed) {
        showToast({
          type: 'error',
          icon: 'error',
          eyebrow: 'Listen together',
          title: 'That address does not look right',
          detail: 'Try something like 192.168.1.42:8420'
        });
        return;
      }
      joinParty({ ...parsed, code: dom.partyCodeInput.value });
    });

    dom.partyAddressInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.btnPartyJoin.click();
    });
    dom.partyCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') dom.btnPartyJoin.click();
    });

    dom.btnPartyCopy.addEventListener('click', async () => {
      if (!party.host) return;
      const invite = party.host.joinCode
        ? `${party.host.invite} (code ${party.host.joinCode})`
        : party.host.invite;
      try {
        await navigator.clipboard.writeText(invite);
        showToast({ type: 'success', icon: 'success', eyebrow: 'Listen together', title: 'Invite copied', detail: invite });
      } catch {
        showToast({ type: 'error', icon: 'error', eyebrow: 'Listen together', title: 'Could not copy the invite' });
      }
    });

    dom.partyGuestControl.addEventListener('change', async () => {
      const result = await window.api.partySetGuestControl(dom.partyGuestControl.checked);
      if (result?.ok) party.allowGuestControl = result.allowGuestControl;
      renderPartyPanel();
    });

    window.api.onPartyDiscovered(({ parties }) => {
      party.discovered = parties || [];
      renderPartyPanel();
    });

    window.api.onPartyListeners(({ listeners }) => {
      if (party.mode !== 'host') return;
      party.listeners = listeners || [];
      renderPartyPanel();
      updatePartyPill();
    });

    window.api.onPartyRequest(({ action, value, listener }) => {
      if (party.mode !== 'host') return;

      const labels = { toggle: 'changed play/pause', next: 'skipped to the next track', prev: 'went back a track', seek: 'jumped the playhead' };
      switch (action) {
        case 'toggle': togglePlay(); break;
        case 'next': playNext(); break;
        case 'prev': playPrev(); break;
        case 'seek':
          if (audio.duration) audio.currentTime = Math.max(0, Math.min(value, audio.duration));
          break;
      }
      broadcastPartyState(true);

      showToast({
        type: 'info',
        icon: 'music',
        eyebrow: 'Listening party',
        title: listener.name,
        detail: labels[action] || 'changed playback'
      });
    });
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

    // Settings
    dom.btnSettings.addEventListener('click', openSettings);
    dom.settingsClose.addEventListener('click', closeSettings);
    dom.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === dom.settingsOverlay) closeSettings();
    });
    dom.settingMiniPlayer.addEventListener('change', () => {
      window.api.saveSettings({ miniPlayerOnMinimize: dom.settingMiniPlayer.checked });
    });
    dom.settingThemeInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        applyTheme(input.value);
        window.api.saveSettings({ theme: state.theme });
        sendMiniPlayerState();
      });
    });
    // Sidebar toggle
    dom.btnToggleSidebar.addEventListener('click', () => {
      dom.sidebar.classList.toggle('collapsed');
      // Save preference
      const isCollapsed = dom.sidebar.classList.contains('collapsed');
      localStorage.setItem('sidebarCollapsed', isCollapsed);
    });

    // Restore sidebar state
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      dom.sidebar.classList.add('collapsed');
    }

    // Mini player command handling
    window.api.onMiniPlayerCommand((command) => {
      switch (command) {
        case 'toggle-play': togglePlay(); break;
        case 'next': playNext(); break;
        case 'prev': playPrev(); break;
      }
    });

    // When mini player requests current state
    window.api.onRequestPlayerState(() => {
      sendMiniPlayerState();
    });

    // Keyboard shortcuts from main process (Ctrl+Arrow)
    window.api.onShortcutPrev(() => {
      playPrev();
    });
    window.api.onShortcutNext(() => {
      playNext();
    });

    // Player controls
    dom.btnPlay.addEventListener('click', togglePlay);
    dom.btnNext.addEventListener('click', playNext);
    dom.btnPrev.addEventListener('click', playPrev);
    dom.btnShuffle.addEventListener('click', toggleShuffle);
    dom.btnRepeat.addEventListener('click', toggleRepeat);
    dom.btnClearTrack.addEventListener('click', clearCurrentTrack);

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

    // Drag & drop local audio files
    setupFileDrop();

    // Downloads folder changed outside the app (file deleted manually).
    window.api.onLibraryChanged(() => refreshLibrary());

    // Safety net: re-check on window focus in case a deletion happened while
    // the app was in the background and the folder watcher missed it.
    window.addEventListener('focus', async () => {
      const count = (await window.api.getSongs()).length;
      if (count !== state.songs.length) refreshLibrary();
    });

    // Click empty space in the song list to clear the multi-selection
    dom.songList.addEventListener('click', (e) => {
      if (!e.target.closest('.song-item')) clearSongSelection();
    });

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
          if (e.ctrlKey) {
            e.preventDefault();
            playNext();
          } else if (isPartyGuest()) {
            partyGuestRequest('seek', partyTargetPosition() + 5);
          } else if (audio.duration) {
            audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
            broadcastPartyState(true);
          }
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            playPrev();
          } else if (isPartyGuest()) {
            partyGuestRequest('seek', Math.max(0, partyTargetPosition() - 5));
          } else if (audio.duration) {
            audio.currentTime = Math.max(0, audio.currentTime - 5);
            broadcastPartyState(true);
          }
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
        case 'KeyA':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const ids = getDisplayedSongIds();
            if (ids.length) {
              ids.forEach(id => state.selectedSongIds.add(id));
              state.lastSelectedSongId = ids[ids.length - 1];
              updateSelectionUI();
            }
          }
          break;
        case 'Escape':
          clearSongSelection();
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
