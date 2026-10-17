# HSK Trainer — Product Requirements & Build Spec

**Document type:** agent-executable specification
**Intended implementer:** Claude Code
**Owner:** Herman (solo)
**Status:** approved for build
**Version:** 1.0 — 17 October 2026

---

## 0. How to use this document

This is a build spec, not a discussion document. Sections 1–3 set constraints that
override later detail if they ever conflict. Section 14 is the ordered task list —
work it top to bottom. Section 2 is an explicit prohibition list; do not add items
from it even if they appear to improve the product.

Where this spec names a library API, **verify it against the installed version
before writing code.** `ts-fsrs` in particular has changed its API across major
versions. Trust the installed `.d.ts` over this document.

---

## 1. Context and goal

### 1.1 What this is

A single-user, offline-first PWA that owns the **daily 15-minute Mandarin loop** for
a learner working from zero toward the entry threshold for HSK 3 (~500 words,
~330 characters recognized).

### 1.2 The problem it solves

A 12-week course was previously delivered as a static HTML page. It was accurate and
well-structured, and it was never used. The failure was **activation, not retention**:
the page described study but outsourced every actual learning action to four external
tools, so "do 15 minutes of Mandarin" required five decisions before any learning
started.

The design thesis follows directly:

> **The app must BE the daily session, not describe it.**

If the daily loop ever requires leaving the app, that is a design defect.

### 1.3 What stays outside the app, correctly

Graded reading and podcast listening remain external links. That content cannot be
legally redistributed, and it is weekly rather than daily. Linking out for *weekly*
activities is fine. Linking out for the *daily* loop is the original failure.

The existing course page remains the syllabus of record and is linked from the app.
**Do not port its prose into the app.**

### 1.4 Success criteria

| Criterion | Measure |
|---|---|
| Primary | 20+ review sessions completed in the first 30 days |
| Primary | ~500 words activated and in review by week 12 |
| Secondary | App opens to a reviewable card in under 2 seconds, offline |
| Secondary | Zero data loss events across 12 weeks |
| Anti-criterion | Build does not exceed one weekend for v1 |

Note the primary criteria measure *use*, not features. A feature-complete app with
five sessions logged has failed.

---

## 2. Non-negotiables and out of scope

### 2.1 Non-negotiables

1. **Learning starts Monday 20 October 2026, independent of build state.** The app is
   not a prerequisite. If v1 slips, week 1 happens on paper. The build must never
   become a reason to defer starting.
2. **v1 is timeboxed to one weekend.** Scope is cut to fit the box; the box does not
   expand to fit scope.
3. **The daily review queue is hard-capped at 60 cards.** See §9.3. This is a
   behavioral requirement, not a performance one, and it is not negotiable on
   retention-optimization grounds.
4. **Sync is off by default** and can never block the review loop. A sync failure must
   be silent and non-blocking.
5. **Local-first.** IndexedDB is the source of truth. The network is a backup.

### 2.2 Explicitly out of scope for v1

Do not implement these. Do not add them because they seem small.

| Excluded | Reason |
|---|---|
| **Handwriting practice / Hanzi Writer** | A randomized study (Lu et al., *AERA Open*, 2019) found supplemental handwriting practice ineffective for CFL word recognition. HSK 3.0 does not assess handwriting at this level. Cut on evidence. |
| User accounts, login, auth, email | Capability token replaces all of it |
| Graded reader / article content in-app | Cannot be legally redistributed |
| Streaks, badges, XP, leaderboards | Evidence base is vendor testimonial, not independent data |
| Multi-user / multi-profile affordances | Building for hypothetical forkers is scope creep |
| Server-side rendering, routing library, state library, UI kit | Unneeded at this size |
| Traditional character toggle | Simplified only; CC-CEDICT carries both, add later if ever |
| Speech recognition / pronunciation scoring | Unreliable at beginner tone accuracy; false feedback is worse than none |

---

## 3. Stack and constraints

### 3.1 Stack

- **React 19 + TypeScript + Vite**
- **Hosting:** Cloudflare Pages, deployed from a public GitHub repo
- **Serving domain:** free `*.pages.dev` subdomain. No custom domain in v1.
- **Sync:** Cloudflare Pages Functions + Workers KV

