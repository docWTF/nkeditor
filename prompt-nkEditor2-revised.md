# **Master Prompt: Korg nanoKONTROL2 Pro Librarian & Editor (Revised)**

## **Part 1: Project Overview and Architecture**

### 1.1 Project Objective

Build a professional desktop application for the **Korg nanoKONTROL2** MIDI controller that provides:
- Real-time CC mapping from hardware inputs to configurable output destinations
- Even when a physical device is not connected, the on-screen GUI should still be usable to transmit values.
- Visual feedback mirroring physical control movements
- A preset librarian for saving, organizing, and recalling configurations
- LED synchronization with the physical device
- Cross-platform support for Linux, macOS, and Windows

### 1.2 Application Architecture

**Platform: Electron Application (Required)**

The application requires native MIDI access and file system operations that browsers cannot provide. Use Electron with the following architecture:

```
┌─────────────────────────────────────────────────────┐
│                    Electron App                      │
├─────────────────────────────────────────────────────┤
│  Main Process (Node.js)                             │
│  ├── MIDI Handler (easymidi/node-midi)              │
│  ├── File Manager (fs + Zod validation)             │
│  └── IPC Bridge                                     │
├─────────────────────────────────────────────────────┤
│  Renderer Process (React)                           │
│  ├── UI Components (Editor, Librarian, Settings)    │
│  ├── State Management (Zustand)                     │
│  └── IPC Client (contextBridge)                     │
└─────────────────────────────────────────────────────┘
```

**Communication:** Use Electron IPC (not Socket.io) via contextBridge for all main-renderer communication.

### 1.3 Directory Structure

```
/nkEditor2
├── /src
│   ├── /main                    # Electron main process
│   │   ├── main.ts              # Entry point
│   │   ├── midi-handler.ts      # MIDI I/O and mapping logic
│   │   ├── midi-discovery.ts    # Port detection and hot-plug
│   │   ├── file-manager.ts      # Preset/config CRUD operations
│   │   └── preload.ts           # IPC bridge via contextBridge
│   ├── /renderer                # React frontend
│   │   ├── /components
│   │   │   ├── /Editor          # Graphical editor components
│   │   │   ├── /Librarian       # Preset management components
│   │   │   ├── /Settings        # Configuration components
│   │   │   └── /Help            # Documentation viewer
│   │   ├── /stores              # Zustand state stores
│   │   ├── /hooks               # Custom React hooks
│   │   └── App.tsx
│   └── /shared                  # Shared types and schemas
│       ├── schemas.ts           # Zod validation schemas
│       ├── types.ts             # TypeScript interfaces
│       └── constants.ts         # CC mappings, defaults
├── /presets                     # User preset storage (JSON files)
├── /assets                      # SVG graphics, icons
├── config.json                  # User settings
├── metadata.json                # Preset index and favorites
└── package.json
```

### 1.4 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Desktop Shell | Electron | Native MIDI, file system, cross-platform distribution |
| MIDI I/O | easymidi (node-midi) | Hardware communication |
| Frontend | React 18+ | UI framework |
| State | Zustand | Client-side state management |
| Validation | Zod | Schema validation for presets and config |
| Build | Vite + electron-builder | Development and packaging |
| Language | TypeScript (strict mode) | Type safety throughout |

---

## **Part 2: Hardware Reference**

### 2.1 Standard Factory CC Mapping

The nanoKONTROL2 sends these CCs by default (device must be in **CC Mode**):

