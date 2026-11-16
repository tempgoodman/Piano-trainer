export type EditorNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th';
export type EditorAccidental = 'sharp' | 'flat' | 'natural' | 'none';
export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export interface MusicXMLNoteDescriptor {
  noteId: string;
  measureIndex: number;
  measureNumber: number;
  noteIndexInMeasure: number;
  staffNumber: number;
  voiceId: string;
  /** Onset in whole-note fractions within the measure (matches OSMD Timestamp.RealValue) */
  onsetRatio: number;
  isRest: boolean;
  isChord: boolean;
  step: PitchStep | null;
  octave: number | null;
  alter: number;
  accidental: EditorAccidental;
  noteType: EditorNoteType;
  dotted: boolean;
  durationDivisions: number;
  midiPitch: number | null;
  displayLabel: string;
}

export interface ScoreMetadata {
  title: string;
  composer: string;
  measureCount: number;
  divisions: number;
}

const DIATONIC_STEPS: PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_TO_SEMITONE: Record<PitchStep, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const NOTE_TYPE_QUARTERS: Record<EditorNoteType, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
};

const NOTE_CHILD_ORDER = [
  'grace',
  'cue',
  'chord',
  'pitch',
  'unpitched',
  'rest',
  'duration',
  'tie',
  'instrument',
  'voice',
  'type',
  'dot',
  'accidental',
  'time-modification',
  'stem',
  'notehead',
  'staff',
  'beam',
  'notations',
  'lyric',
];

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function normalizeNoteType(raw: string | null | undefined): EditorNoteType {
  if (raw === 'whole' || raw === 'half' || raw === 'quarter' || raw === 'eighth' || raw === '16th') {
    return raw;
  }
  return 'quarter';
}

function normalizeAccidental(raw: string | null | undefined, alter: number): EditorAccidental {
  if (raw === 'sharp' || raw === 'flat' || raw === 'natural') {
    return raw;
  }
  if (alter === 1) return 'sharp';
  if (alter === -1) return 'flat';
  return 'none';
}

function formatPitchLabel(
  isRest: boolean,
  step: PitchStep | null,
  octave: number | null,
  alter: number
): string {
  if (isRest || !step || octave === null) return 'Rest';
  const accSymbol = alter === 1 ? '♯' : alter === -1 ? '♭' : '';
  return `${step}${accSymbol}${octave}`;
}

function computeMidiPitch(step: PitchStep | null, octave: number | null, alter: number): number | null {
  if (!step || octave === null) return null;
  return (octave + 1) * 12 + STEP_TO_SEMITONE[step] + alter;
}

/**
 * Deliverable 2: `MusicXMLParser`
 * Standalone DOM-backed MusicXML utility for locating `<note>` nodes by stable ID,
 * computing exact in-measure onset ratios for OSMD visual-to-data mapping,
 * and mutating pitch, accidentals, durations, rests, and chord deletions cleanly.
 */
export class MusicXMLParser {
  private doc: XMLDocument;

  constructor(xmlString: string) {
    const parser = new DOMParser();
    const parsed = parser.parseFromString(xmlString, 'application/xml');
    if (parsed.querySelector('parsererror')) {
      throw new Error('Invalid MusicXML markup.');
    }
    this.doc = parsed;
  }

  public clone(): MusicXMLParser {
    return new MusicXMLParser(this.toXmlString());
  }

