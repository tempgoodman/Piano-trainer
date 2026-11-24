import { PracticeMode } from './music';

export interface BarPracticeStats {
  practices: number;
  perfect: number;
  good: number;
  wrong: number;
  miss: number;
}

export interface PracticeStatRecord {
  id: string;
  ownerId: string;
  scoreId: string;
  mode: PracticeMode;
  bpm: number; // 0 for wait mode; 30..240 for tempo mode
  totalRuns: number;
  bars: Record<string, BarPracticeStats>;
  updatedAtMs: number;
}

export type BarStatsDeltaMap = Record<number, BarPracticeStats>;

export const EMPTY_BAR_STATS: BarPracticeStats = {
  practices: 0,
  perfect: 0,
  good: 0,
  wrong: 0,
  miss: 0,
};

function sanitizeIdPart(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'item';
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates a deterministic Firestore document ID matching `^[a-zA-Z0-9_\-]+$` (<= 128 chars).
 */
export function makePracticeStatId(
  uid: string,
  scoreId: string,
  mode: PracticeMode,
  bpm: number
): string {
  const safeUid = sanitizeIdPart(uid);
  const safeScore = sanitizeIdPart(scoreId);
  const normalizedBpm = mode === 'wait' ? 0 : Math.min(240, Math.max(30, Math.round(bpm)));
  const suffix = `_${mode}_${normalizedBpm}`;
  const full = `${safeUid}_${safeScore}${suffix}`;
  if (full.length <= 128) {
    return full;
  }

  const hash = fnv1aHex(`${safeUid}:${safeScore}`);
  const maxUidLen = Math.min(safeUid.length, 40);
  const maxScoreLen = Math.max(8, 128 - maxUidLen - suffix.length - hash.length - 2);
  return `${safeUid.slice(0, maxUidLen)}_${safeScore.slice(0, maxScoreLen)}_${hash}${suffix}`;
}

export function sanitizeScoreIdForFirestore(scoreId: string): string {
  const cleaned = sanitizeIdPart(scoreId);
  if (cleaned.length <= 128) return cleaned;
  const hash = fnv1aHex(cleaned);
  return `${cleaned.slice(0, 119)}_${hash}`;
}

export function getBarAccuracyPercent(bar: BarPracticeStats): number | null {
  const hits = bar.perfect + bar.good;
  const total = hits + bar.wrong + bar.miss;
  if (total <= 0) return null;
  return Math.round((hits / total) * 100);
}
