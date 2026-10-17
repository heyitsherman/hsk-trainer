// Cached pre-generated file first, Web Speech fallback (PRD §9.4).
// One <audio> element is reused for the whole session: iOS unlocks an element (not the page) on a
// user gesture, so the first tap plays a silent clip on it and every later src change is allowed.

let el: HTMLAudioElement | null = null;
let silentUrl: string | null = null;

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

function playFile(url: string): Promise<void> {
  const a = el!;
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      a.onplaying = a.onerror = null;
      if (ok) resolve();
      else reject(new Error(`audio failed: ${url}`));
    };
    a.onplaying = () => done(true);
    a.onerror = () => done(false);
    a.src = url;
    a.play().catch(() => done(false));
  });
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
  stopAudio();
  if (audioFile) {
    el ??= new Audio(); // created inside the calling tap handler, so iOS allows it
    try {
      await playFile(`${import.meta.env.BASE_URL}audio/${audioFile}`);
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  speak(text);
}
