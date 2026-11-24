import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Security Rules Specification & Verification Suite for `firestore.rules`
 * Mirrors the exact predicates of `firestore.rules` and `firebase-blueprint.json`
 * for both `/scores/{scoreId}` and `/userSettings/{userId}`.
 */

interface AuthContext {
  uid: string;
  emailVerified: boolean;
}

interface DocPayload {
  [key: string]: unknown;
}

const REQUEST_TIME = 1_700_000_000_000;
const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const TIME_SIG_REGEX = /^[0-9]{1,2}\/[0-9]{1,2}$/;
const ALLOWED_LEVELS = new Set(['Beginner', 'Intermediate', 'Advanced', 'Custom']);

const SCORE_REQUIRED_KEYS = [
  'id',
  'ownerId',
  'title',
  'composer',
  'level',
  'timeSignature',
  'measures',
  'bpm',
  'musicXml',
  'createdAt',
  'updatedAt',
];
const SCORE_MUTABLE_KEYS = new Set([
  'title',
  'composer',
  'level',
  'timeSignature',
  'measures',
  'bpm',
  'musicXml',
  'updatedAt',
]);

const HOTKEY_REQUIRED_KEYS = [
  'ownerId',
  'restartMidiNotes',
  'stopMidiNotes',
  'restartKey',
  'stopKey',
  'createdAt',
  'updatedAt',
];
const HOTKEY_MUTABLE_KEYS = new Set([
  'restartMidiNotes',
  'stopMidiNotes',
  'restartKey',
  'stopKey',
  'updatedAt',
]);

const PRACTICE_STAT_REQUIRED_KEYS = [
  'id',
  'ownerId',
  'scoreId',
  'mode',
  'bpm',
  'totalRuns',
  'bars',
  'createdAt',
  'updatedAt',
];
const PRACTICE_STAT_MUTABLE_KEYS = new Set(['totalRuns', 'bars', 'updatedAt']);

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_REGEX.test(id);
}

function isValidMidiNote(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 21 && (n as number) <= 108;
}

function isValidMidiChord(notes: unknown): notes is number[] {
  return (
    Array.isArray(notes) &&
    notes.length >= 1 &&
    notes.length <= 4 &&
    notes.every((n) => isValidMidiNote(n))
  );
}

function isValidKeyboardKey(k: unknown): k is string {
  return typeof k === 'string' && k.length >= 1 && k.length <= 20 && ID_REGEX.test(k);
}

function isValidUserScore(data: DocPayload, scoreId: string, auth: AuthContext): boolean {
  const keys = Object.keys(data);
  if (!SCORE_REQUIRED_KEYS.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => SCORE_REQUIRED_KEYS.includes(k))) return false;

  return (
    isValidId(data.id) &&
    data.id === scoreId &&
    isValidId(data.ownerId) &&
    data.ownerId === auth.uid &&
    typeof data.title === 'string' &&
    data.title.length >= 1 &&
    data.title.length <= 120 &&
    typeof data.composer === 'string' &&
    data.composer.length >= 1 &&
    data.composer.length <= 120 &&
    typeof data.level === 'string' &&
    data.level.length >= 1 &&
    data.level.length <= 20 &&
    ALLOWED_LEVELS.has(data.level) &&
    typeof data.timeSignature === 'string' &&
    data.timeSignature.length >= 3 &&
    data.timeSignature.length <= 10 &&
    TIME_SIG_REGEX.test(data.timeSignature) &&
    Number.isInteger(data.measures) &&
    (data.measures as number) >= 1 &&
    (data.measures as number) <= 1000 &&
    Number.isInteger(data.bpm) &&
    (data.bpm as number) >= 30 &&
    (data.bpm as number) <= 240 &&
    typeof data.musicXml === 'string' &&
    data.musicXml.length >= 20 &&
    data.musicXml.length <= 800000 &&
    typeof data.createdAt === 'number' &&
    typeof data.updatedAt === 'number'
  );
}

function isValidUserHotkeys(data: DocPayload, userId: string, auth: AuthContext): boolean {
  const keys = Object.keys(data);
  if (!HOTKEY_REQUIRED_KEYS.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => HOTKEY_REQUIRED_KEYS.includes(k))) return false;

  return (
    isValidId(data.ownerId) &&
    data.ownerId === userId &&
    data.ownerId === auth.uid &&
    isValidMidiChord(data.restartMidiNotes) &&
    isValidMidiChord(data.stopMidiNotes) &&
    isValidKeyboardKey(data.restartKey) &&
    isValidKeyboardKey(data.stopKey) &&
    typeof data.createdAt === 'number' &&
    typeof data.updatedAt === 'number'
  );
}

