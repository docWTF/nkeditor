# nkEditor3 Phase 2: Electron GUI Implementation Plan

## Overview

Transform the Phase 1 CLI application into a full Electron GUI application with React frontend, reusing all battle-tested MIDI modules from Phase 1.

---

## Phase 1 Modules to Reuse (100% Compatible)

All Phase 1 modules are UI-agnostic and work directly in Electron's main process:

| Module | Lines | Purpose | Modifications |
|--------|-------|---------|---------------|
| `types.ts` | ~200 | Type definitions | None |
| `constants.ts` | ~150 | Hardware CC mappings | None |
| `midi-discovery.ts` | ~300 | Port detection + caching | None |
| `midi-handler.ts` | ~700 | MIDI I/O + heartbeat | None |
| `mapping-engine.ts` | ~400 | CC remapping logic | None |
| `led-controller.ts` | ~200 | LED state management | None |
| `config-parser.ts` | ~660 | Text file parser | Add JSON support |

**Key Lessons from Phase 1**:
- ALSA resource caching (500ms TTL) prevents "Cannot allocate memory" errors
- Heartbeat check (CC 127) tests connection without creating ALSA clients
- Graceful degradation allows offline/demo mode operation

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop Shell | Electron |
| Frontend | React 18+ with TypeScript |
| State Management | Zustand |
| Validation | Zod |
| Build | Vite + electron-builder |
| Styling | Tailwind CSS |
| MIDI I/O | easymidi (reused from Phase 1) |

---

## Project Structure

```
/nkEditor3
├── /src
│   ├── /main                    # Electron main process
│   │   ├── main.ts              # App lifecycle
│   │   ├── preload.ts           # IPC bridge (contextBridge)
│   │   ├── ipc-handlers.ts      # IPC message handlers
│   │   └── /services
│   │       ├── midi-manager.ts  # Wraps Phase 1 MIDI modules
│   │       ├── file-manager.ts  # Preset CRUD
│   │       └── config-manager.ts
│   │
│   ├── /renderer                # React frontend
│   │   ├── /components
│   │   │   ├── /Editor          # Visual nanoKONTROL2 editor
│   │   │   ├── /Librarian       # Preset management
│   │   │   ├── /Settings        # Configuration UI
│   │   │   └── /Help            # Documentation
│   │   ├── /stores              # Zustand stores
│   │   ├── /hooks               # Custom React hooks
│   │   └── App.tsx
│   │
│   └── /shared                  # Shared between main/renderer
│       ├── types.ts             # From Phase 1
│       ├── constants.ts         # From Phase 1
│       ├── schemas.ts           # Zod schemas
│       └── ipc-protocol.ts      # IPC message types
│
├── /presets                     # User preset storage
└── /assets                      # SVG graphics, icons
```

---

## IPC Protocol

### Main to Renderer Events
- `midi:cc` - CC message received from hardware
- `midi:connected` - Device connected
- `midi:disconnected` - Device disconnected
- `midi:portsChanged` - Available ports changed
- `error` - Error occurred

### Renderer to Main (invoke)
- `midi:send` - Send CC to virtual output
- `midi:connect` - Connect to device
- `midi:disconnect` - Disconnect from device
- `midi:ports` - Get available ports
- `preset:load` - Load preset from file
- `preset:save` - Save preset to file
- `preset:delete` - Delete preset file
- `preset:list` - List all presets
- `config:get` - Get configuration
- `config:update` - Update configuration

---

## Key Features

1. **Soft Takeover** - Prevent value jumps when physical != target
2. **LED Sync** - Mirror button states on hardware LEDs
3. **A/B Comparison** - Two preset slots with instant toggle
4. **Quick Access** - 5 preset slots, cycle with Track L/R buttons
5. **Demo Mode** - Full functionality without hardware
6. **Undo/Redo** - 50 levels for all editable actions
7. **Keyboard Shortcuts** - Ctrl+S, Ctrl+Z, 1-8 track select, etc.

---

## Verification Plan

1. **MIDI Functionality**
   - Connect to nanoKONTROL2, verify CC messages appear in Editor
   - Move physical fader, verify UI updates within 50ms
   - Change CC mapping, verify output changes immediately
   - Test LED sync on button press
   - Test soft takeover (load preset, move fader, verify catch behavior)

