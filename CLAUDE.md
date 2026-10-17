# HSK Trainer: instructions for Claude

Single-user, offline-first PWA that **is** the daily 15-minute Mandarin session (zero → HSK 3 entry,
~500 words). Spec: [docs/PRD_HSK-Trainer.md](docs/PRD_HSK-Trainer.md). The PRD wins on scope;
decisions below record where the build deliberately departs from it.

Primary device: **iPhone 16 Pro, Safari, installed to home screen.** Every UX call resolves for it.

## Non-negotiables (PRD §2.1)

1. Learning starts Monday 20 Oct 2026 regardless of build state. The build never becomes a reason to defer.
2. v1 is timeboxed to one weekend. Cut scope to fit; never expand the box.
3. Daily review queue hard-capped at **60 cards**. Behavioural, not performance. Do not "optimise" it away.
4. Sync is **off by default** and can never block or interrupt review. Failures are silent (console + subtle Settings indicator).
5. Local-first: IndexedDB is the source of truth; the network is a backup.

## Out of scope: do not add, even if it looks small (PRD §2.2)

| Excluded | Why |
|---|---|
| Handwriting practice / Hanzi Writer | Lu et al. (*AERA Open*, 2019): handwriting practice doesn't improve CFL word recognition. NB the PRD's second reason is wrong: the new HSK 2 paper *does* have a 书写 section (10/60 items, CLEC Dec 2025). Owner decided 2026-10-17 to omit handwriting entirely and learn it elsewhere. Still excluded. |
| Accounts / login / auth / email | Capability token replaces it |
| Graded reader / article content in-app | Not legally redistributable |
| Streaks, badges, XP, leaderboards | No independent evidence |
| Multi-user / multi-profile | Scope creep |
| SSR, routing library, state library, UI kit | Unneeded at this size |
| Traditional character toggle | Simplified only |
| Speech recognition / pronunciation scoring | False feedback worse than none |
| "Study more" after the queue empties | The cap exists for a reason |

Also do not port prose from the course page (`mandarin-to-hsk-3-threshold.html`) beyond what
`src/data/schedule.json` needs.

## Hard constraints

- **Runtime dependency ceiling: 6.** Currently: react+react-dom, ts-fsrs, dexie. Dev-only: vite, vite-plugin-pwa, typescript, vitest. Need a 7th runtime dep → stop and ask.
- No router, no state library, no Tailwind, no component library, no date library.
- `src/srs/scheduler.ts` is the **only** importer of `ts-fsrs`.
- `src/sync/client.ts` is the **only** file that knows about Cloudflare (two-method interface).
- Verify library APIs against installed `.d.ts`, never from memory (ts-fsrs especially).

## Conventions

- **Dates in IndexedDB are epoch milliseconds (`number`)**, never `Date` objects. Convert at the
  ts-fsrs boundary inside `scheduler.ts` only. Day-level dates (`startDate`) are ISO `YYYY-MM-DD` strings.
- Audio: iOS needs a user gesture; the first tap of a session plays a silent buffer to unlock (PRD §9.4).
- Pinyin is never on the front of a `recognition` card.
- Save indicator ("saved · 18:42") on every screen with mutable state.

## Data pipeline (decisions 2026-10-17)

- `tools/build-vocab.ts` runs with Node 24's native type stripping: `node tools/build-vocab.ts`.
  Sources live in `.sources/` (gitignored); URLs in README.
- HSK list: `tools/data/hsk-2025-l1-l2.tsv`, verified 500/500 against the CLEC syllabus PDF (2025-11).
- Join on **(simplified, syllabus pinyin)**, not simplified alone (PRD §7.2 is wrong on this); the
  syllabus pinyin, with its tone sandhi, is the displayed reading. `pinyinNumbered` = syllabus surface tones.
- Homographs with identical hanzi+reading (点, 花) merge into one entry at the lower level.
- Definitions: Wiktionary (kaikki.org) for multi-character words; CC-CEDICT ranked by syllabus POS
  for single characters; `tools/data/sense-overrides.tsv` **selects** existing senses. Never author definitions.
- Sentences + sentence pinyin + script come from Tatoeba (incl. `transcriptions.csv`); a sentence must use
  the card's reading of the word. pinyin-pro was tested and dropped (wrong on 得).
- User-written sentences have empty `pinyin` (no runtime pinyin library).
- Word → week follows the course page's module themes and per-week counts, all L1 by week 7.
- App vocabulary = the syllabus 500 only; course words outside it (收到, 开会, 经理…) are left to lessons.
- Audio is pre-generated for every word and every candidate sentence (curation picks sentences after the
  build). User sentences fall back to Web Speech.

## Workflow

- One PRD §14 task at a time; meet its acceptance criteria; commit with the task number.
- `tools/generate-audio.py` is run by the owner on their GPU. Never run it.
- Deploy (task 13) and sync (task 14) are deferred: no Cloudflare account yet.
