import { OpenSheetMusicDisplay, Note } from 'opensheetmusicdisplay';
import { FEEDBACK_COLORS, HandMode, ScoreGrade } from '../types/music';

/**
 * Anson Practice Piano — High-Performance OSMD Note Coloring Utility
 *
 * Why this avoids lag:
 * Calling `osmd.render()` after every note forces VexFlow to re-layout and
 * regenerate the entire SVG document (50–200ms per frame), causing audio/cursor stutter.
 * Instead, we retrieve the underlying `VexFlowGraphicalNote` via `osmd.EngravingRules.GNote(note)`
 * and invoke `gNote.setColor(hex, options)`, which directly updates only the SVG notehead's
 * fill/stroke attributes in < 0.5ms. We also persist `note.NoteheadColor = hex` so
 * window resizes retain the feedback colors.
 */

const DEFAULT_NOTE_COLOR = '#000000';

/**
 * Colors a single OSMD Note instance immediately in the live SVG DOM.
 */
export function colorOSMDNote(
  osmd: OpenSheetMusicDisplay | null,
  note: Note,
  hexColor: string
): boolean {
  if (!osmd?.EngravingRules) return false;

  // Persist color on the logical Note model in case of future resize/re-render
  note.NoteheadColor = hexColor;

  try {
    const gNote = osmd.EngravingRules.GNote(note);
    if (!gNote) return false;

    gNote.setColor(hexColor, {
      applyToNoteheads: true,
      applyToModifiers: true,
      applyToStem: false,
      applyToBeams: false,
      applyToLedgerLines: false,
      applyToTies: false,
      applyToSlurs: false,
    });
    return true;
  } catch (err) {
    console.warn('[Anson Practice Piano] Unable to color notehead:', err);
    return false;
  }
}

/**
 * Colors specific notes at the current OSMD cursor position (or matching a specific MIDI pitch).
 */
export function colorNotesAtCursor(
  osmd: OpenSheetMusicDisplay | null,
  grade: ScoreGrade,
  options: { targetMidi?: number; handMode?: HandMode } = {}
): void {
  if (!osmd?.cursor) return;

  const hex = FEEDBACK_COLORS[grade];
  const notes = osmd.cursor.NotesUnderCursor();

  for (const note of notes) {
    if (note.isRest()) continue;
    if (note.NoteTie && note.NoteTie.StartNote !== note) continue;

    const staffIndex =
      note.ParentStaff?.Id ??
      (note.ParentStaff?.idInMusicSheet !== undefined ? note.ParentStaff.idInMusicSheet + 1 : 1);

    if (options.handMode === 'right' && staffIndex !== 1) continue;
    if (options.handMode === 'left' && staffIndex !== 2) continue;

    const noteMidi = note.halfTone + 12;
    if (options.targetMidi !== undefined && noteMidi !== options.targetMidi) {
      continue;
    }

    colorOSMDNote(osmd, note, hex);
  }
}

/**
 * Colors an explicit list of OSMD Note objects (useful when coloring missed notes
 * right before advancing the cursor in Tempo Mode).
 */
export function colorNoteList(
  osmd: OpenSheetMusicDisplay | null,
  notes: Note[],
  grade: ScoreGrade
): void {
  if (!osmd) return;
  const hex = FEEDBACK_COLORS[grade];
  for (const note of notes) {
    if (!note.isRest()) {
      colorOSMDNote(osmd, note, hex);
    }
  }
}

/**
 * Efficiently resets every notehead in the rendered score back to black without calling osmd.render().
 */
export function resetAllOSMDNoteColors(osmd: OpenSheetMusicDisplay | null): void {
  const measureList = osmd?.GraphicSheet?.MeasureList;
  if (!measureList) return;

  for (const measureRow of measureList) {
    if (!measureRow) continue;
    for (const graphicalMeasure of measureRow) {
      if (!graphicalMeasure?.staffEntries) continue;
      for (const staffEntry of graphicalMeasure.staffEntries) {
        for (const gVoiceEntry of staffEntry.graphicalVoiceEntries) {
          for (const gNote of gVoiceEntry.notes) {
            if (!gNote?.sourceNote || gNote.sourceNote.isRest()) continue;
            if (gNote.sourceNote.NoteheadColor && gNote.sourceNote.NoteheadColor !== DEFAULT_NOTE_COLOR) {
              gNote.sourceNote.NoteheadColor = DEFAULT_NOTE_COLOR;
              gNote.setColor(DEFAULT_NOTE_COLOR, {
                applyToNoteheads: true,
                applyToModifiers: true,
                applyToStem: false,
                applyToBeams: false,
              });
            }
          }
        }
      }
    }
  }
}