**8 Channel Strips (Indexed 0-7):**
| Control | Track 1 | Track 2 | Track 3 | Track 4 | Track 5 | Track 6 | Track 7 | Track 8 |
|---------|---------|---------|---------|---------|---------|---------|---------|---------|
| Knob | CC 16 | CC 17 | CC 18 | CC 19 | CC 20 | CC 21 | CC 22 | CC 23 |
| Slider | CC 0 | CC 1 | CC 2 | CC 3 | CC 4 | CC 5 | CC 6 | CC 7 |
| Solo | CC 32 | CC 33 | CC 34 | CC 35 | CC 36 | CC 37 | CC 38 | CC 39 |
| Mute | CC 48 | CC 49 | CC 50 | CC 51 | CC 52 | CC 53 | CC 54 | CC 55 |
| Record | CC 64 | CC 65 | CC 66 | CC 67 | CC 68 | CC 69 | CC 70 | CC 71 |

**Transport Controls:**
| Control | CC |
|---------|-----|
| Rewind | CC 43 |
| Fast Forward | CC 44 |
| Stop | CC 42 |
| Play | CC 41 |
| Record | CC 45 |
| Cycle | CC 46 |
| Track Left | CC 58 |
| Track Right | CC 59 |
| Marker Set | CC 60 |
| Marker Left | CC 61 |
| Marker Right | CC 62 |

### 2.2 LED Control Protocol

LEDs are controlled by sending CC messages **to** the device on the same channel:

| Control Type | CC Range | LED On | LED Off |
|--------------|----------|--------|---------|
| Solo (Track 1-8) | CC 32-39 | 127 | 0 |
| Mute (Track 1-8) | CC 48-55 | 127 | 0 |
| Record (Track 1-8) | CC 64-71 | 127 | 0 |
| Transport | CC 41-46 | 127 | 0 |

**LED Sync Requirements:**
- On preset load, update all LEDs to reflect stored button states
- On app launch, reset all LEDs to off, then sync to current state

### 2.3 Entering CC Mode

The device must be in CC Mode for this application to work. Include these instructions in the Help tab:

1. Hold **SET MARKER** + **CYCLE** buttons simultaneously
2. LEDs will flash to confirm mode change
3. Device is now in CC Mode (not DAW Mode)

---

## **Part 3: Core Engine Specifications**

### 3.1 MIDI Port Discovery

**Platform-Specific Port Name Patterns:**
```typescript
const PLATFORM_PATTERNS = {
  linux: /nanokontrol2.*midi\s*1/i,    // "nanoKONTROL2:nanoKONTROL2 MIDI 1 24:0"
  darwin: /^nanokontrol2$/i,            // "nanoKONTROL2"
  win32: /nanokontrol2/i                // "nanoKONTROL2 0"
};
```

**Discovery Algorithm:**
1. On startup, enumerate all MIDI input and output ports
2. Match against platform pattern; if found, auto-connect
3. Store last-used port names in config for faster reconnection
4. If no match found, present port selector to user

**Hot-Plug Detection:**
- Poll `easymidi.getInputs()`/`getOutputs()` every 2 seconds
- Compare against cached list; emit connection/disconnection events
- Debounce rapid plug/unplug cycles (500ms)
- On device reconnect, automatically restore connection

### 3.2 CC Mapping Engine

The core function: receive CC from hardware, transform it, output to configured destination.

```typescript
interface MappingEntry {
  inputCC: number;          // CC received from hardware (0-127)
  outputCC: number;         // CC to send (0-127)
  outputChannel: number;    // MIDI channel (1-16)
  behavior: 'passthrough' | 'toggle' | 'momentary';
}

function handleIncomingCC(channel: number, inputCC: number, value: number) {
  const mapping = getMappingForCC(inputCC);
  if (!mapping) return; // Unmapped CC, ignore or pass through

  const outputValue = processValue(mapping, value);
  sendMidiCC(mapping.outputChannel, mapping.outputCC, outputValue);

  // Update UI state
  emitToRenderer('midi:cc', { inputCC, outputCC: mapping.outputCC, value: outputValue });
}
```

**Source Tagging:**
Tag each MIDI message with its origin to prevent feedback loops:
- `hardware`: Message from physical nanoKONTROL2
- `software`: Message from preset load or UI interaction
- `led-sync`: Outbound LED control (never process as input)

