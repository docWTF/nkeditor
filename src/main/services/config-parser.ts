/**
 * Parser for human-readable mapping configuration files.
 *
 * The mapping file format supports:
 * - Comments: lines starting with #
 * - Blank lines: ignored
 * - Sections: [trackN] or [transport]
 * - Control mappings: controlType inputCC -> outputCC chN [behavior] ["label"]
 *
 * Example:
 * ```
 * [track1]
 * knob    16 -> 16 ch1 "Filter Cutoff"
 * slider   0 ->  0 ch1 "Volume"
 * solo    32 -> 32 ch1 toggle "Solo"
 * ```
 */

import type {
  MappingConfig,
  MappingEntry,
  TrackMapping,
  TransportMapping,
  ControlType,
  TransportControlType,
  ButtonBehavior,
  ParseResult,
} from '@shared/types.js';

import {
  MIDI_VALUES,
  MIDI_CHANNELS,
  TRACK_CONSTANTS,
  TRACK_CONTROL_TYPES,
  TRANSPORT_CONTROL_TYPES,
  getDefaultBehavior,
  isContinuousControl,
} from '@shared/constants.js';

// =============================================================================
// Parsing Error Class
// =============================================================================

/**
 * Error thrown when parsing fails with line number context.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly lineNumber: number,
    public readonly lineContent: string
  ) {
    super(`Line ${lineNumber}: ${message}\n  > ${lineContent}`);
    this.name = 'ParseError';
  }
}

// =============================================================================
// Internal Types
// =============================================================================

type SectionType = 'track' | 'transport';

interface CurrentSection {
  type: SectionType;
  trackNumber?: number; // 1-8 for track sections
}

interface PartialTrackMapping {
  knob?: MappingEntry;
  slider?: MappingEntry;
  solo?: MappingEntry;
  mute?: MappingEntry;
  rec?: MappingEntry;
}

interface PartialTransportMapping {
  rewind?: MappingEntry;
  forward?: MappingEntry;
  stop?: MappingEntry;
  play?: MappingEntry;
  record?: MappingEntry;
  cycle?: MappingEntry;
  track_left?: MappingEntry;
  track_right?: MappingEntry;
  marker_set?: MappingEntry;
  marker_left?: MappingEntry;
  marker_right?: MappingEntry;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validates that a CC number is within the valid MIDI range (0-127).
 */
function validateCCRange(cc: number, fieldName: string, lineNumber: number, lineContent: string): void {
  if (!Number.isInteger(cc) || cc < MIDI_VALUES.MIN || cc > MIDI_VALUES.MAX) {
    throw new ParseError(
      `${fieldName} must be an integer between ${MIDI_VALUES.MIN} and ${MIDI_VALUES.MAX}, got: ${cc}`,
      lineNumber,
      lineContent
    );
  }
}

/**
 * Validates that a channel number is within the valid range (1-16).
 */
function validateChannelRange(channel: number, lineNumber: number, lineContent: string): void {
  if (!Number.isInteger(channel) || channel < MIDI_CHANNELS.MIN || channel > MIDI_CHANNELS.MAX) {
    throw new ParseError(
      `Channel must be an integer between ${MIDI_CHANNELS.MIN} and ${MIDI_CHANNELS.MAX}, got: ${channel}`,
      lineNumber,
      lineContent
    );
  }
}

/**
 * Validates that a control type is valid for a track section.
 */
function isValidTrackControlType(controlType: string): controlType is ControlType {
  return (TRACK_CONTROL_TYPES as readonly string[]).includes(controlType);
}

/**
 * Validates that a control type is valid for a transport section.
 */
function isValidTransportControlType(controlType: string): controlType is TransportControlType {
  return (TRANSPORT_CONTROL_TYPES as readonly string[]).includes(controlType);
}

/**
 * Validates that a behavior is valid.
 */
function isValidBehavior(behavior: string): behavior is ButtonBehavior {
  return behavior === 'toggle' || behavior === 'momentary';
}

// =============================================================================
// Line Parsing
// =============================================================================

/**
 * Parses a section header line like [track1] or [transport].
 * Returns null if the line is not a section header.
 */
