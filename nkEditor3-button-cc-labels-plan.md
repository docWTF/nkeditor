# Button CC Editing & Control Labels Implementation Plan

## Problem Statement

1. **Transport buttons missing CC editing** - Transport buttons (play, stop, record, etc.) cannot be right-clicked to edit their CC target assignments, unlike track buttons (solo, mute, rec).

2. **Labels need to be editable and saved** - All controls (sliders, knobs, buttons) should have editable text labels that are saved within presets.

## Root Cause Analysis

### Transport Buttons Issue

**Button.tsx** (track buttons) HAS popover integration:
```typescript
// Has state for popover
const [popoverState, setPopoverState] = useState({ isOpen: false, x: 0, y: 0 });

// Has right-click handler
const handleContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  openPopover(e.clientX, e.clientY);
};

// Has Ctrl+click handler
const handleClick = (e: React.MouseEvent) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    openPopover(e.clientX, e.clientY);
    return;
  }
  if (onClick) { onClick(); }
};

// Renders ControlPopover
{popoverState.isOpen && (
  <ControlPopover controlId={controlId} controlKind="button" ... />
)}
```

**TransportButton in Transport.tsx** is MISSING all of this:
```typescript
function TransportButton({ label, active, controlId, hasLed, ledColor, onClick }: TransportButtonProps) {
  // NO popover state
  // NO handleContextMenu
  // NO Ctrl+click detection
  // NO ControlPopover render
  return (
    <div onClick={onClick}> ... </div>  // Simple click only
  );
}
```

### Labels Currently Work (Verification Needed)

- ControlPopover already has a label input field (lines 444-458)
- Labels are stored in MappingEntry.label
- Labels are rendered in Knob.tsx and Slider.tsx
- Button.tsx passes labels to display

**Needs verification**: Are labels being properly saved to presets and restored on load?

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EDITOR VIEW                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Track Controls (8x)                    Transport Controls                   │
│  ┌──────────────┐                       ┌──────────────────────────────┐    │
│  │ Knob         │ ← Has Popover ✓       │ TransportButton              │    │
│  │ - label      │                       │ - play, stop, record, etc.   │    │
│  │ - CC edit    │                       │ - MISSING Popover ✗          │    │
│  ├──────────────┤                       │ - Needs CC editing           │    │
│  │ Slider       │ ← Has Popover ✓       │ - Needs label editing        │    │
│  │ - label      │                       └──────────────────────────────┘    │
│  │ - CC edit    │                                                           │
│  ├──────────────┤                                                           │
│  │ Button (S/M/R)│ ← Has Popover ✓                                          │
│  │ - label      │                                                           │
│  │ - CC edit    │                                                           │
│  └──────────────┘                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ControlPopover                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Label Input     │  │ Output CC       │  │ Channel         │             │
│  │ (editable)      │  │ (editable)      │  │ (editable)      │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Behavior        │  │ Min/Max (cont.) │  │ On/Off (button) │             │
│  │ (toggle/moment) │  │ (knob/slider)   │  │ (button only)   │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Fix Transport Buttons (Priority)

#### File: `src/renderer/components/Editor/Transport.tsx`

**Option A**: Add popover integration to TransportButton (similar to Button.tsx)

```typescript
function TransportButton({ ... }: TransportButtonProps): React.ReactElement {
  // Add popover state
  const [popoverState, setPopoverState] = useState({ isOpen: false, x: 0, y: 0 });

  const openPopover = (x: number, y: number) => {
    setPopoverState({ isOpen: true, x, y });
  };

  const closePopover = () => {
    setPopoverState({ isOpen: false, x: 0, y: 0 });
  };

  // Add Ctrl+click handler
  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      openPopover(e.clientX, e.clientY);
      return;
    }
    if (onClick) { onClick(); }
  };

  // Add right-click handler
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openPopover(e.clientX, e.clientY);
  };

  return (
    <div
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      ...
    >
      {/* ... existing content ... */}

      {/* Add ControlPopover */}
      {popoverState.isOpen && (
        <ControlPopover
          controlId={controlId}
          controlKind="button"
          position={{ x: popoverState.x, y: popoverState.y }}
          onClose={closePopover}
        />
      )}
    </div>
  );
}
```