### 3.3 Soft Takeover

**Definition:** Soft Takeover prevents value jumps when a physical control's position doesn't match the software's target value. The physical control must "catch up" to the target before it resumes control.

**Algorithm:**
```typescript
interface ControlState {
  physicalValue: number;     // Current position of hardware control
  targetValue: number;       // Value from preset or last output
  softTakeoverLocked: boolean;
}

function handleSoftTakeover(controlId: string, physicalValue: number): boolean {
  const state = getControlState(controlId);
  const threshold = settings.softTakeoverThreshold; // default: 3

  if (state.softTakeoverLocked) {
    // Check if physical has caught up to target
    if (Math.abs(physicalValue - state.targetValue) <= threshold) {
      state.softTakeoverLocked = false;
      return true; // Control acquired, send output
    }
    return false; // Still locked, don't send output
  }
  return true; // Normal operation
}
```

**When Soft Takeover Engages:**
- After loading a preset (all continuous controls locked until caught)
- After editing a value via GUI (that specific control locked)

**Soft Takeover Modes (user configurable):**
- `catch`: Physical must match target within threshold (default)
- `jump`: Immediately take new value (disables soft takeover)
- `pickup`: Only activate when physical crosses target value

### 3.4 Button Behavior Modes

**Momentary:**
- Press: Send CC value 127
- Release: Send CC value 0
- LED: Lit only while physically pressed
- State: Not stored in presets

**Toggle:**
- Press: Alternate between CC 127 and CC 0
- Release: No message sent
- LED: Reflects current toggle state
- State: Toggle state IS stored in presets

**Initial State:** All toggles start OFF (value 0) on app launch, then sync to preset if one is loaded.

---

## **Part 4: User Interface Specification**

### 4.1 Layout System

**Dual Layout Support:**

1. **Tabbed Mode (Default, <1400px width):**
   - Four tabs: Editor | Librarian | Settings | Help
   - Only one view visible at a time

2. **Split Mode (>=1400px width):**
   - Editor and Librarian side-by-side (resizable divider)
   - Settings and Help as modal overlays
   - Toggle button in header to switch modes

### 4.2 Graphical Editor View

**Visual Representation:**
- Pixel-accurate 8-track representation of nanoKONTROL2 in SVG
- All controls (knobs, sliders, buttons) rendered as interactive elements
- Transport section below the 8 tracks

**Per-Control Display:**
- Current value (0-127)
- Output CC number
- Output MIDI channel
- Custom label (user-editable, e.g., "Filter Cutoff")
- Soft Takeover indicator (when applicable)

**Soft Takeover Visual Feedback:**
- **Normal state:** Single indicator showing value
- **Soft Takeover active:**
  - Ghost/outline indicator: Target value position
  - Filled indicator: Physical value position
  - Directional arrow: Shows which way to move
  - Color: Gray when locked, accent color when acquired

**Control Editing:**
Click any control to open an edit popover:
- Output CC (0-127) - text input 
- Output Channel (1-16) - dropdown
- Button Behavior (Toggle/Momentary) - for buttons only
- Custom Label - text input


### 4.3 Librarian View

**Preset List:**
- Sortable columns: Name, Group, Date Modified, Favorite
- Search bar with instant filtering (name, group, tags)
- Favorite star toggle on each preset
- Quick-filter buttons: All | Favorites | Recent
- all presets need editable group and tags

**Preset Organization:**
- Groups (folders): "Synthesizers", "DAW Templates", "Live Performance", etc.
- Tags (multiple per preset): user-defined labels
- Drag-and-drop to reorder or move between groups
- Multi-select for batch operations (delete, move, export)

**Quick Access (Virtual Scenes):**
- 5 preset slots assignable via right-click or drag-and-drop
- Physical Track Left/Right buttons (CC 58/59) cycle through
- Visual indicator (1-5 badges) in preset list