function evaluateScoreRule(
  op: 'get' | 'list' | 'create' | 'update' | 'delete',
  auth: AuthContext | null,
  scoreId: string,
  existing?: DocPayload,
  incoming?: DocPayload
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth) return 'PERMISSION_DENIED';
  const isVerified = auth.emailVerified === true;

  if (op === 'get') {
    return isValidId(scoreId) && existing?.ownerId === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
  }
  if (op === 'list') {
    return existing?.ownerId === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
  }
  if (op === 'create') {
    if (!isVerified || !isValidId(scoreId) || !incoming) return 'PERMISSION_DENIED';
    return isValidUserScore(incoming, scoreId, auth) &&
      incoming.createdAt === REQUEST_TIME &&
      incoming.updatedAt === REQUEST_TIME
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'update') {
    if (!isVerified || !isValidId(scoreId) || !existing || !incoming) return 'PERMISSION_DENIED';
    const affectedKeys = Object.keys(incoming).filter((k) => incoming[k] !== existing[k]);
    return isValidUserScore(incoming, scoreId, auth) &&
      existing.ownerId === auth.uid &&
      incoming.ownerId === existing.ownerId &&
      incoming.id === existing.id &&
      incoming.createdAt === existing.createdAt &&
      incoming.updatedAt === REQUEST_TIME &&
      affectedKeys.every((k) => SCORE_MUTABLE_KEYS.has(k))
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'delete') {
    return isVerified && isValidId(scoreId) && existing?.ownerId === auth.uid
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  return 'PERMISSION_DENIED';
}

function evaluateHotkeyRule(
  op: 'get' | 'list' | 'create' | 'update' | 'delete',
  auth: AuthContext | null,
  userId: string,
  existing?: DocPayload,
  incoming?: DocPayload
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth) return 'PERMISSION_DENIED';
  const isVerified = auth.emailVerified === true;

  if (op === 'list') return 'PERMISSION_DENIED';
  if (op === 'get') {
    return isValidId(userId) && userId === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
  }
  if (op === 'create') {
    if (!isVerified || !isValidId(userId) || userId !== auth.uid || !incoming) {
      return 'PERMISSION_DENIED';
    }
    return isValidUserHotkeys(incoming, userId, auth) &&
      incoming.createdAt === REQUEST_TIME &&
      incoming.updatedAt === REQUEST_TIME
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'update') {
    if (!isVerified || !isValidId(userId) || userId !== auth.uid || !existing || !incoming) {
      return 'PERMISSION_DENIED';
    }
    const affectedKeys = Object.keys(incoming).filter((k) => incoming[k] !== existing[k]);
    return isValidUserHotkeys(incoming, userId, auth) &&
      existing.ownerId === auth.uid &&
      incoming.ownerId === existing.ownerId &&
      incoming.createdAt === existing.createdAt &&
      incoming.updatedAt === REQUEST_TIME &&
      affectedKeys.every((k) => HOTKEY_MUTABLE_KEYS.has(k))
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'delete') {
    return isVerified && isValidId(userId) && userId === auth.uid && existing?.ownerId === auth.uid
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  return 'PERMISSION_DENIED';
}

function isValidPracticeStat(data: DocPayload, statId: string, auth: AuthContext): boolean {
  const keys = Object.keys(data);
  if (!PRACTICE_STAT_REQUIRED_KEYS.every((k) => keys.includes(k))) return false;
  if (!keys.every((k) => PRACTICE_STAT_REQUIRED_KEYS.includes(k))) return false;

  const isValidMode = data.mode === 'wait' || data.mode === 'tempo';
  const bpmValid =
    Number.isInteger(data.bpm) &&
    ((data.mode === 'wait' && data.bpm === 0) ||
      (data.mode === 'tempo' && (data.bpm as number) >= 30 && (data.bpm as number) <= 240));
  const barsObj = data.bars;
  const barsValid =
    barsObj !== null &&
    typeof barsObj === 'object' &&
    !Array.isArray(barsObj) &&
    Object.keys(barsObj as Record<string, unknown>).length <= 1000;

  return (
    isValidId(data.id) &&
    data.id === statId &&
    isValidId(data.ownerId) &&
    data.ownerId === auth.uid &&
    isValidId(data.scoreId) &&
    isValidMode &&
    bpmValid &&
    Number.isInteger(data.totalRuns) &&
    (data.totalRuns as number) >= 0 &&
    (data.totalRuns as number) <= 100000 &&
    barsValid &&
    typeof data.createdAt === 'number' &&
    typeof data.updatedAt === 'number'
  );
}

