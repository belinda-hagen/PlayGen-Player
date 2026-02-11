<p align="center">
  <img src="assets/icon.png" alt="PlayGen Logo" width="120" />
</p>

<h1 align="center">PlayGen</h1>

<p align="center">
  <strong>YouTube music downloader & playlist manager</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/github/downloads/belinda-hagen/PlayGen/total?style=for-the-badge&color=ff2d78&label=Downloads" alt="Downloads" />
  <img src="https://img.shields.io/badge/Electron-28-191970?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-ff2d78?style=for-the-badge" alt="License" />
</p>

---

## Features

- **Download from YouTube** — Paste a link, get high-quality MP3 (320 kbps)
- **Playlist system** — Create, rename, reorder & delete playlists with drag-and-drop
- **Full music player** — Play/pause, skip, shuffle, repeat, seek & volume
- **Audio visualizer** — Real-time equalizer bars on the album thumbnail
- **Mini player** — Compact always-on-top player when minimized
- **Search** — Instantly filter songs across your library
- **Session restore** — Picks up right where you left off

## Prerequisites

| Tool | Install |
|------|---------|
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | `winget install yt-dlp` or [GitHub releases](https://github.com/yt-dlp/yt-dlp/releases) |
| **ffmpeg** | `winget install ffmpeg` or [ffmpeg.org](https://ffmpeg.org/download.html) |

## Quick Start

```bash
git clone https://github.com/belinda-hagen/PlayGen.git
cd PlayGen
npm install
npm start
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek −5s / +5s |
| `Ctrl+←` / `Ctrl+→` | Previous / Next track |
| `↑` / `↓` | Volume up / down |
| `S` | Toggle shuffle |
| `R` | Cycle repeat |
| `Ctrl+F` | Focus search |

## Disclaimer

> This tool is intended for downloading content you have the right to download. Users are responsible for complying with applicable laws and YouTube's Terms of Service. The developers of PlayGen do not condone or encourage downloading copyrighted material without permission.

## License

MIT