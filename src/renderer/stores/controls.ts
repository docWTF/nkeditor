/**
 * Controls Store
 *
 * Manages the state of all controls (knobs, sliders, buttons) on the nanoKONTROL2.
 */

import { create } from 'zustand';
import type { ElectronAPI } from '../../main/preload';
import type { ControlValues } from '@shared/ipc-protocol';
import type { MappingConfig, MappingEntry } from '@shared/types';

// Get the electron API from window
const getElectronAPI = (): ElectronAPI | null => {
  return (window as { electronAPI?: ElectronAPI }).electronAPI ?? null;
};

/**
 * Scale a GUI value (0-127) to the configured min/max output range.
 * Formula: min + (value / 127) * (max - min)
 * Result is clamped to 0-127 and rounded to an integer.
 */
function scaleValue(value: number, minValue: number = 0, maxValue: number = 127): number {
  // Handle edge case where minValue > maxValue by swapping
  const min = Math.min(minValue, maxValue);
  const max = Math.max(minValue, maxValue);

  // Apply scaling formula
  const scaled = min + (value / 127) * (max - min);

  // Clamp to 0-127 and round to integer
  return Math.round(Math.max(0, Math.min(127, scaled)));
}

/**
 * Get the MIDI value for a button based on its state and configured on/off values.
 * Uses custom onValue/offValue if configured, otherwise defaults to 127/0.
 * Result is clamped to 0-127.
 */
function getButtonMidiValue(active: boolean, mapping?: MappingEntry): number {
  if (active) {
    const onValue = mapping?.onValue ?? 127;
    return Math.max(0, Math.min(127, onValue));
  } else {
    const offValue = mapping?.offValue ?? 0;
    return Math.max(0, Math.min(127, offValue));
  }
}

// =============================================================================
// Store Types
// =============================================================================

interface ControlState {
  value: number;
  label?: string;
  locked?: boolean; // For soft takeover
}

interface ButtonState {
  active: boolean;
  label?: string;
}

export interface TrackState {
  knob: ControlState;
  slider: ControlState;
  solo: ButtonState;
  mute: ButtonState;
  rec: ButtonState;
}

interface TransportState {
  rewind: ButtonState;
  forward: ButtonState;
  stop: ButtonState;
  play: ButtonState;
  record: ButtonState;
  cycle: ButtonState;
  track_left: ButtonState;
  track_right: ButtonState;
  marker_set: ButtonState;
  marker_left: ButtonState;
  marker_right: ButtonState;
}

/** Selection state for track controls */
interface TrackSelectionState {
  knob: boolean;
  slider: boolean;
}

interface ControlsStoreState {
  // State
  tracks: TrackState[];
  transport: TransportState;
  /** Selection state for each track's knob and slider */
  selections: TrackSelectionState[];

