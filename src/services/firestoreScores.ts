import {
  collection,
  deleteDoc,
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
import { ScorePiece } from '../types/music';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const VALID_TIME_SIG_REGEX = /^[0-9]{1,2}\/[0-9]{1,2}$/;
const ALLOWED_LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced', 'Custom']);

export const MAX_MUSICXML_LENGTH = 800000;
export const MIN_MUSICXML_LENGTH = 20;

export function makeValidScoreId(prefix = 'sheet'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'sheet';
  const rand = Math.random().toString(36).slice(2, 10);
  const candidate = `${cleanPrefix}-${Date.now()}-${rand}`;
  return candidate.slice(0, 128);
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const num = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeText(value: string | undefined, fallback: string, maxLen: number): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function normalizeTimeSignature(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length >= 3 && trimmed.length <= 10 && VALID_TIME_SIG_REGEX.test(trimmed)) {
    return trimmed;
  }
  return '4/4';
}

function normalizeLevel(value: string | undefined): string {
  if (value && ALLOWED_LEVELS.has(value)) {
    return value;
  }
  return 'Custom';
}

interface SanitizedScorePayload {
  id: string;
  ownerId: string;
  title: string;
  composer: string;
  level: string;
  timeSignature: string;
  measures: number;
  bpm: number;
  musicXml: string;
}

function buildSanitizedPayload(uid: string, piece: ScorePiece): SanitizedScorePayload {
  const id =
    piece.id && piece.id.length <= 128 && VALID_ID_REGEX.test(piece.id)
      ? piece.id
      : makeValidScoreId('sheet');

  if (!VALID_ID_REGEX.test(uid) || uid.length > 128) {
    throw new Error('Invalid authenticated user identifier.');
  }

  const musicXml = (piece.musicXml ?? '').trim();
  if (musicXml.length < MIN_MUSICXML_LENGTH) {
    throw new Error('MusicXML document is too short or empty.');
  }
  if (musicXml.length > MAX_MUSICXML_LENGTH) {
    throw new Error(
      'MusicXML file exceeds the 800 KB cloud storage limit. Please try a shorter score or export a simplified XML.'
    );
  }

  return {
    id,
    ownerId: uid,
    title: normalizeText(piece.title, 'Untitled Score', 120),
    composer: normalizeText(piece.composer, 'Uploaded Score', 120),
    level: normalizeLevel(piece.level),
    timeSignature: normalizeTimeSignature(piece.timeSignature),
    measures: clampInt(piece.measures, 1, 1000, 1),
    bpm: clampInt(piece.bpm, 30, 240, 80),
    musicXml,
  };
}

function docDataToScorePiece(docId: string, data: Record<string, unknown>): ScorePiece {
  const updatedAt = data.updatedAt as Timestamp | undefined;
  const createdAt = data.createdAt as Timestamp | undefined;
  const updatedAtMs =
    updatedAt && typeof updatedAt.toMillis === 'function'
      ? updatedAt.toMillis()
      : createdAt && typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : Date.now();

  return {
    id: typeof data.id === 'string' ? data.id : docId,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
    title: typeof data.title === 'string' ? data.title : 'Untitled Score',
    composer: typeof data.composer === 'string' ? data.composer : 'Uploaded Score',
    level: typeof data.level === 'string' ? data.level : 'Custom',
    timeSignature: typeof data.timeSignature === 'string' ? data.timeSignature : '4/4',
    measures: typeof data.measures === 'number' ? data.measures : 1,
    bpm: typeof data.bpm === 'number' ? data.bpm : 80,
    musicXml: typeof data.musicXml === 'string' ? data.musicXml : '',
    isCloudSaved: true,
    updatedAtMs,
  };
}

/**
 * Subscribe to the signed-in user's private scores in real time.
 * Queries strictly by ownerId == uid (matching firestore.rules `allow list`) and sorts newest first client-side.
 */
export function subscribeToUserScores(
  uid: string,
  onScores: (scores: ScorePiece[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const scoresQuery = query(collection(db, 'scores'), where('ownerId', '==', uid));

  return onSnapshot(
    scoresQuery,
    (snapshot) => {
      const items: ScorePiece[] = snapshot.docs.map((d) =>
        docDataToScorePiece(d.id, d.data() as Record<string, unknown>)
      );
      items.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
      onScores(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'scores');
      } catch (wrappedErr) {
        if (onError && wrappedErr instanceof Error) {
          onError(wrappedErr);
        }
      }
    }
  );
}

/**
 * Fetch a single private score by document ID (used when opening /editor/:songId directly).
 */
export async function getUserScoreById(scoreId: string): Promise<ScorePiece | null> {
  if (!scoreId || !VALID_ID_REGEX.test(scoreId)) return null;
  const path = `scores/${scoreId}`;
  try {
    const snap = await getDoc(doc(db, 'scores', scoreId));
    if (!snap.exists()) return null;
    return docDataToScorePiece(snap.id, snap.data() as Record<string, unknown>);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

/**
 * Save a newly uploaded or customized score to Firestore under the authenticated owner.
 */
export async function saveUserScoreToFirestore(
  uid: string,
  piece: ScorePiece
): Promise<ScorePiece> {
  const sanitized = buildSanitizedPayload(uid, piece);
  const path = `scores/${sanitized.id}`;

  try {
    await setDoc(doc(db, 'scores', sanitized.id), {
      ...sanitized,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      ...sanitized,
      isCloudSaved: true,
      updatedAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

/**
 * Update an existing user-owned score in Firestore using only allowed mutable keys.
 */
export async function updateUserScoreInFirestore(
  uid: string,
  scoreId: string,
  piece: ScorePiece
): Promise<ScorePiece> {
  const sanitized = buildSanitizedPayload(uid, { ...piece, id: scoreId });
  const path = `scores/${scoreId}`;

  try {
    await updateDoc(doc(db, 'scores', scoreId), {
      title: sanitized.title,
      composer: sanitized.composer,
      level: sanitized.level,
      timeSignature: sanitized.timeSignature,
      measures: sanitized.measures,
      bpm: sanitized.bpm,
      musicXml: sanitized.musicXml,
      updatedAt: serverTimestamp(),
    });
    return {
      ...sanitized,
      isCloudSaved: true,
      updatedAtMs: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Delete a user-owned score from Firestore.
 */
export async function deleteUserScoreFromFirestore(scoreId: string): Promise<void> {
  if (!scoreId || !VALID_ID_REGEX.test(scoreId)) return;
  const path = `scores/${scoreId}`;
  try {
    await deleteDoc(doc(db, 'scores', scoreId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
