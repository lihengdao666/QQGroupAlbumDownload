# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Electron + Vue.js 3 + TypeScript desktop application for downloading QQ group photo albums. The application provides a 3-step workflow:
1. Input QQ group number
2. Select albums to download
3. Manage download tasks with pause/resume/delete functionality

## Architecture

### Main Process (Electron)
- **Entry point**: `main.js` - Creates BrowserWindow and manages authentication flow
- **Core logic**: `ipcMain.js` - Handles IPC requests and implements download queue system
- **Authentication**: `qqCore.js` - Manages QQ cookies and authentication tokens
- **Constants**: `consts.js` - Defines task status constants (WATING, RUN, FINISH, ERROR, PAUSE)
- **Preload**: `preload.js` - Exposes IPC APIs to renderer process securely

### Renderer Process (Vue.js 3 + TypeScript)
- **Entry point**: `src/main.ts` - Vue application bootstrap
- **Main component**: `src/App.vue` - 3-step workflow controller
- **Components**:
  - `InputGroup.vue` - QQ group number input
  - `SelectAlbum.vue` - Album selection interface
  - `DownloadPage.vue` - Download management interface
- **Router**: `src/router/index.ts` - Vue Router configuration
- **Utilities**: `src/utils.ts` - Helper functions

### IPC Communication Pattern
- Renderer → Main: Uses `window.QQ` APIs exposed via preload script
- Main → Renderer: Uses `event.sender.send()` for progress updates
- Key APIs: `getAlbumList`, `createDownloadAlbum`, `stopDownloadAlbum`, `resumeDownloadAlbum`, `deleteDownloadAlbum`

### Download System
- Concurrent limit: 2 simultaneous downloads
- Task states: WATING → RUN → FINISH/ERROR/PAUSE
- File storage: User-selected directories via dialog
- Progress tracking: Real-time updates via IPC

## Development Commands

### Local Development
```bash
# Install dependencies
npm install

# Start Vue dev server (renderer process)
npm run serve

# Start Electron in development mode (with hot reload)
npm run electron-build-dev

# Start Electron in production mode
npm run electron-build-pro

# Lint code
npm run lint
```

### Build & Packaging
```bash
# Build Vue application (outputs to web/)
npm run build

# Package Electron app with electron-builder
npm run pack
```

### CI/CD (GitHub Actions)
- Trigger: Push to tags matching "v*.*.*"
- Builds: Windows (portable .exe) and macOS (.dmg)
- Workflow: `.github/workflows/build.yml`
- Build command: `npm run build && npm run pack`

## Configuration Files

### Vue Configuration (`vue.config.js`)
- Public path: `./` (relative for packaged app)
- Output directory: `web/`
- Auto-import: Element Plus components via unplugin-auto-import

### Electron Builder (`package.json` build section)
- App ID: `qq.album.download`
- Product name: `QQGroupAlbumDownload`
- Windows target: `portable`
- Icon: `logo.ico` (Windows), `logo_512.png` (macOS 512×512 minimum)

### TypeScript & ESLint
- TypeScript config: `tsconfig.json`
- ESLint config: `.eslintrc.js` (Vue 3 + TypeScript rules)
- Babel config: `babel.config.js`

## Key Dependencies

### Runtime
- `electron`: ^33.2.1
- `vue`: ^3.2.13 + `vue-router`: ^4.0.3
- `element-plus`: ^2.9.1 (UI components)
- `axios`: ^1.7.9 (HTTP requests)
- `fs-extra`: ^11.2.0 (file operations)
- `crypto-js`: ^4.2.0 (MD5 hashing for file names)

### Development
- `electronmon`: ^2.0.3 (hot reload)
- `electron-reloader`: ^1.2.3
- `unplugin-auto-import`: ^0.19.0 (Element Plus auto-import)
- `unplugin-vue-components`: ^0.28.0

## Authentication Flow
1. Opens QQ login window to `xui.ptlogin2.qq.com`
2. Captures authentication cookies after login
3. Generates `g_tk` token using custom algorithm in `main.js:17-23`
4. Stores credentials in `qqCore.js` module state

## File Structure Notes
- Built Vue files output to `web/` directory
- Static assets in `public/` and `src/assets/`
- Electron main process files in root directory
- Vue source files in `src/` directory
- No test files or test configuration currently exists

## Recent Features (from commit history)
- Original image download support
- Donation thanks display
- Unknown source download warnings