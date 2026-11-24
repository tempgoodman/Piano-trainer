import {
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  DEFAULT_USER_HOTKEYS,
  normalizeMidiChord,
  UserHotkeysConfig,
} from '../types/hotkeys';

const VALID_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const VALID_KEY_REGEX = /^[a-zA-Z0-9_\-]+$/;

function sanitizeKeyboardKey(key: unknown, fallback: string): string {
  if (typeof key !== 'string') return fallback;
  const trimmed = key.trim();
  if (trimmed.length >= 1 && trimmed.length <= 20 && VALID_KEY_REGEX.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function sanitizeUserHotkeysConfig(
  input: Partial<UserHotkeysConfig> | Record<string, unknown>
): UserHotkeysConfig {
  const rawRestart = Array.isArray(input.restartMidiNotes)
    ? normalizeMidiChord(input.restartMidiNotes.map(Number))
    : [];
  const rawStop = Array.isArray(input.stopMidiNotes)
    ? normalizeMidiChord(input.stopMidiNotes.map(Number))
    : [];

  return {
    restartMidiNotes:
      rawRestart.length >= 1 ? rawRestart : [...DEFAULT_USER_HOTKEYS.restartMidiNotes],
    stopMidiNotes: rawStop.length >= 1 ? rawStop : [...DEFAULT_USER_HOTKEYS.stopMidiNotes],
    restartKey: sanitizeKeyboardKey(input.restartKey, DEFAULT_USER_HOTKEYS.restartKey),
    stopKey: sanitizeKeyboardKey(input.stopKey, DEFAULT_USER_HOTKEYS.stopKey),
  };
}

/**
 * Subscribe to the signed-in user's custom hotkey preferences in real time.
 * Emits `null` when no custom hotkeys document exists (so defaults are used).
 */
export function subscribeToUserHotkeys(
  uid: string,
  onChange: (config: UserHotkeysConfig | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `userSettings/${uid}`;
  const ref = doc(db, 'userSettings', uid);

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        onChange(null);
        return;
      }
      const data = snapshot.data() as Record<string, unknown>;
      onChange(sanitizeUserHotkeysConfig(data));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrappedErr) {
        if (onError && wrappedErr instanceof Error) {
          onError(wrappedErr);
        }
      }
    }
  );
}

/**
 * Save or update the signed-in user's custom hotkey bindings in Firestore.
 */
export async function saveUserHotkeysToFirestore(
  uid: string,
  config: UserHotkeysConfig
): Promise<UserHotkeysConfig> {
  if (!uid || !VALID_ID_REGEX.test(uid) || uid.length > 128) {
    throw new Error('Invalid authenticated user identifier.');
  }

  const sanitized = sanitizeUserHotkeysConfig(config);
  const path = `userSettings/${uid}`;
  const ref = doc(db, 'userSettings', uid);

  let exists = false;
  try {
    const existingSnap = await getDoc(ref);
    exists = existingSnap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (exists) {
    try {
      await updateDoc(ref, {
        restartMidiNotes: sanitized.restartMidiNotes,
        stopMidiNotes: sanitized.stopMidiNotes,
        restartKey: sanitized.restartKey,
        stopKey: sanitized.stopKey,
        updatedAt: serverTimestamp(),
      });
      return sanitized;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        ownerId: uid,
        restartMidiNotes: sanitized.restartMidiNotes,
        stopMidiNotes: sanitized.stopMidiNotes,
        restartKey: sanitized.restartKey,
        stopKey: sanitized.stopKey,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return sanitized;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

/**
 * Restore defaults by deleting the user's custom hotkeys document if it exists.
 */
export async function restoreDefaultHotkeysInFirestore(uid: string): Promise<void> {
  if (!uid || !VALID_ID_REGEX.test(uid) || uid.length > 128) return;
  const path = `userSettings/${uid}`;
  const ref = doc(db, 'userSettings', uid);

  let exists = false;
  try {
    const snap = await getDoc(ref);
    exists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!exists) return;

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
