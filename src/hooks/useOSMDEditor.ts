import { useCallback, useEffect, useRef, useState } from 'react';
import { GraphicalNote, OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { MusicXMLNoteDescriptor, MusicXMLParser } from '../utils/MusicXMLParser';

export interface NoteAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectedNoteMetadata extends MusicXMLNoteDescriptor {
  anchorRect: NoteAnchorRect | null;
}

interface VexFlowNoteLike extends GraphicalNote {
  getNoteheadSVGs?: () => HTMLElement[];
  getSVGGElement?: () => SVGGElement | null;
}

interface BoundGraphicalEntry {
  noteId: string;
  descriptor: MusicXMLNoteDescriptor;
  graphicalNote: VexFlowNoteLike;
  clickElements: HTMLElement[];
}

interface UseOSMDEditorOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  xmlString: string | null;
  debounceMs?: number;
}

const SELECTION_HIGHLIGHT_HEX = '#0284C7';
const DEFAULT_NOTE_HEX = '#000000';
const SELECTION_OVERLAY_ATTR = 'data-editor-selection-ring';

/**
 * Deliverable 3: `useOSMDEditor` Hook
 * Completely decoupled from Web MIDI, AudioEngine, and Practice/Scoring hooks.
 * Manages an isolated OSMD SVG instance, maps rendered SVG noteheads back to
 * `<note>` XML nodes via `MusicXMLParser`, highlights the selected note, and
 * debounces `osmd.load() -> osmd.render()` to keep rapid edits lag-free.
 */
