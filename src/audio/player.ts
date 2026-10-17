// Cached pre-generated file first, Web Speech fallback (PRD §9.4).
//
// One <audio> element is reused everywhere: iOS unlocks an element (not the page) on a user gesture,
// so the first tap plays a silent clip on it and later src changes are allowed without a gesture.
//
// Files come from the app's audio cache (see offline.ts) and play from a blob URL. Pointing <audio>
// at a URL a service worker answers makes Safari send Range requests and reject a full 200 reply.

import { loadAudio } from './offline';

let el: HTMLAudioElement | null = null;
let unlocked = false;
let silentUrl: string | null = null;
let blobUrl: string | null = null;
let token = 0; // newest play() wins if taps overlap

function silentWav(): string {
  const samples = 800; // 0.1 s at 8 kHz, 16-bit mono
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Must run synchronously inside a tap/click/key handler. Without it iOS fails silently. */
export function unlockAudio(): void {
  el ??= new Audio();
  silentUrl ??= silentWav();
  el.src = silentUrl;
  el.play().catch(() => {});
  unlocked = true;
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
}

export function stopAudio(): void {
  el?.pause();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function playSrc(src: string): Promise<void> {
  const a = el!;
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      a.onplaying = a.onerror = null;
      if (ok) resolve();
      else reject(new Error('audio element error'));
    };
    a.onplaying = () => done(true);
    a.onerror = () => done(false);
    a.src = src;
    a.play().catch(() => done(false));
  });
}

async function playFile(file: string, mine: number): Promise<void> {
  const res = await loadAudio(file);
  const blob = new Blob([await res.arrayBuffer()], { type: 'audio/ogg' });
  if (mine !== token) return; // superseded by a newer tap
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(blob);
  await playSrc(blobUrl);
}

function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = 0.85;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').startsWith('zh-CN'));
  if (voice) u.voice = voice;
  speechSynthesis.speak(u);
}

/** Plays /audio/{file}; falls back to Web Speech (polyphones may be misread) if missing or unplayable. */
export async function play(audioFile: string | undefined, text: string): Promise<void> {
  // Called from a tap before the first await: unlock here if no session start did it yet (e.g. Curate).
  if (!unlocked) unlockAudio();
  stopAudio();
  const mine = ++token;
  if (audioFile) {
    try {
      await playFile(audioFile, mine);
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  if (mine === token) speak(text);
}
