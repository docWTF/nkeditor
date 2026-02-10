# Save Preset Button Fix + Feature Implementation Plan

## Part 1: Save Preset Button Bug Fix

### Problem Statement
The "Save Preset" button in the Editor doesn't recognize when slider/knob positions have changed. Users cannot save after moving a slider.

### Root Cause Analysis
Debug analysis found:

1. **`markUnsavedChanges()` exists but is never called** - The method is defined in `preset.ts` but has zero callers anywhere in the codebase.

2. **Two separate stores with no communication:**
   - `useControlsStore` (controls.ts) - manages slider/knob/button values
   - `usePresetStore` (preset.ts) - manages `hasUnsavedChanges` flag

3. **Flow breakdown:**
   ```
   User moves slider
          ↓
   Slider.tsx calls onValueChange()
          ↓
   Track.tsx handleSliderChange() calls updateControl()
          ↓
   controlsStore updates UI value
          ↓
   [MISSING: presetStore.markUnsavedChanges()]
          ↓
   Save button stays disabled (hasUnsavedChanges = false)
   ```

4. **Misleading UI text** - EditorView.tsx line 68 says "Presets save CC mappings only, not slider/knob positions" but the code DOES save control values via `captureControlValues()`.

### Fix Implementation

#### File: `src/renderer/components/Editor/Track.tsx`

Add `markUnsavedChanges()` calls to all control handlers:

```typescript
import { usePresetStore } from '../../stores/preset';

// In handleKnobChange:
const handleKnobChange = (value: number) => {
  updateControl(`track${trackNumber}.knob`, value);
  // ... MIDI send code ...

  // Mark preset as having unsaved changes
  usePresetStore.getState().markUnsavedChanges();
};

// In handleSliderChange:
const handleSliderChange = (value: number) => {
  updateControl(`track${trackNumber}.slider`, value);
  // ... MIDI send code ...

  // Mark preset as having unsaved changes
  usePresetStore.getState().markUnsavedChanges();
};

// In handleButtonClick:
const handleButtonClick = (buttonType: 'solo' | 'mute' | 'rec') => {
  updateButton(`track${trackNumber}.${buttonType}`, newActive);
  // ... MIDI send code ...

  // Mark preset as having unsaved changes
  usePresetStore.getState().markUnsavedChanges();
};
```

#### File: `src/renderer/components/Editor/Transport.tsx`

Add `markUnsavedChanges()` to transport button handler:

```typescript
import { usePresetStore } from '../../stores/preset';

const handleTransportClick = (controlName: string) => {
  updateButton(`transport.${controlName}`, newActive);
  // ... MIDI send code ...

  // Mark preset as having unsaved changes
  usePresetStore.getState().markUnsavedChanges();
};
```

#### File: `src/renderer/components/Editor/EditorView.tsx`

Remove misleading text at lines 67-69:
```typescript
// REMOVE or UPDATE this:
<div className="text-xs text-gray-600">
  Presets save CC mappings only, not slider/knob positions
</div>

// REPLACE with:
<div className="text-xs text-gray-600">
  Presets save CC mappings and control positions
</div>
```

---

## Part 2: nanoKONTROL2 Feature Implementation

