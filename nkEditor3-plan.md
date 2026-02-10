# nkEditor3: Korg nanoKONTROL2 MIDI Remapper

## Project Overview

A two-phase project to build a CC remapper for the Korg nanoKONTROL2 MIDI controller:

- **Phase 1**: Command-line application (Linux-only)
- **Phase 2**: Electron GUI application (after CLI is stable and bug-free)

**Platform**: Linux only (ALSA/PipeWire)

---

## Phase 1: Command-Line Application

### 1.1 Core Functionality

The CLI application will:
1. Read CC mappings from a human-readable text configuration file
2. Connect to the nanoKONTROL2 MIDI input/output ports
3. Receive MIDI CC messages from the hardware
4. Remap input CCs to configured output CCs and channels
5. Send remapped MIDI messages to a virtual MIDI output port
6. Update LEDs on the hardware to reflect button states

### 1.2 Directory Structure

```
/nkEditor3
├── /src
│   ├── main.ts              # CLI entry point
│   ├── config-parser.ts     # Text config file parser
│   ├── midi-handler.ts      # MIDI I/O using easymidi
│   ├── midi-discovery.ts    # Port detection
│   ├── mapping-engine.ts    # CC remapping logic
│   ├── led-controller.ts    # LED state management
│   └── types.ts             # TypeScript interfaces
├── /mappings                 # User mapping files
│   └── default.txt          # Default 1:1 passthrough mapping
├── /test                     # Unit and integration tests
├── package.json
├── tsconfig.json
└── README.md
```

### 1.3 Human-Readable Mapping File Format

The mapping file uses a simple, line-based text format that is easy to read and edit.

**File: `mappings/default.txt`**

```
# nkEditor3 CC Mapping File
# Format: INPUT_CC -> OUTPUT_CC [CHANNEL] [BEHAVIOR] [LABEL]
#
# INPUT_CC:  The CC number received from the nanoKONTROL2 (0-127)
# OUTPUT_CC: The CC number to send (0-127)
# CHANNEL:   MIDI channel 1-16 (default: 1)
# BEHAVIOR:  For buttons only: toggle | momentary (default: toggle)
# LABEL:     Optional human-readable label (quoted if contains spaces)
#
# Lines starting with # are comments
# Blank lines are ignored

# ====================
# TRACK 1
# ====================
[track1]
knob    16 -> 16 ch1 "Filter Cutoff"
slider   0 ->  0 ch1 "Volume"
solo    32 -> 32 ch1 toggle "Solo"
mute    48 -> 48 ch1 toggle "Mute"
rec     64 -> 64 ch1 momentary "Record Arm"

# ====================
# TRACK 2
# ====================
[track2]
knob    17 -> 17 ch1 "Filter Resonance"
slider   1 ->  1 ch1 "Pan"
solo    33 -> 33 ch1 toggle
mute    49 -> 49 ch1 toggle
rec     65 -> 65 ch1 momentary

# ====================
# TRACK 3
# ====================
[track3]
knob    18 -> 18 ch1
slider   2 ->  2 ch1
solo    34 -> 34 ch1 toggle
mute    50 -> 50 ch1 toggle
rec     66 -> 66 ch1 momentary

# ====================
# TRACK 4
# ====================
[track4]
knob    19 -> 19 ch1
slider   3 ->  3 ch1
solo    35 -> 35 ch1 toggle
mute    51 -> 51 ch1 toggle
rec     67 -> 67 ch1 momentary

# ====================
# TRACK 5
# ====================
[track5]
knob    20 -> 20 ch1
slider   4 ->  4 ch1
solo    36 -> 36 ch1 toggle
mute    52 -> 52 ch1 toggle
rec     68 -> 68 ch1 momentary

# ====================
# TRACK 6
# ====================
[track6]
knob    21 -> 21 ch1
slider   5 ->  5 ch1
solo    37 -> 37 ch1 toggle
mute    53 -> 53 ch1 toggle
rec     69 -> 69 ch1 momentary

# ====================
# TRACK 7
# ====================
[track7]
knob    22 -> 22 ch1
slider   6 ->  6 ch1
solo    38 -> 38 ch1 toggle
mute    54 -> 54 ch1 toggle
rec     70 -> 70 ch1 momentary

# ====================
# TRACK 8
# ====================
[track8]
knob    23 -> 23 ch1
slider   7 ->  7 ch1
solo    39 -> 39 ch1 toggle
mute    55 -> 55 ch1 toggle
rec     71 -> 71 ch1 momentary

# ====================
# TRANSPORT
# ====================
[transport]
rewind      43 -> 43 ch1 momentary "Rewind"
forward     44 -> 44 ch1 momentary "Fast Forward"
stop        42 -> 42 ch1 momentary "Stop"
play        41 -> 41 ch1 toggle "Play"
record      45 -> 45 ch1 toggle "Record"
cycle       46 -> 46 ch1 toggle "Cycle/Loop"
track_left  58 -> 58 ch1 momentary "Track Left"
track_right 59 -> 59 ch1 momentary "Track Right"
marker_set  60 -> 60 ch1 momentary "Set Marker"
marker_left 61 -> 61 ch1 momentary "Previous Marker"
marker_right 62 -> 62 ch1 momentary "Next Marker"
```