function parseSectionHeader(line: string, lineNumber: number): CurrentSection | null {
  const trimmed = line.trim();

  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }

  const sectionName = trimmed.slice(1, -1).toLowerCase();

  if (sectionName === 'transport') {
    return { type: 'transport' };
  }

  // Match track1 through track8
  const trackMatch = sectionName.match(/^track(\d+)$/);
  if (trackMatch) {
    const capturedNumber = trackMatch[1];
    if (capturedNumber === undefined) {
      throw new ParseError('Failed to parse track number', lineNumber, line);
    }
    const trackNumber = parseInt(capturedNumber, 10);
    if (trackNumber >= TRACK_CONSTANTS.FIRST && trackNumber <= TRACK_CONSTANTS.LAST) {
      return { type: 'track', trackNumber };
    }
    throw new ParseError(
      `Invalid track number: ${trackNumber}. Must be between ${TRACK_CONSTANTS.FIRST} and ${TRACK_CONSTANTS.LAST}`,
      lineNumber,
      line
    );
  }

  throw new ParseError(
    `Unknown section: ${sectionName}. Expected [trackN] (1-8) or [transport]`,
    lineNumber,
    line
  );
}

/**
 * Parses a control mapping line.
 *
 * Format: controlType inputCC -> outputCC [chN] [behavior] ["label"]
 *
 * Examples:
 * - knob 16 -> 16 ch1 "Filter Cutoff"
 * - solo 32 -> 32 ch1 toggle "Solo Button"
 * - slider 0 -> 0
 */
function parseControlLine(
  line: string,
  lineNumber: number,
  currentSection: CurrentSection | null
): { controlType: string; entry: MappingEntry } {
  if (!currentSection) {
    throw new ParseError(
      'Control mapping found outside of a section. Add a [trackN] or [transport] header first',
      lineNumber,
      line
    );
  }

  const trimmed = line.trim();

  // Extract quoted label first (if present) to avoid issues with spaces
  let label: string | undefined;
  let lineWithoutLabel = trimmed;

  const labelMatch = trimmed.match(/"([^"]*)"\s*$/);
  if (labelMatch) {
    const capturedLabel = labelMatch[1];
    if (capturedLabel !== undefined) {
      label = capturedLabel;
      lineWithoutLabel = trimmed.slice(0, trimmed.lastIndexOf('"' + label + '"')).trim();
    }
  }

  // Split remaining line by whitespace
  const parts = lineWithoutLabel.split(/\s+/);

  if (parts.length < 4) {
    throw new ParseError(
      'Invalid control mapping format. Expected: controlType inputCC -> outputCC [chN] [behavior] ["label"]',
      lineNumber,
      line
    );
  }

  const controlTypeRaw = parts[0];
  const inputCCStr = parts[1];
  const arrow = parts[2];
  const outputCCStr = parts[3];

  // Validate all required parts exist
  if (controlTypeRaw === undefined || inputCCStr === undefined || arrow === undefined || outputCCStr === undefined) {
    throw new ParseError(
      'Invalid control mapping format. Expected: controlType inputCC -> outputCC [chN] [behavior] ["label"]',
      lineNumber,
      line
    );
  }

  const controlType = controlTypeRaw.toLowerCase();

  // Validate arrow
  if (arrow !== '->') {
    throw new ParseError(
      `Expected '->' between input and output CC, got: ${arrow}`,
      lineNumber,
      line
    );
  }

  // Parse CC numbers
  const inputCC = parseInt(inputCCStr, 10);
  const outputCC = parseInt(outputCCStr, 10);

  if (isNaN(inputCC)) {
    throw new ParseError(`Invalid input CC: ${inputCCStr}`, lineNumber, line);
  }
  if (isNaN(outputCC)) {
    throw new ParseError(`Invalid output CC: ${outputCCStr}`, lineNumber, line);
  }

  validateCCRange(inputCC, 'Input CC', lineNumber, line);
  validateCCRange(outputCC, 'Output CC', lineNumber, line);

  // Parse optional channel and behavior from remaining parts
  let channel: number = MIDI_CHANNELS.DEFAULT;
  let behavior: ButtonBehavior | undefined;

  for (let i = 4; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) {
      continue;
    }

    // Channel: chN or chNN
    const channelMatch = part.match(/^ch(\d+)$/i);
    if (channelMatch) {
      const channelStr = channelMatch[1];
      if (channelStr !== undefined) {
        channel = parseInt(channelStr, 10);
        validateChannelRange(channel, lineNumber, line);
      }
      continue;
    }

    // Behavior: toggle or momentary
    const partLower = part.toLowerCase();
    if (isValidBehavior(partLower)) {
      behavior = partLower;
      continue;
    }

    // Unknown token
    throw new ParseError(
      `Unknown token: ${part}. Expected chN (channel) or toggle/momentary (behavior)`,
      lineNumber,
      line
    );
  }

  // Validate control type based on section
  if (currentSection.type === 'track') {
    if (!isValidTrackControlType(controlType)) {
      throw new ParseError(
        `Invalid track control type: ${controlType}. Expected one of: ${TRACK_CONTROL_TYPES.join(', ')}`,
        lineNumber,
        line
      );
    }
  } else {
    if (!isValidTransportControlType(controlType)) {
      throw new ParseError(
        `Invalid transport control type: ${controlType}. Expected one of: ${TRANSPORT_CONTROL_TYPES.join(', ')}`,
        lineNumber,
        line
      );
    }
  }

  // Apply default behavior for buttons if not specified
  if (!isContinuousControl(controlType) && behavior === undefined) {
    behavior = getDefaultBehavior(controlType);
  }

  // Continuous controls should not have behavior
  if (isContinuousControl(controlType) && behavior !== undefined) {
    throw new ParseError(
      `Behavior (${behavior}) is not valid for continuous control type: ${controlType}`,
      lineNumber,
      line
    );
  }

  const entry: MappingEntry = {
    inputCC,
    outputCC,
    channel,
  };

  if (behavior !== undefined) {
    entry.behavior = behavior;
  }

  if (label !== undefined) {
    entry.label = label;
  }

  return { controlType, entry };
}

