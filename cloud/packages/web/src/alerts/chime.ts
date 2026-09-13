import { useEffect } from 'react';

/** The v3 reminder tone: an 880 Hz sine that fades over 0.8 s. Browsers may block audio until the page is interacted with. */
export function playChime(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.8);
    oscillator.start(context.currentTime);
    oscillator.stop(context.currentTime + 0.8);
    oscillator.onended = () => { void context.close(); };
  } catch {
    // Audio is a courtesy; the banner itself is the reminder.
  }
}

function readAlerted(storageKey: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Chimes once per id per browser session, like v3's sessionStorage "alerted" sets, so navigation never repeats the tone. */
export function useChimeForNewIds(ids: readonly string[], storageKey: string, chime: () => void = playChime): void {
  const key = ids.join('|');
  useEffect(() => {
    if (!key) return;
    const alerted = readAlerted(storageKey);
    const fresh = key.split('|').filter((id) => !alerted.has(id));
    if (!fresh.length) return;
    for (const id of fresh) alerted.add(id);
    try { sessionStorage.setItem(storageKey, JSON.stringify([...alerted])); } catch { /* optional */ }
    chime();
  }, [chime, key, storageKey]);
}
