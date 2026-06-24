<p align="center">
  <img src="assets/playgen-icon.png" alt="PlayGen Logo" width="140" />
</p>

<h1 align="center">PlayGen Player</h1>

<p align="center">
  <strong>YouTube music downloader & playlist manager</strong><br />
  <sub>Download · Organize · Play — all in one app</sub>
</p>

<p align="center">
  <a href="https://github.com/belinda-hagen/PlayGen-Player/releases/latest"><img src="https://img.shields.io/github/v/tag/belinda-hagen/PlayGen-Player?label=Version&style=flat-square&color=a855f7" alt="Version" /></a>
  <a href="https://github.com/belinda-hagen/PlayGen-Player/releases"><img src="https://img.shields.io/github/downloads/belinda-hagen/PlayGen-Player/total?style=flat-square&color=ff8c00&label=Downloads" alt="Downloads" /></a>
  <img src="https://img.shields.io/badge/Electron-28-191970?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows11&logoColor=white" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-ff2d78?style=flat-square" alt="License" /></a>
  <a href="https://github.com/belinda-hagen/PlayGen-Player/stargazers"><img src="https://img.shields.io/github/stars/belinda-hagen/PlayGen-Player?style=flat-square&color=ffcc00&label=Stars" alt="Stars" /></a>
</p>

<p align="center">
  <img src="assets/screenshot.png" alt="PlayGen Screenshot" width="800" />
</p>

---

<h2>Features</h2>

| Feature | Description |
|---|---|
| **Download from YouTube** | Paste a video link and get a high-quality MP3 |
| **Download whole playlists** | Paste a YouTube playlist link to grab every track at once |
| **Playlist system** | Create, rename, reorder (drag-and-drop) & delete playlists |
| **Next-song delay** | Set a per-playlist gap between tracks (Instant → 30 seconds) |
| **Export to folder** | Copy a whole playlist's MP3s to any folder on your PC |
| **Full music player** | Play/pause, skip, shuffle, repeat, seek & volume |
| **Adaptive cover art** | The now-playing banner tints itself to match the album art |
| **Audio visualizer** | Real-time equalizer bars on the album thumbnail |
| **Mini player** | Compact always-on-top player when minimized (toggle in settings) |
| **Search** | Instantly filter songs across your library |

> **Tip:** Right-click a playlist to **rename** it, set its **next-song delay**, or **export** all its tracks to a folder. Inside a playlist a song is only *removed* from that playlist — permanent deletion lives in the **Downloads** view.

## Prerequisites

| Tool | Install |
|------|---------|
| **Node.js** 18+ | [nodejs.org](https://nodejs.org) |
| **yt-dlp** | `winget install yt-dlp` or [GitHub releases](https://github.com/yt-dlp/yt-dlp/releases) |
| **ffmpeg** | `winget install ffmpeg` or [ffmpeg.org](https://ffmpeg.org/download.html) |

## Quick Start

```bash
git clone https://github.com/belinda-hagen/PlayGen-Player.git
cd PlayGen-Player
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
| `Ctrl+V` | Paste a copied YouTube link into the download bar |

## Disclaimer

This tool is intended for downloading content you have the right to download. Users are responsible for complying with applicable laws and YouTube's Terms of Service. The developers of PlayGen do not condone or encourage downloading copyrighted material without permission.

## 📄 License

[MIT](LICENSE)