### 1.4 CLI Interface

```bash
# Basic usage - uses default mapping file
nkeditor3

# Specify a mapping file
nkeditor3 -m mappings/my-daw-setup.txt

# List available MIDI ports
nkeditor3 --list-ports

# Specify MIDI ports explicitly
nkeditor3 --input "nanoKONTROL2:nanoKONTROL2 MIDI 1" --output "Virtual Output"

# Verbose/debug mode
nkeditor3 -v
nkeditor3 --debug

# Validate a mapping file without running
nkeditor3 --validate mappings/my-setup.txt

# Show help
nkeditor3 --help
```

### 1.5 CLI Output Example

```
nkEditor3 v1.0.0 - Korg nanoKONTROL2 MIDI Remapper

[INFO] Loading mapping file: mappings/default.txt
[INFO] Parsed 53 CC mappings
[INFO] Scanning for MIDI ports...
[INFO] Found nanoKONTROL2 input: "nanoKONTROL2:nanoKONTROL2 MIDI 1 24:0"
[INFO] Found nanoKONTROL2 output: "nanoKONTROL2:nanoKONTROL2 MIDI 1 24:0"
[INFO] Creating virtual output port: "nkEditor3 Out"
[INFO] Connected successfully. Remapping active.
[INFO] Press Ctrl+C to exit.

[CC] Track1 Slider: 64 -> ch1 cc0 val:64
[CC] Track1 Knob: 100 -> ch1 cc16 val:100
[CC] Track1 Solo (toggle): ON -> ch1 cc32 val:127
[LED] Track1 Solo: ON
```

### 1.6 Technology Stack (CLI)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20+ | JavaScript runtime |
| Language | TypeScript (strict mode) | Type safety |
| MIDI I/O | easymidi (node-midi) | Hardware communication |
| CLI Parsing | commander | Argument parsing |
| Build | esbuild | Fast bundling |
| Testing | vitest | Unit/integration tests |

---

## Phase 1 Implementation Breakdown

### Sprint 1.1: Project Setup & Config Parser

**Goal**: Set up project structure and implement the text file parser.

**Tasks**:
1. Initialize Node.js project with TypeScript
2. Configure ESLint, Prettier, and tsconfig.json
3. Implement `config-parser.ts`:
   - Parse the human-readable mapping file format
   - Validate CC ranges (0-127), channels (1-16)
   - Handle comments, blank lines, sections
   - Return structured mapping data
4. Write unit tests for parser
5. Create default mapping file

**Deliverables**:
- Working parser that can read and validate mapping files
- Unit tests with >90% coverage for parser
- Default mapping file

**Acceptance Criteria**:
- [ ] Parser correctly reads all sections (track1-8, transport)
- [ ] Parser validates CC ranges and channel numbers
- [ ] Parser handles comments and blank lines
- [ ] Parser reports clear error messages with line numbers
- [ ] Parser handles quoted labels with spaces
- [ ] Unit tests pass

---

### Sprint 1.2: MIDI Discovery & Connection

**Goal**: Implement MIDI port discovery and connection logic.

**Tasks**:
1. Implement `midi-discovery.ts`:
   - Enumerate available MIDI input/output ports
   - Auto-detect nanoKONTROL2 using port name pattern
   - Handle port name variations on Linux
2. Implement basic MIDI connection in `midi-handler.ts`:
   - Open input port (from hardware)
   - Open output port (to hardware, for LEDs)
   - Create virtual MIDI output port for remapped CCs
3. Implement hot-plug detection (poll every 2 seconds)
4. Write unit tests

**Deliverables**:
- Working MIDI port discovery
- Ability to connect/disconnect from device
- Virtual MIDI output port creation

