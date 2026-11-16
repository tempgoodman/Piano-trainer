# Anson Practice Piano

An interactive, full-stack piano practice studio built with **React**, **TypeScript**, **OpenSheetMusicDisplay (OSMD)**, **Web MIDI API**, **Sampled Acoustic Grand Piano Audio (`smplr`)**, and a **FastAPI / Express OMR & Score Backend**.

---

## Key Features

### 1. Unified Input & Acoustic Grand Piano Audio
- **Hardware Web MIDI + Virtual Keyboard + QWERTY**: Accepts real-time MIDI signals (`noteOn`, `noteOff`, velocity `0–127`, CC #64 sustain pedal) from digital pianos alongside an interactive 88-key-compatible virtual piano (`Both Inputs`, `MIDI Piano`, or `Virtual Keys`).
- **Sampled Acoustic Grand Piano (`smplr`)**: Uses `SplendidGrandPiano` (with `CacheStorage` caching and `MusyngKite` `acoustic_grand_piano` Soundfont fallback), polyphony management, dynamic velocity scaling, and sustain pedal voice holding.
- **Hardware MIDI Hotkeys**: Control the app directly from your piano keys without touching the mouse:
  - **Restart** (`A0 + B0 + C1` / MIDI `21, 23, 24`): Resets cursor to Measure 1 or Loop Point A.
  - **Stop / Return to Wait Mode** (`A7 + B7 + C8` / MIDI `105, 107, 108`): Stops Tempo playback and switches to Wait Mode.

### 2. Dual Practice Modes & Real-Time Scoring
- **Wait Mode**: Pauses the OSMD cursor indefinitely until the expected pitch(es) for the active hand (`Both Hands`, `Right Hand`, `Left Hand`) are played. Timing is ignored.
- **Tempo Mode with Smart Start**: Arms on the first required note (`isArmed`), starts the Web Audio clock and cursor movement the moment you play the opening note, and grades every beat live:
  - **Perfect** (`|Δt| ≤ 150ms` — Green)
  - **Good / Early or Late** (`150ms < |Δt| ≤ 300ms` — Amber)
  - **Miss** (`> 300ms` or skipped — Grey)
  - **Wrong Pitch** (Red)
- **Continuous Web Audio Metronome**: Runs continuously in Tempo Mode (both Armed and Playing), Wait Mode (when enabled), and Computer Auto-Play.
- **Interactive SVG A/B Measure Loop**: Click any measure on the sheet music (or use the measure inputs) to set **Point A** and **Point B** with shaded OSMD highlights and seamless auto-reset at Point B.

### 3. Record, Auto-Play & Dual-Cursor Compare Mode
- **Silent Background Recording**: Captures incoming `noteOn` / `noteOff` / velocity events with relative millisecond timestamps.
- **Play by Computer**: Dispatches scheduled MusicXML notes through the acoustic grand piano and OSMD cursor at the configured BPM.
- **Play Recorded**: Replays your captured track with your exact dynamics and timing.
- **Compare Mode**: Overlays a primary green cursor (computer timing) and a blue ghost cursor (your recorded performance) while displaying live timing lead/lag deltas.

### 4. Optical Music Recognition (OMR) Sheet Scanner
- Upload **JPG / PNG** sheet music photos or **`.musicxml` / `.xml`** files via the **Upload Sheet** modal.
- Image uploads run through an asynchronous backend pipeline (`POST /api/omr/upload`) streaming progress over **WebSocket** (`/ws/omr/{job_id}`) with automatic **HTTP polling fallback** (`/api/omr/status/{job_id}`).
- Supports **HOMR** in the Python FastAPI backend (Docker Compose) or **Gemini Vision** / fallback sample MusicXML in the Node Express server (`server.ts`).

### 5. Standalone WYSIWYG Sheet Music Editor (`/editor/:songId`)
- Isolated on its own React Router page (`/editor/:songId`), completely decoupled from practice/MIDI/audio hooks.
- Click any rendered OSMD notehead to highlight it and open the floating **Note Editor Toolbar** (`Pitch ↑/↓`, `Accidentals ♯/♭/♮/Clear`, `Duration 1–1/16 + Dotted`, `Convert to Rest`, `Delete`).
- Powered by `MusicXMLParser` (DOM manipulation + automatic `<divisions>` scaling) and `useOSMDEditor` (`160ms` debounced `osmd.load() -> osmd.render()` loop), with Undo/Redo (`Ctrl+Z` / `Ctrl+Y`), `.musicxml` export, and `PUT /api/scores/:songId` persistence.

### 6. Rule-Based Practice Tutor (Strategy Pattern)
- Built around `ITutorEngine` (`generatePlan(performanceData: PerformanceSummary): Promise<TrainingPlan>`), making the UI completely agnostic to whether plans come from `RuleBasedTutorEngine` (`'RULE'`) or a future `LLMTutorEngine` (`'LLM'`).
- Evaluates live measure-by-measure, staff-separated (`Staff 1` Right Hand vs. `Staff 2` Left Hand) telemetry against **15 piano pedagogy rules** (hand isolation, rushing/dragging BPM adjustments, rhythm-only metronome focus, single-bar micro-loops, barline transition stumbles, end-of-piece fatigue, consecutive missed-note recovery, scaffolding, challenge mode, halving overwhelmed pieces, and empty-input checks).
- Clicking **Apply & Practice** on any step in `trainingPlaylist` configures Practice Mode, Hand Isolation, BPM, Metronome, and A/B Loop automatically.

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Browser (React 19 + TypeScript)                       │
│                                                                              │
│  ┌────────────────────────────────────┐   ┌───────────────────────────────┐  │
│  │ PracticePlayerPage (Route: `/`)    │   │ SheetMusicEditorPage          │  │
│  │  • Web MIDI + VirtualPiano         │   │ (Route: `/editor/:songId`)    │  │
│  │  • smplr Acoustic Grand Piano      │   │  • useOSMDEditor (160ms deb.) │  │
│  │  • Wait / Tempo / Compare Engines  │   │  • MusicXMLParser (DOM + XML) │  │
│  │  • PracticeTutorModal (ITutorEngine)│  │  • NoteEditorToolbar          │  │
│  └───────────────┬────────────────────┘   └──────────────┬────────────────┘  │
└──────────────────┼───────────────────────────────────────┼───────────────────┘
                   │ HTTP (/api/*) & WebSocket (/ws/omr/*) │
                   ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│            Production (Docker Compose)              Local Dev / Preview      │
│  ┌─────────────────────────────────────┐         ┌────────────────────────┐  │
│  │ Nginx (Port 3000 -> 80)             │         │ Express + Vite Server  │  │
│  │  • Serves Vite static `dist/`       │         │ (`server.ts`, Port 3000)│ │
│  │  • SPA fallback (`try_files`)       │         │  • Serves Vite dev/prod│  │
│  │  • Proxies `/api/` & `/ws/` ────────┼──┐      │  • `/api/omr/*`, `/ws/`│  │
│  └─────────────────────────────────────┘  │      │  • `/api/scores/:id`   │  │
│                                           ▼      └────────────────────────┘  │
│  ┌──────────────────────────────────────────┐                                │
│  │ FastAPI Backend (`backend/main.py`, 8000)│                                │
│  │  • Async OMR Worker Pool (HOMR CLI)      │                                │
│  │  • WebSocket + HTTP Status Polling       │                                │
│  │  • MusicXML Score Store (`/api/scores/*`)│                                │
│  └──────────────────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Project Directory Structure

```text
.
├── backend/
│   ├── Dockerfile              # Python 3.11 + FastAPI + Uvicorn + HOMR container
│   ├── main.py                 # FastAPI OMR pipeline, WebSocket & Score endpoints
│   └── requirements.txt        # fastapi, uvicorn, python-multipart, homr
├── nginx/
│   └── default.conf            # SPA routing + reverse proxy for /api/* and /ws/*
├── src/
│   ├── audio/AudioEngine.ts    # smplr SplendidGrandPiano + Metronome + Sustain
│   ├── components/
│   │   ├── editor/NoteEditorToolbar.tsx
│   │   ├── OmrUploadModal.tsx
│   │   ├── PracticeControls.tsx
│   │   ├── PracticeTutorModal.tsx
│   │   ├── SheetMusicViewer.tsx
│   │   ├── TopBar.tsx
│   │   └── VirtualPiano.tsx
│   ├── data/sampleScores.ts    # Built-in piano repertoire (MusicXML)
│   ├── engines/
│   │   ├── PlaybackScheduler.ts
│   │   ├── ScoringEngine.ts
│   │   └── tutor/
│   │       ├── TutorEngineInterface.ts      # ITutorEngine, PerformanceSummary, TrainingPlan
│   │       ├── RuleBasedTutorEngine.ts      # 15 pedagogical rules + helpers
│   │       ├── TutorFactory.ts              # createTutorEngine & getTrainingPlan()
│   │       └── performanceSummaryBuilder.ts # Live telemetry -> PerformanceSummary
│   ├── hooks/
│   │   ├── useMIDIHotkeyController.ts
│   │   ├── useOSMDEditor.ts
│   │   ├── useOSMDInteract.ts
│   │   ├── usePianoAudio.ts
│   │   ├── usePlaybackEngine.ts
│   │   ├── usePracticeMode.ts
│   │   ├── useRecordingEngine.ts
│   │   └── useUnifiedNoteInput.ts
│   ├── pages/
│   │   ├── PracticePlayerPage.tsx
│   │   └── SheetMusicEditorPage.tsx
│   ├── store/usePracticeStore.ts
│   ├── types/music.ts
│   ├── utils/
│   │   ├── MusicXMLParser.ts
│   │   └── osmdColoring.ts
│   └── App.tsx                 # React Router (`/`, `/editor/:songId`)
├── Dockerfile.frontend         # Multi-stage Node 22 build -> Nginx Alpine runtime
├── docker-compose.yml          # Orchestrates frontend (3000) & backend (8000)
├── package.json
├── server.ts                   # Single-process Express + Vite dev/prod server
└── vite.config.ts
```

---

## How to Use

1. **Choose a Piece & Input Source**:
   - Select a built-in piece from the top navigation bar (or click **Upload Sheet** to import a `.musicxml`/`.xml` file or scan a JPG/PNG sheet image).
   - Connect a USB MIDI digital piano (supported in Chromium-based browsers via Web MIDI) or play using the **Virtual Piano** / computer keyboard (`A–L`, `W/E/T/Y/U` etc.).
2. **Practice in Wait Mode or Tempo Mode**:
   - **Wait Mode**: Play the highlighted key(s); the blue OSMD cursor waits indefinitely for correct pitches. Use `Right Hand`, `Left Hand`, or `Both Hands` to isolate staves.
   - **Tempo Mode**: Click **Tempo Mode** to arm (`Armed — Play 1st Note`). Turn on **Metronome** if desired, adjust **BPM**, and play the first expected note to trigger Smart Start.
3. **Set A/B Loops**:
   - Click any measure on the sheet music to set **Point A**, click a second measure to set **Point B**, or enter measure numbers directly in the toolbar.
4. **Record & Compare**:
   - Every practice session is captured automatically in the background. Click **Play by Computer**, **Play Recorded**, or **Compare Mode** to hear and visually compare your timing against the computer reference cursor.
5. **Get a Practice Plan (Practice Tutor)**:
   - Play a pass (or finish a song and click **Review with Tutor**), or open **Practice Tutor** in the toolbar.
   - Review the diagnosis and click **Apply & Practice** on any generated step to automatically configure Mode, Hand Isolation, BPM, Metronome, and A/B Loop.
6. **Edit Sheet Music (`/editor/:songId`)**:
   - Click **Edit Score** in the top bar to open the standalone WYSIWYG editor.
   - Click any notehead to adjust pitch (`↑`/`↓`), accidentals, duration, dotted rhythm, rest conversion, or deletion, then click **Save Score** to update the piece for practice.

---

## Getting Started

### Option 1: Run Full Stack with Docker Compose (Recommended)

Requirements: **Docker** and **Docker Compose v2**.

```bash
# Build and start both Frontend (Nginx on :3000) and Backend (FastAPI on :8000)
docker compose up --build
```

Once healthy:
- **App (Player & Editor)**: http://localhost:3000
- **FastAPI Backend Swagger Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/api/health

Stop the stack:

```bash
docker compose down
```

> **Environment Option (`OMR_ALLOW_SAMPLE_FALLBACK`)**: Defaults to `true` in `docker-compose.yml` so JPG/PNG uploads still complete cleanly with a sample transcribed MusicXML if HOMR model weights are not pre-cached inside the container. Set `OMR_ALLOW_SAMPLE_FALLBACK=false` to enforce strict `homr` CLI errors.

---

### Option 2: Local Development (Node + Vite + Express)

Requirements: **Node.js 20+** (Node 22 recommended) and **npm**.

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Configure environment variables for Gemini Vision OMR
cp .env.example .env
# Edit .env and set GEMINI_API_KEY="your-key" if using Gemini Vision OMR in server.ts

# 3. Start Express + Vite dev server on port 3000
npm run dev
```

Useful scripts:
- `npm run dev` — Starts `server.ts` with Vite middleware on http://localhost:3000
- `npm run build` — Builds the production React bundle into `dist/`
- `npm run lint` — Runs TypeScript type checking (`tsc --noEmit`)
- `NODE_ENV=production npm start` — Serves the built `dist/` bundle via `server.ts`

If you want to run the Python FastAPI OMR service locally on port `8000`:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Backend API & WebSocket Endpoints

| Method / Protocol | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service liveness probe |
| `POST` | `/api/omr/upload` | Queue JPG/PNG sheet music image (`application/json` base64 or `multipart/form-data`); returns `202` with `job_id` |
| `GET` | `/api/omr/status/{job_id}` | HTTP polling fallback returning OMR progress and resulting `musicxml` |
| `WS` | `/ws/omr/{job_id}` | Real-time OMR progress stream (`queued` → `preprocessing` → `recognizing` → `postprocessing` → `completed`) |
| `GET` | `/api/scores/{song_id}` | Fetch saved MusicXML document for the editor |
| `PUT` | `/api/scores/{song_id}` | Persist edited MusicXML (`title`, `composer`, `musicxml`) |

---

## Extending the Practice Tutor (`LLMTutorEngine`)

The tutor module (`src/engines/tutor/TutorFactory.ts`) uses the Strategy Pattern (`ITutorEngine`):

```ts
import { getTrainingPlan } from './engines/tutor/TutorFactory';

// Currently uses RuleBasedTutorEngine (15 deterministic pedagogical rules)
const plan = await getTrainingPlan(performanceSummary, 'RULE');

// Future swap: zero UI changes required once /api/tutor/plan is backed by an LLM
const llmPlan = await getTrainingPlan(performanceSummary, 'LLM');
```
