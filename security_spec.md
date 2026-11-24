# Security Specification — Anson Practice Piano Firestore Rules

## 1. Data Invariants

1. **Strict Private Ownership**:
   - Every document in `/scores/{scoreId}` belongs to one authenticated, email-verified user (`ownerId == request.auth.uid`).
   - Every document in `/userSettings/{userId}` belongs strictly to the user matching `userId == request.auth.uid` (`allow get` only; `allow list` is omitted/denied).
   - Every document in `/practiceStats/{statId}` belongs to one authenticated, email-verified user (`ownerId == request.auth.uid`).
2. **Global Default Deny**: Any collection path outside `/scores/{scoreId}`, `/userSettings/{userId}`, and `/practiceStats/{statId}` (including `/test/connection`) is explicitly denied (`allow read, write: if false`).
3. **Document ID Hardening**: Single-document operations (`get`, `create`, `update`, `delete`) require path IDs (`scoreId`, `userId`, `statId`) to match `^[a-zA-Z0-9_\-]+$` with length `<= 128`.
4. **Schema & Volumetric Bounds (Sync with `firebase-blueprint.json`)**:
   - **`UserScore`**: Required & exclusive keys `id`, `ownerId`, `title` (1..120), `composer` (1..120), `level` enum, `timeSignature` (`^[0-9]{1,2}/[0-9]{1,2}$`), `measures` (int 1..1000), `bpm` (int 30..240), `musicXml` (20..800000), `createdAt`, `updatedAt`.
   - **`UserHotkeys`**: Required & exclusive keys `ownerId` (`== userId == request.auth.uid`), `restartMidiNotes` (list of 1..4 ints in 21..108, every element guarded), `stopMidiNotes` (list of 1..4 ints in 21..108, every element guarded), `restartKey` (`1..20`, `^[a-zA-Z0-9_\-]+$`), `stopKey` (`1..20`, `^[a-zA-Z0-9_\-]+$`), `createdAt`, `updatedAt`.
   - **`PracticeStatDoc`**: Required & exclusive keys `id` (`== statId`), `ownerId` (`== request.auth.uid`), `scoreId` (`1..128`, `^[a-zA-Z0-9_\-]+$`), `mode` (`'wait'` or `'tempo'`), `bpm` (`0` for `'wait'`, `30..240` for `'tempo'`), `totalRuns` (int `0..100000`), `bars` (map with `size() <= 1000`), `createdAt`, `updatedAt`.
5. **Immutability & Server Timestamps**:
   - On `create`: `createdAt == request.time` and `updatedAt == request.time`.
   - On `update`: `ownerId` and `createdAt` (plus `id`, `scoreId`, `mode`, `bpm` on practiceStats and `id` on scores) are immutable; `updatedAt == request.time`; action-based `affectedKeys().hasOnly(...)` restricts mutable keys.
6. **Verified Identity Enforcement**: All writes require `request.auth != null && request.auth.token.email_verified == true`.
7. **Zero Client Query Trust**: `allow list` on `/scores/{scoreId}` and `/practiceStats/{statId}` enforces `resource.data.ownerId == request.auth.uid`; `/userSettings/{userId}` does not allow `list`.

---

## 2. Adversarial Payloads ("Dirty Dozen" + Hotkey & Practice Stats Guards)

| # | Attack Vector | Target Operation | Adversarial Payload / Context | Expected Result |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Unauthenticated Read** | `get /scores/s1` | `auth = null` | `PERMISSION_DENIED` |
| 2 | **Cross-User Get** | `get /scores/alice-score` | `auth.uid = 'bob'` (`ownerId = 'alice'`) | `PERMISSION_DENIED` |
| 3 | **Unscoped List Scraping** | `list /scores` | `auth.uid = 'bob'`, query without `where('ownerId', '==', 'bob')` | `PERMISSION_DENIED` |
| 4 | **Identity Spoofing on Create** | `create /scores/spoof-1` | `auth.uid = 'bob'`, `ownerId: 'alice'` | `PERMISSION_DENIED` |
| 5 | **Unverified Email Write** | `create /scores/unver-1` | `auth.uid = 'bob'`, `email_verified: false` | `PERMISSION_DENIED` |
| 6 | **Shadow / Ghost Field Injection** | `create /scores/ghost-1` | Valid score + `isAdmin: true` | `PERMISSION_DENIED` |
| 7 | **ID Poisoning** | `create /scores/bad$id!@#` | `scoreId` fails `^[a-zA-Z0-9_\-]+$` or `> 128` chars | `PERMISSION_DENIED` |
| 8 | **Mismatched Body ID** | `create /scores/score-a` | `data.id = 'score-b'` (`!= scoreId`) | `PERMISSION_DENIED` |
| 9 | **Client-Forged Timestamp** | `create /scores/time-1` | `createdAt: Timestamp(2020-01-01)` (`!= request.time`) | `PERMISSION_DENIED` |
| 10 | **Value Poisoning / Oversized String** | `update /scores/alice-1` | `title: 'A'.repeat(250)` or `measures: -5` or `level: 'Hack'` | `PERMISSION_DENIED` |
| 11 | **Immutable Field Tampering** | `update /scores/alice-1` | Attempt to mutate `ownerId` or `createdAt` | `PERMISSION_DENIED` |
| 12 | **Cross-User Delete** | `delete /scores/alice-1` | `auth.uid = 'bob'` (`ownerId = 'alice'`) | `PERMISSION_DENIED` |
| 13 | **Cross-User Hotkey Read/Write** | `get/create /userSettings/alice_uid` | `auth.uid = 'bob_uid'` | `PERMISSION_DENIED` |
| 14 | **Array Element Poisoning on Hotkeys** | `create /userSettings/alice_uid` | `restartMidiNotes: [21, 999]` or `['bad']` or 5 elements | `PERMISSION_DENIED` |
| 15 | **Hotkey Shadow Field / Invalid Key** | `update /userSettings/alice_uid` | `restartKey: 'bad$key!'` or extra field `role: 'admin'` | `PERMISSION_DENIED` |
| 16 | **Cross-User Practice Stats Read/List** | `get/list /practiceStats/stat1` | `auth.uid = 'bob_uid'` (`ownerId = 'alice_uid'`) | `PERMISSION_DENIED` |
| 17 | **Invalid Mode/BPM Pairing on Stats** | `create /practiceStats/stat1` | `mode: 'wait', bpm: 80` or `mode: 'tempo', bpm: 0` | `PERMISSION_DENIED` |
| 18 | **Immutable Bucket Tampering on Stats** | `update /practiceStats/stat1` | Attempt to mutate `mode`, `bpm`, or `scoreId` | `PERMISSION_DENIED` |