export function useOSMDEditor({
  containerRef,
  xmlString,
  debounceMs = 160,
}: UseOSMDEditorOptions) {
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const boundEntriesRef = useRef<Map<string, BoundGraphicalEntry>>(new Map());
  const selectedNoteIdRef = useRef<string | null>(null);
  const hasRenderedInitialRef = useRef(false);
  const renderTimerRef = useRef<number | null>(null);
  const renderEpochRef = useRef(0);

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedNoteMetadata, setSelectedNoteMetadata] = useState<SelectedNoteMetadata | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  selectedNoteIdRef.current = selectedNoteId;

  const computeAnchorRect = useCallback(
    (entry: BoundGraphicalEntry): NoteAnchorRect | null => {
      const container = containerRef.current;
      const targetEl =
        entry.clickElements[0] ?? entry.graphicalNote.getSVGGElement?.() ?? null;
      if (!container || !targetEl) return null;

      const containerRect = container.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      return {
        left: targetRect.left - containerRect.left + targetRect.width / 2,
        top: targetRect.top - containerRect.top,
        width: targetRect.width,
        height: targetRect.height,
      };
    },
    [containerRef]
  );

  const clearSelectionVisuals = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      container.querySelectorAll(`[${SELECTION_OVERLAY_ATTR}="true"]`).forEach((el) => el.remove());
    }
    for (const entry of boundEntriesRef.current.values()) {
      try {
        entry.graphicalNote.setColor(DEFAULT_NOTE_HEX, {
          applyToNoteheads: true,
          applyToModifiers: true,
          applyToStem: false,
          applyToBeams: false,
        });
      } catch {
        // Ignore unrendered note
      }
    }
  }, [containerRef]);

  const applySelectionVisuals = useCallback(
    (noteId: string | null) => {
      clearSelectionVisuals();

      if (!noteId) {
        setSelectedNoteMetadata(null);
        return;
      }

      const entry = boundEntriesRef.current.get(noteId);
      if (!entry) {
        setSelectedNoteMetadata(null);
        return;
      }

      try {
        entry.graphicalNote.setColor(SELECTION_HIGHLIGHT_HEX, {
          applyToNoteheads: true,
          applyToModifiers: true,
          applyToStem: false,
          applyToBeams: false,
        });
      } catch {
        // Ignore color failure
      }

      // Draw a subtle SVG focus halo around the selected notehead or rest
      const anchorEl = entry.clickElements[0] ?? entry.graphicalNote.getSVGGElement?.() ?? null;
      const svgParent = anchorEl?.closest('svg');
      if (anchorEl && svgParent && anchorEl instanceof SVGGraphicsElement) {
        try {
          const bbox = anchorEl.getBBox();
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const pad = 5;
          rect.setAttribute('x', String(bbox.x - pad));
          rect.setAttribute('y', String(bbox.y - pad));
          rect.setAttribute('width', String(Math.max(16, bbox.width + pad * 2)));
          rect.setAttribute('height', String(Math.max(16, bbox.height + pad * 2)));
          rect.setAttribute('rx', '4');
          rect.setAttribute('fill', 'rgba(2, 132, 199, 0.14)');
          rect.setAttribute('stroke', '#0284C7');
          rect.setAttribute('stroke-width', '1.5');
          rect.setAttribute('pointer-events', 'none');
          rect.setAttribute(SELECTION_OVERLAY_ATTR, 'true');
          anchorEl.parentNode?.insertBefore(rect, anchorEl);
        } catch {
          // Ignore SVG getBBox failure when detached
        }
      }

      const anchorRect = computeAnchorRect(entry);
      setSelectedNoteMetadata({
        ...entry.descriptor,
        anchorRect,
      });
    },
    [clearSelectionVisuals, computeAnchorRect]
  );

  // Sync optimistic metadata immediately when XML mutates (before debounced re-render completes)
  useEffect(() => {
    if (!xmlString || !selectedNoteId) return;
    try {
      const parser = new MusicXMLParser(xmlString);
      const updated = parser.getNoteById(selectedNoteId);
      if (!updated) {
        setSelectedNoteId(null);
        setSelectedNoteMetadata(null);
        return;
      }
      setSelectedNoteMetadata((prev) =>
        prev && prev.noteId === selectedNoteId
          ? { ...updated, anchorRect: prev.anchorRect }
          : { ...updated, anchorRect: null }
      );
    } catch {
      // Ignore parse errors during transient state
    }
  }, [xmlString, selectedNoteId]);

  // Bind click handlers across all OSMD SVG noteheads and map them 1-to-1 to XML descriptors
  const bindRenderedSvgNotes = useCallback(
    (osmd: OpenSheetMusicDisplay, activeXml: string) => {
      const container = containerRef.current;
      if (!container || !osmd.GraphicSheet?.MeasureList) return;

      let descriptors: MusicXMLNoteDescriptor[] = [];
      try {
        descriptors = new MusicXMLParser(activeXml).extractNoteDescriptors();
      } catch {
        return;
      }

      const claimedIds = new Set<string>();
      const newMap = new Map<string, BoundGraphicalEntry>();

      const findMatchingDescriptor = (
        measureIndex: number,
        staffNumber: number,
        voiceId: string,
        onsetRatio: number,
        isRest: boolean,
        midiPitch: number | null
      ): MusicXMLNoteDescriptor | null => {
        const candidates = descriptors.filter(
          (d) =>
            !claimedIds.has(d.noteId) &&
            d.measureIndex === measureIndex &&
            d.staffNumber === staffNumber &&
            d.isRest === isRest &&
            Math.abs(d.onsetRatio - onsetRatio) < 0.005
        );

        if (candidates.length === 0) return null;

        // Prefer exact voice + pitch match
        const exact = candidates.find(
          (d) =>
            d.voiceId === voiceId &&
            (isRest || midiPitch === null || d.midiPitch === midiPitch)
        );
        if (exact) return exact;

        // Next prefer exact pitch match
        if (!isRest && midiPitch !== null) {
          const pitchMatch = candidates.find((d) => d.midiPitch === midiPitch);
          if (pitchMatch) return pitchMatch;
        }

        // Fallback to voice match or first candidate at that onset
        return candidates.find((d) => d.voiceId === voiceId) ?? candidates[0];
      };

      const measureList = osmd.GraphicSheet.MeasureList;
      for (let measureIdx = 0; measureIdx < measureList.length; measureIdx++) {
        const staffMeasures = measureList[measureIdx];
        if (!staffMeasures) continue;

        for (let staffRowIdx = 0; staffRowIdx < staffMeasures.length; staffRowIdx++) {
          const gMeasure = staffMeasures[staffRowIdx];
          if (!gMeasure?.staffEntries) continue;

          for (const staffEntry of gMeasure.staffEntries) {
            const onsetReal =
              staffEntry.sourceStaffEntry?.Timestamp?.RealValue ?? 0;

            for (const gve of staffEntry.graphicalVoiceEntries ?? []) {
              for (const rawGNote of gve.notes ?? []) {
                const gNote = rawGNote as VexFlowNoteLike;
                const src = gNote.sourceNote;
                if (!src) continue;

                const isRest = src.isRest();
                const staffId =
                  typeof src.ParentStaff?.idInMusicSheet === 'number'
                    ? src.ParentStaff.idInMusicSheet + 1
                    : staffRowIdx + 1;
                const voiceId = String(
                  src.ParentVoiceEntry?.ParentVoice?.VoiceId ?? '1'
                );
                const midiPitch = !isRest && typeof src.halfTone === 'number'
                  ? src.halfTone + 12
                  : null;

                const descriptor = findMatchingDescriptor(
                  measureIdx,
                  staffId,
                  voiceId,
                  onsetReal,
                  isRest,
                  midiPitch
                );
                if (!descriptor) continue;
                claimedIds.add(descriptor.noteId);

                const noteheads = gNote.getNoteheadSVGs?.() ?? [];
                const groupEl = gNote.getSVGGElement?.() ?? null;
                const clickElements = (
                  noteheads.length > 0 ? noteheads : groupEl ? [groupEl] : []
                ) as HTMLElement[];

                for (const el of clickElements) {
                  el.style.cursor = 'pointer';
                  el.style.pointerEvents = 'all';
                  el.setAttribute('data-editor-note-id', descriptor.noteId);

                  el.addEventListener('click', (evt: MouseEvent) => {
                    evt.stopPropagation();
                    setSelectedNoteId(descriptor.noteId);
                    applySelectionVisuals(descriptor.noteId);
                  });
                }

                newMap.set(descriptor.noteId, {
                  noteId: descriptor.noteId,
                  descriptor,
                  graphicalNote: gNote,
                  clickElements,
                });
              }
            }
          }
        }
      }

      boundEntriesRef.current = newMap;

      if (selectedNoteIdRef.current && newMap.has(selectedNoteIdRef.current)) {
        applySelectionVisuals(selectedNoteIdRef.current);
      } else if (selectedNoteIdRef.current) {
        setSelectedNoteId(null);
        setSelectedNoteMetadata(null);
      }
    },
    [applySelectionVisuals, containerRef]
  );

  // Initialize OSMD once when container mounts
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    hasRenderedInitialRef.current = false;

    const osmd = new OpenSheetMusicDisplay(container, {
      autoResize: true,
      backend: 'svg',
      drawTitle: true,
      drawSubtitle: false,
      drawComposer: true,
      drawPartNames: false,
      followCursor: false,
    });
    osmdRef.current = osmd;

    const handleBackgroundClick = (evt: MouseEvent) => {
      const target = evt.target as Element | null;
      if (target?.closest('[data-editor-note-id]')) return;
      setSelectedNoteId(null);
      applySelectionVisuals(null);
    };

    container.addEventListener('click', handleBackgroundClick);

    return () => {
      if (renderTimerRef.current !== null) {
        window.clearTimeout(renderTimerRef.current);
        renderTimerRef.current = null;
      }
      container.removeEventListener('click', handleBackgroundClick);
      osmdRef.current = null;
      boundEntriesRef.current.clear();
      container.innerHTML = '';
    };
  }, [applySelectionVisuals, containerRef]);

  // Deliverable 4: Debounced Update Loop -> OSMD.load() -> OSMD.render() -> Re-bind SVG map
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || !xmlString) return;

    if (renderTimerRef.current !== null) {
      window.clearTimeout(renderTimerRef.current);
      renderTimerRef.current = null;
    }

    const executeRender = async () => {
      const epoch = ++renderEpochRef.current;
      setIsRendering(true);
      setRenderError(null);

      try {
        await osmd.load(xmlString);
        if (epoch !== renderEpochRef.current) return;
        osmd.render();
        hasRenderedInitialRef.current = true;
        bindRenderedSvgNotes(osmd, xmlString);
      } catch (err) {
        if (epoch !== renderEpochRef.current) return;
        setRenderError(
          err instanceof Error ? err.message : 'Unable to engrave MusicXML.'
        );
      } finally {
        if (epoch === renderEpochRef.current) {
          setIsRendering(false);
        }
      }
    };

    // First score render runs immediately; rapid edits are coalesced via debounceMs
    if (!hasRenderedInitialRef.current) {
      void executeRender();
    } else {
      renderTimerRef.current = window.setTimeout(() => {
        renderTimerRef.current = null;
        void executeRender();
      }, debounceMs);
    }
  }, [xmlString, debounceMs, bindRenderedSvgNotes]);

  const clearSelection = useCallback(() => {
    setSelectedNoteId(null);
    applySelectionVisuals(null);
  }, [applySelectionVisuals]);

  return {
    selectedNoteId,
    selectedNoteMetadata,
    isRendering,
    renderError,
    clearSelection,
  };
}