React is chosen for agent-generation reliability and market legibility, not technical
fit — vanilla TS would be technically sufficient. Keep the React surface thin.

### 3.2 Dependency ceiling: 6 runtime dependencies

Permitted:

1. `react` + `react-dom` (counts as one)
2. `ts-fsrs` — scheduling
3. `dexie` — IndexedDB wrapper
4. `vite-plugin-pwa` — service worker + manifest (dev dependency)
5. `pinyin-pro` — tone-number to tone-mark conversion (build-time only; prefer to
   vendor the conversion as ~60 lines and drop this dependency entirely)

No router. No Redux/Zustand/Jotai. No Tailwind. No component library. No date library.
If a seventh dependency seems necessary, stop and flag it rather than adding it.

### 3.3 Target devices

- **Primary:** iPhone 16 Pro, Safari, installed to home screen. All UX decisions
  resolve in favor of this device.
- **Secondary:** Windows 11 desktop (Chrome/Edge), Surface Pro 11 (ARM64).
- Offline operation is required — study happens on the MRT, underground.

---

## 4. Critical platform constraint: iOS storage eviction

**This is the single highest-severity risk in the project.**

Safari caps script-writable storage — localStorage, IndexedDB, and service worker
caches — at 7 days of non-interaction. Home-screen-installed web apps are exempt
under WebKit's documented ITP carve-out, because the home screen app is not counted
against Safari's tally.

Consequence: **used in a Safari tab, a one-week lapse destroys all progress.** A
one-week lapse is this user's demonstrated failure mode.

Required mitigations, all three:

1. **First-run install gate.** On iOS Safari, if `navigator.standalone !== true`,
   show a blocking modal explaining that progress will be lost unless the app is
   added to the home screen, with the Share → Add to Home Screen steps. Allow
   dismissal, but re-show on every launch while un-installed.
2. **Persistent storage request.** Call `navigator.storage.persist()` on first run.
   Log the result. Do not assume it succeeded.
3. **Export always available.** See §11.3. This is the only guarantee that survives
   platform behavior changes.

---

## 5. Repository structure

```
hsk-trainer/
├── PRD.md
├── README.md
├── LICENSE                  # MIT (code)
├── LICENSE-DATA             # CC BY-SA 4.0 (dictionary-derived data)
├── ATTRIBUTION.md
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── public/
│   ├── manifest.webmanifest
│   ├── icons/
│   └── audio/               # pre-generated, committed, ~8 MB
│       └── {sha1-of-text}.opus
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── db/
│   │   ├── schema.ts        # Dexie schema + migrations
│   │   └── queries.ts
│   ├── srs/
│   │   ├── scheduler.ts     # ts-fsrs wrapper
│   │   ├── ladder.ts        # card-type promotion
│   │   └── queue.ts         # daily queue assembly + 60-cap
│   ├── sync/
│   │   ├── client.ts        # ~40 lines; the whole vendor surface
│   │   └── merge.ts
│   ├── audio/
│   │   └── player.ts        # cached file first, Web Speech fallback
│   ├── screens/
│   │   ├── Review.tsx
│   │   ├── Today.tsx
│   │   ├── Curate.tsx
│   │   ├── Schedule.tsx
│   │   └── Settings.tsx
│   ├── data/
│   │   ├── vocab.json       # generated, committed
│   │   └── schedule.json    # 12-week module definitions
│   └── styles.css
├── functions/
│   └── api/
│       └── sync/[token].ts  # Cloudflare Pages Function
└── tools/
    ├── build-vocab.ts       # CC-CEDICT + HSK list + Tatoeba → vocab.json
    └── generate-audio.py    # Kokoro TTS → public/audio/
```

**Design note on `src/sync/client.ts`:** the entire Cloudflare dependency lives in
this one file behind a two-method interface. Porting to any other key-value host
must be a single-file change. This is the exit-cost guarantee; preserve it.

---

## 6. Data model

