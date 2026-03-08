# Development Guide

This guide explains how to set up the development environment for Delulu.

## Prerequisites

- **Node.js:** v20+ (LTS recommended)
- **Rust:** Latest stable version (via [rustup](https://rustup.rs/))
- **Build Tools:**
  - **Windows:** C++ Build Tools for Visual Studio.
  - **Linux:** `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.0-dev`.
- **Tauri CLI:** `npm install -g @tauri-apps/cli`

## Repository Structure

- `tauri.deluluapp/`: The main React + Tauri project.
- `local-extractor/`: The Node.js headless extraction engine.
- `docs/`: Technical documentation.
- `photos/`: Screenshots for the README.

## Setup Instructions

1. **Clone and Install Dependencies:**
   ```bash
   git clone https://github.com/ZacKXSnydeR/DeluluDesktop.git
   cd DeluluDesktop/tauri.deluluapp
   npm install
   ```

2. **Configure Environment:**
   - Copy `tauri.deluluapp/.env.example` to `tauri.deluluapp/.env`.
   - Add your [TMDB API Key](https://www.themoviedb.org/documentation/api).
   - Add your [Firebase Web Config](https://firebase.google.com/docs/web/setup).

3. **Running in Development Mode:**
   ```bash
   npm run tauri dev
   ```
   This will start the Vite dev server and the Tauri window simultaneously.

## Sidecar Mechanism

The local extractor in `local-extractor/` is automatically bundled during the build/dev process by the `scripts/run-tauri-with-setup.cjs` wrapper. If you make changes to the extractor, they will be reflected every time you restart the dev command.

## Building for Production

To create a signed installer:
```bash
npm run tauri build
```
The output will be located in `src-tauri/target/release/bundle/`.