2. **Preset Management**
   - Create, save, load, delete presets
   - Verify presets persist after app restart
   - Test search/filter with 100+ presets
   - Test A/B comparison toggle
   - Test Quick Access slot assignment

3. **Settings**
   - Change theme, verify immediate application
   - Change soft takeover mode, verify behavior change
   - Verify settings persist after restart

4. **Cross-Platform**
   - Test on Linux (ALSA/PipeWire)
   - Verify no ALSA resource exhaustion after 1 hour

---

## Known Issues & Bugs (Identified 2025-01-21)

### Critical Issues

| Issue | Location | Description | Fix |
|-------|----------|-------------|-----|
| Missing esbuild dependency | package.json | `vite-plugin-electron-renderer@0.14.x` imports esbuild at runtime but doesn't declare it as a dependency. esbuild is nested under vite's node_modules and not accessible. | Add `"esbuild": "^0.21.5"` to devDependencies |
| Circular import | main.ts ↔ ipc-handlers.ts | `main.ts` imports from `ipc-handlers.ts`, which imports `sendToRenderer` from `main.ts`. Can cause undefined values at runtime. | Extract `sendToRenderer` to separate utility module |
| ConfigManager interval leak | config-manager.ts | `setInterval` in constructor is never cleared, preventing clean shutdown | Store interval ID and clear in cleanup method |

### High Priority Issues

| Issue | Location | Description | Fix |
|-------|----------|-------------|-----|
| Missing Vite aliases for main process | vite.config.ts | Path aliases only configured for renderer build, not main process build within electron() plugin | Add resolve.alias to electron plugin's vite config |
| Missing IPC handler deregistration | ipc-handlers.ts | `cleanupIpcHandlers()` doesn't call `ipcMain.removeHandler()` - causes errors if handlers registered twice | Add removeHandler calls in cleanup |
| FileManager async constructor | file-manager.ts | `ensurePresetsDir()` is async but not awaited in constructor - race condition risk | Use factory pattern or make sync |

### Medium Priority Issues

| Issue | Location | Description | Fix |
|-------|----------|-------------|-----|
| Dynamic require() in ESM | main.ts:63 | Uses `require('electron').shell` in ESM module | Replace with static import |
| Inconsistent .js extensions | renderer stores | Main process uses .js extensions, renderer doesn't - inconsistent | Standardize on .js extensions for ESM |
| Unused IPC channels | ipc-protocol.ts | `PRESET_IMPORT` and `PRESET_EXPORT` defined but not implemented | Remove or implement |
| No default mapping loaded | midi-manager.ts | MappingEngine is null by default, CC passthrough mode on startup | Consider loading default mapping |

### Low Priority Issues

| Issue | Location | Description |
|-------|----------|-------------|
| Duplicate type definitions | schemas.ts vs types.ts | Same types defined in both files |
| Type shadowing | ErrorEvent in ipc-protocol vs types | Different ErrorEvent definitions |
| Service initialization order | ipc-handlers.ts | Dependency order relies on comment, not enforced |

---

## Architecture Corrections

### 1. Break Circular Dependency

Create `src/main/utils/renderer-bridge.ts`:
```typescript
import { BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}
```

### 2. Fix Build Configuration

Update package.json devDependencies:
```json
{
  "devDependencies": {
    "esbuild": "^0.21.5"
  }
}
```

Update vite.config.ts electron plugin:
```typescript
electron([
  {
    entry: 'src/main/main.ts',
    vite: {
      resolve: {
        alias: {
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      build: {
        outDir: 'dist-electron',
        rollupOptions: {
          external: ['easymidi'],
        },
      },
    },
  },
  // ... preload config with same aliases
]),
```

### 3. Fix ConfigManager Lifecycle

```typescript
class ConfigManager {
  private saveIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    // ...
    this.saveIntervalId = setInterval(() => {
      if (this.dirty) this.save();
    }, 30000);
  }

  cleanup(): void {
    if (this.saveIntervalId) {
      clearInterval(this.saveIntervalId);
      this.saveIntervalId = null;
    }
    this.save();
  }
}
```
