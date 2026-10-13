"use client";

export type MissionSoundKind = "start" | "verified" | "review" | "failed";

const SOUND_STORAGE_KEY = "patchverdict:sound-enabled";
const SOUND_EVENT = "patchverdict:sound-preference";

let audioContext: AudioContext | null = null;

type Tone = {
  frequency: number;
  offsetMs: number;
  durationMs: number;
  gain: number;
};

const patterns: Record<MissionSoundKind, Tone[]> = {
  start: [
    { frequency: 392, offsetMs: 0, durationMs: 80, gain: 0.018 },
    { frequency: 523.25, offsetMs: 95, durationMs: 110, gain: 0.02 },
  ],
  verified: [
    { frequency: 523.25, offsetMs: 0, durationMs: 100, gain: 0.022 },
    { frequency: 659.25, offsetMs: 105, durationMs: 100, gain: 0.024 },
    { frequency: 783.99, offsetMs: 210, durationMs: 150, gain: 0.026 },
  ],
  review: [
    { frequency: 440, offsetMs: 0, durationMs: 110, gain: 0.02 },
    { frequency: 349.23, offsetMs: 135, durationMs: 160, gain: 0.018 },
  ],
  failed: [
    { frequency: 246.94, offsetMs: 0, durationMs: 120, gain: 0.02 },
    { frequency: 196, offsetMs: 145, durationMs: 180, gain: 0.018 },
  ],
};

function browserWindow() {
  return typeof window === "undefined" ? null : window;
}

function getAudioContext() {
  const currentWindow = browserWindow();
  if (!currentWindow || typeof currentWindow.AudioContext === "undefined") {
    return null;
  }

  audioContext ??= new currentWindow.AudioContext();
  return audioContext;
}

export function isMissionSoundEnabled() {
  const currentWindow = browserWindow();
  if (!currentWindow) return false;

  try {
    return currentWindow.localStorage.getItem(SOUND_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setMissionSoundEnabled(enabled: boolean) {
  const currentWindow = browserWindow();
  if (!currentWindow) return;

  try {
    currentWindow.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // Sound preference persistence is optional.
  }

  currentWindow.dispatchEvent(
    new CustomEvent(SOUND_EVENT, { detail: { enabled } }),
  );
}

export function subscribeMissionSoundPreference(
  listener: (enabled: boolean) => void,
) {
  const currentWindow = browserWindow();
  if (!currentWindow) return () => {};

  const onPreference = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      event.detail &&
      typeof event.detail.enabled === "boolean"
    ) {
      listener(event.detail.enabled);
      return;
    }

    listener(isMissionSoundEnabled());
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_STORAGE_KEY) {
      listener(event.newValue === "true");
    }
  };

  currentWindow.addEventListener(SOUND_EVENT, onPreference);
  currentWindow.addEventListener("storage", onStorage);

  return () => {
    currentWindow.removeEventListener(SOUND_EVENT, onPreference);
    currentWindow.removeEventListener("storage", onStorage);
  };
}

export async function prepareMissionSound() {
  if (!isMissionSoundEnabled()) return;

  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    await context.resume().catch(() => {
      // Browsers can still deny audio; verification must never depend on sound.
    });
  }
}

export async function playMissionSound(kind: MissionSoundKind) {
  if (!isMissionSoundEnabled()) return;

  const context = getAudioContext();
  if (!context) return;

  if (context.state === "suspended") {
    await context.resume().catch(() => {});
  }

  if (context.state !== "running") return;

  const baseTime = context.currentTime + 0.01;

  for (const tone of patterns[kind]) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const start = baseTime + tone.offsetMs / 1000;
    const end = start + tone.durationMs / 1000;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(tone.frequency, start);

    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(tone.gain, start + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

export async function playMissionSoundOnce(
  key: string,
  kind: MissionSoundKind,
) {
  const currentWindow = browserWindow();
  if (!currentWindow || !isMissionSoundEnabled()) return;

  const storageKey = `patchverdict:sound-played:${key}`;

  try {
    if (currentWindow.sessionStorage.getItem(storageKey) === "true") return;
  } catch {
    // If session storage is unavailable, a duplicate tone is preferable to failure.
  }

  await playMissionSound(kind);

  try {
    currentWindow.sessionStorage.setItem(storageKey, "true");
  } catch {
    // Sound is non-critical and must never affect mission state.
  }
}
