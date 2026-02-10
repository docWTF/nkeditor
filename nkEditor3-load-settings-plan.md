# Preset Loading Feature - Revised Rewrite Plan

## Problem Statement

The preset loading feature is not working correctly. When a user clicks "Load" on a preset in the Librarian:
1. **GUI controls (knobs, sliders) do NOT update** to reflect the loaded preset values
2. **Synth does NOT receive MIDI CC messages** for the loaded values

**Hypothesis**: Button states may be interfering with the load operation - either causing errors or sending problematic MIDI that affects synth behavior.

## Critical Requirement: GUI Must Reflect Loaded State

**When a preset is loaded, the Editor view MUST immediately show:**
- All 8 knobs at their stored positions (0-127)
- All 8 sliders at their stored positions (0-127)
- All button states (solo, mute, rec) reflecting stored on/off states
- All transport button states reflecting stored on/off states

**Visual confirmation is essential** - the user must SEE that the preset loaded correctly.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RENDERER PROCESS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │ PresetList  │───>│ PresetStore │───>│ControlStore │───>│   EDITOR    │  │
│  │ (Load btn)  │    │ loadPreset()│    │applyPreset()│    │  GUI VIEW   │  │
│  └─────────────┘    └──────┬──────┘    └──────┬──────┘    │             │  │
│                            │                   │           │ ┌─────────┐ │  │
│                            │                   │           │ │ KNOBS   │ │  │
│                            │                   │           │ │ must    │ │  │
│                            │                   │           │ │ update! │ │  │
│                            │                   │           │ ├─────────┤ │  │
│                            │                   │           │ │ SLIDERS │ │  │
│                            │                   │           │ │ must    │ │  │
│                            │                   │           │ │ update! │ │  │
│                            │                   │           │ └─────────┘ │  │
│                            │ IPC               │ IPC       └─────────────┘  │
└────────────────────────────┼───────────────────┼────────────────────────────┘
                             │                   │
                             ▼                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              MAIN PROCESS                                   │
├────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │FileManager  │    │ MidiManager │    │MappingEngine│    │ VirtualPort │  │
│  │(load preset)│    │loadMapping()│    │  processCC  │    │  (to synth) │  │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## New Feature: Button Transmission Toggle

**Location**: Settings Tab

**Purpose**: Allow users to disable button MIDI transmission when loading presets, in case button states are causing synth problems.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Settings                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MIDI Output                                                                 │
│  ───────────────────────────────────────────────────────────────────────    │
│                                                                              │
│  [ ] Transmit button states on preset load                                   │
│      When disabled, only knob and slider values are                          │
│      sent to synth. Button states still update GUI.                          │
│                                                                              │
│  This can help if button MIDI messages (CC 127/0)                            │
│  are causing issues with your synth or DAW.                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior**:
- **Enabled (default)**: Load preset sends MIDI CC for knobs, sliders, AND buttons
- **Disabled**: Load preset sends MIDI CC for knobs and sliders ONLY; buttons update GUI but don't transmit

## Complete Data Flow for Load Preset

### Step 1: User Action
- User clicks "Load" button in `PresetList.tsx`
- Calls `presetStore.loadPreset(id)`

### Step 2: IPC to Main Process
- `loadPreset()` calls `api.loadPreset({ id })`
- Main process `FileManager` reads preset JSON from disk
- Returns full `Preset` object including `mapping` and `controlValues`

### Step 3: Apply Mapping to MIDI Manager
- `loadPreset()` calls `api.applyMapping({ mapping })`
- Main process `MidiManager.loadMapping()` updates `MappingEngine`
- Syncs LED states on hardware via `LedController`

### Step 4: Apply Control Values to GUI (CRITICAL)

**This step MUST update the GUI controls store so that the Editor view reflects the loaded state.**

```typescript
applyPresetValues(controlValues, mapping, transmitButtons):

  // STEP 4a: Build new GUI state for ALL controls
  FOR each track (1-8):
    newTrack.knob.value = controlValues.tracks[i].knob      // 0-127
    newTrack.slider.value = controlValues.tracks[i].slider  // 0-127
    newTrack.solo.active = controlValues.tracks[i].solo     // true/false
    newTrack.mute.active = controlValues.tracks[i].mute     // true/false
    newTrack.rec.active = controlValues.tracks[i].rec       // true/false
    // Apply labels from mapping
    newTrack.knob.label = mapping.tracks[i].knob.label
    newTrack.slider.label = mapping.tracks[i].slider.label
    // ... etc

  // STEP 4b: Send MIDI CC to synth for KNOBS (always)
  FOR each track (1-8):
    api.sendCC(channel, outputCC, knobValue)

  // STEP 4c: Send MIDI CC to synth for SLIDERS (always)
  FOR each track (1-8):
    api.sendCC(channel, outputCC, sliderValue)

  // STEP 4d: Send MIDI CC to synth for BUTTONS (conditional)
  IF transmitButtons ENABLED:
    FOR each button (solo, mute, rec x 8 tracks):
      api.sendCC(channel, outputCC, active ? 127 : 0)
    FOR each transport button:
      api.sendCC(channel, outputCC, active ? 127 : 0)

  // STEP 4e: Update Zustand store state (triggers React re-render)
  set({ tracks: newTracks, transport: newTransport })

  // GUI NOW REFLECTS LOADED VALUES
```

### Step 5: Update Preset Store State
- `presetStore` sets `currentPreset`, `selectedId`, `hasUnsavedChanges`

## Subagent Assignments

