import { CacheStorage, Soundfont, SplendidGrandPiano, type Smplr, type StopFn } from 'smplr';

/**
 * Representative acoustic grand piano sample roots spanning the full keyboard.
 * `smplr` automatically selects the matching velocity layer (PPP/PP/MP/MF/FF)
 * and pitch-shifts smoothly to adjacent semitones via `fallback: 'nearest'`.
 */
const SAMPLED_PIANO_NOTES = [
  27, 33, 38, 41, 45,
  48, 52, 55, 58,
  60, 62, 64, 65, 67, 69, 71,
  72, 74, 76, 77, 79, 81, 83,
  86, 89, 93, 96, 103,
];

export interface PianoLoadCallbacks {
  onProgress?: (progressPercent: number, engineLabel: string) => void;
}

class PianoAudioEngine {
  private ctx: AudioContext | null = null;
  private metronomeGain: GainNode | null = null;
  private pianoBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private instrument: Smplr | null = null;
  private engineLabel = 'Splendid Grand Piano';
  private isLoaded = false;
  private loadProgress = 0;
  private loadPromise: Promise<string> | null = null;

  // Polyphonic voice + CC64 Sustain Pedal state
  private activeVoices: Map<number, StopFn> = new Map();
  private heldKeys: Set<number> = new Set();
  private sustainedNotes: Set<number> = new Set();
  private sustainPedalDown = false;

