import { useCallback, useEffect, useRef } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { usePracticeStore } from '../store/usePracticeStore';

const OVERLAY_GROUP_CLASS = 'anson-loop-overlay';

interface UseOSMDInteractOptions {
  osmdRef: React.MutableRefObject<OpenSheetMusicDisplay | null>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  isReady: boolean;
}

/**
 * Anson Practice Piano — Interactive OSMD Measure Selection Hook (Deliverable 1)
 *
 * Inspects rendered OSMD GraphicSheet.MeasureList SVG groups (`getSVGGElement()`),
 * computes unified grand-staff measure bounding boxes, renders interactive SVG overlay
 * rectangles for click-to-set Point A / Point B A/B looping, and highlights selected measures.
 */
export function useOSMDInteract({ osmdRef, containerRef, isReady }: UseOSMDInteractOptions) {
  const loopRange = usePracticeStore((s) => s.loopRange);
  const loopSelectionStage = usePracticeStore((s) => s.loopSelectionStage);
  const setLoopRange = usePracticeStore((s) => s.setLoopRange);
  const setLoopSelectionStage = usePracticeStore((s) => s.setLoopSelectionStage);

  const clickStepRef = useRef<'pickA' | 'pickB'>('pickA');
  const pointARef = useRef<number>(loopRange.startMeasure);

  useEffect(() => {
    clickStepRef.current = loopSelectionStage;
  }, [loopSelectionStage]);

  const handleMeasureClick = useCallback(
    (measureNumber: number) => {
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
    [setLoopRange, setLoopSelectionStage]
  );

  /**
   * Builds/refreshes interactive measure hitboxes and visual A/B highlight bands inside OSMD's SVG.
   */
  const syncMeasureOverlays = useCallback(() => {
    const osmd = osmdRef.current;
    const container = containerRef.current;
    if (!osmd?.GraphicSheet?.MeasureList || !container) return;

    const svgEl = container.querySelector('svg');
    if (!svgEl) return;

    // Remove previous overlay group cleanly before re-drawing
    svgEl.querySelectorAll(`g.${OVERLAY_GROUP_CLASS}`).forEach((el) => el.remove());

    const overlayGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    overlayGroup.setAttribute('class', OVERLAY_GROUP_CLASS);

    const measureList = osmd.GraphicSheet.MeasureList;
    const { enabled, startMeasure, endMeasure } = usePracticeStore.getState().loopRange;
    const stage = usePracticeStore.getState().loopSelectionStage;

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
      const padY = 8;
      const rectX = minX;
      const rectY = Math.max(0, minY - padY);
      const rectW = maxX - minX;
      const rectH = maxY - minY + padY * 2;

      const isSelected = enabled && measureNumber >= startMeasure && measureNumber <= endMeasure;
      const isPointA = enabled && measureNumber === startMeasure;
      const isPointB = enabled && measureNumber === endMeasure;

      const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      hitRect.setAttribute('x', String(rectX));
      hitRect.setAttribute('y', String(rectY));
      hitRect.setAttribute('width', String(rectW));
      hitRect.setAttribute('height', String(rectH));
      hitRect.setAttribute('rx', '4');
      hitRect.setAttribute('data-measure', String(measureNumber));
      hitRect.style.cursor = 'pointer';
      hitRect.style.transition = 'fill 140ms ease, stroke 140ms ease';

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
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
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
        const badgeB = document.createElementNS('http://www.w3.org/2000/svg', 'text');
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

    // Insert overlay behind noteheads so cursor and note colors stay crisp on top
    if (svgEl.firstChild) {
      svgEl.insertBefore(overlayGroup, svgEl.firstChild);
    } else {
      svgEl.appendChild(overlayGroup);
    }
  }, [containerRef, handleMeasureClick, osmdRef]);

  // Refresh overlays whenever sheet finishes rendering or loop range changes
  useEffect(() => {
    if (!isReady) return;
    syncMeasureOverlays();
  }, [isReady, loopRange.enabled, loopRange.startMeasure, loopRange.endMeasure, loopSelectionStage, syncMeasureOverlays]);

  // Also refresh overlay coordinates on window resize (OSMD autoResize)
  useEffect(() => {
    if (!isReady) return;
    let timer: number | null = null;
    const onResize = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => syncMeasureOverlays(), 180);
    };
    window.addEventListener('resize', onResize);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [isReady, syncMeasureOverlays]);

  return { syncMeasureOverlays };
}