**Preset Actions:**
| Action | Description |
|--------|-------------|
| Load | Apply preset to Editor, engage Soft Takeover |
| Commit | Send all current values to hardware (LEDs + initial state) |
| Save | Save current Editor state as new preset |
| Save As | Save as new preset with new name |
| Duplicate | Create copy with "(Copy)" suffix |
| Delete | Remove preset (with confirmation) |
| Randomize | Generate random values for testing |

**A/B Comparison:**
- Two slots (A and B) for instant comparison
- Toggle button or `A` key to switch
- "Copy A to B" and "Swap" buttons
- Visual diff: highlight controls that differ between A and B

### 4.4 Settings Tab

**config.json Schema:**
```typescript
const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  midi: z.object({
    inputPort: z.string().nullable().default(null),
    outputPort: z.string().nullable().default(null),
    defaultChannel: z.number().int().min(1).max(16).default(1),
    softTakeoverEnabled: z.boolean().default(true),
    softTakeoverThreshold: z.number().min(1).max(10).default(3),
    softTakeoverMode: z.enum(['catch', 'jump', 'pickup']).default('catch'),
    autoConnect: z.boolean().default(true),
  }),
  ui: z.object({
    theme: z.enum(['light', 'dark', 'system']).default('dark'),
    fontSize: z.number().min(10).max(24).default(14),
    uiScale: z.number().min(0.75).max(1.5).default(1.0),
    defaultLayout: z.enum(['tabbed', 'split']).default('tabbed'),
    showWelcomeOnStartup: z.boolean().default(true),
  }),
  pipewire: z.object({
    clientName: z.string().max(64).default('nkEditor2'),
  }),
});
```

**Settings UI Sections:**
1. **MIDI Configuration**
   - Input/Output port selection (dropdowns with refresh button)
   - Default output channel
   - Soft Takeover enable/disable, threshold, mode

2. **Appearance**
   - Theme selector (Light/Dark/System)
   - Font size slider
   - UI scale slider

3. **Advanced**
   - PipeWire client name (Linux only)
   - Reset to defaults button
   - Export diagnostics

### 4.5 Help Tab

**Content:**
- Searchable HTML manual
- Sections: Getting Started, Editor, Librarian, Settings, Troubleshooting
- Embedded 2-minute video tutorial (optional)
- Keyboard shortcuts reference
- CC Mode instructions with visual guide
- FAQ

### 4.6 Onboarding

**First-Run Experience:**
1. Welcome modal with brief overview
2. Interactive guided tour (optional, can skip):
   - Connect device and verify LED response
   - Move a fader to see real-time feedback
   - Save first preset
3. Getting Started checklist persists until completed
4. Contextual tooltips on first hover

**Demo Mode:**
When no device is connected, allow full functionality with simulated input for testing and preset creation.

### 4.7 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save current preset |
| `Ctrl/Cmd + Shift + S` | Save As |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + L` | Focus Librarian |
| `Ctrl/Cmd + E` | Focus Editor |
| `1-8` | Select track 1-8 |
| `A` | Toggle A/B comparison |
| `Space` | Play/Stop transport (if mapped) |
| `?` | Show keyboard shortcuts |
| `Tab` | Navigate between controls |
| `Escape` | Close modal/popover |

### 4.8 Accessibility Requirements

- All interactive elements must have ARIA labels
- Minimum 4.5:1 color contrast for text
- Visible focus indicators for keyboard navigation
- All functionality accessible via keyboard alone
- High contrast mode support
- Screen reader compatible

---

## **Part 5: Data Schemas**

### 5.1 Preset Schema

```typescript
const TrackMappingSchema = z.object({
  knob: z.object({
    outputCC: z.number().int().min(0).max(127),
    channel: z.number().int().min(1).max(16),
    label: z.string().max(32).default(''),
  }),
  slider: z.object({
    outputCC: z.number().int().min(0).max(127),
    channel: z.number().int().min(1).max(16),
    label: z.string().max(32).default(''),
  }),
  solo: z.object({
    outputCC: z.number().int().min(0).max(127),
    channel: z.number().int().min(1).max(16),
    behavior: z.enum(['toggle', 'momentary']).default('toggle'),
    label: z.string().max(32).default(''),
  }),
  mute: z.object({
    outputCC: z.number().int().min(0).max(127),
    channel: z.number().int().min(1).max(16),
    behavior: z.enum(['toggle', 'momentary']).default('toggle'),
    label: z.string().max(32).default(''),
  }),
  rec: z.object({
    outputCC: z.number().int().min(0).max(127),
    channel: z.number().int().min(1).max(16),
    behavior: z.enum(['toggle', 'momentary']).default('momentary'),
    label: z.string().max(32).default(''),
  }),
});