```ts
// ---------- Vocabulary (static, generated at build time) ----------

interface VocabEntry {
  id: string;              // stable slug, e.g. "w-0142"
  simplified: string;
  pinyin: string;          // tone marks, NOT tone numbers
  pinyinNumbered: string;  // source form, retained for audio generation
  definitions: string[];   // from CC-CEDICT, max 3, trimmed
  hskLevel: 1 | 2;         // HSK 3.0 finalized syllabus
  week: number;            // 1-12, which module activates it
  partOfSpeech?: string;
  audioFile: string;       // "a1b2c3....opus"
  candidateSentences: Sentence[];  // from Tatoeba, max 3
}

interface Sentence {
  simplified: string;
  pinyin: string;
  english: string;
  source: 'tatoeba' | 'user';
  tatoebaId?: number;      // required when source === 'tatoeba', for attribution
}

// ---------- User state (IndexedDB, mutable) ----------

type CardType = 'recognition' | 'audio' | 'production' | 'cloze';

interface Card {
  id: string;              // `${vocabId}:${type}`
  vocabId: string;
  type: CardType;
  // FSRS state — field names must match the installed ts-fsrs Card type.
  // Verify against node_modules/ts-fsrs before writing.
  due: Date;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;           // ts-fsrs State enum
  last_review?: Date;
  createdAt: Date;
}

interface ActivatedWord {
  vocabId: string;
  activatedAt: Date;
  chosenSentence: Sentence | null;  // approved or user-written during curation
  userNote?: string;
}

interface ReviewLog {
  id?: number;             // auto-increment
  cardId: string;
  rating: 1 | 2 | 3 | 4;   // ts-fsrs Rating: Again/Hard/Good/Easy
  reviewedAt: Date;
  durationMs: number;      // needed for §16 recalibration
  stabilityAfter: number;
}

interface WeekProgress {
  week: number;            // 1-12
  tasksCompleted: string[];
  assignmentText: string;
  notesText: string;
  curatedAt: Date | null;
  completedAt: Date | null;
}

interface AppSettings {
  newCardsPerDay: number;        // default 10
  dailyReviewCap: number;        // default 60, see §9.3
  syncEnabled: boolean;          // default FALSE
  syncToken: string | null;
  lastSyncAt: Date | null;
  startDate: string;             // ISO date, default "2026-10-20"
  installDismissedAt: Date | null;
}
```

### 6.1 Dexie schema

```ts
db.version(1).stores({
  cards: 'id, vocabId, type, due, state',
  activated: 'vocabId, activatedAt',
  reviewLog: '++id, cardId, reviewedAt',
  weekProgress: 'week',
  settings: 'key',
});
```

Index `due` — the daily queue query depends on it and will be slow without it.

---

## 7. Data sourcing and build pipeline

### 7.1 Sources and licenses

| Source | Provides | License | Obligation |
|---|---|---|---|
| HSK 3.0 Level 1+2 lists | The 500-word corpus | Official syllabus | Cite CTI |
| CC-CEDICT | Definitions, pinyin | CC BY-SA | Attribute; derived data stays CC BY-SA |
| Tatoeba | Example sentences | CC BY 2.0 FR | Attribute; retain sentence ID per §6 |
| Kokoro TTS | Generated audio | Apache 2.0 | Output is freely usable |

`ATTRIBUTION.md` must list all four with links. The CC-CEDICT ShareAlike term
propagates to `vocab.json`, which is why the repo is dual-licensed: MIT for code,
CC BY-SA 4.0 for `src/data/vocab.json`.

### 7.2 `tools/build-vocab.ts`

Run once, output committed. Not part of the app build.

1. Read the HSK 3.0 Level 1 and Level 2 word lists (~500 cumulative).
2. Join against CC-CEDICT on simplified form. Log unmatched entries rather than
   failing silently.
3. Convert pinyin from tone-number to tone-mark form **at build time**.
4. Trim definitions to at most 3 senses; drop archaic and obscene senses.
5. Pull up to 3 Tatoeba sentences per word, preferring sentences whose other
   vocabulary is also within the HSK 1–2 set. Retain `tatoebaId`.
6. Assign `week` 1–12 per §13.
7. Compute `audioFile` as `sha1(simplified + '|' + pinyinNumbered) + '.opus'`.

### 7.3 `tools/generate-audio.py`

Kokoro TTS, Chinese voice, run locally on the RTX 3070 (needs ~1.5 GB VRAM — well
inside the 8 GB ceiling; the full set generates in under 10 minutes).

**The reason this exists rather than runtime TTS:** polyphonic characters (多音字).
Given a bare character with no context, a TTS engine returns its most frequent
reading — 长 as cháng not zhǎng, 得 as de not děi, 觉 as jué not jiào. Roughly 1 in 8
single-character cards would drill the wrong pronunciation, reinforced by spaced
repetition. Pre-generation lets the pinyin field drive the reading.

