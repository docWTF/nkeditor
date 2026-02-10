/**
 * Preset Store
 *
 * Manages preset library, selection, and A/B comparison.
 */

import { create } from 'zustand';
import type { ElectronAPI } from '../../main/preload';
import type { PresetMetadata, Preset } from '@shared/ipc-protocol';
import { createDefaultPreset } from '@shared/schemas';
import { useControlsStore } from './controls';

// Get the electron API from window
const getElectronAPI = (): ElectronAPI | null => {
  return (window as { electronAPI?: ElectronAPI }).electronAPI ?? null;
};

// =============================================================================
// Store Types
// =============================================================================

interface PresetStoreState {
  // State
  presets: PresetMetadata[];
  selectedId: string | null;
  currentPreset: Preset | null;
  abSlotA: Preset | null;
  abSlotB: Preset | null;
  abActive: 'A' | 'B';
  loading: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;

  // Actions
  loadPresets: () => Promise<void>;
  selectPreset: (id: string) => void;
  loadPreset: (id: string) => Promise<boolean>;
  createPreset: (name: string, description?: string, tags?: string[], group?: string) => Promise<string | null>;
  savePreset: (preset: Preset, overwrite?: boolean) => Promise<boolean>;
  saveCurrentPreset: () => Promise<boolean>;
  setCurrentPreset: (preset: Preset) => void;
  markUnsavedChanges: () => void;
  deletePreset: (id: string) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<void>;
  updatePresetMetadata: (id: string, updates: {
    name?: string;
    description?: string;
    tags?: string[];
    group?: string;
  }) => Promise<boolean>;
  /**
   * Duplicates a preset with a new name.
   * @param id - The ID of the preset to duplicate
   * @param newName - The name for the duplicated preset
   * @returns The new preset ID, or null on failure
   */
  duplicatePreset: (id: string, newName: string) => Promise<string | null>;

  // A/B comparison
  setSlotA: (preset: Preset) => void;
  setSlotB: (preset: Preset) => void;
  toggleAB: () => void;

  // Helpers
  getAllTags: () => string[];
  getAllGroups: () => string[];
}

// =============================================================================
// Store Implementation
// =============================================================================