const TrackValuesSchema = z.object({
  knob: z.number().int().min(0).max(127),
  slider: z.number().int().min(0).max(127),
  solo: z.boolean(),
  mute: z.boolean(),
  rec: z.boolean(),
});

const PresetSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  group: z.string().max(32).default('Uncategorized'),
  tags: z.array(z.string().max(24)).default([]),
  isFavorite: z.boolean().default(false),
  createdAt: z.string().datetime(),
  lastModified: z.string().datetime(),

  mappings: z.object({
    track1: TrackMappingSchema,
    track2: TrackMappingSchema,
    track3: TrackMappingSchema,
    track4: TrackMappingSchema,
    track5: TrackMappingSchema,
    track6: TrackMappingSchema,
    track7: TrackMappingSchema,
    track8: TrackMappingSchema,
  }),

  transportMappings: z.object({
    rewind: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    forward: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    stop: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    play: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    record: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    cycle: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    markerSet: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    markerLeft: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
    markerRight: z.object({ outputCC: z.number(), channel: z.number(), label: z.string().default('') }),
  }),

  values: z.object({
    track1: TrackValuesSchema,
    track2: TrackValuesSchema,
    track3: TrackValuesSchema,
    track4: TrackValuesSchema,
    track5: TrackValuesSchema,
    track6: TrackValuesSchema,
    track7: TrackValuesSchema,
    track8: TrackValuesSchema,
  }),
});
```

### 5.2 Metadata Index Schema

```typescript
const MetadataSchema = z.object({
  schemaVersion: z.literal(1),
  lastUpdated: z.string().datetime(),
  quickAccess: z.array(z.string().uuid()).max(5), // Preset IDs for Virtual Scenes
  groups: z.array(z.string()), // List of group names
  presets: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    group: z.string(),
    tags: z.array(z.string()),
    isFavorite: z.boolean(),
    lastModified: z.string().datetime(),
  })),
});
```

---

## **Part 6: State Management**

### 6.1 Zustand Store Architecture

```typescript
// Connection slice
interface MidiConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  inputPort: string | null;
  outputPort: string | null;
  availableInputs: string[];
  availableOutputs: string[];
  lastError: string | null;
}

// Control values slice
interface ControlState {
  physicalValues: Record<string, number>;  // Current hardware positions
  targetValues: Record<string, number>;    // Software target values
  softTakeoverLocked: Record<string, boolean>;
  buttonStates: Record<string, boolean>;   // Toggle states for buttons
}

// Mapping slice
interface MappingState {
  mappings: Record<string, MappingEntry>;
  transportMappings: Record<string, MappingEntry>;
  labels: Record<string, string>;
}

// Preset slice
interface PresetState {
  currentPresetId: string | null;
  isDirty: boolean;  // Unsaved changes indicator
  presetIndex: PresetMetadata[];
  loadedPreset: Preset | null;
}

// Settings slice
interface SettingsState {
  config: Config;
}