**Acceptance Criteria**:
- [ ] `--list-ports` shows all available MIDI ports
- [ ] Auto-detects nanoKONTROL2 within 5 seconds
- [ ] Creates virtual output port visible to other apps (e.g., aconnect)
- [ ] Handles device disconnect gracefully
- [ ] Handles device reconnect automatically
- [ ] Unit tests pass

---

### Sprint 1.3: CC Remapping Engine

**Goal**: Implement the core CC remapping logic.

**Tasks**:
1. Implement `mapping-engine.ts`:
   - Receive CC from hardware
   - Look up mapping for input CC
   - Transform to output CC and channel
   - Handle toggle vs momentary button behavior
   - Track button states for toggle buttons
2. Integrate with MIDI handler:
   - Receive messages from hardware
   - Send remapped messages to virtual output
3. Write integration tests

**Deliverables**:
- Working CC remapping
- Toggle/momentary button handling
- Button state tracking

**Acceptance Criteria**:
- [ ] Continuous controls (knobs, sliders) remap correctly
- [ ] Toggle buttons alternate between 127 and 0
- [ ] Momentary buttons send 127 on press, 0 on release
- [ ] Remapped messages appear on virtual output port
- [ ] MIDI latency < 10ms
- [ ] Integration tests pass

---

### Sprint 1.4: LED Controller

**Goal**: Implement LED synchronization with button states.

**Tasks**:
1. Implement `led-controller.ts`:
   - Track LED states for all buttons
   - Send LED updates to hardware output port
   - Sync LEDs on connection/reconnection
2. Integrate LED updates with mapping engine:
   - Update LEDs when toggle buttons change state
   - Flash LEDs for momentary buttons
3. Write tests

**Deliverables**:
- Working LED control
- LED sync on startup

**Acceptance Criteria**:
- [ ] Toggle button LEDs reflect current state
- [ ] Momentary button LEDs light while pressed
- [ ] LEDs sync correctly on app startup
- [ ] LEDs sync correctly after device reconnect
- [ ] Tests pass

---

### Sprint 1.5: CLI Interface & Integration

**Goal**: Complete the CLI interface and perform end-to-end testing.

**Tasks**:
1. Implement `main.ts` with commander:
   - Parse command-line arguments
   - Load and validate mapping file
   - Initialize MIDI connections
   - Run main event loop
   - Handle graceful shutdown (Ctrl+C)
2. Implement verbose and debug output modes
3. Implement `--validate` flag for mapping file validation
4. Write end-to-end integration tests
5. Create README with usage instructions

**Deliverables**:
- Complete working CLI application
- README with installation and usage instructions
- End-to-end test suite

**Acceptance Criteria**:
- [ ] `nkeditor3` runs with default settings
- [ ] `nkeditor3 -m file.txt` loads specified mapping
- [ ] `nkeditor3 --list-ports` shows available ports
- [ ] `nkeditor3 --validate file.txt` validates without running
- [ ] Ctrl+C exits gracefully
- [ ] Verbose mode shows MIDI messages in real-time
- [ ] All tests pass
- [ ] No memory leaks in 1-hour stress test

---

### Sprint 1.6: Polish & Bug Fixes

**Goal**: Address bugs, improve error handling, and prepare for release.

**Tasks**:
1. Fix any bugs discovered during testing
2. Improve error messages and user feedback
3. Add logging with configurable levels
4. Test on multiple Linux distributions:
   - Ubuntu 22.04+
   - Arch Linux
   - Fedora
5. Test with ALSA and PipeWire
6. Performance optimization if needed
7. Create installation instructions for each distro

**Deliverables**:
- Stable, bug-free CLI application
- Installation guides for major distros
- Release-ready package

**Acceptance Criteria**:
- [ ] Works on Ubuntu 22.04 with ALSA
- [ ] Works on Arch Linux with PipeWire
- [ ] Works on Fedora
- [ ] No crashes or hangs during extended use
- [ ] All edge cases handled gracefully
- [ ] Installation instructions tested on fresh systems

---

## Hardware Reference

### Standard Factory CC Mapping

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

### LED Control Protocol

LEDs are controlled by sending CC messages **to** the device:

| Control Type | CC Range | LED On | LED Off |
|--------------|----------|--------|---------|
| Solo (Track 1-8) | CC 32-39 | 127 | 0 |
| Mute (Track 1-8) | CC 48-55 | 127 | 0 |
| Record (Track 1-8) | CC 64-71 | 127 | 0 |
| Transport | CC 41-46 | 127 | 0 |

