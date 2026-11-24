import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { PracticeMode } from '../types/music';
import {
  BarPracticeStats,
  BarStatsDeltaMap,
  makePracticeStatId,
  PracticeStatRecord,
  sanitizeScoreIdForFirestore,
} from '../types/stats';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const MAX_BAR_ENTRIES = 1000;

// Serialize writes per statId so back-to-back measure completions never overwrite each other
const writeQueues = new Map<string, Promise<void>>();

function clampNonNegativeInt(value: unknown, max = 1000000): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, n));
}

function sanitizeBarStats(raw: unknown): BarPracticeStats {
  if (!raw || typeof raw !== 'object') {
    return { practices: 0, perfect: 0, good: 0, wrong: 0, miss: 0 };
  }
  const obj = raw as Record<string, unknown>;
  return {
    practices: clampNonNegativeInt(obj.practices),
    perfect: clampNonNegativeInt(obj.perfect),
    good: clampNonNegativeInt(obj.good),
    wrong: clampNonNegativeInt(obj.wrong),
    miss: clampNonNegativeInt(obj.miss),
  };
}

function sanitizeBarsMap(raw: unknown): Record<string, BarPracticeStats> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, MAX_BAR_ENTRIES);
  const result: Record<string, BarPracticeStats> = {};
  for (const [key, value] of entries) {
    if (!/^[0-9]{1,4}$/.test(key)) continue;
    result[key] = sanitizeBarStats(value);
  }
  return result;
}

function mapDocToPracticeStat(
  docId: string,
  data: Record<string, unknown>
): PracticeStatRecord | null {
  const mode = data.mode === 'tempo' ? 'tempo' : data.mode === 'wait' ? 'wait' : null;
  if (!mode) return null;

  const ownerId = typeof data.ownerId === 'string' ? data.ownerId : '';
  const scoreId = typeof data.scoreId === 'string' ? data.scoreId : '';
  if (!ownerId || !scoreId) return null;

  const bpm =
    mode === 'wait'
      ? 0
      : Math.min(240, Math.max(30, clampNonNegativeInt(data.bpm, 240) || 60));

  const updatedAt = data.updatedAt;
  const updatedAtMs =
    updatedAt instanceof Timestamp
      ? updatedAt.toMillis()
      : typeof updatedAt === 'number'
      ? updatedAt
      : Date.now();

  return {
    id: docId,
    ownerId,
    scoreId,
    mode,
    bpm,
    totalRuns: clampNonNegativeInt(data.totalRuns, 100000),
    bars: sanitizeBarsMap(data.bars),
    updatedAtMs,
  };
}

/**
 * Subscribe to all private practice statistics for the signed-in user.
 * Uses a single-field `where('ownerId', '==', uid)` filter (zero composite index required).
 */
export function subscribeToUserPracticeStats(
  uid: string,
  onChange: (records: PracticeStatRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'practiceStats';
  const q = query(collection(db, path), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: PracticeStatRecord[] = [];
      snapshot.forEach((docSnap) => {
        const mapped = mapDocToPracticeStat(
          docSnap.id,
          docSnap.data() as Record<string, unknown>
        );
        if (mapped) {
          records.push(mapped);
        }
      });
      onChange(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrappedErr) {
        if (onError && wrappedErr instanceof Error) {
          onError(wrappedErr);
        }
      }
    }
  );
}

/**
 * Incrementally persists per-bar practice stats to Firestore for a verified signed-in user.
 * Operations on the same `(uid, scoreId, mode, bpm)` bucket are serialized to avoid lost updates.
 */
export function recordBarPracticeStatsToFirestore(params: {
  uid: string;
  scoreId: string;
  mode: PracticeMode;
  bpm: number;
  barDeltas: BarStatsDeltaMap;
  incrementRun?: boolean;
}): Promise<void> {
  const { uid, scoreId, mode, bpm, barDeltas, incrementRun = false } = params;

  const deltaEntries = Object.entries(barDeltas).filter(([, d]) => {
    return d.practices > 0 || d.perfect > 0 || d.good > 0 || d.wrong > 0 || d.miss > 0;
  });

  if (!uid || !VALID_ID_REGEX.test(uid) || uid.length > 128) {
    return Promise.resolve();
  }
  if (deltaEntries.length === 0 && !incrementRun) {
    return Promise.resolve();
  }

  const safeScoreId = sanitizeScoreIdForFirestore(scoreId);
  const normalizedBpm = mode === 'wait' ? 0 : Math.min(240, Math.max(30, Math.round(bpm)));
  const statId = makePracticeStatId(uid, safeScoreId, mode, normalizedBpm);

  const prev = writeQueues.get(statId) ?? Promise.resolve();
  const next = prev
    .catch(() => {
      // Never block subsequent updates if an earlier transient write failed
    })
    .then(async () => {
      const path = `practiceStats/${statId}`;
      const ref = doc(db, 'practiceStats', statId);

      let existingData: Record<string, unknown> | null = null;
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) {
          existingData = snap.data() as Record<string, unknown>;
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }

      const mergedBars = existingData ? sanitizeBarsMap(existingData.bars) : {};
      for (const [measureKey, delta] of deltaEntries) {
        const mNum = Number(measureKey);
        if (!Number.isInteger(mNum) || mNum < 1 || mNum > 1000) continue;
        const key = String(mNum);
        const cur = mergedBars[key] ?? {
          practices: 0,
          perfect: 0,
          good: 0,
          wrong: 0,
          miss: 0,
        };
        if (!(key in mergedBars) && Object.keys(mergedBars).length >= MAX_BAR_ENTRIES) {
          continue;
        }
        mergedBars[key] = {
          practices: clampNonNegativeInt(cur.practices + delta.practices),
          perfect: clampNonNegativeInt(cur.perfect + delta.perfect),
          good: clampNonNegativeInt(cur.good + delta.good),
          wrong: clampNonNegativeInt(cur.wrong + delta.wrong),
          miss: clampNonNegativeInt(cur.miss + delta.miss),
        };
      }

      const existingRuns = existingData ? clampNonNegativeInt(existingData.totalRuns, 100000) : 0;
      const nextRuns = Math.min(100000, existingRuns + (incrementRun ? 1 : 0));

      if (existingData) {
        try {
          await updateDoc(ref, {
            totalRuns: nextRuns,
            bars: mergedBars,
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, path);
        }
      } else {
        try {
          await setDoc(ref, {
            id: statId,
            ownerId: uid,
            scoreId: safeScoreId,
            mode,
            bpm: normalizedBpm,
            totalRuns: nextRuns,
            bars: mergedBars,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    });

  writeQueues.set(statId, next);
  return next.catch((err) => {
    console.warn('[Anson Practice Piano] Failed to record practice stats:', err);
  });
}