- Input: `vocab.json`. Generate for each word AND each chosen sentence.
- Where the engine accepts pinyin or phoneme hints, pass `pinyinNumbered` explicitly.
- Output: Opus, mono, 24 kHz, ~24 kbps → roughly 8 MB total. Commit to
  `public/audio/`.
- Script must be idempotent: skip files that already exist.

---

## 8. FSRS integration

### 8.1 Contract

`src/srs/scheduler.ts` is the only file that imports `ts-fsrs`. Everything else uses:

```ts
export function newCard(id: string, vocabId: string, type: CardType): Card;
export function schedule(card: Card, rating: Rating, now: Date): Card;
export function previewIntervals(card: Card, now: Date): Record<Rating, string>;
```

`previewIntervals` returns human-readable intervals ("4d", "2mo") for display on the
answer buttons.

### 8.2 Configuration

- Default FSRS parameters. **Do not hand-tune.** The published defaults outperform
  SM-2 for ~99.5% of users without per-user optimization.
- `request_retention`: 0.90.
- Four-button grading: Again / Hard / Good / Easy.
- `enable_fuzz`: true — prevents cards learned together from permanently clumping.

FSRS is chosen over SM-2 for one property that matters more here than raw accuracy:
it handles long review gaps far better. Given a demonstrated two-month lapse pattern,
graceful recovery from absence is the governing requirement.

---

## 9. Review engine

### 9.1 The card ladder

A word does **not** get all four card types at once. Doing so would triple daily load
and blow the 1.5 h/week budget (projected 3.4–4.9 h at four-way, versus 1.0–1.4 h
laddered). Types unlock on FSRS stability:

| Card type | Unlock condition | Front → Back |
|---|---|---|
| `recognition` | On activation | character → pinyin + meaning |
| `audio` | recognition `stability >= 14` | audio only → character + meaning |
| `production` | recognition `stability >= 30` | meaning (English) → character + pinyin |
| `cloze` | `chosenSentence !== null` AND recognition `stability >= 30` | sentence with word blanked → full sentence |

By the time a word earns `production`, its `recognition` card sits on a monthly
interval and costs almost nothing. Load stays near the two-type figure while all four
modalities are eventually exercised. This also respects the ordering that recognition
precedes production — forcing production on a word not yet recognized is where
learners quit.

Promotion check runs once per session start in `src/srs/ladder.ts`. Newly spawned
cards enter as new cards and count against the new-card budget.

### 9.2 Pinyin display policy

**Pinyin is never shown on the front of a `recognition` card.** Pinyin beside a
character creates a reliance effect — the learner reads the pinyin and never encodes
the character. Reveal on answer only.

### 9.3 The 60-card cap

The daily queue is assembled as:

```
queue = [ due cards, oldest-due first ]  ++  [ new cards, up to newCardsPerDay ]
queue = queue.slice(0, dailyReviewCap)    // default 60
```

Overflow is **not** dropped — it rolls to the next day and is picked up by the
oldest-due-first ordering.

Rationale, stated explicitly so it is not optimized away: FSRS schedules delayed
reviews correctly but does not limit *volume*. Returning after a three-week lapse to
400 due cards means correct scheduling and an abandoned app. The cap converts a wall
into a tail. It marginally degrades theoretical retention. That trade is correct here.

`newCardsPerDay` defaults to **10** for the first 14 days, then becomes freely
user-adjustable. Misconfigured new-card limits are the single most common cause of
SRS abandonment.

### 9.4 Session UX

- One card at a time, full screen, no chrome beyond a progress indicator.
- Space / tap to reveal; 1–4 keys or four buttons to grade.
- Audio auto-plays on reveal for `recognition`, and on card show for `audio` type.
- **iOS requires a user gesture before audio.** Play a silent buffer on the first tap
  of a session to unlock the audio context; without this, playback fails silently.
- Session ends when the queue empties. Show counts and the next due time. Do not
  offer "study more" — the cap exists for a reason.

---

## 10. Curation flow

Words activate weekly, not all at once. Activation is gated behind a curation pass of
roughly 10 minutes per week, ~42 words.