// Undo slice
interface UndoState {
  undoStack: Action[];
  redoStack: Action[];
  maxHistory: number; // default: 50
}
```

### 6.2 IPC Protocol

**Main Process → Renderer:**
```typescript
'midi:cc' → { source: 'hardware' | 'software', channel: number, cc: number, value: number }
'midi:connected' → { inputPort: string, outputPort: string }
'midi:disconnected' → { reason: string }
'midi:portsChanged' → { inputs: string[], outputs: string[] }
'preset:loaded' → { preset: Preset }
'error' → { code: string, message: string, recoverable: boolean }
```

**Renderer → Main Process:**
```typescript
'midi:send' → { channel: number, cc: number, value: number }
'midi:connect' → { inputPort: string, outputPort: string }
'midi:disconnect' → {}
'midi:refresh' → {}
'preset:load' → { id: string }
'preset:save' → { preset: Preset }
'preset:delete' → { id: string }
'config:update' → { config: Partial<Config> }
```

---

## **Part 7: Error Handling**

### 7.1 Error Matrix

| Error | Detection | User Feedback | Recovery |
|-------|-----------|---------------|----------|
| Device not found at launch | Port enumeration empty | Modal: "Connect your nanoKONTROL2" with diagram | Poll every 2s, auto-connect when found |
| Device disconnected | MIDI error or poll failure | Toast: "Device disconnected. Reconnecting..." | Auto-reconnect with backoff (1s, 2s, 4s, max 30s) |
| Port busy | Open throws EBUSY | Modal: "Port in use by another application" | List potential conflicts, retry button |
| Preset file corrupted | Zod validation failure | Toast: "Preset X is corrupted" | Offer to delete or skip |
| Permission denied | EACCES error | Modal: "Cannot access presets folder" | Guide to fix permissions |
| MIDI message invalid | Validation failure | Log only (silent) | Ignore message, continue |

### 7.2 Graceful Degradation

The application **must** remain functional without hardware:
- All UI controls work in "virtual" mode
- Presets can be created, edited, and saved
- "OFFLINE" indicator displayed prominently

---

## **Part 8: Security Requirements**

### 8.1 File System Security

```typescript
// All file operations must validate paths are within /presets
function isPathSafe(requestedPath: string): boolean {
  const resolved = path.resolve(PRESETS_DIR, requestedPath);
  return resolved.startsWith(path.resolve(PRESETS_DIR));
}

