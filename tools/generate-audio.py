"""Kokoro TTS → public/audio/{sha1}.opus for every word and candidate sentence (PRD §7.3).

Input: tools/data/audio-manifest.json (written by `node tools/build-vocab.ts`).
Each item carries the reading to speak (`pinyinNumbered`, e.g. "zhang3 de5"). Kokoro's own G2P would
guess polyphones from bare characters (长 → cháng); here the frontend's pypinyin lookup is replaced
with our readings, so the pinyin field drives the audio. Kokoro still applies its third-tone sandhi
and erhua merging, which is what a speaker does.

Setup (once, in a venv; CUDA build of torch for the RTX 3070):
    pip install -r tools/requirements-audio.txt
    pip install torch --index-url https://download.pytorch.org/whl/cu124

Run from the repo root:
    python tools/generate-audio.py                 # everything missing
    python tools/generate-audio.py --limit 20      # quick trial
    python tools/generate-audio.py --voice zm_010  # different voice (zf_001…, zm_009…)

Idempotent: existing files are skipped. Delete public/audio/*.opus to regenerate.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from pypinyin import Style
from pypinyin.contrib.tone_convert import to_finals_tone3, to_initials, to_tone

REPO = 'hexgrad/Kokoro-82M-v1.1-zh'
SAMPLE_RATE = 24_000
ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / 'tools' / 'data' / 'audio-manifest.json'
OUT_DIR = ROOT / 'public' / 'audio'

# Polyphones to listen to after a run (PRD §14 task 4 acceptance).
SPOT_CHECK = ['长', '得', '觉得', '睡觉', '只', '还', '东西', '了', '地', '一下']


class ReadingInjector:
    """Stands in for pypinyin.lazy_pinyin inside misaki.zh_frontend.

    The frontend segments text with jieba and asks for INITIALS then FINALS_TONE3 per word, in order.
    We answer from our syllable queue instead of pypinyin's dictionary guess.
    """

    def __init__(self, original):
        self.original = original
        self.syllables: list[str] | None = None
        self.pos = 0
        self.failed = False

    def load(self, pinyin_numbered: str | None):
        self.syllables = None if pinyin_numbered is None else [self._normalise(s) for s in pinyin_numbered.split()]
        self.pos = 0
        self.failed = False

    @staticmethod
    def _normalise(syl: str) -> str:
        syl = syl.lower().replace('v', 'ü')
        return 'er5' if syl == 'r5' else syl  # erhua 儿; the frontend merges it into the previous syllable

    def __call__(self, word, style=None, **kwargs):
        if self.syllables is None:
            return self.original(word, style=style, **kwargs)
        n = len(word)
        chunk = self.syllables[self.pos:self.pos + n]
        if len(chunk) != n:
            self.failed = True
            return self.original(word, style=style, **kwargs)
        marked = [to_tone(s) for s in chunk]
        if style == Style.INITIALS:
            return [to_initials(s) for s in marked]
        self.pos += n  # FINALS_TONE3 is the second of the two calls per word
        return [to_finals_tone3(s, neutral_tone_with_five=True) for s in marked]

    @property
    def complete(self) -> bool:
        return self.syllables is not None and not self.failed and self.pos == len(self.syllables)


def encode(audio: np.ndarray, path: Path, compression: float):
    # Trim leading/trailing near-silence and peak-normalise to -1 dBFS.
    idx = np.flatnonzero(np.abs(audio) > 0.01)
    if idx.size:
        pad = int(0.05 * SAMPLE_RATE)
        audio = audio[max(idx[0] - pad, 0):idx[-1] + pad]
    peak = np.max(np.abs(audio)) or 1.0
    audio = (audio / peak * 0.89).astype(np.float32)
    tmp = path.with_suffix('.tmp')
    sf.write(tmp, audio, SAMPLE_RATE, format='OGG', subtype='OPUS', compression_level=compression)
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--voice', default='zf_001')
    ap.add_argument('--speed', type=float, default=0.9, help='slightly slow for learners')
    # libsndfile maps level 0..1 roughly linearly onto ~256..6 kbps; 0.93 ≈ 24 kbps (PRD §7.3, ~8 MB total).
    ap.add_argument('--compression', type=float, default=0.93, help='libsndfile Opus compression level 0..1')
    ap.add_argument('--limit', type=int, default=0, help='generate at most N missing files')
    ap.add_argument('--device', default=None, help="'cuda' or 'cpu' (default: auto)")
    args = ap.parse_args()

    if 'OPUS' not in sf.available_subtypes('OGG'):
        sys.exit('This libsndfile build has no Ogg/Opus support; upgrade soundfile (needs libsndfile >= 1.2).')

    import misaki.zh_frontend as zh_frontend
    from kokoro import KModel, KPipeline

    injector = ReadingInjector(zh_frontend.lazy_pinyin)
    zh_frontend.lazy_pinyin = injector

    items = json.loads(MANIFEST.read_text(encoding='utf-8'))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    missing = [it for it in items if not (OUT_DIR / it['file']).exists()]
    todo = missing[:args.limit] if args.limit else missing
    print(f'{len(items)} in manifest, {len(items) - len(missing)} already present, generating {len(todo)}')
    if not todo:
        return

    model = KModel(repo_id=REPO)
    model = model.to(args.device or ('cuda' if __import__('torch').cuda.is_available() else 'cpu')).eval()
    pipeline = KPipeline(lang_code='z', repo_id=REPO, model=model, en_callable=lambda _: '')

    fallbacks: list[str] = []
    started = time.time()
    for n, it in enumerate(todo, 1):
        injector.load(it['pinyinNumbered'])
        phonemes, _ = pipeline.g2p(it['text'])
        if not injector.complete:
            # Syllable count drifted (e.g. digits expanded to 三点半). Fall back to Kokoro's own reading.
            fallbacks.append(f"{it['file']}  {it['text']}  [{it['pinyinNumbered']}]")
            injector.load(None)
            phonemes, _ = pipeline.g2p(it['text'])
        chunks = [r.audio.cpu().numpy() for r in pipeline.generate_from_tokens(phonemes, voice=args.voice, speed=args.speed) if r.audio is not None]
        if not chunks:
            print(f'  no audio for {it["text"]}', file=sys.stderr)
            continue
        encode(np.concatenate(chunks), OUT_DIR / it['file'], args.compression)
        if n % 100 == 0 or n == len(todo):
            print(f'  {n}/{len(todo)}  ({time.time() - started:.0f}s)')

    total = sum(p.stat().st_size for p in OUT_DIR.glob('*.opus'))
    print(f'\npublic/audio: {len(list(OUT_DIR.glob("*.opus")))} files, {total / 1e6:.1f} MB')
    if fallbacks:
        print(f'\n{len(fallbacks)} item(s) used Kokoro\'s own reading (listen to these):')
        print('\n'.join('  ' + f for f in fallbacks))
    words = {it['text']: it for it in items if it['kind'] == 'word'}
    print('\nSpot-check these polyphones (task 4):')
    for w in SPOT_CHECK:
        if w in words:
            print(f"  {w:4} {words[w]['pinyinNumbered']:16} public/audio/{words[w]['file']}")


if __name__ == '__main__':
    main()
