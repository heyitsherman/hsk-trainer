# HSK Trainer

A single-user, offline-first PWA that **is** the daily 15-minute Mandarin session, from zero to the
HSK 3 entry threshold (the ~500 words of the 2025 HSK Level 1–2 syllabus). Built for an iPhone,
installed to the Home Screen.

- **Review**: FSRS-scheduled cards, hard cap of 60 a day, audio on every card.
- **Curate**: each week's words are activated by hand, with an example sentence you pick or write.
- **Schedule**: the 12-week course modules with tasks, assignments and notes.
- **Settings**: JSON backup and restore, a Markdown export for Obsidian, and the new-card limit.

Spec: [docs/PRD_HSK-Trainer.md](docs/PRD_HSK-Trainer.md). Working rules for coding agents: [CLAUDE.md](CLAUDE.md).

> **Audio note.** The audio is synthesised with Kokoro TTS. It is good enough for recognition drills,
> and readings follow the syllabus pinyin, so polyphones are right. It is **not** a model for
> pronunciation. Learn pronunciation from the human audio in the linked course resources and from a
> tutor.

## Using it on an iPhone

Live at **https://heyitsherman.github.io/hsk-trainer/**, rebuilt on every push to `main`. Open it in Safari, tap **Share → Add to Home Screen**, and always launch from the icon. In a
Safari tab, iOS deletes the app's data after 7 days without a visit. The app shows a reminder in a
tab until you install it. Export a backup from Settings now and then; it is the only guarantee that
doesn't depend on Apple's storage policy.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

Node 24+. The tools in `tools/*.ts` run directly with Node's built-in type stripping.

### Rebuilding the vocabulary (`src/data/vocab.json`)

The output is committed, so you only need this to change the data. Download the sources into
`.sources/` (gitignored):

| Path | URL |
|---|---|
| `.sources/cedict/cedict_ts.u8` | https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz (gunzip) |
| `.sources/tatoeba/cmn_sentences.tsv` | https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2 |
| `.sources/tatoeba/eng_sentences.tsv` | https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2 |
| `.sources/tatoeba/cmn-eng_links.tsv` | https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2 |
| `.sources/tatoeba-tr/transcriptions.csv` | https://downloads.tatoeba.org/exports/transcriptions.tar.bz2 |
| `.sources/wiktionary/kaikki-chinese.jsonl` | https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl (1.2 GB; filtered once into a small cache) |

```bash
node tools/build-vocab.ts --report docs/vocab-review.md
```

This writes `src/data/vocab.json`, `tools/data/audio-manifest.json` and the review report. Inputs it
reads from the repo:

- `tools/data/hsk-2025-l1-l2.tsv`: the syllabus list (500 entries, verified against the CLEC PDF)
- `tools/data/week-anchors.tsv`: course-page theme words, read as "taught by week N"
- `tools/data/sense-overrides.tsv`: manual choice of which CC-CEDICT/Wiktionary senses to show (selection only)

### Generating audio (`public/audio/`)

This runs locally on a GPU (about 1.5 GB of VRAM). It is idempotent and skips files that already exist.

```bash
python -m venv .venv
```

```bash
.venv\Scripts\pip install -r tools/requirements-audio.txt
```

```bash
.venv\Scripts\pip install torch --index-url https://download.pytorch.org/whl/cu124
```

```bash
.venv\Scripts\python tools/generate-audio.py --limit 20
```

Listen to the trial files, then run the script without `--limit`. At the end it lists polyphones to
spot-check, plus any sentences that fell back to Kokoro's own reading. Commit `public/audio/`.

## Where the build departs from the PRD, and why

| PRD | Built | Why |
|---|---|---|
| §7.2 join HSK list to CC-CEDICT on simplified form | Join on (simplified, syllabus pinyin) | Joining on the character alone picks an arbitrary reading, e.g. 只 *zhǐ* where the L1 word is the measure word *zhī* |
| §7.2 definitions from CC-CEDICT | Wiktionary for multi-character words; CC-CEDICT ranked by part of speech for single characters; manual sense selection | CC-CEDICT's sense order put "grain that has begun to ripen" first for 只 and dropped "o'clock" for 点 |
| §3.2 pinyin-pro for conversion | No pinyin library; sentence pinyin comes from Tatoeba's own transcriptions | pinyin-pro misread 得 in every test (做得好 → *dé*) |
| §6 `Date` fields | Epoch milliseconds in IndexedDB; converted only inside `scheduler.ts` | Avoids Dexie/structured-clone `Date` pitfalls and keeps backups JSON-clean |
| §6 Card fields | Adds `learning_steps` | Required by ts-fsrs 5.4.2 |
| §9.3 new cards | Recognition cards (newly activated words) take the new-card budget first; ladder-spawned cards use what's left | Without this, a simulation reached only ~340 of 500 words by week 12 |
| §7.3 audio for "each chosen sentence" | Audio for every candidate sentence; user-written sentences use Web Speech | Sentences are chosen in the app after the audio is built |
| §9.1 ladder: independent thresholds (audio S≥14, production S≥30) | Chained: audio ← recognition S≥14; production ← recognition S≥30 **and** audio S≥14; cloze ← production S≥14 and a sentence | With default FSRS weights a known card jumps from S≈11 to ≈46 in one review, so independent thresholds would unlock all types on the same day |
| §3.1 Cloudflare Pages | GitHub Pages for now (`BASE_PATH=/hsk-trainer/`); Cloudflare later from the same repo with base `/` | No Cloudflare account yet; sync (task 14) waits for it |
| §13.2 handwriting task removed | Removed. Week 2's "stroke order as a rule set" is kept as character-structure knowledge | Handwriting stays out of scope (owner's decision, 2026-10-17), even though the new HSK 2 paper does test it |

## Recalibration (PRD §16)

To be filled in at day 21 (around 9 Nov 2026). Settings shows actual reviews per day and the median
seconds per card. If projected load is above 1.5 h a week, lower `newCardsPerDay`; don't change the
cap or the ladder.

## Credits and licenses

Code: MIT ([LICENSE](LICENSE)). Dictionary- and sentence-derived data: CC BY-SA 4.0 ([LICENSE-DATA](LICENSE-DATA)).
Sources: the CLEC HSK syllabus (2025), CC-CEDICT, Wiktionary, Tatoeba, Kokoro TTS and FSRS. Details in
[ATTRIBUTION.md](ATTRIBUTION.md).
