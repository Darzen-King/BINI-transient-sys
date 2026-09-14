import { useEffect } from 'react';

type AudioContextConstructor = typeof AudioContext;
let sharedContext: AudioContext | null = null;

function audioContextClass(): AudioContextConstructor | undefined {
  return typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
}

/**
 * Mobile browsers keep audio suspended until the page receives a tap or key press. One shared context is created
 * and resumed on the first interaction, so a reminder that arrives later can actually be heard.
 */
export function enableChimeOnFirstInteraction(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const unlock = () => {
    const AudioContextClass = audioContextClass();
    if (!AudioContextClass) return;
    try {
      sharedContext ??= new AudioContextClass();
      void sharedContext.resume().catch(() => undefined);
    } catch { /* audio unavailable */ }
    remove();
  };
  const remove = () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  return remove;
}

/** The v3 reminder tone: an 880 Hz sine that fades over 0.8 s. */
export function playChime(): void {
  try {
    const AudioContextClass = audioContextClass();
    if (!AudioContextClass) return;
    sharedContext ??= new AudioContextClass();
    const context = sharedContext;
    const play = () => {
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
    };
    if (context.state === 'suspended') void context.resume().then(play).catch(() => undefined);
    else play();
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