export const usePresetStore = create<PresetStoreState>((set, get) => ({
  // Initial state
  presets: [],
  selectedId: null,
  currentPreset: null,
  abSlotA: null,
  abSlotB: null,
  abActive: 'A',
  loading: false,
  error: null,
  hasUnsavedChanges: false,

  // Load all presets from disk
  loadPresets: async () => {
    const api = getElectronAPI();
    if (!api) return;

    set({ loading: true, error: null });

    try {
      const response = await api.listPresets();
      set({ presets: response.presets, loading: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
    }
  },

  // Select a preset (for viewing/editing)
  selectPreset: (id) => {
    set({ selectedId: id });
  },

  // Load a preset (activate it and apply mappings)
  loadPreset: async (id) => {
    const api = getElectronAPI();
    if (!api) return false;

    console.log('[preset-store] Loading preset:', id);
    set({ loading: true, error: null });

    try {
      // Get config to check transmitButtonsOnLoad setting
      const configResponse = await api.getConfig();
      const transmitButtonsOnLoad = configResponse.config.transmitButtonsOnLoad ?? true;
      console.log('[preset-store] transmitButtonsOnLoad setting:', transmitButtonsOnLoad);

      const response = await api.loadPreset({ id });

      if (response.success && response.preset) {
        console.log('[preset-store] Loaded preset data:', response.preset);
        console.log('[preset-store] Control values:', response.preset?.controlValues);

        // Apply the mapping configuration to the MIDI manager
        const applyResult = await api.applyMapping({ mapping: response.preset.mapping });

        if (!applyResult.success) {
          console.warn('[preset-store] Failed to apply mapping:', applyResult.error);
        }

        // Apply control values to GUI and send MIDI CC to synth
        // Pass transmitButtonsOnLoad to control whether button MIDI is sent
        const controlsStore = useControlsStore.getState();
        if (response.preset.controlValues) {
          await controlsStore.applyPresetValues(
            response.preset.controlValues,
            response.preset.mapping,
            transmitButtonsOnLoad
          );
        } else {
          // If no control values stored, at least apply labels from mapping
          controlsStore.applyLabelsFromMapping(response.preset.mapping);
        }

        set({
          currentPreset: response.preset,
          selectedId: id,
          loading: false,
          hasUnsavedChanges: false,
        });
        return true;
      } else {
        set({ error: response.error ?? 'Failed to load preset', loading: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return false;
    }
  },

  // Create a new preset with default mapping
  createPreset: async (name, description, tags, group) => {
    const api = getElectronAPI();
    if (!api) return null;

    set({ loading: true, error: null });

    try {
      // Create a new preset with default (identity) mapping
      const basePreset = createDefaultPreset(name, description, group);

      // Add tags if provided
      if (tags && tags.length > 0) {
        basePreset.metadata.tags = tags;
      }

      // Add description if provided
      if (description) {
        basePreset.metadata.description = description;
      }

      // Capture current control values instead of using defaults
      const controlsStore = useControlsStore.getState();
      const controlValues = controlsStore.captureControlValues();

      const newPreset: Preset = {
        ...basePreset,
        controlValues,
      };

      const response = await api.savePreset({ preset: newPreset, overwrite: false });

      if (response.success && response.id) {
        // Refresh preset list
        await get().loadPresets();
        set({ loading: false, selectedId: response.id });
        return response.id;
      } else {
        set({ error: response.error ?? 'Failed to create preset', loading: false });
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return null;
    }
  },

  // Save a preset
  savePreset: async (preset, overwrite = false) => {
    const api = getElectronAPI();
    if (!api) return false;

    set({ loading: true, error: null });

    try {
      const response = await api.savePreset({ preset, overwrite });

      if (response.success) {
        // Refresh preset list
        await get().loadPresets();
        set({ loading: false });
        return true;
      } else {
        set({ error: response.error ?? 'Failed to save preset', loading: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return false;
    }
  },

  // Save the currently loaded preset to disk.
  // This ONLY writes to disk - it does NOT reload the preset or re-apply mappings.
  // This preserves the current MIDI state and control values.
  saveCurrentPreset: async () => {
    const api = getElectronAPI();
    if (!api) return false;

    const { currentPreset } = get();
    if (!currentPreset) {
      set({ error: 'No preset is currently loaded' });
      return false;
    }

    set({ loading: true, error: null });

    try {
      // Capture current control values from the GUI
      const controlsStore = useControlsStore.getState();
      const controlValues = controlsStore.captureControlValues();

      // Update the modified timestamp and include captured control values
      const presetToSave: Preset = {
        ...currentPreset,
        metadata: {
          ...currentPreset.metadata,
          modifiedAt: new Date().toISOString(),
        },
        controlValues,
      };

      // Save to disk (overwrite since it already exists)
      const response = await api.savePreset({ preset: presetToSave, overwrite: true });

      if (response.success) {
        // Update the in-memory preset with the new timestamp
        // but do NOT reload or re-apply mapping - this preserves MIDI state
        set({
          currentPreset: presetToSave,
          hasUnsavedChanges: false,
          loading: false,
        });

        // Refresh the preset list metadata (this only updates the sidebar list,
        // it does NOT affect the current preset or MIDI state)
        await get().loadPresets();

        return true;
      } else {
        set({ error: response.error ?? 'Failed to save preset', loading: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return false;
    }
  },

  // Set the current preset in memory (used by ControlPopover when editing mappings)
  // This does NOT write to disk - call saveCurrentPreset to persist changes
  setCurrentPreset: (preset) => {
    set({ currentPreset: preset, hasUnsavedChanges: true });
  },

  // Mark that there are unsaved changes to the current preset
  markUnsavedChanges: () => {
    set({ hasUnsavedChanges: true });
  },

  // Delete a preset
  deletePreset: async (id) => {
    const api = getElectronAPI();
    if (!api) return false;

    set({ loading: true, error: null });

    try {
      const response = await api.deletePreset({ id });

      if (response.success) {
        // Clear selection if deleted preset was selected
        if (get().selectedId === id) {
          set({ selectedId: null });
        }
        // Refresh preset list
        await get().loadPresets();
        set({ loading: false });
        return true;
      } else {
        set({ error: response.error ?? 'Failed to delete preset', loading: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return false;
    }
  },

  // Toggle favorite status
  toggleFavorite: async (id) => {
    const api = getElectronAPI();
    if (!api) return;

    // First load the preset
    const response = await api.loadPreset({ id });
    if (!response.success || !response.preset) return;

    // Toggle favorite
    const updatedPreset: Preset = {
      ...response.preset,
      metadata: {
        ...response.preset.metadata,
        favorite: !response.preset.metadata.favorite,
      },
    };

    // Save back
    await api.savePreset({ preset: updatedPreset, overwrite: true });

    // Refresh list
    await get().loadPresets();
  },

  // Update preset metadata (name, description, tags, group)
  updatePresetMetadata: async (id, updates) => {
    const api = getElectronAPI();
    if (!api) return false;

    set({ loading: true, error: null });

    try {
      // First load the full preset to preserve mapping configuration
      const response = await api.loadPreset({ id });
      if (!response.success || !response.preset) {
        set({ error: response.error ?? 'Failed to load preset', loading: false });
        return false;
      }

      // Apply metadata updates while preserving mapping and other fields
      const updatedPreset: Preset = {
        ...response.preset,
        metadata: {
          ...response.preset.metadata,
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.description !== undefined && { description: updates.description }),
          ...(updates.tags !== undefined && { tags: updates.tags }),
          ...(updates.group !== undefined && { group: updates.group }),
        },
      };

      // Remove undefined group to keep JSON clean
      if (updatedPreset.metadata.group === undefined) {
        delete updatedPreset.metadata.group;
      }

      // Save with overwrite
      const saveResponse = await api.savePreset({ preset: updatedPreset, overwrite: true });

      if (saveResponse.success) {
        // Refresh preset list to show updated metadata
        await get().loadPresets();
        set({ loading: false });
        return true;
      } else {
        set({ error: saveResponse.error ?? 'Failed to save preset', loading: false });
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return false;
    }
  },

  // Set A/B slot A
  setSlotA: (preset) => {
    set({ abSlotA: preset });
  },

  // Set A/B slot B
  setSlotB: (preset) => {
    set({ abSlotB: preset });
  },

  // Toggle between A and B
  toggleAB: () => {
    const { abActive, abSlotA, abSlotB } = get();
    const newActive = abActive === 'A' ? 'B' : 'A';
    const newPreset = newActive === 'A' ? abSlotA : abSlotB;

    set({
      abActive: newActive,
      currentPreset: newPreset,
    });
  },

  // Get all unique tags from presets
  getAllTags: () => {
    const { presets } = get();
    const tagSet = new Set<string>();

    for (const preset of presets) {
      for (const tag of preset.tags) {
        tagSet.add(tag);
      }
    }

    return Array.from(tagSet).sort();
  },

  // Get all unique groups from presets
  getAllGroups: () => {
    const { presets } = get();
    const groupSet = new Set<string>();

    for (const preset of presets) {
      if (preset.group) {
        groupSet.add(preset.group);
      }
    }

    return Array.from(groupSet).sort();
  },

  // Duplicate a preset with a new name
  duplicatePreset: async (id, newName) => {
    const api = getElectronAPI();
    if (!api) return null;

    set({ loading: true, error: null });

    try {
      // First load the full preset
      const response = await api.loadPreset({ id });
      if (!response.success || !response.preset) {
        set({ error: response.error ?? 'Failed to load preset', loading: false });
        return null;
      }

      // Create a new preset with a new ID and the given name
      const now = new Date().toISOString();
      const newId = `preset-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const duplicatedPreset: Preset = {
        ...response.preset,
        metadata: {
          ...response.preset.metadata,
          id: newId,
          name: newName,
          createdAt: now,
          modifiedAt: now,
          favorite: false, // Don't copy favorite status
        },
      };

      // Save the duplicated preset
      const saveResponse = await api.savePreset({ preset: duplicatedPreset, overwrite: false });

      if (saveResponse.success && saveResponse.id) {
        // Refresh preset list
        await get().loadPresets();
        set({ loading: false, selectedId: saveResponse.id });
        return saveResponse.id;
      } else {
        set({ error: saveResponse.error ?? 'Failed to save duplicated preset', loading: false });
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message, loading: false });
      return null;
    }
  },
}));