### Phase 2: Verify Label Flow

#### Check 1: Labels in Store State
- `controls.ts` TrackState should include labels
- `preset.ts` should save labels when capturing state
- Labels should be restored on preset load

#### Check 2: Labels in Mapping
- MappingEntry.label is used in ControlPopover
- updateMapping should persist label changes
- Preset save should include mapping with labels

#### Check 3: Labels in UI
- Knob.tsx displays label prop
- Slider.tsx displays label prop
- Button.tsx displays label prop
- TransportButton needs to display label

### Phase 3: Ensure Labels Save/Load Correctly

#### File: `src/renderer/stores/preset.ts`

Verify `captureControlValues()` includes labels or mapping is saved separately.

#### File: `src/renderer/stores/controls.ts`

Verify `applyPresetValues()` restores labels from preset.

## Subagent Assignments

### Expert-Coder Agent 1: Fix TransportButton Popover
- **Focus**: Add ControlPopover integration to TransportButton
- Add popover state and handlers
- Render ControlPopover with controlKind="button"
- Ensure right-click and Ctrl+click work
- Test with transport buttons (play, stop, record, etc.)

### Expert-Coder Agent 2: Verify Label Save/Load Flow
- **Focus**: Ensure labels are properly persisted
- Trace label data from UI → store → preset file → restored
- Fix any gaps in label persistence
- Verify labels appear after preset load

### Debug-Orchestrator Agent 1: Test Transport Button CC Editing
- **Focus**: Verify transport CC editing works end-to-end
- Right-click on transport button → popover opens
- Change CC number → mapping updates
- Save preset → CC mapping persisted
- Load preset → CC mapping restored

### Debug-Orchestrator Agent 2: Test Label Persistence
- **Focus**: Verify all control labels persist
- Edit knob label → save preset → load preset → label restored
- Edit slider label → save preset → load preset → label restored
- Edit button label → save preset → load preset → label restored
- Edit transport label → save preset → load preset → label restored

### MIDI-UI-Architect Agent 1: Review Transport Architecture
- **Focus**: Ensure TransportButton follows same patterns as Button
- Review Button.tsx patterns for reference
- Apply consistent patterns to TransportButton
- Consider extracting shared popover logic to hook

### MIDI-UI-Architect Agent 2: Review Label Display
- **Focus**: Ensure labels are displayed consistently
- Verify Knob shows label
- Verify Slider shows label
- Verify Button shows label
- Add label display to TransportButton if missing

### MIDI-UI-Architect Agent 3: Review ControlPopover Integration
- **Focus**: Ensure ControlPopover works for all control types
- Verify controlKind="button" shows correct fields
- Verify label editing works
- Verify changes are applied via updateMapping
- Verify changes trigger markUnsavedChanges()

## Key Files to Modify

| File | Changes |
|------|---------|
| `Transport.tsx` | Add popover state, handlers, ControlPopover render to TransportButton |
| `controls.ts` | Verify labels in TrackState, verify applyPresetValues restores labels |
| `preset.ts` | Verify labels saved in preset, verify loadPreset passes labels |
| `ControlPopover.tsx` | Verify label input works for all control types |

## Verification Checklist

### Transport Button CC Editing
- [ ] Right-click on Play button → popover opens
- [ ] Change Play CC from 41 to 50 → mapping updates
- [ ] Save preset → CC 50 is saved
- [ ] Load preset → CC 50 is restored

### Label Persistence
- [ ] Edit Track 1 knob label to "Filter" → save → load → shows "Filter"
- [ ] Edit Track 1 slider label to "Volume" → save → load → shows "Volume"
- [ ] Edit Track 1 solo label to "Solo 1" → save → load → shows "Solo 1"
- [ ] Edit Play button label to "Start" → save → load → shows "Start"

### UI Consistency
- [ ] All controls show labels when set
- [ ] Empty labels show control type or CC number
- [ ] Labels are editable via ControlPopover
- [ ] Changes marked as unsaved