Based on research of the official [KORG KONTROL Editor](https://www.korg.com/us/support/download/software/0/159/1355/) and [nanoKONTROL2 product page](https://www.korg.com/us/products/computergear/nanokontrol2/), here are the features to consider:

### Hardware Control Features

| Feature | Description | Include? |
|---------|-------------|----------|
| **8 Track Channels** | Knob, slider, 3 buttons per track | Already implemented |
| **Transport Controls** | Play, Stop, Rec, RW, FF, Cycle | Already implemented |
| **Marker Controls** | Set, Left, Right markers | Already implemented |
| **Track Navigation** | Track Left/Right buttons | Already implemented |

### Per-Control Settings (KORG Editor Features)

| Feature | Description | Include? |
|---------|-------------|----------|
| **CC Number Assignment** | Set output CC for each control | Already implemented |
| **MIDI Channel Assignment** | Set output channel (1-16) per control | Already implemented |
| **Control Label** | Custom name for each control | Already implemented |
| **Min/Max Value Range** | Limit output range (e.g., 0-100 instead of 0-127) | TBD |
| **Button Behavior** | Toggle vs Momentary mode | Already implemented |
| **Button On/Off Values** | Custom CC values for on/off states | TBD |

### Global Settings (KORG Editor Features)

| Feature | Description | Include? |
|---------|-------------|----------|
| **Global MIDI Channel** | Default channel for all controls | TBD |
| **LED Mode** | Internal (button state) vs External (software controlled) | TBD |
| **Control Mode** | CC mode, Note mode, or other | TBD |

### Scene/Preset Management

| Feature | Description | Include? |
|---------|-------------|----------|
| **Scene Sets** | Multiple preset configurations | Already implemented (presets) |
| **Save to Device** | Write settings to hardware | TBD |
| **Load from Device** | Read settings from hardware | TBD |
| **Import/Export** | File-based preset sharing | TBD |

### Advanced Features

| Feature | Description | Include? |
|---------|-------------|----------|
| **Soft Takeover** | Prevent value jumps | Already implemented (in settings) |
| **A/B Comparison** | Compare two presets | Partially implemented |
| **Quick Access Slots** | Fast preset switching | TBD |
| **Undo/Redo** | Revert changes | TBD |

---

## Part 3: Feature Decisions Summary

Based on interactive discussion, here are the confirmed feature implementations:

### Features to Implement

| Feature | Priority | Description |
|---------|----------|-------------|
| **Save Preset Bug Fix** | P0 | Fix `markUnsavedChanges()` not being called |
| **Min/Max Value Range** | P1 | Add min/max fields per control (e.g., 20-100 instead of 0-127) |
| **Button On/Off Values** | P1 | Custom CC values for button states (e.g., On=100, Off=10) |
| **Global MIDI Channel** | P1 | Default channel setting in Settings |
| **LED Mode** | P1 | Internal (button state) vs External (DAW controlled) toggle |
| **Import/Export Presets** | P2 | Export/import presets as .json files for sharing |
| **Quick Access Slots** | P2 | 5 preset slots, cycle with Track L/R buttons |
| **Undo/Redo** | P2 | 50-level undo/redo stack for all editable actions |
| **A/B Comparison** | P3 | Complete with visual diff highlighting between presets |

### Features NOT to Implement

| Feature | Reason |
|---------|--------|
| SysEx Device Sync | User declined - file-based presets sufficient |
| Control Mode (CC/Note) | User declined - CC mode only |
| MIDI Learn | User declined - manual CC entry sufficient |
| DAW Templates | User declined - users create own presets |

---

## Part 4: Implementation Plan

### Phase 1: Bug Fixes (Immediate)
1. Fix Save Preset button (`markUnsavedChanges()` calls)
2. Update misleading UI text

### Phase 2: Per-Control Features
1. Add `minValue` and `maxValue` to MappingEntry schema
2. Add `onValue` and `offValue` to button MappingEntry
3. Update ControlPopover to edit these fields
4. Update MIDI output to respect min/max range

### Phase 3: Global Settings
1. Add `globalMidiChannel` to AppConfig
2. Add `ledMode: 'internal' | 'external'` to AppConfig
3. Update Settings UI with these options
4. Wire LED mode to LED controller

### Phase 4: Preset Management
1. Implement import/export buttons in Librarian
2. Add Quick Access slot bar UI
3. Wire Track L/R buttons to cycle Quick Access slots

### Phase 5: Undo/Redo
1. Create undo store with action stack
2. Wrap editable actions in undoable commands
3. Add Ctrl+Z/Y keyboard shortcuts
4. Add undo/redo buttons in UI

### Phase 6: A/B Comparison
1. Complete A/B slot management
2. Add visual diff highlighting between A and B
3. Add toggle button to switch between A/B
