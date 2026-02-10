# ▶ PLAYGEN

> **Cyberpunk-themed YouTube music downloader & playlist manager**

![Electron](https://img.shields.io/badge/Electron-28-47848F?style=flat-square&logo=electron)
![License](https://img.shields.io/badge/License-MIT-00f0ff?style=flat-square)

---

## Features

- **Download audio from YouTube** — Paste a URL, get MP3 (320kbps)
- **Library management** — Browse all your downloaded tracks
- **Playlist system** — Create, rename, delete playlists; drag-and-drop songs between them
- **Music player** — Play/pause, next/prev, shuffle, repeat (one/all), volume, seek
- **Audio visualizer** — Real-time equalizer bars overlaid on the album thumbnail
- **Cyberpunk UI** — Dark theme with neon cyan/magenta glows, scanline overlay, glitch effects, Orbitron font
- **Search & filter** — Quickly find songs in your library
- **Session persistence** — Remembers your last song, playlist, volume, and settings
- **Keyboard shortcuts** — Space (play/pause), arrows (seek/volume), Ctrl+arrows (next/prev), S (shuffle), R (repeat)

## Prerequisites

You need these installed and available in your system PATH:

| Tool | Install |
|------|---------|
| **Node.js** (18+) | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | `winget install yt-dlp` or [github.com/yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) |
| **ffmpeg** | `winget install ffmpeg` or [ffmpeg.org](https://ffmpeg.org/download.html) |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/PlayGen.git
cd PlayGen

# Install dependencies
npm install

# Run the app
npm start
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek -5s / +5s |
| `Ctrl+←` / `Ctrl+→` | Previous / Next track |
| `↑` / `↓` | Volume up / down |
| `S` | Toggle shuffle |
| `R` | Cycle repeat (off → all → one) |
| `Ctrl+F` | Focus search |
| Paste a YouTube URL anywhere | Auto-fills download field |

## Project Structure

```
PlayGen/
├── main.js          # Electron main process (IPC, yt-dlp, database)
├── preload.js       # Secure bridge between main & renderer
├── package.json
├── src/
│   ├── index.html   # App layout
│   ├── styles.css   # Cyberpunk theme
│   └── renderer.js  # App logic, player, visualizer
└── README.md
```

## How It Works

1. **Download**: Paste a YouTube URL → `yt-dlp` extracts MP3 audio → saved to app data folder
2. **Library**: All downloads appear in "All Downloads" with thumbnail, title, channel, duration
3. **Playlists**: Create playlists in the sidebar → drag songs onto them or use the context menu
4. **Player**: Double-click any song to play → bottom bar shows controls + audio visualizer
5. **Data**: Song metadata & playlists stored in a JSON database in your app data folder

## License

MIT