<div align="center">

# 🧰 OmniTools

**A privacy-first, all-in-one browser toolbox — no uploads, no servers, no limits.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-brightgreen)](https://drewpall.github.io/OmniTools/)
[![WebAssembly](https://img.shields.io/badge/Powered%20by-WebAssembly-654FF0?logo=webassembly)](https://webassembly.org/)

[**Live Demo →**](https://drewpall.github.io/OmniTools/)

</div>

---

## What is OmniTools?

OmniTools is a collection of powerful media and developer utilities that run **entirely in your browser**. No files are ever uploaded to a server. Everything is processed locally on your device using WebAssembly.

---

## Features

### 🎬 Video Compressor
Compress videos directly in the browser with full control over quality and format.
- Adjustable resolution (4K → 360p), frame rate, and CRF quality
- Output to MP4 (H.264) or WebM (VP9)
- Audio track control: keep, compress, or strip
- Multi-threaded WASM engine with automatic fallback
- Side-by-side before/after comparison with size savings readout

### 🖼️ Image Converter
Batch convert and compress images between formats.
- Supports JPEG, PNG, WebP, AVIF, GIF, BMP
- Quality slider and resize controls
- Real-time preview comparison

### 🎵 Audio Converter
Convert audio files between common formats using FFmpeg.wasm.
- Supports MP3, AAC, OGG, WAV, FLAC, M4A, OPUS
- Bitrate and channel selection

### 📄 PDF Toolbox
Client-side PDF manipulation powered by PDF.js and pdf-lib.
- Merge, split, reorder, delete pages
- Add password protection
- Extract pages as images

### ✍️ Markdown & LaTeX Reader
Render Markdown documents with full LaTeX math support.
- Powered by marked.js + KaTeX
- Live preview with syntax highlighting

### 🛠️ Developer Tools
Everyday utilities for developers.
- JSON Formatter & Validator
- Base64 Encode / Decode
- URL Encode / Decode
- Hash Generator (MD5, SHA-1, SHA-256, SHA-512)
- Regex Tester
- Timestamp Converter
- Color Picker & Converter
- UUID Generator

### 🚀 P2P File Transfer
End-to-end client-side file sharing utilizing WebRTC P2P direct transmission.
- 100% serverless data channel; files never touch any middleman servers
- Direct drag-and-drop file upload with multiple file selection support
- In-app QR code pairing utilizing camera streams and offline URL hash routing
- Flow control with WebRTC backpressure safety to support files of arbitrary size
- Real-time transfer statistics including elapsed duration, speeds, and ETA readouts

### 🌐 Bilingual UI (English / Chinese)
Switch the entire interface between English and Simplified Chinese with a single click.
- Language preference is persisted in `localStorage` across sessions
- All tool labels, buttons, status messages, and tooltips are fully localized

---

## Privacy

> **Your files never leave your device.**

All processing happens locally in the browser via WebAssembly. OmniTools has no backend, no analytics, and no file upload endpoints.

---

## Technology

| Component | Technology |
|---|---|
| Video / Audio processing | [FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) |
| PDF processing | [pdf-lib](https://pdf-lib.js.org/) + [PDF.js](https://mozilla.github.io/pdf.js/) |
| Math rendering | [KaTeX](https://katex.org/) |
| Markdown parsing | [marked.js](https://marked.js.org/) |
| Cross-origin isolation | [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) |
| UI | Vanilla HTML / CSS / JavaScript |
| P2P File Transfer | [PeerJS](https://peerjs.com/) + [jsQR](https://github.com/cozmo/jsQR) + [QRious](https://github.com/neocotic/qrious) |

---

## Local Development

A local server with COOP/COEP headers is required to enable multi-threaded WASM acceleration.

**Node.js:**
```bash
npm install
npm run dev
```

**Python:**
```bash
python server.py
```

Then open `http://localhost:3000`.

---

## License

MIT © [drewpall](https://github.com/drewpall)
