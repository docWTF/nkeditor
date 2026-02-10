/**
 * Undo Store
 *
 * Manages undo history for control value changes.
 * Stores snapshots of control state that can be restored.
 * Maximum of 20 undo steps.
 */

import { create } from 'zustand';
import type { ControlValues } from '@shared/ipc-protocol';

interface UndoSnapshot {
  timestamp: number;
  description: string;
  controlValues: ControlValues;
}

interface UndoStore {
  /** Stack of undo snapshots (most recent first) */
  undoStack: UndoSnapshot[];
  /** Maximum number of undo steps */
  maxUndoSteps: number;

  /**
   * Push a new snapshot onto the undo stack.
   * Call this BEFORE making changes to preserve the previous state.
   */
  pushSnapshot: (description: string, controlValues: ControlValues) => void;

  /**
   * Pop and return the most recent snapshot from the undo stack.
   * Returns null if stack is empty.
   */
  popSnapshot: () => UndoSnapshot | null;

  /**
   * Peek at the most recent snapshot without removing it.
   */
  peekSnapshot: () => UndoSnapshot | null;

  /**
   * Get the number of available undo steps.
   */
  getUndoCount: () => number;

  /**
   * Clear the entire undo stack.
   */
  clearUndoStack: () => void;

  /**
   * Check if undo is available.
   */
  canUndo: () => boolean;
}

export const useUndoStore = create<UndoStore>((set, get) => ({
  undoStack: [],
  maxUndoSteps: 20,

  pushSnapshot: (description: string, controlValues: ControlValues) => {
    const snapshot: UndoSnapshot = {
      timestamp: Date.now(),
      description,
      // Deep clone to prevent reference issues
      controlValues: JSON.parse(JSON.stringify(controlValues)),
    };

    set((state) => {
      const newStack = [snapshot, ...state.undoStack];
      // Trim to max size
      if (newStack.length > state.maxUndoSteps) {
        newStack.pop();
      }
      return { undoStack: newStack };
    });
  },

  popSnapshot: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) {
      return null;
    }

    const [snapshot, ...rest] = undoStack;
    set({ undoStack: rest });
    return snapshot ?? null;
  },

  peekSnapshot: () => {
    const { undoStack } = get();
    return undoStack[0] ?? null;
  },

  getUndoCount: () => {
    return get().undoStack.length;
  },

  clearUndoStack: () => {
    set({ undoStack: [] });
  },

  canUndo: () => {
    return get().undoStack.length > 0;
  },
}));