// Sanitize preset names for filenames
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 64);
}
```

- Reject preset files > 3MB
- Validate all JSON with Zod before use

### 8.2 Electron Security

- **Disable** `nodeIntegration` in renderer
- **Enable** `contextIsolation`
- Use `contextBridge` for all IPC
- Validate all IPC messages in main process
- Never expose file paths or stack traces to renderer

### 8.3 Input Validation

- All MIDI values: Validate 0-127 range
- All channel values: Validate 1-16 range
- All preset JSON: Parse with Zod, reject on validation failure
- Search queries: Sanitize before filtering

---

## **Part 9: Performance Requirements**

### 9.1 MIDI Throughput

- Do NOT throttle inbound MIDI processing
- Batch UI updates using `requestAnimationFrame`
- LED updates: Max 1 per control per 50ms

### 9.2 React Optimization

- Control components use `React.memo()` with custom comparison
- Fine-grained Zustand selectors (one control per selector)
- SVG controls use CSS transforms (GPU-accelerated)

### 9.3 Benchmarks (Required)

| Metric | Target |
|--------|--------|
| 8 sliders moving simultaneously | 60fps |
| MIDI round-trip latency | <10ms |
| Preset load time | <100ms |
| Search filter response (1000 presets) | <50ms |
| App cold start | <3s |

---

## **Part 10: Import/Export**

### 10.1 Export Formats

- **Single preset:** `.nk2preset` (JSON with metadata)
- **Preset library:** `.nk2library` (ZIP containing all presets + metadata.json)

### 10.2 Import

- Drag-and-drop onto Librarian
- File picker dialog
- Validate imported presets against schema
- On validation failure, show detailed error and reject

### 10.3 Backup

- Manual "Export All" to `.nk2library`
- Optional: Keep last 5 versions of each preset (configurable)

---

## **Part 11: Build and Distribution**

### 11.1 Platform Requirements

**Linux:**
- ALSA: `sudo apt install libasound2-dev` (Debian/Ubuntu)
- ALSA: `sudo pacman -S alsa-lib` (Arch)
- User must be in `audio` group for MIDI access

**macOS:**
- CoreMIDI built-in
- Code signing required for distribution

**Windows:**
- WinMM built-in
- Some USB MIDI devices need manufacturer driver

### 11.2 Electron Builder Config

```json
{
  "appId": "com.nkeditor.nkEditor2",
  "productName": "nkEditor2",
  "directories": { "output": "dist" },
  "linux": {
    "target": ["AppImage", "deb"],
    "category": "Audio"
  },
  "mac": {
    "target": ["dmg", "zip"],
    "category": "public.app-category.music"
  },
  "win": {
    "target": ["nsis", "portable"]
  }
}
```

---

## **Part 12: Acceptance Criteria**

### 12.1 Cross-Platform

- [ ] Launches without errors on Windows 10/11, macOS 12+, Ubuntu 22.04, Arch Linux
- [ ] MIDI device auto-detected within 5 seconds of connection
- [ ] Presets created on one platform load correctly on others
- [ ] UI renders correctly at 100% and 150% system scaling

### 12.2 MIDI Functionality

- [ ] Moving physical fader updates UI within 50ms
- [ ] CC mapping changes reflected in MIDI output immediately
- [ ] LED states sync within 50ms of button press
- [ ] Soft Takeover prevents value jumps (test: fader at 0, target at 100)
- [ ] Device disconnect triggers error state within 2 seconds
- [ ] Device reconnect restores functionality without app restart

### 12.3 Librarian

- [ ] Create, rename, duplicate, and delete presets
- [ ] Presets persist after app restart
- [ ] Search returns results within 200ms for 100+ presets
- [ ] Favorites and group filters work correctly
- [ ] Quick Access (Track buttons) cycles through assigned presets

### 12.4 Editor

- [ ] All controls respond to MIDI input in real-time
- [ ] Custom labels persist in presets
- [ ] Undo/Redo works for all editable actions (50 levels)
- [ ] A/B comparison switches instantly

### 12.5 Settings

- [ ] Theme change applies without restart
- [ ] All settings persist after app restart
- [ ] Soft Takeover mode changes take effect immediately

### 12.6 Accessibility

- [ ] All controls keyboard navigable
- [ ] Screen reader announces control labels
- [ ] Color contrast meets WCAG AA standards

---

## **Part 13: Seed Data**

Include 5 example presets for testing:

1. **Default Passthrough** - All CCs mapped 1:1, channel 1
2. **DAW Mixer** - Sliders mapped to typical DAW mixer CCs
3. **Synthesizer Control** - Knobs mapped to filter, resonance, envelope
4. **Live Performance** - Buttons configured for scene triggers
5. **Random Test** - Randomized values and mappings

---

## **Part 14: Engineering Guidelines**

### 14.1 Code Standards

- TypeScript strict mode enabled
- ES Modules (ESM) throughout
- Functional React components with hooks
- No `any` types without explicit justification
- All exports typed
- JSDoc comments for public APIs

### 14.2 Implementation Requirements

- No placeholder code or TODO comments in production
- All MIDI logic fully implemented
- All error states handled with user feedback
- All features fully functional before delivery

### 14.3 Modularity

- MIDI handling completely separate from UI
- State management via Zustand only (no prop drilling)
- Reusable components for controls
- Shared schemas importable by both main and renderer

---

*End of Specification*