  public toXmlString(): string {
    const serializer = new XMLSerializer();
    let xml = serializer.serializeToString(this.doc);
    if (!xml.startsWith('<?xml')) {
      xml = `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
    }
    return xml;
  }

  public getScoreMetadata(): ScoreMetadata {
    const title =
      this.doc.querySelector('work > work-title')?.textContent?.trim() ||
      this.doc.querySelector('movement-title')?.textContent?.trim() ||
      'Untitled Score';
    const composer =
      this.doc.querySelector('identification > creator[type="composer"]')?.textContent?.trim() ||
      'Anson Practice Piano';
    const measures = this.getFirstPartMeasures();
    const firstDiv = Number(this.doc.querySelector('attributes > divisions')?.textContent?.trim() || '1');
    return {
      title,
      composer,
      measureCount: measures.length,
      divisions: Number.isFinite(firstDiv) && firstDiv > 0 ? firstDiv : 1,
    };
  }

  public updateTitle(newTitle: string): void {
    const clean = newTitle.trim() || 'Untitled Score';
    let workEl = this.doc.querySelector('work');
    if (!workEl) {
      workEl = this.doc.createElement('work');
      const root = this.doc.documentElement;
      root.insertBefore(workEl, root.firstChild);
    }
    let titleEl = workEl.querySelector('work-title');
    if (!titleEl) {
      titleEl = this.doc.createElement('work-title');
      workEl.appendChild(titleEl);
    }
    titleEl.textContent = clean;
  }

  private getFirstPart(): Element | null {
    return this.doc.querySelector('part');
  }

  private getFirstPartMeasures(): Element[] {
    const part = this.getFirstPart();
    if (!part) return [];
    return Array.from(part.children).filter((el) => el.tagName === 'measure');
  }

  /**
   * Builds a complete indexed list of all `<note>` nodes in the primary `<part>`,
   * tracking divisions and `<backup>`/`<forward>` offsets to produce exact OSMD-compatible onset ratios.
   */
  public extractNoteDescriptors(): MusicXMLNoteDescriptor[] {
    const measures = this.getFirstPartMeasures();
    const descriptors: MusicXMLNoteDescriptor[] = [];
    let currentDivisions = 1;

    measures.forEach((measureEl, measureIndex) => {
      const measureNumAttr = Number(measureEl.getAttribute('number'));
      const measureNumber = Number.isFinite(measureNumAttr) && measureNumAttr > 0 ? measureNumAttr : measureIndex + 1;

      const divNode = measureEl.querySelector(':scope > attributes > divisions');
      if (divNode) {
        const parsedDiv = Number(divNode.textContent?.trim());
        if (Number.isFinite(parsedDiv) && parsedDiv > 0) {
          currentDivisions = parsedDiv;
        }
      }

      let cursorDiv = 0;
      let lastNonChordOnsetDiv = 0;
      let noteIndexInMeasure = 0;

      for (const child of Array.from(measureEl.children)) {
        if (child.tagName === 'backup') {
          const dur = Number(child.querySelector('duration')?.textContent?.trim() || '0');
          if (Number.isFinite(dur)) cursorDiv = Math.max(0, cursorDiv - dur);
          continue;
        }
        if (child.tagName === 'forward') {
          const dur = Number(child.querySelector('duration')?.textContent?.trim() || '0');
          if (Number.isFinite(dur)) cursorDiv += dur;
          continue;
        }
        if (child.tagName !== 'note') continue;

        const isChord = Boolean(child.querySelector(':scope > chord'));
        const onsetDiv = isChord ? lastNonChordOnsetDiv : cursorDiv;
        const durationDiv = Number(child.querySelector(':scope > duration')?.textContent?.trim() || '1');
        const safeDuration = Number.isFinite(durationDiv) && durationDiv >= 0 ? durationDiv : 1;

        if (!isChord) {
          lastNonChordOnsetDiv = cursorDiv;
          cursorDiv += safeDuration;
        }

        const isRest = Boolean(child.querySelector(':scope > rest'));
        const pitchEl = child.querySelector(':scope > pitch');
        const rawStep = pitchEl?.querySelector(':scope > step')?.textContent?.trim() as PitchStep | undefined;
        const step = rawStep && DIATONIC_STEPS.includes(rawStep) ? rawStep : null;
        const rawOctave = Number(pitchEl?.querySelector(':scope > octave')?.textContent?.trim());
        const octave = Number.isFinite(rawOctave) ? rawOctave : null;
        const rawAlter = Number(pitchEl?.querySelector(':scope > alter')?.textContent?.trim() || '0');
        const alter = Number.isFinite(rawAlter) ? rawAlter : 0;

        const accText = child.querySelector(':scope > accidental')?.textContent?.trim();
        const accidental = normalizeAccidental(accText, alter);
        const noteType = normalizeNoteType(child.querySelector(':scope > type')?.textContent?.trim());
        const dotted = Boolean(child.querySelector(':scope > dot'));
        const staffNumber = Number(child.querySelector(':scope > staff')?.textContent?.trim() || '1') || 1;
        const voiceId = child.querySelector(':scope > voice')?.textContent?.trim() || '1';
        const onsetRatio = onsetDiv / (currentDivisions * 4);

        const noteId = `m${measureIndex}-n${noteIndexInMeasure}`;
        descriptors.push({
          noteId,
          measureIndex,
          measureNumber,
          noteIndexInMeasure,
          staffNumber,
          voiceId,
          onsetRatio,
          isRest,
          isChord,
          step: isRest ? null : step,
          octave: isRest ? null : octave,
          alter: isRest ? 0 : alter,
          accidental: isRest ? 'none' : accidental,
          noteType,
          dotted,
          durationDivisions: safeDuration,
          midiPitch: isRest ? null : computeMidiPitch(step, octave, alter),
          displayLabel: formatPitchLabel(isRest, step, octave, alter),
        });

        noteIndexInMeasure++;
      }
    });

    return descriptors;
  }

  public getNoteById(noteId: string): MusicXMLNoteDescriptor | null {
    return this.extractNoteDescriptors().find((d) => d.noteId === noteId) ?? null;
  }

  private findNoteElement(noteId: string): { measureEl: Element; noteEl: Element } | null {
    const match = noteId.match(/^m(\d+)-n(\d+)$/);
    if (!match) return null;
    const measureIndex = Number(match[1]);
    const noteIndex = Number(match[2]);

    const measures = this.getFirstPartMeasures();
    const measureEl = measures[measureIndex];
    if (!measureEl) return null;

    const noteElements = Array.from(measureEl.children).filter((el) => el.tagName === 'note');
    const noteEl = noteElements[noteIndex];
    if (!noteEl) return null;

    return { measureEl, noteEl };
  }

  private insertInMusicXmlOrder(noteEl: Element, element: Element): void {
    const targetRank = NOTE_CHILD_ORDER.indexOf(element.tagName);
    const children = Array.from(noteEl.children);
    for (const child of children) {
      const rank = NOTE_CHILD_ORDER.indexOf(child.tagName);
      if (rank > targetRank && targetRank !== -1) {
        noteEl.insertBefore(element, child);
        return;
      }
    }
    noteEl.appendChild(element);
  }

  private ensureChildText(parent: Element, tagName: string, text: string, orderedInNote = false): Element {
    let child = parent.querySelector(`:scope > ${tagName}`);
    if (!child) {
      child = this.doc.createElement(tagName);
      if (orderedInNote) {
        this.insertInMusicXmlOrder(parent, child);
      } else {
        parent.appendChild(child);
      }
    }
    child.textContent = text;
    return child;
  }

  /**
   * Moves a note up or down by one diatonic step (e.g., C4 -> D4, B4 -> C5).
   * If invoked on a `<rest/>`, converts it into a pitched note on that staff.
   */
  public transposeDiatonic(noteId: string, deltaSteps: 1 | -1): MusicXMLNoteDescriptor | null {
    const located = this.findNoteElement(noteId);
    if (!located) return null;
    const { noteEl } = located;

    const restEl = noteEl.querySelector(':scope > rest');
    if (restEl) {
      restEl.remove();
      const staff = Number(noteEl.querySelector(':scope > staff')?.textContent?.trim() || '1');
      const pitchEl = this.doc.createElement('pitch');
      this.ensureChildText(pitchEl, 'step', staff === 2 ? 'C' : 'C');
      this.ensureChildText(pitchEl, 'octave', staff === 2 ? '3' : '4');
      this.insertInMusicXmlOrder(noteEl, pitchEl);
      return this.getNoteById(noteId);
    }

    const pitchEl = noteEl.querySelector(':scope > pitch');
    if (!pitchEl) return null;

    const currentStep = (pitchEl.querySelector(':scope > step')?.textContent?.trim() || 'C') as PitchStep;
    const currentOctave = Number(pitchEl.querySelector(':scope > octave')?.textContent?.trim() || '4');
    const stepIdx = Math.max(0, DIATONIC_STEPS.indexOf(currentStep));

    let nextIdx = stepIdx + deltaSteps;
    let nextOctave = currentOctave;

    if (nextIdx >= DIATONIC_STEPS.length) {
      nextIdx = 0;
      nextOctave = Math.min(7, nextOctave + 1);
    } else if (nextIdx < 0) {
      nextIdx = DIATONIC_STEPS.length - 1;
      nextOctave = Math.max(1, nextOctave - 1);
    }

    const nextStep = DIATONIC_STEPS[nextIdx];
    this.ensureChildText(pitchEl, 'step', nextStep);
    this.ensureChildText(pitchEl, 'octave', String(nextOctave));

    return this.getNoteById(noteId);
  }

  /**
   * Adds, updates, or clears an accidental (Sharp #, Flat b, Natural, or None) on a pitched note.
   */
  public setAccidental(noteId: string, accidental: EditorAccidental): MusicXMLNoteDescriptor | null {
    const located = this.findNoteElement(noteId);
    if (!located) return null;
    const { noteEl } = located;

    const pitchEl = noteEl.querySelector(':scope > pitch');
    if (!pitchEl) return null; // Ignore on rests

    const existingAlter = pitchEl.querySelector(':scope > alter');
    const existingAcc = noteEl.querySelector(':scope > accidental');

    if (accidental === 'sharp') {
      this.ensureChildText(pitchEl, 'alter', '1');
      // Place <alter> between <step> and <octave> per MusicXML schema
      const octaveEl = pitchEl.querySelector(':scope > octave');
      const alterEl = pitchEl.querySelector(':scope > alter');
      if (octaveEl && alterEl) {
        pitchEl.insertBefore(alterEl, octaveEl);
      }
      this.ensureChildText(noteEl, 'accidental', 'sharp', true);
    } else if (accidental === 'flat') {
      this.ensureChildText(pitchEl, 'alter', '-1');
      const octaveEl = pitchEl.querySelector(':scope > octave');
      const alterEl = pitchEl.querySelector(':scope > alter');
      if (octaveEl && alterEl) {
        pitchEl.insertBefore(alterEl, octaveEl);
      }
      this.ensureChildText(noteEl, 'accidental', 'flat', true);
    } else if (accidental === 'natural') {
      existingAlter?.remove();
      this.ensureChildText(noteEl, 'accidental', 'natural', true);
    } else {
      existingAlter?.remove();
      existingAcc?.remove();
    }

    return this.getNoteById(noteId);
  }

  /**
   * Scales `<divisions>` and all `<duration>` values across the `<part>` if needed
   * so shorter note values (eighth, 16th, dotted) always remain exact MusicXML integers.
   */
  private ensureDivisionsForQuarterMultiple(quarterMultiple: number): number {
    const part = this.getFirstPart();
    if (!part) return 1;

    const firstDivNode = this.doc.querySelector('attributes > divisions');
    const currentDiv = Math.max(1, Number(firstDivNode?.textContent?.trim() || '1'));

    // Find denominator of quarterMultiple (e.g. 0.75 -> 4, 0.375 -> 8)
    const scaled = Math.round(quarterMultiple * 16);
    const denom = 16 / gcd(scaled, 16);
    const currentMultiple = (currentDiv * scaled) / 16;

    if (Number.isInteger(currentMultiple) && currentMultiple >= 1) {
      return currentDiv;
    }

    const factor = denom / gcd(currentDiv, denom);
    const nextDiv = currentDiv * factor;

    const allDivNodes = part.querySelectorAll('attributes > divisions');
    allDivNodes.forEach((node) => {
      const val = Number(node.textContent?.trim() || '1');
      node.textContent = String(Math.max(1, Math.round(val * factor)));
    });

    const allDurationNodes = part.querySelectorAll('duration');
    allDurationNodes.forEach((node) => {
      const val = Number(node.textContent?.trim() || '1');
      node.textContent = String(Math.max(1, Math.round(val * factor)));
    });

    return nextDiv;
  }

  /**
   * Changes the rhythmic value (whole, half, quarter, eighth, 16th) and optional dot on a note/rest.
   */
  public setDuration(
    noteId: string,
    noteType: EditorNoteType,
    dotted = false
  ): MusicXMLNoteDescriptor | null {
    const located = this.findNoteElement(noteId);
    if (!located) return null;
    const { noteEl } = located;

    const baseQuarters = NOTE_TYPE_QUARTERS[noteType];
    const effectiveQuarters = dotted ? baseQuarters * 1.5 : baseQuarters;
    const divisions = this.ensureDivisionsForQuarterMultiple(effectiveQuarters);
    const nextDuration = Math.max(1, Math.round(divisions * effectiveQuarters));

    this.ensureChildText(noteEl, 'duration', String(nextDuration), true);
    this.ensureChildText(noteEl, 'type', noteType, true);

    const existingDot = noteEl.querySelector(':scope > dot');
    if (dotted && !existingDot) {
      const dotEl = this.doc.createElement('dot');
      this.insertInMusicXmlOrder(noteEl, dotEl);
    } else if (!dotted && existingDot) {
      existingDot.remove();
    }

    return this.getNoteById(noteId);
  }

  /**
   * Converts a pitched note into a `<rest/>` preserving duration & measure timing,
   * or removes a chord member if the selected note is part of a chord.
   */
  public convertToRest(noteId: string): MusicXMLNoteDescriptor | null {
    const located = this.findNoteElement(noteId);
    if (!located) return null;
    const { noteEl } = located;

    // If this note is an upper chord tone (<chord/>), removing it keeps the base beat intact
    if (noteEl.querySelector(':scope > chord')) {
      noteEl.remove();
      return null;
    }

    // If the next sibling is a <chord/> belonging to this note, promote it instead of leaving orphaned <chord/>
    const nextSibling = noteEl.nextElementSibling;
    if (nextSibling?.tagName === 'note' && nextSibling.querySelector(':scope > chord')) {
      nextSibling.querySelector(':scope > chord')?.remove();
      noteEl.remove();
      return this.getNoteById(noteId);
    }

    noteEl.querySelector(':scope > pitch')?.remove();
    noteEl.querySelector(':scope > accidental')?.remove();
    noteEl.querySelector(':scope > tie')?.remove();

    if (!noteEl.querySelector(':scope > rest')) {
      const restEl = this.doc.createElement('rest');
      this.insertInMusicXmlOrder(noteEl, restEl);
    }

    return this.getNoteById(noteId);
  }

  /**
   * Removes the `<note>` XML element directly from its `<measure>`.
   * Handles promoting the next `<chord/>` note if the base chord note is deleted.
   */
  public removeNote(noteId: string): void {
    const located = this.findNoteElement(noteId);
    if (!located) return;
    const { noteEl } = located;

    const nextSibling = noteEl.nextElementSibling;
    if (
      !noteEl.querySelector(':scope > chord') &&
      nextSibling?.tagName === 'note' &&
      nextSibling.querySelector(':scope > chord')
    ) {
      nextSibling.querySelector(':scope > chord')?.remove();
    }

    noteEl.remove();
  }
}