  // Metronome scheduler state
  private metronomeTimer: number | null = null;
  private nextBeatTime = 0;
  private currentBeat = 0;
  private bpm = 84;
  private beatsPerMeasure = 4;
  private isMetronomeRunning = false;
  private onBeatCallback: ((beatInMeasure: number) => void) | null = null;

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master dynamics limiter prevents clipping during dense chords + sustain pedal
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.2, this.ctx.currentTime);
      this.compressor.connect(this.ctx.destination);

      this.pianoBus = this.ctx.createGain();
      this.pianoBus.gain.value = 1.0;
      this.pianoBus.connect(this.compressor);

      this.metronomeGain = this.ctx.createGain();
      this.metronomeGain.gain.value = 0.45;
      this.metronomeGain.connect(this.compressor);
    }
    return this.ctx;
  }

  /**
   * Resumes/initializes Web Audio context on user gesture and returns monotonic clock time in ms.
   */
  public ensureActive(): number {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return performance.now();
  }

  /**
   * Shared high-precision monotonic clock in ms (matches ensureActive and MIDI timestamps with zero epoch jumps).
   */
  public getNowMs(): number {
    return performance.now();
  }

  public getIsLoaded(): boolean {
    return this.isLoaded;
  }

  public getLoadProgress(): number {
    return this.loadProgress;
  }

  public getEngineLabel(): string {
    return this.engineLabel;
  }

  /**
   * Loads the multi-velocity sampled SplendidGrandPiano (with CacheStorage persistence),
   * falling back automatically to Gleitz's MusyngKite acoustic_grand_piano Soundfont if needed.
   */
  public loadPianoSamples(callbacks?: PianoLoadCallbacks): Promise<string> {
    if (this.isLoaded && this.instrument) {
      callbacks?.onProgress?.(100, this.engineLabel);
      return Promise.resolve(this.engineLabel);
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    const ctx = this.ensureContext();
    if (!this.pianoBus) {
      return Promise.reject(new Error('Audio output bus initialization failed.'));
    }

    const destination = this.pianoBus;

    this.loadPromise = (async () => {
      try {
        this.loadProgress = 5;
        this.engineLabel = 'Splendid Grand Piano';
        callbacks?.onProgress?.(5, this.engineLabel);

        const splendid = new SplendidGrandPiano(ctx, {
          destination,
          storage: new CacheStorage('anson-splendid-piano-v1'),
          volume: 112,
          decayTime: 0.42,
          notesToLoad: {
            notes: SAMPLED_PIANO_NOTES,
            velocityRange: [1, 127],
            fallback: 'nearest',
          },
          onLoadProgress: ({ loaded, total }) => {
            if (total > 0) {
              const pct = Math.max(5, Math.min(99, Math.round((loaded / total) * 100)));
              this.loadProgress = pct;
              callbacks?.onProgress?.(pct, 'Splendid Grand Piano');
            }
          },
        });

        await splendid.ready;
        this.instrument = splendid;
        this.engineLabel = 'Splendid Grand Piano';
        this.isLoaded = true;
        this.loadProgress = 100;
        callbacks?.onProgress?.(100, this.engineLabel);
        return this.engineLabel;
      } catch (primaryErr) {
        console.warn(
          '[Anson Practice Piano] SplendidGrandPiano CDN unavailable, falling back to Gleitz Soundfont:',
          primaryErr
        );

        try {
          this.engineLabel = 'Acoustic Grand Soundfont';
          this.loadProgress = 15;
          callbacks?.onProgress?.(15, this.engineLabel);

          const sf = new Soundfont(ctx, {
            kit: 'MusyngKite',
            instrument: 'acoustic_grand_piano',
            destination,
            storage: new CacheStorage('anson-gleitz-soundfont-v1'),
            volume: 112,
            onLoadProgress: ({ loaded, total }) => {
              if (total > 0) {
                const pct = Math.max(15, Math.min(99, Math.round((loaded / total) * 100)));
                this.loadProgress = pct;
                callbacks?.onProgress?.(pct, 'Acoustic Grand Soundfont');
              }
            },
          });

          await sf.ready;
          this.instrument = sf;
          this.engineLabel = 'Acoustic Grand Soundfont';
          this.isLoaded = true;
          this.loadProgress = 100;
          callbacks?.onProgress?.(100, this.engineLabel);
          return this.engineLabel;
        } catch (fallbackErr) {
          this.loadPromise = null;
          this.isLoaded = false;
          throw fallbackErr instanceof Error
            ? fallbackErr
            : new Error('Unable to download piano samples.');
        }
      }
    })();

    return this.loadPromise;
  }

  /**
   * Triggers a polyphonic sampled acoustic piano note with dynamic MIDI velocity (0-127).
   */
  public playPianoNote(midi: number, velocity = 96): void {
    if (!this.isLoaded || !this.instrument) return;

    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const clampedMidi = Math.max(21, Math.min(108, Math.round(midi)));
    const clampedVel = Math.max(1, Math.min(127, Math.round(velocity)));

    this.heldKeys.add(clampedMidi);
    this.sustainedNotes.delete(clampedMidi);

    // Prevent voice stacking on rapid re-strikes of the exact same key
    const existingStop = this.activeVoices.get(clampedMidi);
    if (existingStop) {
      try {
        existingStop();
      } catch {
        // Ignore already released voice
      }
      this.activeVoices.delete(clampedMidi);
    }

    const stopFn = this.instrument.start({
      note: clampedMidi,
      velocity: clampedVel,
      stopId: clampedMidi,
    });

    this.activeVoices.set(clampedMidi, stopFn);
  }

  /**
   * Stops/releases a piano note, or defers release when global Sustain Pedal (MIDI CC 64) is pressed.
   */
  public stopPianoNote(midi: number): void {
    const clampedMidi = Math.max(21, Math.min(108, Math.round(midi)));
    this.heldKeys.delete(clampedMidi);

    if (!this.activeVoices.has(clampedMidi)) return;

    if (this.sustainPedalDown) {
      this.sustainedNotes.add(clampedMidi);
      return;
    }

    this.releaseKeyVoice(clampedMidi);
  }

  /**
   * Backwards-compatible aliases used across input & playback schedulers.
   */
  public playNote(midi: number, velocity = 96): void {
    this.playPianoNote(midi, velocity);
  }

  public stopNote(midi: number): void {
    this.stopPianoNote(midi);
  }

  public stopAllNotes(): void {
    this.heldKeys.clear();
    this.sustainedNotes.clear();
    this.activeVoices.clear();
    try {
      this.instrument?.stop();
    } catch {
      // Ignore if disposed
    }
  }

  /**
   * Global Sustain Pedal (MIDI CC 64): holds released notes ringing until pedal is lifted.
   */
  public setSustainPedal(isDown: boolean): void {
    this.sustainPedalDown = isDown;
    try {
      this.instrument?.setCC(64, isDown ? 127 : 0);
    } catch {
      // Ignore if not yet initialized
    }

    if (!isDown) {
      for (const midi of Array.from(this.sustainedNotes)) {
        if (!this.heldKeys.has(midi)) {
          this.releaseKeyVoice(midi);
        }
      }
      this.sustainedNotes.clear();
    }
  }

  private releaseKeyVoice(midi: number): void {
    const stopFn = this.activeVoices.get(midi);
    if (stopFn) {
      try {
        stopFn();
      } catch {
        // Ignore already ended voice
      }
      this.activeVoices.delete(midi);
    }
    try {
      this.instrument?.stop(midi);
    } catch {
      // Ignore
    }
  }

  public playFeedbackCue(kind: 'success' | 'error'): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (!this.metronomeGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'success' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(kind === 'success' ? 880 : 196, now);
    if (kind === 'success') {
      osc.frequency.setValueAtTime(1174.66, now + 0.08);
    }
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.metronomeGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  // --- Synchronized Web Audio Metronome ---

  public configureMetronome(bpm: number, beatsPerMeasure = 4): void {
    this.bpm = Math.max(40, Math.min(200, bpm));
    this.beatsPerMeasure = Math.max(2, Math.min(12, beatsPerMeasure));
  }

  public startMetronome(onBeat?: (beatInMeasure: number) => void): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    this.onBeatCallback = onBeat ?? null;

    if (this.isMetronomeRunning) return;
    this.isMetronomeRunning = true;
    this.currentBeat = 0;
    this.nextBeatTime = ctx.currentTime + 0.05;

    const lookaheadMs = 25;
    const scheduleAheadSec = 0.12;

    const scheduler = () => {
      if (!this.isMetronomeRunning || !this.ctx) return;

      while (this.nextBeatTime < this.ctx.currentTime + scheduleAheadSec) {
        const beatIndex = this.currentBeat % this.beatsPerMeasure;
        this.scheduleClick(this.nextBeatTime, beatIndex === 0);

        const delayMs = Math.max(0, (this.nextBeatTime - this.ctx.currentTime) * 1000);
        if (this.onBeatCallback) {
          const cb = this.onBeatCallback;
          window.setTimeout(() => {
            if (this.isMetronomeRunning) cb(beatIndex);
          }, delayMs);
        }

        const secondsPerBeat = 60.0 / this.bpm;
        this.nextBeatTime += secondsPerBeat;
        this.currentBeat++;
      }

      this.metronomeTimer = window.setTimeout(scheduler, lookaheadMs);
    };

    scheduler();
  }

  public stopMetronome(): void {
    this.isMetronomeRunning = false;
    if (this.metronomeTimer !== null) {
      window.clearTimeout(this.metronomeTimer);
      this.metronomeTimer = null;
    }
    this.onBeatCallback = null;
  }

  private scheduleClick(time: number, isDownbeat: boolean): void {
    if (!this.ctx || !this.metronomeGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(isDownbeat ? 1320 : 880, time);
    osc.frequency.exponentialRampToValueAtTime(isDownbeat ? 660 : 440, time + 0.035);

    gain.gain.setValueAtTime(isDownbeat ? 0.35 : 0.2, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(gain);
    gain.connect(this.metronomeGain);

    osc.start(time);
    osc.stop(time + 0.05);
  }
}

export const audioEngine = new PianoAudioEngine();