Bulk CSV entry is deliberately avoided: transcription is not learning. Engaging with
each word in a context you construct is — the generation effect is well established.
So the *import* is automated and the *activation* is manual.

Per word, `Curate.tsx` presents:

1. Character, pinyin, definitions, audio.
2. Up to 3 candidate Tatoeba sentences. User picks one, or
3. Writes their own sentence (becomes `source: 'user'`).
4. Optional note.

On commit: create the `recognition` card, write `ActivatedWord`, mark
`weekProgress.curatedAt`.

Curation can be done in batches. The user may activate fewer than the week's full
allocation; unactivated words simply remain dormant.

---

## 11. Persistence

### 11.1 Local

Dexie / IndexedDB, per §6.1. Source of truth. Debounced writes at 500 ms for text
fields; immediate writes for review grades.

### 11.2 Visible save state

Every screen with mutable state shows a save indicator ("saved · 18:42"). Silent
saving the user cannot verify is worse than no saving — they will not trust it, and
distrust is a reason to stop.

### 11.3 Export / import

- **Export JSON** — complete state backup, downloadable file.
- **Export Markdown** — week notes and assignment answers, formatted for direct paste
  into an Obsidian vault.
- **Import JSON** — restore, with a confirmation step.

Export must work with sync disabled, offline, and on a device that has never synced.
It is the only data guarantee not dependent on platform behavior.

---

## 12. Sync (off by default)

### 12.1 Design

No accounts. A 128-bit random token *is* the identity.

- `GET /api/sync/:token` → `{ data, updatedAt }` or 404
- `PUT /api/sync/:token` → stores one JSON blob

Token generated via `crypto.getRandomValues`, stored locally, displayed as a
12-character grouped code for manual entry on the second device. **No QR in v1** — it
costs a camera library and a permission prompt for an eight-second one-time action.

### 12.2 Cloudflare constraints to honor

- Workers KV free tier: 100,000 reads/day, **1,000 writes/day**, **1 write per second
  to the same key**. Realistic load is 2–20 writes/day — ample headroom, but the
  per-second cap means the sync debounce must be **≥ 2 seconds with coalescing**.
- KV is **eventually consistent**; a write returns before global propagation
  completes (~60 s). Cross-device reads can be stale.

### 12.3 Conflict handling

Last-write-wins on a top-level `updatedAt` timestamp, with one exception:
`reviewLog` entries are merged by union on `id`, never overwritten. Losing review
history to a clock skew is unacceptable; losing a half-typed note is survivable.

On conflict where remote `updatedAt` is newer than local and local has unsynced
changes, present the user a choice. Do not silently discard.

### 12.4 Failure behavior

Sync failures are **silent and non-blocking**. Log to console, set a subtle indicator
in Settings, continue. A sync error must never interrupt a review session or surface
a modal.

---

## 13. Schedule module

Progress-anchored, not date-anchored. Week N unlocks when week N−1's curation is
complete. Display elapsed calendar time since `startDate` as information, never as
a reprimand — no red text, no "behind schedule" labels. Falling behind must not
generate a reason to stop opening the app.

### 13.1 Weekly time budget (re-cut)

Handwriting is removed; its allocation moves to listening.

| Activity | Hours |
|---|---|
| Core lesson (grammar only — app now owns vocabulary) | 1.75 |
| SRS + audio (in-app) | 1.50 |
| Listening (external) | 1.25 |
| Graded reading (external) | 0.75 |
| Speaking / shadowing | 0.50 |
| Weekly curation pass (in-app) | 0.25 |
| **Total** | **6.00** |

### 13.2 Module definitions

`src/data/schedule.json` holds 12 entries:

```ts
interface Module {
  week: number;
  title: string;
  focus: string;
  wordCount: number;       // ~42
  tasks: string[];         // 5 items — handwriting task REMOVED
  resources: { label: string; url: string }[];
  businessThread: string;
  fieldTask: string;       // Singapore-specific
  assignment: string;
}
```

Titles, foci, business threads, field tasks, and assignments carry over from the
existing course page. **Remove the handwriting task and the five-characters-per-week
line from every module.** The 60-character handwriting target is retired.

`Schedule.tsx` renders checkboxes, the assignment textarea, and the notes textarea,
persisted to `WeekProgress`. Resource links open externally.

---