function evaluatePracticeStatRule(
  op: 'get' | 'list' | 'create' | 'update' | 'delete',
  auth: AuthContext | null,
  statId: string,
  existing?: DocPayload,
  incoming?: DocPayload
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!auth) return 'PERMISSION_DENIED';
  const isVerified = auth.emailVerified === true;

  const isOwnedStatDocId =
    statId.length > auth.uid.length + 1 && statId.startsWith(`${auth.uid}_`);

  if (op === 'get') {
    if (!isValidId(statId)) return 'PERMISSION_DENIED';
    if (!existing) {
      return isOwnedStatDocId ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    return existing.ownerId === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
  }
  if (op === 'list') {
    return existing?.ownerId === auth.uid ? 'ALLOW' : 'PERMISSION_DENIED';
  }
  if (op === 'create') {
    if (!isVerified || !isValidId(statId) || !isOwnedStatDocId || !incoming) {
      return 'PERMISSION_DENIED';
    }
    return isValidPracticeStat(incoming, statId, auth) &&
      incoming.createdAt === REQUEST_TIME &&
      incoming.updatedAt === REQUEST_TIME
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'update') {
    if (!isVerified || !isValidId(statId) || !existing || !incoming) return 'PERMISSION_DENIED';
    const affectedKeys = Object.keys(incoming).filter((k) => incoming[k] !== existing[k]);
    return isValidPracticeStat(incoming, statId, auth) &&
      existing.ownerId === auth.uid &&
      incoming.ownerId === existing.ownerId &&
      incoming.id === existing.id &&
      incoming.scoreId === existing.scoreId &&
      incoming.mode === existing.mode &&
      incoming.bpm === existing.bpm &&
      incoming.createdAt === existing.createdAt &&
      incoming.updatedAt === REQUEST_TIME &&
      affectedKeys.every((k) => PRACTICE_STAT_MUTABLE_KEYS.has(k))
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  if (op === 'delete') {
    return isVerified && isValidId(statId) && existing?.ownerId === auth.uid
      ? 'ALLOW'
      : 'PERMISSION_DENIED';
  }
  return 'PERMISSION_DENIED';
}

const VALID_XML =
  '<?xml version="1.0"?><score-partwise version="3.1"><part id="P1"></part></score-partwise>';

const aliceAuth: AuthContext = { uid: 'alice_uid', emailVerified: true };
const bobAuth: AuthContext = { uid: 'bob_uid', emailVerified: true };
const unverifiedBob: AuthContext = { uid: 'bob_uid', emailVerified: false };

const validAliceScore: DocPayload = {
  id: 'alice-score-1',
  ownerId: 'alice_uid',
  title: 'Minuet in G',
  composer: 'J.S. Bach',
  level: 'Custom',
  timeSignature: '3/4',
  measures: 16,
  bpm: 92,
  musicXml: VALID_XML,
  createdAt: REQUEST_TIME,
  updatedAt: REQUEST_TIME,
};

const validAliceHotkeys: DocPayload = {
  ownerId: 'alice_uid',
  restartMidiNotes: [48, 50, 52],
  stopMidiNotes: [79, 81, 83],
  restartKey: 'r',
  stopKey: 'Escape',
  createdAt: REQUEST_TIME,
  updatedAt: REQUEST_TIME,
};

const validAliceStat: DocPayload = {
  id: 'alice_uid_ode-to-joy_tempo_80',
  ownerId: 'alice_uid',
  scoreId: 'ode-to-joy',
  mode: 'tempo',
  bpm: 80,
  totalRuns: 2,
  bars: {
    '1': { practices: 2, perfect: 7, good: 1, wrong: 0, miss: 0 },
    '2': { practices: 2, perfect: 6, good: 1, wrong: 1, miss: 0 },
  },
  createdAt: REQUEST_TIME,
  updatedAt: REQUEST_TIME,
};

function runSuite() {
  const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(rulesText.includes("rules_version = '2';"), 'Rules must use rules_version 2');
  assert.ok(rulesText.includes('allow read, write: if false;'), 'Global default deny required');
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'), 'Verified email gate required');
  assert.ok(rulesText.includes('resource.data.ownerId == request.auth.uid'), 'List query gate required');
  assert.ok(rulesText.includes('match /userSettings/{userId}'), 'userSettings collection must be secured');
  assert.ok(rulesText.includes('match /practiceStats/{statId}'), 'practiceStats collection must be secured');

  // Positive control checks: /scores
  assert.equal(evaluateScoreRule('create', aliceAuth, 'alice-score-1', undefined, validAliceScore), 'ALLOW');
  assert.equal(evaluateScoreRule('get', aliceAuth, 'alice-score-1', validAliceScore), 'ALLOW');
  assert.equal(evaluateScoreRule('list', aliceAuth, '', validAliceScore), 'ALLOW');
  assert.equal(
    evaluateScoreRule('update', aliceAuth, 'alice-score-1', validAliceScore, {
      ...validAliceScore,
      title: 'Minuet in G (Edited)',
      updatedAt: REQUEST_TIME,
    }),
    'ALLOW'
  );
  assert.equal(evaluateScoreRule('delete', aliceAuth, 'alice-score-1', validAliceScore), 'ALLOW');

  // Positive control checks: /userSettings
  assert.equal(evaluateHotkeyRule('create', aliceAuth, 'alice_uid', undefined, validAliceHotkeys), 'ALLOW');
  assert.equal(evaluateHotkeyRule('get', aliceAuth, 'alice_uid', validAliceHotkeys), 'ALLOW');
  assert.equal(
    evaluateHotkeyRule('update', aliceAuth, 'alice_uid', validAliceHotkeys, {
      ...validAliceHotkeys,
      restartMidiNotes: [21, 23, 24],
      updatedAt: REQUEST_TIME,
    }),
    'ALLOW'
  );
  assert.equal(evaluateHotkeyRule('delete', aliceAuth, 'alice_uid', validAliceHotkeys), 'ALLOW');

  // Dirty Dozen (#1–#12: /scores)
  assert.equal(evaluateScoreRule('get', null, 'alice-score-1', validAliceScore), 'PERMISSION_DENIED', '#1');
  assert.equal(evaluateScoreRule('get', bobAuth, 'alice-score-1', validAliceScore), 'PERMISSION_DENIED', '#2');
  assert.equal(evaluateScoreRule('list', bobAuth, '', validAliceScore), 'PERMISSION_DENIED', '#3');
  assert.equal(
    evaluateScoreRule('create', bobAuth, 'spoof-1', undefined, { ...validAliceScore, id: 'spoof-1', ownerId: 'alice_uid' }),
    'PERMISSION_DENIED',
    '#4'
  );
  assert.equal(
    evaluateScoreRule('create', unverifiedBob, 'unver-1', undefined, { ...validAliceScore, id: 'unver-1', ownerId: 'bob_uid' }),
    'PERMISSION_DENIED',
    '#5'
  );
  assert.equal(
    evaluateScoreRule('create', aliceAuth, 'ghost-1', undefined, { ...validAliceScore, id: 'ghost-1', isAdmin: true }),
    'PERMISSION_DENIED',
    '#6'
  );
  assert.equal(
    evaluateScoreRule('create', aliceAuth, 'bad$id!@#', undefined, { ...validAliceScore, id: 'bad$id!@#' }),
    'PERMISSION_DENIED',
    '#7'
  );
  assert.equal(
    evaluateScoreRule('create', aliceAuth, 'score-a', undefined, { ...validAliceScore, id: 'score-b' }),
    'PERMISSION_DENIED',
    '#8'
  );
  assert.equal(
    evaluateScoreRule('create', aliceAuth, 'time-1', undefined, { ...validAliceScore, id: 'time-1', createdAt: 1000 }),
    'PERMISSION_DENIED',
    '#9'
  );
  assert.equal(
    evaluateScoreRule('update', aliceAuth, 'alice-score-1', validAliceScore, {
      ...validAliceScore,
      title: 'A'.repeat(250),
    }),
    'PERMISSION_DENIED',
    '#10'
  );
  assert.equal(
    evaluateScoreRule('update', aliceAuth, 'alice-score-1', validAliceScore, {
      ...validAliceScore,
      createdAt: REQUEST_TIME - 5000,
    }),
    'PERMISSION_DENIED',
    '#11'
  );
  assert.equal(evaluateScoreRule('delete', bobAuth, 'alice-score-1', validAliceScore), 'PERMISSION_DENIED', '#12');

  // Hotkey adversarial checks (#13–#15: /userSettings)
  assert.equal(evaluateHotkeyRule('get', bobAuth, 'alice_uid', validAliceHotkeys), 'PERMISSION_DENIED', '#13a');
  assert.equal(evaluateHotkeyRule('list', aliceAuth, '', validAliceHotkeys), 'PERMISSION_DENIED', '#13b');
  assert.equal(
    evaluateHotkeyRule('create', aliceAuth, 'alice_uid', undefined, {
      ...validAliceHotkeys,
      restartMidiNotes: [21, 999],
    }),
    'PERMISSION_DENIED',
    '#14a'
  );
  assert.equal(
    evaluateHotkeyRule('create', aliceAuth, 'alice_uid', undefined, {
      ...validAliceHotkeys,
      restartMidiNotes: [21, 22, 23, 24, 25],
    }),
    'PERMISSION_DENIED',
    '#14b'
  );
  assert.equal(
    evaluateHotkeyRule('update', aliceAuth, 'alice_uid', validAliceHotkeys, {
      ...validAliceHotkeys,
      restartKey: 'bad$key!',
    }),
    'PERMISSION_DENIED',
    '#15a'
  );
  assert.equal(
    evaluateHotkeyRule('update', aliceAuth, 'alice_uid', validAliceHotkeys, {
      ...validAliceHotkeys,
      role: 'admin',
    }),
    'PERMISSION_DENIED',
    '#15b'
  );

  // Positive control checks: /practiceStats
  assert.equal(
    evaluatePracticeStatRule('get', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', undefined),
    'ALLOW'
  );
  assert.equal(
    evaluatePracticeStatRule('create', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', undefined, validAliceStat),
    'ALLOW'
  );
  assert.equal(
    evaluatePracticeStatRule('get', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', validAliceStat),
    'ALLOW'
  );
  assert.equal(evaluatePracticeStatRule('list', aliceAuth, '', validAliceStat), 'ALLOW');
  assert.equal(
    evaluatePracticeStatRule('update', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', validAliceStat, {
      ...validAliceStat,
      totalRuns: 3,
      bars: {
        '1': { practices: 3, perfect: 11, good: 1, wrong: 0, miss: 0 },
      },
      updatedAt: REQUEST_TIME,
    }),
    'ALLOW'
  );
  assert.equal(
    evaluatePracticeStatRule('delete', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', validAliceStat),
    'ALLOW'
  );

  // Practice stats adversarial checks (#16–#18: /practiceStats)
  assert.equal(
    evaluatePracticeStatRule('get', bobAuth, 'alice_uid_ode-to-joy_tempo_80', validAliceStat),
    'PERMISSION_DENIED',
    '#16a'
  );
  assert.equal(
    evaluatePracticeStatRule('get', bobAuth, 'alice_uid_ode-to-joy_tempo_80', undefined),
    'PERMISSION_DENIED',
    '#16c'
  );
  assert.equal(
    evaluatePracticeStatRule('list', bobAuth, '', validAliceStat),
    'PERMISSION_DENIED',
    '#16b'
  );
  assert.equal(
    evaluatePracticeStatRule('create', aliceAuth, 'alice_uid_ode-to-joy_wait_80', undefined, {
      ...validAliceStat,
      id: 'alice_uid_ode-to-joy_wait_80',
      mode: 'wait',
      bpm: 80,
    }),
    'PERMISSION_DENIED',
    '#17a'
  );
  assert.equal(
    evaluatePracticeStatRule('create', aliceAuth, 'alice_uid_ode-to-joy_tempo_0', undefined, {
      ...validAliceStat,
      id: 'alice_uid_ode-to-joy_tempo_0',
      mode: 'tempo',
      bpm: 0,
    }),
    'PERMISSION_DENIED',
    '#17b'
  );
  assert.equal(
    evaluatePracticeStatRule('update', aliceAuth, 'alice_uid_ode-to-joy_tempo_80', validAliceStat, {
      ...validAliceStat,
      bpm: 100,
      updatedAt: REQUEST_TIME,
    }),
    'PERMISSION_DENIED',
    '#18'
  );

  console.log('ALL 18 ADVERSARIAL + 14 POSITIVE FIRESTORE RULES TESTS PASSED');
}

runSuite();
