import { useCallback, useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { usePracticeStore } from '../store/usePracticeStore';
import {
  BarPracticeStats,
  getBarAccuracyPercent,
  sanitizeScoreIdForFirestore,
} from '../types/stats';

const OVERLAY_GROUP_CLASS = 'anson-loop-overlay';
const STATS_LABELS_GROUP_CLASS = 'anson-stats-labels-overlay';
const SVG_NS = 'http://www.w3.org/2000/svg';

interface UseOSMDInteractOptions {
  osmdRef: React.MutableRefObject<OpenSheetMusicDisplay | null>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  isReady: boolean;
}

function hasBarActivity(bar: BarPracticeStats | undefined): boolean {
  if (!bar) return false;
  return bar.practices > 0 || bar.perfect + bar.good + bar.wrong + bar.miss > 0;
}

function getBarColors(bar: BarPracticeStats | undefined, isSelected: boolean) {
  if (isSelected) {
    return {
      fill: 'rgba(2, 132, 199, 0.16)',
      stroke: '#0284C7',
      strokeWidth: '2',
    };
  }
  if (!hasBarActivity(bar)) {
    return {
      fill: 'rgba(148, 163, 184, 0.05)',
      stroke: 'rgba(148, 163, 184, 0.28)',
      strokeWidth: '1',
    };
  }
  const acc = getBarAccuracyPercent(bar!);
  if (acc === null || acc >= 90) {
    return {
      fill: 'rgba(16, 185, 129, 0.12)',
      stroke: 'rgba(5, 150, 105, 0.45)',
      strokeWidth: '1.25',
    };
  }
  if (acc >= 70) {
    return {
      fill: 'rgba(14, 165, 233, 0.11)',
      stroke: 'rgba(2, 132, 199, 0.42)',
      strokeWidth: '1.25',
    };
  }
  return {
    fill: 'rgba(245, 158, 11, 0.14)',
    stroke: 'rgba(217, 119, 6, 0.48)',
    strokeWidth: '1.25',
  };
}

/**
 * Anson Practice Piano — Interactive OSMD Measure Selection & Practice Stats Overlay Hook
 *
 * - Normal Practice Mode: computes grand-staff measure bounding boxes for click-to-set A/B loop.
 * - Practice Stats Mode: draws per-bar practice count & grade badges directly over each measure
 *   and allows clicking any bar to inspect full statistics.
 */
export function useOSMDInteract({ osmdRef, containerRef, isReady }: UseOSMDInteractOptions) {
  const activeScoreId = usePracticeStore((s) => s.activeScore.id);
  const loopRange = usePracticeStore((s) => s.loopRange);
  const loopSelectionStage = usePracticeStore((s) => s.loopSelectionStage);
  const setLoopRange = usePracticeStore((s) => s.setLoopRange);
  const setLoopSelectionStage = usePracticeStore((s) => s.setLoopSelectionStage);

  const isStatsMode = usePracticeStore((s) => s.isStatsMode);
  const statsFilterMode = usePracticeStore((s) => s.statsFilterMode);
  const statsSelectedBpm = usePracticeStore((s) => s.statsSelectedBpm);
  const statsSelectedBar = usePracticeStore((s) => s.statsSelectedBar);
  const practiceStats = usePracticeStore((s) => s.practiceStats);
  const setStatsSelectedBar = usePracticeStore((s) => s.setStatsSelectedBar);

  const clickStepRef = useRef<'pickA' | 'pickB'>('pickA');
  const pointARef = useRef<number>(loopRange.startMeasure);

  useEffect(() => {
    clickStepRef.current = loopSelectionStage;
  }, [loopSelectionStage]);

  const handleMeasureClick = useCallback(
    (measureNumber: number) => {
      const state = usePracticeStore.getState();
      if (state.isStatsMode) {
        setStatsSelectedBar(state.statsSelectedBar === measureNumber ? null : measureNumber);
        return;
      }

      if (clickStepRef.current === 'pickA') {
        pointARef.current = measureNumber;
        setLoopRange({
          enabled: true,
          startMeasure: measureNumber,
          endMeasure: measureNumber,
        });
        setLoopSelectionStage('pickB');
        console.info(`[Anson Practice Piano] A/B Loop Point A set -> Measure ${measureNumber}`);
      } else {
        const start = Math.min(pointARef.current, measureNumber);
        const end = Math.max(pointARef.current, measureNumber);
        setLoopRange({
          enabled: true,
          startMeasure: start,
          endMeasure: end,
        });
        setLoopSelectionStage('pickA');
        console.info(`[Anson Practice Piano] A/B Loop Point B set -> Measure ${start} to ${end}`);
      }
    },
    [setLoopRange, setLoopSelectionStage, setStatsSelectedBar]
  );

  /**
   * Builds/refreshes interactive measure hitboxes and visual A/B or Practice Stats overlays inside OSMD's SVG.
   */
  const syncMeasureOverlays = useCallback(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd?.GraphicSheet?.MeasureList || !container) return;

    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    // Remove previous overlay groups cleanly before re-drawing
    svgEl.querySelectorAll(`g.${OVERLAY_GROUP_CLASS}`).forEach((el) => el.remove());
    svgEl.querySelectorAll(`g.${STATS_LABELS_GROUP_CLASS}`).forEach((el) => el.remove());

    const overlayGroup = document.createElementNS(SVG_NS, 'g');
    overlayGroup.setAttribute('class', OVERLAY_GROUP_CLASS);

    const labelsGroup = document.createElementNS(SVG_NS, 'g');
    labelsGroup.setAttribute('class', STATS_LABELS_GROUP_CLASS);
    labelsGroup.style.pointerEvents = 'none';

    const measureList = osmd.GraphicSheet.MeasureList;
    const storeState = usePracticeStore.getState();
    const { enabled, startMeasure, endMeasure } = storeState.loopRange;
    const stage = storeState.loopSelectionStage;
    const inStatsMode = storeState.isStatsMode;
    const filterMode = storeState.statsFilterMode;
    const selectedBpm = storeState.statsSelectedBpm;
    const selectedBar = storeState.statsSelectedBar;

    // Resolve matching PracticeStatRecord for this sheet + mode (+ tempo)
    const safeScoreId = sanitizeScoreIdForFirestore(storeState.activeScore.id);
    const activeStatRecord = inStatsMode
      ? storeState.practiceStats.find((r) => {
          if (r.scoreId !== safeScoreId || r.mode !== filterMode) return false;
          if (filterMode === 'wait') return r.bpm === 0;
          return selectedBpm !== null && r.bpm === selectedBpm;
        })
      : undefined;

    for (let mIdx = 0; mIdx < measureList.length; mIdx++) {
      const staffMeasures = measureList[mIdx];
      if (!staffMeasures || staffMeasures.length === 0) continue;

      // Compute combined bounding box across all staves (Staff 1 Treble + Staff 2 Bass)
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const gm of staffMeasures) {
        const gEl = gm?.getSVGGElement?.();
        if (!gEl) continue;
        try {
          const box = gEl.getBBox();
          if (box.width <= 0 || box.height <= 0) continue;
          minX = Math.min(minX, box.x);
          minY = Math.min(minY, box.y);
          maxX = Math.max(maxX, box.x + box.width);
          maxY = Math.max(maxY, box.y + box.height);
        } catch {
          // Ignore detached SVG elements
        }
      }

      if (!Number.isFinite(minX) || maxX <= minX) continue;

      const measureNumber = mIdx + 1;
      const padY = inStatsMode ? 10 : 8;
      const rectX = minX;
      const rectY = Math.max(2, minY - padY);
      const rectW = maxX - minX;
      const rectH = maxY - minY + padY * 2;

      const hitRect = document.createElementNS(SVG_NS, 'rect');
      hitRect.setAttribute('x', String(rectX));
      hitRect.setAttribute('y', String(rectY));
      hitRect.setAttribute('width', String(rectW));
      hitRect.setAttribute('height', String(rectH));
      hitRect.setAttribute('rx', '4');
      hitRect.setAttribute('data-measure', String(measureNumber));
      hitRect.style.cursor = 'pointer';
      hitRect.style.transition = 'fill 140ms ease, stroke 140ms ease';

      if (inStatsMode) {
        const barStats = activeStatRecord?.bars[String(measureNumber)];
        const isBarSelected = selectedBar === measureNumber;
        const colors = getBarColors(barStats, isBarSelected);

        hitRect.setAttribute('fill', colors.fill);
        hitRect.setAttribute('stroke', colors.stroke);
        hitRect.setAttribute('stroke-width', colors.strokeWidth);

        hitRect.addEventListener('mouseenter', () => {
          if (!isBarSelected) {
            hitRect.setAttribute('stroke', '#0284C7');
            hitRect.setAttribute('stroke-width', '1.75');
          }
        });

        hitRect.addEventListener('mouseleave', () => {
          if (!isBarSelected) {
            hitRect.setAttribute('stroke', colors.stroke);
            hitRect.setAttribute('stroke-width', colors.strokeWidth);
          }
        });

        hitRect.addEventListener('click', (e) => {
          e.stopPropagation();
          handleMeasureClick(measureNumber);
        });

        overlayGroup.appendChild(hitRect);

        // Render compact, accurately measured per-bar stats badge along the top edge of the measure
        const badgeHeight = 16;
        const badgeY = Math.max(1, rectY - 5);
        const badgeX = rectX + 3;
        const maxBadgeW = Math.max(26, rectW - 6);

        type BadgeSegment = { text: string; fill: string };
        const candidates: BadgeSegment[][] = [];

        if (!hasBarActivity(barStats)) {
          candidates.push([
            { text: `M${measureNumber} · 0×`, fill: '#64748B' },
          ]);
          candidates.push([
            { text: `M${measureNumber}`, fill: '#64748B' },
          ]);
        } else if (filterMode === 'wait') {
          const stats = barStats!;
          if (stats.wrong > 0) {
            candidates.push([
              { text: `M${measureNumber} · `, fill: '#475569' },
              { text: `${stats.practices}×`, fill: '#047857' },
              { text: ` ${stats.wrong}W`, fill: '#DC2626' },
            ]);
            candidates.push([
              { text: `${stats.practices}×`, fill: '#047857' },
              { text: ` ${stats.wrong}W`, fill: '#DC2626' },
            ]);
          }
          candidates.push([
            { text: `M${measureNumber} · `, fill: '#475569' },
            { text: `${stats.practices}×`, fill: '#047857' },
          ]);
          candidates.push([
            { text: `${stats.practices}×`, fill: '#047857' },
          ]);
        } else {
          const stats = barStats!;
          const acc = getBarAccuracyPercent(stats);
          const accColor =
            acc === null || acc >= 90 ? '#047857' : acc >= 70 ? '#0369A1' : '#B45309';

          if (stats.miss > 0) {
            candidates.push([
              { text: `M${measureNumber} `, fill: '#475569' },
              { text: `${stats.practices}×`, fill: '#0F172A' },
              { text: ` ${stats.perfect}P`, fill: '#047857' },
              { text: ` ${stats.good}G`, fill: '#B45309' },
              { text: ` ${stats.wrong}W`, fill: '#DC2626' },
              { text: ` ${stats.miss}M`, fill: '#64748B' },
            ]);
          }
          candidates.push([
            { text: `M${measureNumber} `, fill: '#475569' },
            { text: `${stats.practices}×`, fill: '#0F172A' },
            { text: ` ${stats.perfect}P`, fill: '#047857' },
            { text: ` ${stats.good}G`, fill: '#B45309' },
            { text: ` ${stats.wrong}W`, fill: '#DC2626' },
          ]);
          candidates.push([
            { text: `${stats.practices}×`, fill: '#0F172A' },
            { text: ` ${stats.perfect}P`, fill: '#047857' },
            { text: ` ${stats.good}G`, fill: '#B45309' },
            { text: ` ${stats.wrong}W`, fill: '#DC2626' },
          ]);
          if (acc !== null) {
            candidates.push([
              { text: `M${measureNumber} · `, fill: '#475569' },
              { text: `${stats.practices}×`, fill: '#0F172A' },
              { text: ` ${acc}%`, fill: accColor },
            ]);
            candidates.push([
              { text: `${stats.practices}×`, fill: '#0F172A' },
              { text: ` ${acc}%`, fill: accColor },
            ]);
          }
          candidates.push([
            { text: `${stats.practices}×`, fill: '#0F172A' },
          ]);
        }

        const labelText = document.createElementNS(SVG_NS, 'text');
        labelText.setAttribute('x', String(badgeX + 5));
        labelText.setAttribute('y', String(badgeY + 11.5));
        labelText.setAttribute('font-size', '10');
        labelText.setAttribute('font-weight', '700');
        labelText.setAttribute('font-family', 'IBM Plex Mono, monospace');

        const populateText = (segments: BadgeSegment[]) => {
          labelText.textContent = '';
          for (const seg of segments) {
            const tspan = document.createElementNS(SVG_NS, 'tspan');
            tspan.setAttribute('fill', seg.fill);
            tspan.textContent = seg.text;
            labelText.appendChild(tspan);
          }
        };

        const labelBg = document.createElementNS(SVG_NS, 'rect');
        labelBg.setAttribute('x', String(badgeX));
        labelBg.setAttribute('y', String(badgeY));
        labelBg.setAttribute('height', String(badgeHeight));
        labelBg.setAttribute('rx', '3');
        labelBg.setAttribute('fill', isBarSelected ? '#F0F9FF' : 'rgba(255, 255, 255, 0.95)');
        labelBg.setAttribute(
          'stroke',
          isBarSelected
            ? '#0284C7'
            : hasBarActivity(barStats)
            ? 'rgba(15, 23, 42, 0.22)'
            : 'rgba(148, 163, 184, 0.38)'
        );
        labelBg.setAttribute('stroke-width', isBarSelected ? '1.25' : '0.85');

        // Append temporarily inside labelsGroup (which we attach to svgEl after loop, OR measure directly in svgEl)
        labelsGroup.appendChild(labelBg);
        labelsGroup.appendChild(labelText);

        // Pick the richest candidate that fits cleanly within maxBadgeW (fallback to estimated width before attach)
        const chosen = candidates.find((segs) => {
          const charLen = segs.reduce((acc, s) => acc + s.text.length, 0);
          return charLen * 6.2 + 10 <= maxBadgeW;
        }) ?? candidates[candidates.length - 1];
        populateText(chosen);

        const estWidth = chosen.reduce((acc, s) => acc + s.text.length, 0) * 6.2 + 10;
        labelBg.setAttribute('width', String(Math.min(maxBadgeW, Math.max(24, estWidth))));
        labelBg.setAttribute('data-max-w', String(maxBadgeW));
      } else {
        const isSelected = enabled && measureNumber >= startMeasure && measureNumber <= endMeasure;
        const isPointA = enabled && measureNumber === startMeasure;
        const isPointB = enabled && measureNumber === endMeasure;

        if (isSelected) {
          hitRect.setAttribute('fill', 'rgba(245, 158, 11, 0.14)');
          hitRect.setAttribute('stroke', isPointA || isPointB ? '#D97706' : 'rgba(217, 119, 6, 0.35)');
          hitRect.setAttribute('stroke-width', isPointA || isPointB ? '1.75' : '1');
        } else {
          hitRect.setAttribute('fill', 'rgba(2, 132, 199, 0)');
          hitRect.setAttribute('stroke', 'transparent');
        }

        hitRect.addEventListener('mouseenter', () => {
          if (!isSelected) {
            hitRect.setAttribute('fill', 'rgba(2, 132, 199, 0.08)');
            hitRect.setAttribute('stroke', 'rgba(2, 132, 199, 0.35)');
          }
        });

        hitRect.addEventListener('mouseleave', () => {
          if (!isSelected) {
            hitRect.setAttribute('fill', 'rgba(2, 132, 199, 0)');
            hitRect.setAttribute('stroke', 'transparent');
          }
        });

        hitRect.addEventListener('click', (e) => {
          e.stopPropagation();
          handleMeasureClick(measureNumber);
        });

        overlayGroup.appendChild(hitRect);

        // Draw crisp A / B badges inside the measure top corners when selected
        if (isPointA) {
          const badge = document.createElementNS(SVG_NS, 'text');
          badge.setAttribute('x', String(rectX + 6));
          badge.setAttribute('y', String(rectY + 13));
          badge.setAttribute('fill', '#B45309');
          badge.setAttribute('font-size', '11');
          badge.setAttribute('font-weight', '700');
          badge.setAttribute('font-family', 'IBM Plex Mono, monospace');
          badge.style.pointerEvents = 'none';
          badge.textContent = stage === 'pickB' && isPointB ? 'A (click B)' : 'A';
          overlayGroup.appendChild(badge);
        }

        if (isPointB && !isPointA) {
          const badgeB = document.createElementNS(SVG_NS, 'text');
          badgeB.setAttribute('x', String(rectX + rectW - 14));
          badgeB.setAttribute('y', String(rectY + 13));
          badgeB.setAttribute('fill', '#B45309');
          badgeB.setAttribute('font-size', '11');
          badgeB.setAttribute('font-weight', '700');
          badgeB.setAttribute('font-family', 'IBM Plex Mono, monospace');
          badgeB.style.pointerEvents = 'none';
          badgeB.textContent = 'B';
          overlayGroup.appendChild(badgeB);
        }
      }
    }

    // Insert measure fill/hitboxes behind noteheads so cursor and note colors stay crisp on top
    if (svgEl.firstChild) {
      svgEl.insertBefore(overlayGroup, svgEl.firstChild);
    } else {
      svgEl.appendChild(overlayGroup);
    }

    // Append Stats Mode labels on top so per-bar statistics are crisply legible, then fine-tune pill widths using real getBBox()
    if (inStatsMode && labelsGroup.childNodes.length > 0) {
      svgEl.appendChild(labelsGroup);
      const children = Array.from(labelsGroup.children);
      for (let i = 0; i < children.length - 1; i += 2) {
        const bgRect = children[i] as SVGRectElement;
        const txtEl = children[i + 1] as SVGTextElement;
        try {
          const textBox = txtEl.getBBox();
          const maxW = Number(bgRect.getAttribute('data-max-w')) || 200;
          if (textBox.width > 0) {
            const fittedW = Math.min(maxW, Math.max(24, Math.ceil(textBox.width + 10)));
            bgRect.setAttribute('width', String(fittedW));
          }
        } catch {
          // Ignore if element is hidden
        }
      }
    }
  }, [containerRef, handleMeasureClick, osmdRef]);

  // Refresh overlays whenever sheet finishes rendering, loop range changes, or Stats Mode filters update
  useEffect(() => {
    if (!isReady) return;
    syncMeasureOverlays();
  }, [
    isReady,
    activeScoreId,
    loopRange.enabled,
    loopRange.startMeasure,
    loopRange.endMeasure,
    loopSelectionStage,
    isStatsMode,
    statsFilterMode,
    statsSelectedBpm,
    statsSelectedBar,
    practiceStats,
    syncMeasureOverlays,
  ]);

  // Also refresh overlay coordinates on window resize, container resize, or when OSMD replaces its SVG
  useEffect(() => {
    if (!isReady) return;
    let timer: number | null = null;
    const scheduleSync = (delay = 280) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => syncMeasureOverlays(), delay);
    };

    const handleResize = () => scheduleSync(320);
    window.addEventListener('resize', handleResize);

    const el = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    if (el) {
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => scheduleSync(320));
        resizeObserver.observe(el);
      }
      if (typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => {
          const svg = el.querySelector('svg');
          if (svg && !svg.querySelector(`g.${OVERLAY_GROUP_CLASS}`)) {
            scheduleSync(60);
          }
        });
        mutationObserver.observe(el, { childList: true, subtree: true });
      }
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [containerRef, isReady, syncMeasureOverlays]);

  return { syncMeasureOverlays };
}