### Entering CC Mode

The device must be in CC Mode. Instructions:
1. Hold **SET MARKER** + **CYCLE** buttons simultaneously
2. LEDs will flash to confirm mode change
3. Device is now in CC Mode (not DAW Mode)

---

## Linux MIDI Requirements

### ALSA (Default)

```bash
# Debian/Ubuntu
sudo apt install libasound2-dev

# Arch Linux
sudo pacman -S alsa-lib

# Fedora
sudo dnf install alsa-lib-devel
```

### User Permissions

The user must be in the `audio` group for MIDI access:
```bash
sudo usermod -aG audio $USER
# Log out and back in for changes to take effect
```

### PipeWire Compatibility

PipeWire's ALSA compatibility layer should work automatically. The app should detect and use whatever MIDI subsystem is available.

---

## Phase 2: Electron GUI Application

**Prerequisites**: Phase 1 CLI is complete, stable, and bug-free.

Phase 2 will add a graphical user interface using Electron. The CLI core (MIDI handling, mapping engine, LED controller) will be reused in the Electron main process.

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Electron App                      │
├─────────────────────────────────────────────────────┤
│  Main Process (Node.js)                             │
│  ├── MIDI Handler (reused from CLI)                 │
│  ├── Mapping Engine (reused from CLI)              │
│  ├── LED Controller (reused from CLI)              │
│  ├── File Manager (preset CRUD)                    │
│  └── IPC Bridge                                     │
├─────────────────────────────────────────────────────┤
│  Renderer Process (React)                           │
│  ├── Visual Editor (SVG nanoKONTROL2 representation)│
│  ├── Preset Librarian                              │
│  ├── Settings Panel                                │
│  └── Help/Documentation                            │
└─────────────────────────────────────────────────────┘
```

### 2.2 GUI Features (Planned)

- Visual representation of nanoKONTROL2 with interactive controls
- Real-time visual feedback when moving physical controls
- Click-to-edit CC mappings on any control
- Preset librarian for saving/loading configurations
- Soft takeover for preset switching
- A/B comparison between presets
- Dark/light theme support
- Keyboard shortcuts

### 2.3 Technology Stack (GUI)

| Component | Technology |
|-----------|------------|
| Desktop Shell | Electron |
| Frontend | React 18+ |
| State Management | Zustand |
| Validation | Zod |
| Build | Vite + electron-builder |
| Styling | Tailwind CSS or CSS Modules |

Phase 2 detailed specifications will be developed after Phase 1 is complete.

---

## Project Timeline Overview

| Phase | Sprint | Focus | Duration |
|-------|--------|-------|----------|
| 1 | 1.1 | Project setup + Config parser | 1 week |
| 1 | 1.2 | MIDI discovery + Connection | 1 week |
| 1 | 1.3 | CC remapping engine | 1 week |
| 1 | 1.4 | LED controller | 3-4 days |
| 1 | 1.5 | CLI interface + Integration | 1 week |
| 1 | 1.6 | Polish + Bug fixes | 1 week |
| - | - | **Phase 1 Complete** | - |
| 2 | 2.x | Electron GUI | TBD |

---

## Team Responsibilities

### Phase 1 can be divided among team members:

| Role | Responsibilities |
|------|------------------|
| **Developer A** | Config parser (Sprint 1.1), CLI interface (Sprint 1.5) |
| **Developer B** | MIDI discovery and handler (Sprint 1.2) |
| **Developer C** | Mapping engine (Sprint 1.3), LED controller (Sprint 1.4) |
| **All** | Integration testing, bug fixes (Sprint 1.6) |

### Coordination Points

- Shared TypeScript interfaces in `types.ts` must be agreed upon early
- Integration points between modules should be documented
- Daily syncs recommended during integration phase

---

## Success Criteria for Phase 1 Completion

Before proceeding to Phase 2, **all** of the following must be true:

- [ ] All 6 sprints completed with acceptance criteria met
- [ ] Zero known bugs in production code
- [ ] Works reliably on Ubuntu, Arch, and Fedora
- [ ] Works with both ALSA and PipeWire
- [ ] Documentation complete and tested
- [ ] Code reviewed and merged to main branch
- [ ] Stress test passed (1+ hour continuous operation)
- [ ] At least 3 users have tested and provided feedback

---

*End of Phase 1 Specification*