  // Actions
  initialize: () => void;
  updateControl: (controlId: string, value: number) => void;
  updateButton: (controlId: string, active: boolean) => void;
  setControlLabel: (controlId: string, label: string) => void;
  resetAllControls: () => void;
  /**
   * Applies control values and labels from a preset.
   * Updates the GUI state FIRST, then sends MIDI CC messages to the synth.
   * GUI update is guaranteed even if MIDI transmission fails.
   *
   * @param controlValues - The control values to apply
   * @param mapping - The mapping configuration with labels and CC assignments
   * @param transmitButtons - If false, skip MIDI sends for buttons (solo, mute, rec, transport). Default: true
   */
  applyPresetValues: (controlValues: ControlValues, mapping: MappingConfig, transmitButtons?: boolean) => Promise<void>;
  /**
   * Captures current control values into a ControlValues object for saving.
   */
  captureControlValues: () => ControlValues;
  /**
   * Applies labels from a mapping configuration to all controls.
   */
  applyLabelsFromMapping: (mapping: MappingConfig) => void;
  /**
   * Randomizes all knob and slider values (0-127) for all 8 tracks.
   * Updates the GUI state FIRST, then sends MIDI CC messages.
   * Does NOT randomize button states (solo, mute, rec, transport).
   *
   * @param mapping - The mapping configuration with CC assignments for MIDI output
   */
  randomizeKnobsAndSliders: (mapping: MappingConfig) => Promise<void>;
  /**
   * Randomizes only selected knob and slider values.
   * If no controls are selected, does nothing.
   *
   * @param mapping - The mapping configuration with CC assignments for MIDI output
   */
  randomizeSelectedKnobsAndSliders: (mapping: MappingConfig) => Promise<void>;
  /**
   * Restores control values from a snapshot (used by undo).
   * Updates GUI state and sends MIDI CC messages.
   *
   * @param controlValues - The control values to restore
   * @param mapping - The mapping configuration with CC assignments for MIDI output
   */
  restoreFromControlValues: (controlValues: ControlValues, mapping: MappingConfig) => Promise<void>;
  /**
   * Toggles selection state for a specific control.
   * @param trackIndex - Track index (0-7)
   * @param controlType - 'knob' or 'slider'
   */
  toggleControlSelection: (trackIndex: number, controlType: 'knob' | 'slider') => void;
  /**
   * Selects all knobs and sliders.
   */
  selectAllControls: () => void;
  /**
   * Deselects all knobs and sliders.
   */
  deselectAllControls: () => void;
  /**
   * Gets the count of selected controls.
   */
  getSelectedCount: () => number;
}

// =============================================================================
// Default State
// =============================================================================

function createDefaultTrack(): TrackState {
  return {
    knob: { value: 0 },
    slider: { value: 0 },
    solo: { active: false },
    mute: { active: false },
    rec: { active: false },
  };
}

function createDefaultTransport(): TransportState {
  return {
    rewind: { active: false },
    forward: { active: false },
    stop: { active: false },
    play: { active: false },
    record: { active: false },
    cycle: { active: false },
    track_left: { active: false },
    track_right: { active: false },
    marker_set: { active: false },
    marker_left: { active: false },
    marker_right: { active: false },
  };
}

