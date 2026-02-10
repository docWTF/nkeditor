/**
 * Connection Store
 *
 * Manages MIDI connection state and operations.
 */

import { create } from 'zustand';
import type { ElectronAPI } from '../../main/preload';

// Get the electron API from window
const getElectronAPI = (): ElectronAPI | null => {
  return (window as { electronAPI?: ElectronAPI }).electronAPI ?? null;
};

// =============================================================================
// Store Types
// =============================================================================

interface ConnectionState {
  // State
  connected: boolean;
  connecting: boolean;
  inputPort: string | null;
  outputPort: string | null;
  virtualPort: string;
  midiAvailable: boolean;
  availablePorts: {
    inputs: string[];
    outputs: string[];
  };

  // Actions
  initialize: () => Promise<void>;
  connect: (inputPort?: string, outputPort?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refreshPorts: () => Promise<void>;
}

// =============================================================================
// Store Implementation
// =============================================================================

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  // Initial state
  connected: false,
  connecting: false,
  inputPort: null,
  outputPort: null,
  virtualPort: 'nkEditor3 Out',
  midiAvailable: false,
  availablePorts: { inputs: [], outputs: [] },

  // Initialize connection and set up event listeners
  initialize: async () => {
    const api = getElectronAPI();
    if (!api) {
      console.warn('[connection] Electron API not available');
      return;
    }

    // Get initial status
    try {
      const status = await api.getStatus();
      set({
        connected: status.connected,
        inputPort: status.inputPort,
        outputPort: status.outputPort,
        virtualPort: status.virtualPort,
        midiAvailable: status.midiAvailable,
      });
    } catch (error) {
      console.error('[connection] Failed to get initial status:', error);
    }

    // Get available ports
    await get().refreshPorts();

    // Set up event listeners
    api.onMidiConnected((event) => {
      set({
        connected: true,
        connecting: false,
        inputPort: event.inputPort,
        outputPort: event.outputPort,
        virtualPort: event.virtualPort,
      });
    });

    api.onMidiDisconnected(() => {
      set({
        connected: false,
        inputPort: null,
        outputPort: null,
      });
    });

    api.onMidiPortsChanged((event) => {
      set({
        availablePorts: {
          inputs: event.inputs,
          outputs: event.outputs,
        },
      });
    });
  },

  // Connect to MIDI device
  connect: async (inputPort, outputPort) => {
    const api = getElectronAPI();
    if (!api) return false;

    set({ connecting: true });

    try {
      const result = await api.connect({ inputPort, outputPort });

      if (result.success) {
        set({
          connected: true,
          connecting: false,
          inputPort: result.inputPort ?? null,
          outputPort: result.outputPort ?? null,
        });
        return true;
      } else {
        set({ connecting: false });
        console.error('[connection] Connect failed:', result.error);
        return false;
      }
    } catch (error) {
      set({ connecting: false });
      console.error('[connection] Connect error:', error);
      return false;
    }
  },

  // Disconnect from MIDI device
  disconnect: async () => {
    const api = getElectronAPI();
    if (!api) return;

    try {
      await api.disconnect();
      set({
        connected: false,
        inputPort: null,
        outputPort: null,
      });
    } catch (error) {
      console.error('[connection] Disconnect error:', error);
    }
  },

  // Refresh available ports
  refreshPorts: async () => {
    const api = getElectronAPI();
    if (!api) return;

    try {
      const response = await api.getPorts();
      set({
        availablePorts: {
          inputs: response.inputs,
          outputs: response.outputs,
        },
        midiAvailable: response.nanoKontrol2Found || response.inputs.length > 0,
      });
    } catch (error) {
      console.error('[connection] Failed to refresh ports:', error);
    }
  },
}));