// =============================================================================
// Config Building
// =============================================================================

/**
 * Creates an empty partial track mapping.
 */
function createEmptyPartialTrack(): PartialTrackMapping {
  return {};
}

/**
 * Validates that a partial track mapping has all required controls.
 */
function validateTrackMapping(
  partial: PartialTrackMapping,
  trackNumber: number
): TrackMapping {
  const missing: string[] = [];

  if (!partial.knob) missing.push('knob');
  if (!partial.slider) missing.push('slider');
  if (!partial.solo) missing.push('solo');
  if (!partial.mute) missing.push('mute');
  if (!partial.rec) missing.push('rec');

  if (missing.length > 0) {
    throw new Error(
      `Track ${trackNumber} is missing required controls: ${missing.join(', ')}`
    );
  }

  // TypeScript requires explicit checks even after the above validation
  if (!partial.knob || !partial.slider || !partial.solo || !partial.mute || !partial.rec) {
    throw new Error(`Track ${trackNumber} validation failed unexpectedly`);
  }

  return {
    knob: partial.knob,
    slider: partial.slider,
    solo: partial.solo,
    mute: partial.mute,
    rec: partial.rec,
  };
}

/**
 * Validates that a partial transport mapping has all required controls.
 */
function validateTransportMapping(partial: PartialTransportMapping): TransportMapping {
  const missing: string[] = [];

  if (!partial.rewind) missing.push('rewind');
  if (!partial.forward) missing.push('forward');
  if (!partial.stop) missing.push('stop');
  if (!partial.play) missing.push('play');
  if (!partial.record) missing.push('record');
  if (!partial.cycle) missing.push('cycle');
  if (!partial.track_left) missing.push('track_left');
  if (!partial.track_right) missing.push('track_right');
  if (!partial.marker_set) missing.push('marker_set');
  if (!partial.marker_left) missing.push('marker_left');
  if (!partial.marker_right) missing.push('marker_right');

  if (missing.length > 0) {
    throw new Error(
      `Transport section is missing required controls: ${missing.join(', ')}`
    );
  }

  // TypeScript requires explicit checks even after the above validation
  if (
    !partial.rewind ||
    !partial.forward ||
    !partial.stop ||
    !partial.play ||
    !partial.record ||
    !partial.cycle ||
    !partial.track_left ||
    !partial.track_right ||
    !partial.marker_set ||
    !partial.marker_left ||
    !partial.marker_right
  ) {
    throw new Error('Transport validation failed unexpectedly');
  }

  return {
    rewind: partial.rewind,
    forward: partial.forward,
    stop: partial.stop,
    play: partial.play,
    record: partial.record,
    cycle: partial.cycle,
    track_left: partial.track_left,
    track_right: partial.track_right,
    marker_set: partial.marker_set,
    marker_left: partial.marker_left,
    marker_right: partial.marker_right,
  };
}

// =============================================================================
// Main Parser
// =============================================================================