### Debug-Orchestrator Agent 1: Diagnose GUI Update Failure
- **Focus**: Why don't knobs and sliders update visually?
- Trace from `applyPresetValues()` to React component re-render
- Check if Zustand `set()` is being called with new values
- Verify React components subscribe to controls store correctly
- Check if there are any errors thrown before `set()` is called

### Debug-Orchestrator Agent 2: Diagnose MIDI Transmission
- **Focus**: Are MIDI CC messages being sent? Are buttons the problem?
- Check if `api.sendCC()` is being called
- Verify channel and CC number correctness
- Test what happens if button transmission is skipped
- Check if button MIDI (CC 127/0) is causing synth issues

### MIDI-UI-Architect Agent 1: Redesign applyPresetValues()
- **Focus**: Ensure GUI updates happen correctly
- Separate GUI state update from MIDI transmission
- Ensure `set()` is called even if MIDI fails
- Add proper error boundaries
- Guarantee knobs/sliders update visually

### MIDI-UI-Architect Agent 2: Implement Button Toggle Feature
- **Focus**: Add settings toggle for button transmission
- Add `transmitButtonsOnLoad` to AppConfig
- Update Settings UI with toggle
- Pass setting to `applyPresetValues()`
- Ensure GUI always updates regardless of toggle

### MIDI-UI-Architect Agent 3: Add Debug Visualization
- **Focus**: Make it easy to verify preset loaded correctly
- Add JSON view of control values in Librarian
- Add visual indicator in Editor when preset loads
- Show toast/notification with loaded values summary
- Add console logging for debugging

### Expert-Coder Agent 1: Rewrite Core Loading Logic
- **Focus**: Bulletproof the load sequence
- Rewrite `loadPreset()` in preset store with error handling
- Rewrite `applyPresetValues()` to guarantee GUI update
- Add the `transmitButtons` parameter
- Ensure atomic state updates

### Expert-Coder Agent 2: Rewrite UI Integration
- **Focus**: Visual feedback and Settings toggle
- Update `PresetList.tsx` with loading states
- Add Settings toggle for button transmission
- Implement JSON debug view
- Add success/failure feedback

## Key Code Changes Required

### 1. `src/shared/ipc-protocol.ts` - Add to AppConfig
```typescript
interface AppConfig {
  // ... existing fields
  /** Whether to transmit button MIDI on preset load */
  transmitButtonsOnLoad: boolean;  // NEW - default: true
}
```

### 2. `src/renderer/stores/controls.ts` - Revised `applyPresetValues()`
```typescript
applyPresetValues: async (controlValues, mapping, transmitButtons = true) => {
  const api = getElectronAPI();

  // ALWAYS build new GUI state (even if MIDI fails)
  const newTracks: TrackState[] = [];
  for (let i = 0; i < 8; i++) {
    const values = controlValues.tracks[i];
    const map = mapping.tracks[i];

    newTracks.push({
      knob: { value: values.knob, label: map.knob.label },
      slider: { value: values.slider, label: map.slider.label },
      solo: { active: values.solo, label: map.solo.label },
      mute: { active: values.mute, label: map.mute.label },
      rec: { active: values.rec, label: map.rec.label },
    });
  }

  // Build transport state
  const newTransport = { /* ... */ };

  // UPDATE GUI FIRST (before MIDI transmission)
  set({ tracks: newTracks, transport: newTransport });

  // THEN send MIDI (failures won't affect GUI)
  if (api) {
    // Always send knobs and sliders
    for (let i = 0; i < 8; i++) { /* sendCC for knobs/sliders */ }

    // Conditionally send buttons
    if (transmitButtons) {
      for (let i = 0; i < 8; i++) { /* sendCC for buttons */ }
      // Transport buttons...
    }
  }
}
```

### 3. `src/renderer/components/Settings/SettingsView.tsx` - Add Toggle
```typescript
// Add toggle for button transmission
<label>
  <input
    type="checkbox"
    checked={config.transmitButtonsOnLoad}
    onChange={(e) => updateConfig({ transmitButtonsOnLoad: e.target.checked })}
  />
  Transmit button states on preset load
</label>
<p className="text-xs text-gray-500">
  When disabled, only knob and slider values are sent to synth.
  Button states still update in the GUI.
</p>
```

### 4. `src/renderer/components/Librarian/PresetList.tsx` - JSON Debug View
```typescript
// In expanded preset details, add:
<div className="mt-2">
  <button onClick={toggleJsonView}>Show Control Values JSON</button>
  {showJson && (
    <pre className="text-xs bg-gray-800 p-2 rounded overflow-auto">
      {JSON.stringify(preset.controlValues, null, 2)}
    </pre>
  )}
</div>
```

## Verification Checklist

### GUI Updates (CRITICAL)
- [ ] Load preset with slider 1 at 100 → Editor shows slider 1 at 100
- [ ] Load preset with all knobs at 64 → Editor shows all knobs at 64
- [ ] Load preset with all sliders at 0 → Editor shows all sliders at 0
- [ ] Load preset with solo buttons on → Editor shows solo LEDs lit
- [ ] GUI updates even if MIDI transmission fails

### MIDI Output
- [ ] Load preset → Synth receives knob CC values
- [ ] Load preset → Synth receives slider CC values
- [ ] With button toggle ON → Synth receives button CC values
- [ ] With button toggle OFF → Synth does NOT receive button CC values

### Button Toggle Feature
- [ ] Toggle appears in Settings tab
- [ ] Toggle state persists after restart
- [ ] When OFF, buttons update GUI but don't send MIDI
- [ ] When ON, buttons update GUI AND send MIDI

### Debug Features
- [ ] JSON view shows control values in Librarian
- [ ] Console logs MIDI CC messages being sent
- [ ] Error states are displayed to user
