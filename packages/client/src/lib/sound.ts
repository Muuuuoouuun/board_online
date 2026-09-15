// Lightweight synthesized sound effects for board games.
// Zero audio assets: everything is generated at runtime with the Web Audio API.

export type SoundName =
  | "place" // a stone lands (gomoku, reversi)
  | "move" // a piece slides to a new square (chess, janggi, checkers)
  | "capture" // a piece is taken
  | "flip" // reversi discs flipping
  | "win"
  | "lose"
  | "draw"
  | "click"; // UI buttons

const MUTE_KEY = "boardonline:muted";

let ctx: AudioContext | undefined;
let ctxFailed = false;

function getContext(): AudioContext | undefined {
  if (ctxFailed) return undefined;
  if (ctx) return ctx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      ctxFailed = true;
      return undefined;
    }
    ctx = new Ctor();
    return ctx;
  } catch {
    ctxFailed = true;
    return undefined;
  }
}

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // ignore (private browsing / storage disabled)
  }
}

// A short buffer of white noise, cached and reused across calls.
let noiseBuffer: AudioBuffer | undefined;
function getNoiseBuffer(context: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === context.sampleRate) return noiseBuffer;
  const duration = 0.5;
  const length = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

/** A short filtered noise burst, e.g. for a wooden "tok" or a shuffle tick. */
function noiseBurst(
  context: AudioContext,
  dest: AudioNode,
  {
    start,
    duration,
    peakGain,
    filterType,
    filterFreq,
    filterQ = 1,
  }: {
    start: number;
    duration: number;
    peakGain: number;
    filterType: BiquadFilterType;
    filterFreq: number;
    filterQ?: number;
  }
): void {
  const src = context.createBufferSource();
  src.buffer = getNoiseBuffer(context);

  const filter = context.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  filter.Q.value = filterQ;

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.gain.setValueAtTime(0, start + duration + 0.01);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  src.start(start);
  src.stop(start + duration + 0.02);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

/** A short decaying sine/triangle "thud". */
function tone(
  context: AudioContext,
  dest: AudioNode,
  {
    start,
    duration,
    peakGain,
    freqStart,
    freqEnd = freqStart,
    type = "sine",
  }: {
    start: number;
    duration: number;
    peakGain: number;
    freqStart: number;
    freqEnd?: number;
    type?: OscillatorType;
  }
): void {
  const osc = context.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, start);
  if (freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + duration);
  }

  const gain = context.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peakGain, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  gain.gain.setValueAtTime(0, start + duration + 0.01);

  osc.connect(gain);
  gain.connect(dest);

  osc.start(start);
  osc.stop(start + duration + 0.02);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function playPlace(context: AudioContext, dest: AudioNode, t: number): void {
  // Wooden "tok": fast filtered noise crack + a low sine thud.
  noiseBurst(context, dest, { start: t, duration: 0.05, peakGain: 0.22, filterType: "bandpass", filterFreq: 2200, filterQ: 1.2 });
  tone(context, dest, { start: t, duration: 0.09, peakGain: 0.25, freqStart: 180, freqEnd: 90, type: "sine" });
}

function playMove(context: AudioContext, dest: AudioNode, t: number): void {
  // Softer, duller thud than place — lower peak, longer, more low-pass.
  noiseBurst(context, dest, { start: t, duration: 0.06, peakGain: 0.1, filterType: "lowpass", filterFreq: 900, filterQ: 0.7 });
  tone(context, dest, { start: t, duration: 0.12, peakGain: 0.16, freqStart: 130, freqEnd: 75, type: "sine" });
}

function playCapture(context: AudioContext, dest: AudioNode, t: number): void {
  // move + a brighter, slightly dirtier transient on top.
  playMove(context, dest, t);
  noiseBurst(context, dest, { start: t + 0.02, duration: 0.07, peakGain: 0.18, filterType: "bandpass", filterFreq: 3200, filterQ: 0.9 });
  tone(context, dest, { start: t + 0.02, duration: 0.08, peakGain: 0.14, freqStart: 520, freqEnd: 260, type: "sawtooth" });
}

function playFlip(context: AudioContext, dest: AudioNode, t: number): void {
  // A couple of very short noise ticks in quick sequence.
  noiseBurst(context, dest, { start: t, duration: 0.03, peakGain: 0.14, filterType: "highpass", filterFreq: 3500, filterQ: 0.8 });
  noiseBurst(context, dest, { start: t + 0.055, duration: 0.03, peakGain: 0.12, filterType: "highpass", filterFreq: 4200, filterQ: 0.8 });
  noiseBurst(context, dest, { start: t + 0.11, duration: 0.03, peakGain: 0.09, filterType: "highpass", filterFreq: 4800, filterQ: 0.8 });
}

function playArpeggio(
  context: AudioContext,
  dest: AudioNode,
  t: number,
  freqs: number[],
  { step, noteDuration, peakGain, type }: { step: number; noteDuration: number; peakGain: number; type: OscillatorType }
): void {
  freqs.forEach((f, i) => {
    tone(context, dest, { start: t + i * step, duration: noteDuration, peakGain, freqStart: f, type });
  });
}

function playWin(context: AudioContext, dest: AudioNode, t: number): void {
  // Pleasant rising major triad (e.g. C5-E5-G5-C6).
  playArpeggio(context, dest, t, [523.25, 659.25, 783.99, 1046.5], {
    step: 0.11,
    noteDuration: 0.3,
    peakGain: 0.2,
    type: "triangle",
  });
}

function playLose(context: AudioContext, dest: AudioNode, t: number): void {
  // Descending, minor, softer (e.g. A4-F4-D4).
  playArpeggio(context, dest, t, [440, 349.23, 293.66], {
    step: 0.14,
    noteDuration: 0.4,
    peakGain: 0.15,
    type: "sine",
  });
}

function playDraw(context: AudioContext, dest: AudioNode, t: number): void {
  // Two neutral tones, same pitch, gentle.
  tone(context, dest, { start: t, duration: 0.22, peakGain: 0.16, freqStart: 392, type: "triangle" });
  tone(context, dest, { start: t + 0.2, duration: 0.22, peakGain: 0.16, freqStart: 392, type: "triangle" });
}

function playClick(context: AudioContext, dest: AudioNode, t: number): void {
  // A tiny, very quiet UI tick.
  tone(context, dest, { start: t, duration: 0.03, peakGain: 0.06, freqStart: 1200, type: "square" });
}

export function playSound(name: SoundName): void {
  if (isMuted()) return;

  const context = getContext();
  if (!context) return;

  try {
    if (context.state === "suspended") {
      // Fire-and-forget: if this rejects (e.g. no user gesture yet), we still
      // attempt to schedule the sound, which will simply be silent.
      void context.resume().catch(() => {});
    }

    const dest = context.destination;
    const t = context.currentTime;

    switch (name) {
      case "place":
        playPlace(context, dest, t);
        break;
      case "move":
        playMove(context, dest, t);
        break;
      case "capture":
        playCapture(context, dest, t);
        break;
      case "flip":
        playFlip(context, dest, t);
        break;
      case "win":
        playWin(context, dest, t);
        break;
      case "lose":
        playLose(context, dest, t);
        break;
      case "draw":
        playDraw(context, dest, t);
        break;
      case "click":
        playClick(context, dest, t);
        break;
    }
  } catch {
    // Never throw from playSound — sound is a nice-to-have.
  }
}