/**
 * Parses a mapping configuration file content and returns a MappingConfig.
 *
 * @param content - The raw string content of the mapping file
 * @returns ParseResult indicating success with config or failure with error message
 *
 * @example
 * ```typescript
 * const content = fs.readFileSync('mappings/default.txt', 'utf-8');
 * const result = parseMapping(content);
 * if (result.success) {
 *   console.log('Loaded', result.config.tracks.length, 'tracks');
 * } else {
 *   console.error('Parse error:', result.error);
 * }
 * ```
 */
export function parseMapping(content: string): ParseResult {
  try {
    const lines = content.split('\n');

    // Initialize tracking structures
    const tracks: Map<number, PartialTrackMapping> = new Map();
    for (let i = 1; i <= TRACK_CONSTANTS.COUNT; i++) {
      tracks.set(i, createEmptyPartialTrack());
    }

    const transport: PartialTransportMapping = {};
    let currentSection: CurrentSection | null = null;
    let hasTransportSection = false;
    const definedTracks = new Set<number>();

    // Parse each line
    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1; // 1-indexed for error messages
      const line = lines[i];

      // Handle undefined line (should not happen, but TypeScript requires check)
      if (line === undefined) {
        continue;
      }

      const trimmed = line.trim();

      // Skip empty lines and comments
      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      // Check for section header
      const sectionHeader = parseSectionHeader(trimmed, lineNumber);
      if (sectionHeader) {
        currentSection = sectionHeader;
        if (sectionHeader.type === 'transport') {
          hasTransportSection = true;
        } else if (sectionHeader.trackNumber !== undefined) {
          definedTracks.add(sectionHeader.trackNumber);
        }
        continue;
      }

      // Parse control mapping line
      const { controlType, entry } = parseControlLine(line, lineNumber, currentSection);

      if (currentSection === null) {
        // This should not happen due to check in parseControlLine, but TypeScript needs it
        throw new ParseError('Internal error: no current section', lineNumber, line);
      }

      // Store the mapping in the appropriate structure
      if (currentSection.type === 'track' && currentSection.trackNumber !== undefined) {
        const trackMapping = tracks.get(currentSection.trackNumber);
        if (!trackMapping) {
          throw new ParseError(
            `Internal error: track ${currentSection.trackNumber} not initialized`,
            lineNumber,
            line
          );
        }

        // Type-safe assignment for track controls
        const trackControl = controlType as ControlType;

        // Check for duplicate control definitions
        if (trackMapping[trackControl] !== undefined) {
          throw new ParseError(
            `Duplicate ${controlType} definition in track${currentSection.trackNumber}`,
            lineNumber,
            line
          );
        }

        trackMapping[trackControl] = entry;
      } else if (currentSection.type === 'transport') {
        // Type-safe assignment for transport controls
        const transportControl = controlType as TransportControlType;

        // Check for duplicate control definitions
        if (transport[transportControl] !== undefined) {
          throw new ParseError(
            `Duplicate ${controlType} definition in transport section`,
            lineNumber,
            line
          );
        }

        transport[transportControl] = entry;
      }
    }

    // Validate all tracks are defined
    for (let i = 1; i <= TRACK_CONSTANTS.COUNT; i++) {
      if (!definedTracks.has(i)) {
        return {
          success: false,
          error: `Track ${i} is not defined. All 8 tracks (track1-track8) must be present`,
        };
      }
    }

    // Validate transport section is defined
    if (!hasTransportSection) {
      return {
        success: false,
        error: 'Transport section is not defined. A [transport] section is required',
      };
    }

    // Validate and build final track mappings
    const finalTracks: TrackMapping[] = [];
    for (let i = 1; i <= TRACK_CONSTANTS.COUNT; i++) {
      const partial = tracks.get(i);
      if (!partial) {
        return {
          success: false,
          error: `Internal error: track ${i} not found`,
        };
      }

      try {
        finalTracks.push(validateTrackMapping(partial, i));
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // Validate and build final transport mapping
    let finalTransport: TransportMapping;
    try {
      finalTransport = validateTransportMapping(transport);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      success: true,
      config: {
        tracks: finalTracks,
        transport: finalTransport,
      },
    };
  } catch (err) {
    if (err instanceof ParseError) {
      return {
        success: false,
        error: err.message,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Convenience function that parses and throws on error.
 * Use this when you want exceptions rather than result objects.
 */
export function parseMappingOrThrow(content: string): MappingConfig {
  const result = parseMapping(content);
  if (result.success) {
    return result.config;
  }
  throw new Error(result.error);
}
