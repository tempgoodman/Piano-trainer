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

export type MetronomeStyle = 'classic' | 'woodblock' | 'mechanical';

export interface PianoLoadCallbacks {
  onProgress?: (progressPercent: number, engineLabel: string) => void;
}

const METRONOME_MAX_GAIN = 2.2;

class PianoAudioEngine {
  private ctx: AudioContext | null = null;
  private metronomeGain: GainNode | null = null;
  private feedbackGain: GainNode | null = null;
  private pianoBus: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private clickNoiseBuffer: AudioBuffer | null = null;

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
  private metronomeVolume = 0.85;
  private metronomeStyle: MetronomeStyle = 'classic';
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

      this.feedbackGain = this.ctx.createGain();
      this.feedbackGain.gain.value = 0.5;
      this.feedbackGain.connect(this.compressor);

      this.metronomeGain = this.ctx.createGain();
      this.metronomeGain.gain.value = this.metronomeVolume * METRONOME_MAX_GAIN;
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
    if (!this.feedbackGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'success' ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(kind === 'success' ? 880 : 196, now);
    if (kind === 'success') {
      osc.frequency.setValueAtTime(1174.66, now + 0.08);
    }
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(this.feedbackGain);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  // --- Synchronized Web Audio Metronome ---

  public configureMetronome(bpm: number, beatsPerMeasure = 4): void {
    this.bpm = Math.max(40, Math.min(200, bpm));
    this.beatsPerMeasure = Math.max(2, Math.min(12, beatsPerMeasure));
  }

  public setMetronomeVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.85));
    this.metronomeVolume = clamped;
    if (this.ctx && this.metronomeGain) {
      this.metronomeGain.gain.setTargetAtTime(
        clamped * METRONOME_MAX_GAIN,
        this.ctx.currentTime,
        0.015
      );
    }
  }

  public setMetronomeStyle(style: MetronomeStyle): void {
    this.metronomeStyle = style;
  }

  public previewMetronomeClick(isDownbeat = true): void {
    if (this.metronomeVolume <= 0) return;
    const ctx = this.ensureContext();
    const trigger = () => {
      if (this.metronomeGain) {
        this.metronomeGain.gain.setValueAtTime(
          this.metronomeVolume * METRONOME_MAX_GAIN,
          ctx.currentTime
        );
      }
      this.scheduleClick(ctx.currentTime + 0.015, isDownbeat);
    };

    if (ctx.state === 'suspended') {
      void ctx.resume().then(trigger);
    } else {
      trigger();
    }
  }

  public startMetronome(onBeat?: (beatInMeasure: number) => void): void {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    if (this.metronomeGain) {
      this.metronomeGain.gain.setValueAtTime(
        this.metronomeVolume * METRONOME_MAX_GAIN,
        ctx.currentTime
      );
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

  private getClickNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.clickNoiseBuffer && this.clickNoiseBuffer.sampleRate === ctx.sampleRate) {
      return this.clickNoiseBuffer;
    }
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.03));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Exponentially decaying white noise burst for crisp percussive stick/pendulum attack
      const env = Math.exp((-6 * i) / length);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    this.clickNoiseBuffer = buffer;
    return buffer;
  }

  private scheduleClick(time: number, isDownbeat: boolean): void {
    if (!this.ctx || !this.metronomeGain || this.metronomeVolume <= 0) return;

    if (this.metronomeStyle === 'woodblock') {
      this.scheduleWoodblockClick(this.ctx, this.metronomeGain, time, isDownbeat);
      return;
    }

    if (this.metronomeStyle === 'mechanical') {
      this.scheduleMechanicalClick(this.ctx, this.metronomeGain, time, isDownbeat);
      return;
    }

    this.scheduleClassicClick(this.ctx, this.metronomeGain, time, isDownbeat);
  }

  private scheduleClassicClick(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    isDownbeat: boolean
  ): void {
    // Punchy digital beep with bright harmonic overtone so it cuts cleanly through grand piano chords
    const osc = ctx.createOscillator();
    const overtone = ctx.createOscillator();
    const gain = ctx.createGain();
    const overtoneGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isDownbeat ? 1568 : 1046.5, time);
    osc.frequency.exponentialRampToValueAtTime(isDownbeat ? 1175 : 784, time + 0.045);

    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(isDownbeat ? 3136 : 2093, time);

    const peak = isDownbeat ? 0.92 : 0.65;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.058);

    overtoneGain.gain.setValueAtTime(0.0001, time);
    overtoneGain.gain.linearRampToValueAtTime(peak * 0.25, time + 0.0015);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.024);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    gain.connect(dest);
    overtoneGain.connect(dest);

    osc.start(time);
    overtone.start(time);
    osc.stop(time + 0.065);
    overtone.stop(time + 0.03);
  }

  private scheduleWoodblockClick(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    isDownbeat: boolean
  ): void {
    // Resonant hollow woodblock: dual tuned cavity partials + bandpass-filtered wooden mallet attack
    const bodyOsc = ctx.createOscillator();
    const cavityOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const cavityGain = ctx.createGain();

    const baseFreq = isDownbeat ? 1020 : 760;
    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(baseFreq * 1.06, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.014);

    cavityOsc.type = 'triangle';
    cavityOsc.frequency.setValueAtTime(baseFreq * 1.54, time);
    cavityOsc.frequency.exponentialRampToValueAtTime(baseFreq * 1.48, time + 0.018);

    const peak = isDownbeat ? 0.98 : 0.72;
    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.linearRampToValueAtTime(peak, time + 0.0015);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.052);

    cavityGain.gain.setValueAtTime(0.0001, time);
    cavityGain.gain.linearRampToValueAtTime(peak * 0.42, time + 0.001);
    cavityGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.028);

    bodyOsc.connect(bodyGain);
    cavityOsc.connect(cavityGain);
    bodyGain.connect(dest);
    cavityGain.connect(dest);

    // Filtered stick-strike noise transient
    const noise = ctx.createBufferSource();
    noise.buffer = this.getClickNoiseBuffer(ctx);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(isDownbeat ? 2600 : 1900, time);
    bandpass.Q.setValueAtTime(2.6, time);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(isDownbeat ? 0.75 : 0.55, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.016);

    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(dest);

    bodyOsc.start(time);
    cavityOsc.start(time);
    noise.start(time);

    bodyOsc.stop(time + 0.06);
    cavityOsc.stop(time + 0.035);
    noise.stop(time + 0.02);
  }

  private scheduleMechanicalClick(
    ctx: AudioContext,
    dest: AudioNode,
    time: number,
    isDownbeat: boolean
  ): void {
    // Classic pyramid metronome pendulum tick with crisp metallic accent on beat 1
    const noise = ctx.createBufferSource();
    noise.buffer = this.getClickNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isDownbeat ? 3400 : 2350, time);
    filter.Q.setValueAtTime(3.2, time);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(isDownbeat ? 1.15 : 0.85, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.022);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(dest);
    noise.start(time);
    noise.stop(time + 0.026);

    // Short wooden housing knock + downbeat bell ping
    const knockOsc = ctx.createOscillator();
    const knockGain = ctx.createGain();
    knockOsc.type = 'square';
    knockOsc.frequency.setValueAtTime(isDownbeat ? 2150 : 1450, time);
    knockOsc.frequency.exponentialRampToValueAtTime(isDownbeat ? 900 : 620, time + 0.012);

    const knockFilter = ctx.createBiquadFilter();
    knockFilter.type = 'bandpass';
    knockFilter.frequency.setValueAtTime(isDownbeat ? 2400 : 1600, time);
    knockFilter.Q.setValueAtTime(2.0, time);

    knockGain.gain.setValueAtTime(0.0001, time);
    knockGain.gain.linearRampToValueAtTime(isDownbeat ? 0.65 : 0.48, time + 0.001);
    knockGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);

    knockOsc.connect(knockFilter);
    knockFilter.connect(knockGain);
    knockGain.connect(dest);
    knockOsc.start(time);
    knockOsc.stop(time + 0.022);

    if (isDownbeat) {
      // Subtle classic Wittner metronome bell ping on beat 1
      const bell = ctx.createOscillator();
      const bellGain = ctx.createGain();
      bell.type = 'sine';
      bell.frequency.setValueAtTime(2637, time);
      bellGain.gain.setValueAtTime(0.0001, time);
      bellGain.gain.linearRampToValueAtTime(0.32, time + 0.002);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.095);
      bell.connect(bellGain);
      bellGain.connect(dest);
      bell.start(time);
      bell.stop(time + 0.1);
    }
  }
}

export const audioEngine = new PianoAudioEngine();