function createDefaultSelections(): TrackSelectionState[] {
  return Array(8).fill(null).map(() => ({
    knob: false,
    slider: false,
  }));
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useControlsStore = create<ControlsStoreState>((set, get) => ({
  // Initial state
  tracks: Array(8).fill(null).map(() => createDefaultTrack()),
  transport: createDefaultTransport(),
  selections: createDefaultSelections(),

  // Initialize and set up MIDI CC listener
  initialize: () => {
    const api = getElectronAPI();
    if (!api) return;

    api.onMidiCC((event) => {
      const { controlType } = event;
      if (!controlType) return;

      // Parse control type (e.g., "track1.knob" or "transport.play")
      const parts = controlType.split('.');
      if (parts.length !== 2) return;

      const [section, control] = parts;
      if (!section || !control) return;

      // Handle track controls
      if (section.startsWith('track')) {
        const trackNum = parseInt(section.replace('track', ''), 10);
        if (isNaN(trackNum) || trackNum < 1 || trackNum > 8) return;

        if (control === 'knob' || control === 'slider') {
          get().updateControl(controlType, event.value);
        } else if (control === 'solo' || control === 'mute' || control === 'rec') {
          get().updateButton(controlType, event.value > 0);
        }
      }

      // Handle transport controls
      if (section === 'transport') {
        get().updateButton(controlType, event.value > 0);
      }
    });
  },

  // Update a continuous control (knob/slider)
  updateControl: (controlId, value) => {
    const parts = controlId.split('.');
    if (parts.length !== 2) return;

    const [section, control] = parts;
    if (!section || !control) return;

    if (section.startsWith('track')) {
      const trackNum = parseInt(section.replace('track', ''), 10);
      if (isNaN(trackNum) || trackNum < 1 || trackNum > 8) return;

      const trackIndex = trackNum - 1;

      set((state) => {
        const newTracks = [...state.tracks];
        const track = newTracks[trackIndex];
        if (!track) return state;

        if (control === 'knob') {
          newTracks[trackIndex] = {
            ...track,
            knob: { ...track.knob, value },
          };
        } else if (control === 'slider') {
          newTracks[trackIndex] = {
            ...track,
            slider: { ...track.slider, value },
          };
        }

        return { tracks: newTracks };
      });
    }
  },

  // Update a button state
  updateButton: (controlId, active) => {
    const parts = controlId.split('.');
    if (parts.length !== 2) return;

    const [section, control] = parts;
    if (!section || !control) return;

    if (section.startsWith('track')) {
      const trackNum = parseInt(section.replace('track', ''), 10);
      if (isNaN(trackNum) || trackNum < 1 || trackNum > 8) return;

      const trackIndex = trackNum - 1;

      set((state) => {
        const newTracks = [...state.tracks];
        const track = newTracks[trackIndex];
        if (!track) return state;

        if (control === 'solo' || control === 'mute' || control === 'rec') {
          newTracks[trackIndex] = {
            ...track,
            [control]: { ...track[control], active },
          };
        }

        return { tracks: newTracks };
      });
    }

    if (section === 'transport') {
      set((state) => {
        const transportKey = control as keyof TransportState;
        if (!(transportKey in state.transport)) return state;

        return {
          transport: {
            ...state.transport,
            [transportKey]: { ...state.transport[transportKey], active },
          },
        };
      });
    }
  },

  // Set a control label
  setControlLabel: (controlId, label) => {
    const parts = controlId.split('.');
    if (parts.length !== 2) return;

    const [section, control] = parts;
    if (!section || !control) return;

    if (section.startsWith('track')) {
      const trackNum = parseInt(section.replace('track', ''), 10);
      if (isNaN(trackNum) || trackNum < 1 || trackNum > 8) return;

      const trackIndex = trackNum - 1;

      set((state) => {
        const newTracks = [...state.tracks];
        const track = newTracks[trackIndex];
        if (!track) return state;

        const controlKey = control as keyof TrackState;
        if (!(controlKey in track)) return state;

        newTracks[trackIndex] = {
          ...track,
          [controlKey]: { ...track[controlKey], label },
        };

        return { tracks: newTracks };
      });
    }
  },

  // Reset all controls to default state
  resetAllControls: () => {
    set({
      tracks: Array(8).fill(null).map(() => createDefaultTrack()),
      transport: createDefaultTransport(),
    });
  },

  // Apply control values and labels from a preset, sending MIDI CC to the synth
  // CRITICAL: GUI update happens FIRST to guarantee UI responsiveness even if MIDI fails
  applyPresetValues: async (controlValues, mapping, transmitButtons = true) => {
    console.log('[controls-store] Applying preset values, transmitButtons:', transmitButtons);
    console.log('[controls-store] Track 1 values:', { knob: controlValues.tracks[0]?.knob, slider: controlValues.tracks[0]?.slider });

    // =========================================================================
    // PHASE 1: Build new state (pure computation, no side effects)
    // =========================================================================

    // Build new state for all tracks
    const newTracks: TrackState[] = [];
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const trackValues = controlValues.tracks[trackIndex];
      const trackMapping = mapping.tracks[trackIndex];

      if (!trackValues || !trackMapping) {
        newTracks.push(createDefaultTrack());
        continue;
      }

      // Labels from controlValues take precedence over mapping labels
      newTracks.push({
        knob: {
          value: trackValues.knob,
          label: trackValues.knobLabel ?? trackMapping.knob.label,
        },
        slider: {
          value: trackValues.slider,
          label: trackValues.sliderLabel ?? trackMapping.slider.label,
        },
        solo: {
          active: trackValues.solo,
          label: trackValues.soloLabel ?? trackMapping.solo.label,
        },
        mute: {
          active: trackValues.mute,
          label: trackValues.muteLabel ?? trackMapping.mute.label,
        },
        rec: {
          active: trackValues.rec,
          label: trackValues.recLabel ?? trackMapping.rec.label,
        },
      });
    }

    // Build new transport state with labels (controlValues labels take precedence)
    const transportMapping = mapping.transport;
    const transportValues = controlValues.transport;

    const newTransport: TransportState = {
      rewind: { active: transportValues.rewind, label: transportValues.rewindLabel ?? transportMapping.rewind.label },
      forward: { active: transportValues.forward, label: transportValues.forwardLabel ?? transportMapping.forward.label },
      stop: { active: transportValues.stop, label: transportValues.stopLabel ?? transportMapping.stop.label },
      play: { active: transportValues.play, label: transportValues.playLabel ?? transportMapping.play.label },
      record: { active: transportValues.record, label: transportValues.recordLabel ?? transportMapping.record.label },
      cycle: { active: transportValues.cycle, label: transportValues.cycleLabel ?? transportMapping.cycle.label },
      track_left: { active: transportValues.track_left, label: transportValues.track_leftLabel ?? transportMapping.track_left.label },
      track_right: { active: transportValues.track_right, label: transportValues.track_rightLabel ?? transportMapping.track_right.label },
      marker_set: { active: transportValues.marker_set, label: transportValues.marker_setLabel ?? transportMapping.marker_set.label },
      marker_left: { active: transportValues.marker_left, label: transportValues.marker_leftLabel ?? transportMapping.marker_left.label },
      marker_right: { active: transportValues.marker_right, label: transportValues.marker_rightLabel ?? transportMapping.marker_right.label },
    };

    // =========================================================================
    // PHASE 2: Update GUI immediately (synchronous Zustand update)
    // This MUST happen before any MIDI transmission to guarantee GUI updates
    // =========================================================================

    set({ tracks: newTracks, transport: newTransport });
    console.log('[controls-store] GUI state updated');
    console.log('[preset-load] GUI updated with preset values');

    // =========================================================================
    // PHASE 3: Send MIDI to synth (async, with error handling per-control)
    // Errors are logged but do not prevent other controls from being sent
    // =========================================================================

    const api = getElectronAPI();
    if (!api) {
      console.log('[preset-load] No Electron API available, skipping MIDI transmission');
      return;
    }

    // Helper function to send CC with error handling and logging
    const safeSendCC = async (
      channel: number,
      cc: number,
      value: number,
      description: string
    ): Promise<void> => {
      try {
        console.log('[preset-load] Sending CC:', { channel, cc, value, description });
        await api.sendCC({ channel, cc, value });
      } catch (error) {
        console.error(`[preset-load] Failed to send CC for ${description}:`, {
          channel,
          cc,
          value,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Send MIDI CC for all track controls
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const trackValues = controlValues.tracks[trackIndex];
      const trackMapping = mapping.tracks[trackIndex];

      if (!trackValues || !trackMapping) {
        continue;
      }

      const trackNum = trackIndex + 1;

      // Knobs are ALWAYS transmitted (continuous controllers)
      // Apply min/max scaling if configured
      const knobScaledValue = scaleValue(
        trackValues.knob,
        trackMapping.knob.minValue,
        trackMapping.knob.maxValue
      );
      await safeSendCC(
        trackMapping.knob.channel - 1,
        trackMapping.knob.outputCC,
        knobScaledValue,
        `track${trackNum}.knob`
      );

      // Sliders are ALWAYS transmitted (continuous controllers)
      // Apply min/max scaling if configured
      const sliderScaledValue = scaleValue(
        trackValues.slider,
        trackMapping.slider.minValue,
        trackMapping.slider.maxValue
      );
      await safeSendCC(
        trackMapping.slider.channel - 1,
        trackMapping.slider.outputCC,
        sliderScaledValue,
        `track${trackNum}.slider`
      );

      // Buttons are only transmitted if transmitButtons is true
      if (transmitButtons) {
        // Use custom on/off values if configured
        await safeSendCC(
          trackMapping.solo.channel - 1,
          trackMapping.solo.outputCC,
          getButtonMidiValue(trackValues.solo, trackMapping.solo),
          `track${trackNum}.solo`
        );

        await safeSendCC(
          trackMapping.mute.channel - 1,
          trackMapping.mute.outputCC,
          getButtonMidiValue(trackValues.mute, trackMapping.mute),
          `track${trackNum}.mute`
        );

        await safeSendCC(
          trackMapping.rec.channel - 1,
          trackMapping.rec.outputCC,
          getButtonMidiValue(trackValues.rec, trackMapping.rec),
          `track${trackNum}.rec`
        );
      }
    }

    // Send MIDI CC for transport buttons (only if transmitButtons is true)
    if (transmitButtons) {
      const transportControls: (keyof typeof transportMapping)[] = [
        'rewind', 'forward', 'stop', 'play', 'record', 'cycle',
        'track_left', 'track_right', 'marker_set', 'marker_left', 'marker_right',
      ];

      for (const controlName of transportControls) {
        const controlMapping = transportMapping[controlName];
        const isActive = transportValues[controlName];
        // Use custom on/off values if configured
        await safeSendCC(
          controlMapping.channel - 1,
          controlMapping.outputCC,
          getButtonMidiValue(isActive, controlMapping),
          `transport.${controlName}`
        );
      }
    } else {
      console.log('[preset-load] Skipping button MIDI transmission (transmitButtons=false)');
    }

    console.log('[preset-load] MIDI transmission complete');
  },

  // Capture current control values for saving to a preset (includes labels)
  captureControlValues: () => {
    const state = get();

    const tracks = state.tracks.map((track) => ({
      knob: track.knob.value,
      knobLabel: track.knob.label,
      slider: track.slider.value,
      sliderLabel: track.slider.label,
      solo: track.solo.active,
      soloLabel: track.solo.label,
      mute: track.mute.active,
      muteLabel: track.mute.label,
      rec: track.rec.active,
      recLabel: track.rec.label,
    }));

    const transport = {
      play: state.transport.play.active,
      playLabel: state.transport.play.label,
      stop: state.transport.stop.active,
      stopLabel: state.transport.stop.label,
      rewind: state.transport.rewind.active,
      rewindLabel: state.transport.rewind.label,
      forward: state.transport.forward.active,
      forwardLabel: state.transport.forward.label,
      record: state.transport.record.active,
      recordLabel: state.transport.record.label,
      cycle: state.transport.cycle.active,
      cycleLabel: state.transport.cycle.label,
      track_left: state.transport.track_left.active,
      track_leftLabel: state.transport.track_left.label,
      track_right: state.transport.track_right.active,
      track_rightLabel: state.transport.track_right.label,
      marker_set: state.transport.marker_set.active,
      marker_setLabel: state.transport.marker_set.label,
      marker_left: state.transport.marker_left.active,
      marker_leftLabel: state.transport.marker_left.label,
      marker_right: state.transport.marker_right.active,
      marker_rightLabel: state.transport.marker_right.label,
    };

    return { tracks, transport };
  },

  // Apply labels from mapping config to all controls
  applyLabelsFromMapping: (mapping) => {
    set((state) => {
      const newTracks = state.tracks.map((track, trackIndex) => {
        const trackMapping = mapping.tracks[trackIndex];
        if (!trackMapping) return track;

        return {
          knob: { ...track.knob, label: trackMapping.knob.label },
          slider: { ...track.slider, label: trackMapping.slider.label },
          solo: { ...track.solo, label: trackMapping.solo.label },
          mute: { ...track.mute, label: trackMapping.mute.label },
          rec: { ...track.rec, label: trackMapping.rec.label },
        };
      });

      const transportMapping = mapping.transport;
      const newTransport: TransportState = {
        rewind: { ...state.transport.rewind, label: transportMapping.rewind.label },
        forward: { ...state.transport.forward, label: transportMapping.forward.label },
        stop: { ...state.transport.stop, label: transportMapping.stop.label },
        play: { ...state.transport.play, label: transportMapping.play.label },
        record: { ...state.transport.record, label: transportMapping.record.label },
        cycle: { ...state.transport.cycle, label: transportMapping.cycle.label },
        track_left: { ...state.transport.track_left, label: transportMapping.track_left.label },
        track_right: { ...state.transport.track_right, label: transportMapping.track_right.label },
        marker_set: { ...state.transport.marker_set, label: transportMapping.marker_set.label },
        marker_left: { ...state.transport.marker_left, label: transportMapping.marker_left.label },
        marker_right: { ...state.transport.marker_right, label: transportMapping.marker_right.label },
      };

      return { tracks: newTracks, transport: newTransport };
    });
  },

  // Randomize knobs and sliders for all tracks, sending MIDI CC
  randomizeKnobsAndSliders: async (mapping) => {
    console.log('[controls-store] Randomizing knobs and sliders');

    // =========================================================================
    // PHASE 1: Generate random values and build new state
    // =========================================================================

    const currentTracks = get().tracks;
    const newTracks: TrackState[] = [];
    const randomValues: Array<{ knob: number; slider: number }> = [];

    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const currentTrack = currentTracks[trackIndex];
      if (!currentTrack) {
        newTracks.push(createDefaultTrack());
        randomValues.push({ knob: 0, slider: 0 });
        continue;
      }

      // Generate random values (0-127 inclusive)
      const knobValue = Math.floor(Math.random() * 128);
      const sliderValue = Math.floor(Math.random() * 128);

      randomValues.push({ knob: knobValue, slider: sliderValue });

      // Preserve labels and button states, only update knob/slider values
      newTracks.push({
        knob: { ...currentTrack.knob, value: knobValue },
        slider: { ...currentTrack.slider, value: sliderValue },
        solo: currentTrack.solo,
        mute: currentTrack.mute,
        rec: currentTrack.rec,
      });
    }

    // =========================================================================
    // PHASE 2: Update GUI immediately
    // =========================================================================

    set({ tracks: newTracks });
    console.log('[controls-store] GUI state updated with random values');

    // =========================================================================
    // PHASE 3: Send MIDI CC messages
    // =========================================================================

    const api = getElectronAPI();
    if (!api) {
      console.log('[controls-store] No Electron API available, skipping MIDI transmission');
      return;
    }

    // Helper function to send CC with error handling
    const safeSendCC = async (
      channel: number,
      cc: number,
      value: number,
      description: string
    ): Promise<void> => {
      try {
        await api.sendCC({ channel, cc, value });
      } catch (error) {
        console.error(`[controls-store] Failed to send CC for ${description}:`, {
          channel,
          cc,
          value,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Send MIDI CC for all randomized controls
    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const trackMapping = mapping.tracks[trackIndex];
      const values = randomValues[trackIndex];

      if (!trackMapping || !values) continue;

      const trackNum = trackIndex + 1;

      // Apply min/max scaling if configured, then send knob CC
      const knobScaledValue = scaleValue(
        values.knob,
        trackMapping.knob.minValue,
        trackMapping.knob.maxValue
      );
      await safeSendCC(
        trackMapping.knob.channel - 1,
        trackMapping.knob.outputCC,
        knobScaledValue,
        `track${trackNum}.knob`
      );

      // Apply min/max scaling if configured, then send slider CC
      const sliderScaledValue = scaleValue(
        values.slider,
        trackMapping.slider.minValue,
        trackMapping.slider.maxValue
      );
      await safeSendCC(
        trackMapping.slider.channel - 1,
        trackMapping.slider.outputCC,
        sliderScaledValue,
        `track${trackNum}.slider`
      );
    }

    console.log('[controls-store] Randomize MIDI transmission complete');
  },

  // Randomize only selected knobs and sliders
  randomizeSelectedKnobsAndSliders: async (mapping) => {
    const { selections, tracks: currentTracks } = get();

    // Check if any controls are selected
    const hasSelection = selections.some(s => s.knob || s.slider);
    if (!hasSelection) {
      console.log('[controls-store] No controls selected, skipping randomization');
      return;
    }

    console.log('[controls-store] Randomizing selected knobs and sliders');

    // Build new state with random values only for selected controls
    const newTracks: TrackState[] = [];
    const randomValues: Array<{ knob: number | null; slider: number | null }> = [];

    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const currentTrack = currentTracks[trackIndex];
      const selection = selections[trackIndex];

      if (!currentTrack || !selection) {
        newTracks.push(currentTrack ?? createDefaultTrack());
        randomValues.push({ knob: null, slider: null });
        continue;
      }

      const knobValue = selection.knob ? Math.floor(Math.random() * 128) : null;
      const sliderValue = selection.slider ? Math.floor(Math.random() * 128) : null;

      randomValues.push({ knob: knobValue, slider: sliderValue });

      newTracks.push({
        knob: { ...currentTrack.knob, value: knobValue ?? currentTrack.knob.value },
        slider: { ...currentTrack.slider, value: sliderValue ?? currentTrack.slider.value },
        solo: currentTrack.solo,
        mute: currentTrack.mute,
        rec: currentTrack.rec,
      });
    }

    // Update GUI immediately
    set({ tracks: newTracks });
    console.log('[controls-store] GUI state updated with random values for selected controls');

    // Send MIDI CC messages only for changed controls
    const api = getElectronAPI();
    if (!api) {
      console.log('[controls-store] No Electron API available, skipping MIDI transmission');
      return;
    }

    const safeSendCC = async (
      channel: number,
      cc: number,
      value: number,
      description: string
    ): Promise<void> => {
      try {
        await api.sendCC({ channel, cc, value });
      } catch (error) {
        console.error(`[controls-store] Failed to send CC for ${description}:`, {
          channel, cc, value,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    for (let trackIndex = 0; trackIndex < 8; trackIndex++) {
      const trackMapping = mapping.tracks[trackIndex];
      const values = randomValues[trackIndex];

      if (!trackMapping || !values) continue;

      const trackNum = trackIndex + 1;

      // Send knob CC if it was randomized
      if (values.knob !== null) {
        const knobScaledValue = scaleValue(
          values.knob,
          trackMapping.knob.minValue,
          trackMapping.knob.maxValue
        );
        await safeSendCC(
          trackMapping.knob.channel - 1,
          trackMapping.knob.outputCC,
          knobScaledValue,
          `track${trackNum}.knob`
        );
      }

      // Send slider CC if it was randomized
      if (values.slider !== null) {
        const sliderScaledValue = scaleValue(
          values.slider,
          trackMapping.slider.minValue,
          trackMapping.slider.maxValue
        );
        await safeSendCC(
          trackMapping.slider.channel - 1,
          trackMapping.slider.outputCC,
          sliderScaledValue,
          `track${trackNum}.slider`
        );
      }
    }

    console.log('[controls-store] Selected randomize MIDI transmission complete');
  },

  // Restore control values from a snapshot (for undo)
  restoreFromControlValues: async (controlValues, mapping) => {
    console.log('[controls-store] Restoring from control values snapshot');
    // Reuse applyPresetValues which handles both GUI update and MIDI transmission
    await get().applyPresetValues(controlValues, mapping, false);
  },

  // Toggle selection state for a control
  toggleControlSelection: (trackIndex, controlType) => {
    if (trackIndex < 0 || trackIndex > 7) return;

    set((state) => {
      const newSelections = [...state.selections];
      const selection = newSelections[trackIndex];
      if (!selection) return state;

      newSelections[trackIndex] = {
        ...selection,
        [controlType]: !selection[controlType],
      };

      return { selections: newSelections };
    });
  },

  // Select all knobs and sliders
  selectAllControls: () => {
    set({
      selections: Array(8).fill(null).map(() => ({
        knob: true,
        slider: true,
      })),
    });
  },

  // Deselect all knobs and sliders
  deselectAllControls: () => {
    set({
      selections: createDefaultSelections(),
    });
  },

  // Get count of selected controls
  getSelectedCount: () => {
    const { selections } = get();
    let count = 0;
    for (const selection of selections) {
      if (selection.knob) count++;
      if (selection.slider) count++;
    }
    return count;
  },
}));
