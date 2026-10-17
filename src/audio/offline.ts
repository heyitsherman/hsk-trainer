// Offline audio, downloaded by the app rather than the service worker's install step.
//
// Precaching ~1,640 files made the SW install all-or-nothing: one failed request, or iOS stopping a
// long background install, discarded everything and audio never reached the device. Here progress is
// kept file by file, resumes on every launch, and needs no service worker at all (Cache Storage is
// available to the page). Files are content-hashed, so a cached file never goes stale.

import { vocab } from '../data/vocab';

export const AUDIO_CACHE = 'audio-v1';
const CONCURRENCY = 6;

export const audioUrl = (file: string) => `${import.meta.env.BASE_URL}audio/${file}`;

export const ALL_AUDIO = [...new Set(vocab.flatMap((v) => [v.audioFile, ...v.candidateSentences.map((s) => s.audioFile)]))].filter(
  (f): f is string => !!f,
);

export async function cachedAudioCount(): Promise<number> {
  if (!('caches' in window)) return 0;
  const keys = await (await caches.open(AUDIO_CACHE)).keys();
  const wanted = new Set(ALL_AUDIO);
  return keys.filter((r) => wanted.has(r.url.slice(r.url.lastIndexOf('/') + 1))).length;
}

type Listener = (done: number, total: number) => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;
let progress = { done: 0, total: ALL_AUDIO.length };

export function onAudioProgress(fn: Listener): () => void {
  listeners.add(fn);
  fn(progress.done, progress.total);
  return () => listeners.delete(fn);
}

const emit = () => listeners.forEach((fn) => fn(progress.done, progress.total));

/** Fills the audio cache in the background. Safe to call repeatedly; one run at a time. */
export function syncOfflineAudio(): Promise<void> {
  if (!('caches' in window) || !navigator.onLine) return Promise.resolve();
  running ??= (async () => {
    const cache = await caches.open(AUDIO_CACHE);
    const have = new Set((await cache.keys()).map((r) => r.url.slice(r.url.lastIndexOf('/') + 1)));
    const todo = ALL_AUDIO.filter((f) => !have.has(f));
    progress = { done: ALL_AUDIO.length - todo.length, total: ALL_AUDIO.length };
    emit();
    let failures = 0;
    const attempts = new Map<string, number>();
    const worker = async () => {
      for (let f = todo.shift(); f && navigator.onLine; f = todo.shift()) {
        try {
          const res = await fetch(audioUrl(f), { cache: 'no-cache' });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(audioUrl(f), res);
          progress.done++;
          emit();
        } catch (e) {
          const n = (attempts.get(f) ?? 0) + 1;
          attempts.set(f, n);
          if (n < 3) todo.push(f); // flaky mobile networks: retry later in this run
          else if (++failures <= 3) console.warn('audio download failed', f, e);
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (failures) console.warn(`${failures} audio downloads failed; they retry on next launch`);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Cached copy first (works offline without any service worker), network second. */
export async function loadAudio(file: string): Promise<Response> {
  const url = audioUrl(file);
  const hit = 'caches' in window ? await (await caches.open(AUDIO_CACHE)).match(url) : undefined;
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}