## 14. Build order

Ship in this sequence. Each task has an acceptance test. Do not proceed on a failing
test.

| # | Task | Acceptance criteria |
|---|---|---|
| 1 | Scaffold Vite + React + TS + PWA plugin | `npm run build` succeeds; manifest and SW emitted |
| 2 | Dexie schema + settings store | Write and read back each store in a browser test |
| 3 | `tools/build-vocab.ts` | `vocab.json` has ~500 entries, every entry has pinyin with tone marks, ≥1 definition, non-empty `audioFile` |
| 4 | `tools/generate-audio.py` | One `.opus` per entry; spot-check 10 for correct polyphone readings |
| 5 | FSRS wrapper | Unit test: a `Good` on a new card yields `state=Learning` and a future `due`; a lapse reduces stability |
| 6 | Queue assembly + 60-cap | Unit test: with 400 due cards, queue length is exactly 60, oldest-due first |
| 7 | Review screen | Full session on iPhone Safari; audio plays after first gesture |
| 8 | Ladder promotion | Unit test: card at stability 15 spawns `audio`; at 31 spawns `production`; no duplicates on re-run |
| 9 | Curation screen | Activate 10 words; cards appear in next session's queue |
| 10 | Schedule screen | Check tasks, write assignment, reload — state intact |
| 11 | Export / import | Export, clear site data, import, verify card count and due dates match |
| 12 | iOS install gate | In Safari tab: modal shows. Installed: suppressed |
| 13 | Deploy to Cloudflare Pages | Loads at `*.pages.dev`; works offline after first visit |
| 14 | Sync Function + client | Pair two devices by code; a grade on one appears on the other within 60 s |
| 15 | README + ATTRIBUTION + licenses | All four sources credited; dual license stated |

Tasks 1–13 are the weekend. Task 14 (sync) is explicitly the stretch item — **if the
weekend runs out, ship without sync.** The app is fully functional without it.
Task 15 is required regardless of whether 14 ships: the attribution obligations in
§7.1 are license terms, not polish.

---

## 15. Design and accessibility

Calm, dense, quiet. No gamification visuals.

- Dark default, light toggle, persisted.
- System font stack. One accent color. Generous type sizing — characters need to be
  large, minimum 72 px on card fronts.
- Touch targets ≥ 44 px (iOS minimum).
- Keyboard operable throughout: space to reveal, 1–4 to grade.
- `prefers-reduced-motion` respected.
- The review screen is the app's one considered surface. Everything else is utility.

---

## 16. Recalibration after three weeks

The daily-load model in §9.1 uses a 7–10× multiplier on new-card rate. That is a
heuristic, not a measurement. `ReviewLog` captures `durationMs` precisely so this can
be checked against reality.

At day 21, compute actual reviews/day and median seconds/card. If projected steady
state exceeds 1.5 h/week, the lever is `newCardsPerDay`, not the cap and not the
ladder thresholds. Record the finding in the README.

---

## 17. Open risks

| Risk | Severity | Mitigation |
|---|---|---|
| iOS evicts storage on a lapse | **High** | §4, all three mitigations |
| User builds app, never studies | **High** | 20 Oct start decoupled from build; §1.4 measures use not features |
| Scope creep past the weekend | Medium | §2.2 prohibition list; sync is droppable |
| Tatoeba sentence quality uneven at HSK 1–2 | Medium | User approves or replaces during curation |
| Kokoro Chinese quality below expectation | Medium | Spot-check at task 4; Web Speech fallback already specified |
| HSK 2.0 / 3.0 transition shifts | Low | Targeting 500 words supersets both; verify at chinesetest.cn before any exam registration |

---

## 18. Attribution requirements

`ATTRIBUTION.md` must state:

- Vocabulary targets from the finalized HSK 3.0 syllabus (CLEC, November 2025).
- Definitions and pinyin from **CC-CEDICT**, CC BY-SA, via MDBG.
- Example sentences from **Tatoeba**, CC BY 2.0 FR, with per-sentence IDs retained.
- Audio generated with **Kokoro TTS** (Hexgrad), Apache 2.0.
- Scheduling by **FSRS** (Jarrett Ye), open source.

README must state plainly that generated audio is adequate for recognition drilling
but is **not** a model for pronunciation — that comes from human audio in the linked
external resources.
