import fs from 'fs';
import path from 'path';

interface PhonkLoopSpec {
  filename: string;
  bpm: number;
  durationSec: number;
  rootHz: number;
  cowbellPattern: number[];
  bassPattern: number[];
}

const DEMO_SPECS: PhonkLoopSpec[] = [
  {
    filename: 'tokyo_drift_808.wav',
    bpm: 136,
    durationSec: 48,
    rootHz: 46.25, // F#1 deep sub
    cowbellPattern: [0, 3, 7, 10, 12, 10, 7, 3],
    bassPattern: [0, 0, 0, 3, 0, 0, -2, 3],
  },
  {
    filename: 'touge_emerald_cowbell.wav',
    bpm: 142,
    durationSec: 52,
    rootHz: 41.2, // E1
    cowbellPattern: [0, 2, 5, 7, 10, 7, 5, 2],
    bassPattern: [0, 0, 5, 5, 3, 3, 2, 0],
  },
  {
    filename: 'sodium_midnight_phonk.wav',
    bpm: 128,
    durationSec: 56,
    rootHz: 49.0, // G1
    cowbellPattern: [0, 4, 7, 11, 12, 11, 7, 4],
    bassPattern: [0, 0, -3, -3, 2, 2, 0, 5],
  },
];

function writeWavFile(filePath: string, samples: Float32Array, sampleRate: number): void {
  const numChannels = 2;
  const bitsPerSample = 16;
  const numFrames = samples.length / numChannels;
  const dataByteLength = numFrames * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataByteLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), offset);
    offset += 2;
  }

  fs.writeFileSync(filePath, buffer);
}

function synthesizePhonkBeat(spec: PhonkLoopSpec, sampleRate = 44100): Float32Array {
  const totalFrames = Math.floor(spec.durationSec * sampleRate);
  const stereo = new Float32Array(totalFrames * 2);

  const stepSec = 60 / spec.bpm / 4; // 16th note step
  const stepFrames = Math.floor(stepSec * sampleRate);
  const twoPi = Math.PI * 2;

  // Deterministic pseudo-random for hi-hat & snare noise
  let seed = 1337 + Math.round(spec.rootHz * 10);
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalFrames; i++) {
    const t = i / sampleRate;
    const stepIndex = Math.floor(i / stepFrames);
    const stepLocalT = (i % stepFrames) / sampleRate;
    const barStep = stepIndex % 16;
    const phraseIdx = Math.floor(stepIndex / 16) % spec.bassPattern.length;

    // 1. Punchy 808 Kick + Saturated Sub Bass
    const hasKick = barStep === 0 || barStep === 6 || barStep === 10;
    let kickEnv = 0;
    if (hasKick) {
      kickEnv = Math.exp(-stepLocalT * 14);
    }
    const kickPitch = 45 + 115 * Math.exp(-stepLocalT * 38);
    const kickSample = hasKick ? Math.sin(twoPi * kickPitch * stepLocalT) * kickEnv * 0.72 : 0;

    // Continuous saturated 808 sub bassline
    const bassSemitone = spec.bassPattern[phraseIdx];
    const bassFreq = spec.rootHz * Math.pow(2, bassSemitone / 12);
    const bassGate = barStep % 4 === 3 ? 0.5 : 0.9;
    const rawBass = Math.sin(twoPi * bassFreq * t) + 0.35 * Math.sin(twoPi * bassFreq * 2 * t);
    const bassSample = Math.tanh(rawBass * 1.8) * 0.42 * bassGate;

    // 2. Memphis 808 Cowbell Lead (dual detuned square-ish partials)
    const cowNoteIdx = (stepIndex + Math.floor(stepIndex / 8)) % spec.cowbellPattern.length;
    const playCowbell = barStep % 2 === 0 || barStep === 11 || barStep === 15;
    let cowbell = 0;
    if (playCowbell) {
      const semi = spec.cowbellPattern[cowNoteIdx];
      const baseFreq = 540 * Math.pow(2, semi / 12);
      const env = Math.exp(-stepLocalT * 18);
      const p1 = Math.sign(Math.sin(twoPi * baseFreq * stepLocalT));
      const p2 = Math.sign(Math.sin(twoPi * (baseFreq * 1.48) * stepLocalT));
      cowbell = (p1 * 0.55 + p2 * 0.45) * env * 0.22;
    }

    // 3. Snare / Clap on beats 2 & 4 (step 4 and 12)
    let snare = 0;
    if (barStep === 4 || barStep === 12) {
      const sEnv = Math.exp(-stepLocalT * 24);
      const body = Math.sin(twoPi * 185 * stepLocalT) * Math.exp(-stepLocalT * 35);
      snare = (nextRand() * 0.65 + body * 0.45) * sEnv * 0.42;
    }

    // 4. Crisp 16th Hi-Hats with subtle roll
    const hatEnv = Math.exp(-stepLocalT * (barStep % 4 === 2 ? 45 : 70));
    const hat = nextRand() * hatEnv * (barStep % 2 === 0 ? 0.14 : 0.08);

    // Subtle stereo spread on cowbell & hats
    const monoCore = kickSample + bassSample + snare;
    const left = Math.tanh((monoCore + cowbell * 0.92 + hat * 1.1) * 1.15) * 0.85;
    const right = Math.tanh((monoCore + cowbell * 1.08 + hat * 0.9) * 1.15) * 0.85;

    // Smooth fade-in/fade-out at loop boundary (50ms) so infinite loop never clicks
    let loopFade = 1;
    const fadeFrames = Math.floor(sampleRate * 0.05);
    if (i < fadeFrames) loopFade = i / fadeFrames;
    else if (i > totalFrames - fadeFrames) loopFade = (totalFrames - i) / fadeFrames;

    stereo[i * 2] = left * loopFade;
    stereo[i * 2 + 1] = right * loopFade;
  }

  return stereo;
}

export function ensureDemoAudioFiles(demoDir: string): string[] {
  fs.mkdirSync(demoDir, { recursive: true });
  const paths: string[] = [];

  for (const spec of DEMO_SPECS) {
    const outPath = path.join(demoDir, spec.filename);
    if (!fs.existsSync(outPath)) {
      const samples = synthesizePhonkBeat(spec, 22050);
      writeWavFile(outPath, samples, 22050);
    }
    paths.push(outPath);
  }

  return paths;
}
