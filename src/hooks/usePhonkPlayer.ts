import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNextLoopIndex,
  getPreviousLoopIndex,
  type AudioFxSettings,
  type PhonkTrack,
} from '../lib/phonkLogic';

function createHallImpulse(ctx: AudioContext, durationSec = 2.2, decay = 2.6): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const channelData = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      channelData[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return impulse;
}

export function usePhonkPlayer(tracks: PhonkTrack[], fx: AudioFxSettings) {
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [bassEnergy, setBassEnergy] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(new ArrayBuffer(64)));

  const resolvedIndex =
    tracks.length === 0
      ? -1
      : activeTrackId
        ? Math.max(0, tracks.findIndex((t) => t.id === activeTrackId))
        : 0;
  const currentIndex = resolvedIndex < 0 ? 0 : resolvedIndex;

  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  // Keep activeTrackId synced when tracks load or active track is removed
  useEffect(() => {
    if (tracks.length === 0) {
      setActiveTrackId(null);
      setIsPlaying(false);
      setElapsedSec(0);
      setDurationSec(0);
      return;
    }
    if (!activeTrackId || !tracks.some((t) => t.id === activeTrackId)) {
      setActiveTrackId(tracks[0].id);
    }
  }, [tracks, activeTrackId]);

  const currentTrack = tracks[currentIndex] ?? null;
  const nextIndex = getNextLoopIndex(currentIndex, tracks.length, shuffle);
  const nextTrack = nextIndex >= 0 ? tracks[nextIndex] ?? null : null;

  const ensureAudioGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(audio);

      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 78;
      bassFilter.gain.value = fx.bassBoostDb;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 18;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.005;
      compressor.release.value = 0.2;

      const convolver = ctx.createConvolver();
      convolver.buffer = createHallImpulse(ctx);

      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const masterGain = ctx.createGain();
      masterGain.gain.value = fx.volume;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.78;
      freqDataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      const mediaDest = ctx.createMediaStreamDestination();

      source.connect(bassFilter);
      bassFilter.connect(compressor);

      // Dry path
      compressor.connect(dryGain);
      dryGain.connect(masterGain);

      // Wet reverb path
      compressor.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(masterGain);

      masterGain.connect(analyser);
      analyser.connect(ctx.destination);
      masterGain.connect(mediaDest);

      ctxRef.current = ctx;
      sourceRef.current = source;
      bassFilterRef.current = bassFilter;
      dryGainRef.current = dryGain;
      wetGainRef.current = wetGain;
      masterGainRef.current = masterGain;
      analyserRef.current = analyser;
      mediaDestRef.current = mediaDest;
    }

    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
  }, [fx.bassBoostDb, fx.volume]);

  // Apply real-time Phonk FX parameters
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = fx.slowedReverb ? 0.85 : 1.0;
      // Preserve vinyl/tape pitch shift on slowed mode!
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = !fx.slowedReverb;
    }
    if (bassFilterRef.current) {
      bassFilterRef.current.gain.value = fx.bassBoostDb;
    }
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = fx.volume;
    }
    if (dryGainRef.current && wetGainRef.current) {
      const wet = fx.slowedReverb ? fx.reverbMix : 0;
      wetGainRef.current.gain.value = wet;
      dryGainRef.current.gain.value = 1 - wet * 0.35;
    }
  }, [fx]);

  // Create persistent audio element once
  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'metadata';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setElapsedSec(audio.currentTime || 0);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationSec(audio.duration);
      }
    };

    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDurationSec(audio.duration);
      }
    };

    const onEnded = () => {
      const list = tracksRef.current;
      if (list.length === 0) return;
      const nextIdx = getNextLoopIndex(currentIndexRef.current, list.length, shuffleRef.current);
      if (nextIdx === currentIndexRef.current) {
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
      } else if (list[nextIdx]) {
        setActiveTrackId(list[nextIdx].id);
        setElapsedSec(0);
      }
    };

    const onError = () => {
      setAudioError('Unable to decode audio track.');
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => undefined);
      }
    };
  }, []);

  // Load track URL when currentTrack changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setAudioError(null);

    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setElapsedSec(0);
      setDurationSec(0);
      return;
    }

    audio.src = currentTrack.audioUrl;
    audio.playbackRate = fx.slowedReverb ? 0.85 : 1.0;
    setElapsedSec(0);
    setDurationSec(currentTrack.durationSec || 0);

    if (isPlayingRef.current) {
      ensureAudioGraph();
      void audio.play().catch(() => {
        setIsPlaying(false);
      });
    }
  }, [currentTrack?.id, currentTrack?.audioUrl]);

  // Sample bass energy smoothly for reactive glass glow
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (analyserRef.current && isPlayingRef.current) {
        analyserRef.current.getByteFrequencyData(freqDataRef.current);
        let bassSum = 0;
        for (let i = 0; i < 6; i++) {
          bassSum += freqDataRef.current[i] || 0;
        }
        setBassEnergy(bassSum / (6 * 255));
      } else {
        setBassEnergy((prev) => (prev > 0.01 ? prev * 0.85 : 0));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    ensureAudioGraph();

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
        setAudioError(null);
      } catch {
        setAudioError('Playback blocked by browser autoplay policy. Click Play again.');
        setIsPlaying(false);
      }
    }
  }, [currentTrack, ensureAudioGraph, isPlaying]);

  const playTrackAt = useCallback(
    async (index: number) => {
      if (index < 0 || index >= tracks.length) return;
      ensureAudioGraph();
      const target = tracks[index];
      setIsPlaying(true);
      isPlayingRef.current = true;
      if (target.id === activeTrackId) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          await audio.play().catch(() => undefined);
        }
      } else {
        setActiveTrackId(target.id);
      }
    },
    [activeTrackId, ensureAudioGraph, tracks]
  );

  const next = useCallback(() => {
    if (tracks.length === 0) return;
    const targetIdx = getNextLoopIndex(currentIndex, tracks.length, shuffle);
    if (targetIdx === currentIndex && audioRef.current) {
      audioRef.current.currentTime = 0;
    } else if (tracks[targetIdx]) {
      setActiveTrackId(tracks[targetIdx].id);
    }
    setElapsedSec(0);
  }, [currentIndex, shuffle, tracks]);

  const previous = useCallback(() => {
    if (tracks.length === 0) return;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 4) {
      audio.currentTime = 0;
      setElapsedSec(0);
      return;
    }
    const targetIdx = getPreviousLoopIndex(currentIndex, tracks.length);
    if (tracks[targetIdx]) {
      setActiveTrackId(tracks[targetIdx].id);
    }
    setElapsedSec(0);
  }, [currentIndex, tracks]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds));
    audio.currentTime = clamped;
    setElapsedSec(clamped);
  }, []);

  const getFrequencyData = useCallback((): Uint8Array => {
    if (analyserRef.current && isPlayingRef.current) {
      analyserRef.current.getByteFrequencyData(freqDataRef.current);
      return freqDataRef.current;
    }
    return freqDataRef.current;
  }, []);

  const getRelayAudioStream = useCallback((): MediaStream | null => {
    ensureAudioGraph();
    return mediaDestRef.current ? mediaDestRef.current.stream : null;
  }, [ensureAudioGraph]);

  return {
    currentIndex,
    currentTrack,
    nextTrack,
    isPlaying,
    shuffle,
    setShuffle,
    elapsedSec,
    durationSec: durationSec || currentTrack?.durationSec || 0,
    bassEnergy,
    audioError,
    togglePlay,
    playTrackAt,
    next,
    previous,
    seekTo,
    getFrequencyData,
    getRelayAudioStream,
  };
}
