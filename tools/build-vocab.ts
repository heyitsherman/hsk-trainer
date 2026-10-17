// HSK 3.0 L1–2 syllabus + CC-CEDICT + Wiktionary + Tatoeba → src/data/vocab.json
// Also writes tools/data/audio-manifest.json (input to generate-audio.py).
//
// Run: node tools/build-vocab.ts [--sample 爱,只,...] [--out path] [--report docs/vocab-review.md]
// Inputs live in .sources/ (gitignored); README lists the download URLs.

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import type { Sentence, VocabEntry } from '../src/types.ts';

const SRC = '.sources';
const HSK_TSV = 'tools/data/hsk-2025-l1-l2.tsv';
const ANCHORS_TSV = 'tools/data/week-anchors.tsv';
const OVERRIDES_TSV = 'tools/data/sense-overrides.tsv';
const MANIFEST = 'tools/data/audio-manifest.json';
const WIKT_DUMP = `${SRC}/wiktionary/kaikki-chinese.jsonl`;
const WIKT_CACHE = `${SRC}/wiktionary/hsk-subset.json`;

// Per-week new-word counts from the course page (sum 500; the last week absorbs the difference).
const WEEK_COUNTS = [40, 45, 45, 45, 45, 45, 40, 40, 40, 40, 45, 30];
const MAX_DEFS = 3;
const MAX_SENTENCES = 3;

const args = process.argv.slice(2);
const argOf = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const sampleWords = argOf('--sample')?.split(',');
const outPath = argOf('--out') ?? 'src/data/vocab.json';
const reportPath = argOf('--report');

const readTsv = (path: string) =>
  readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'));

// ---------- pinyin helpers ----------

const MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'], e: ['ē', 'é', 'ě', 'è'], i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'], u: ['ū', 'ú', 'ǔ', 'ù'], ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** "lu:4" / "lv4" → "lǜ", "Hao3" → "Hǎo", "r5" → "r" */
function numberedToMarked(syl: string): string {
  const m = /^([a-zü]+?)([1-5])?$/i.exec(syl.replace(/u:|v/g, 'ü').replace(/U:|V/g, 'Ü'));
  if (!m) return syl;
  const base = m[1];
  const tone = Number(m[2] ?? 5);
  if (tone === 5) return base;
  const lower = base.toLowerCase();
  let idx = lower.search(/[ae]/);
  if (idx < 0) idx = lower.indexOf('ou');
  if (idx < 0) {
    for (let i = lower.length - 1; i >= 0; i--) if ('iouü'.includes(lower[i])) { idx = i; break; }
  }
  if (idx < 0) return base;
  const v = lower[idx];
  const marked = MARKS[v][tone - 1];
  return base.slice(0, idx) + (base[idx] === v ? marked : marked.toUpperCase()) + base.slice(idx + 1);
}

const stripTones = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/u:|v/g, 'u').toLowerCase();

const toneOf = (marked: string): number => {
  const d = marked.normalize('NFD');
  if (d.includes('̄')) return 1;
  if (d.includes('́')) return 2;
  if (d.includes('̌')) return 3;
  if (d.includes('̀')) return 4;
  return 5;
};

/**
 * Split tone-marked pinyin ("nǚ’ér", "bú kèqi") into syllables, using a CEDICT syllable sequence as
 * the template. Returns null if the toneless forms don't line up.
 */
function alignSyllables(marked: string, templateSyls: string[]): string[] | null {
  const s = marked.replace(/[\s’'·-]/g, '').normalize('NFC');
  const out: string[] = [];
  let pos = 0;
  for (const t of templateSyls) {
    const bare = stripTones(t.replace(/[1-5]$/, ''));
    const chunk = s.slice(pos, pos + bare.length);
    if (stripTones(chunk) !== bare) return null;
    out.push(chunk);
    pos += bare.length;
  }
  return pos === s.length ? out : null;
}

/** Tones agree, allowing neutral tone and 一/不 sandhi to differ. */
const tonesCompatible = (a: number, b: number, ch: string) => a === b || a === 5 || b === 5 || '一不'.includes(ch);

// ---------- HSK syllabus ----------

const POS: Record<string, string> = {
  名: 'noun', 动: 'verb', 形: 'adjective', 副: 'adverb', 代: 'pronoun', 数: 'numeral',
  量: 'measure word', 介: 'preposition', 连: 'conjunction', 助: 'particle', 叹: 'interjection',
  拟声: 'onomatopoeia', 数量: 'numeral-measure', 前缀: 'prefix', 后缀: 'suffix',
};

interface HskRow { id: number; level: 1 | 2; hanzi: string; pinyin: string; posList: string[] }

const merged = new Map<string, HskRow>();
for (const [id, level, , hanzi, pinyinRaw, pos] of readTsv(HSK_TSV).slice(1)) {
  const pinyin = pinyinRaw.split('/')[0]; // "shéi/shuí" → first reading
  // Parenthesised POS belong to senses introduced at later levels.
  const posList = pos.replace(/（[^）]*）/g, '').split('、').filter(Boolean).map((p) => POS[p] ?? p);
  // Homographs with identical hanzi + reading (点1/点2, 花1/花2) merge at the lower level.
  const key = `${hanzi}|${pinyin}`;
  const prev = merged.get(key);
  if (prev) prev.posList.push(...posList.filter((p) => !prev.posList.includes(p)));
  else merged.set(key, { id: Number(id), level: Number(level) as 1 | 2, hanzi, pinyin, posList });
}
const hskWords = new Set([...merged.values()].map((r) => r.hanzi));

// ---------- CC-CEDICT ----------

interface CedictEntry { trad: string; simp: string; syls: string[]; senses: string[] }

const cedict = new Map<string, CedictEntry[]>();
const tradChars = new Set<string>();
const simpChars = new Set<string>();
for (const line of readFileSync(`${SRC}/cedict/cedict_ts.u8`, 'utf8').split('\n')) {
  if (line.startsWith('#') || !line.trim()) continue;
  const m = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/.exec(line);
  if (!m) continue;
  const [, trad, simp, py, defs] = m;
  (cedict.get(simp) ?? cedict.set(simp, []).get(simp)!).push({ trad, simp, syls: py.split(' '), senses: defs.split('/') });
  for (const c of trad) tradChars.add(c);
  for (const c of simp) simpChars.add(c);
}
const tradOnly = new Set([...tradChars].filter((c) => !simpChars.has(c)));

const CEDICT_DROP = [
  /^(old |archaic |unofficial |erroneous )?variant of/i,
  /^(see |used in |surname [A-Z]|abbr\. for|CL:|Taiwan pr\.|also pr\.|also written|pr\. )/,
  /^\((archaic|old|literary|dialect|Cantonese|Tw|Taiwan|slang|vulgar|derog\.|offensive|obscene|Buddhism|TCM)/i,
  /vulgar|obscene|offensive|sexual/i,
];

const cleanCedict = (s: string) =>
  s
    .replace(/,?\s*\(?CL:[^)/]*\)?/g, '') // inline classifier notes: "cat (CL:隻|只[zhi1])"
    // 得[de2] / 無|无[wu2] → 得 (dé) / 无 (wú)
    .replace(/(?:\p{Script=Han}+\|)?(\p{Script=Han}+)\[([^\]]+)\]/gu, (_, hz: string, py: string) =>
      `${hz} (${py.split(' ').map(numberedToMarked).join('')})`)
    .replace(/[\p{Script=Han}\d]+\|([\p{Script=Han}\d]+)/gu, '$1') // bare trad|simp pairs
    .trim();

/** "erhua variant of 麵條|面条[mian4 tiao2]" → the base word's senses */
const expandErhua = (senses: string[]) =>
  senses.flatMap((s) => {
    const m = /^erhua (?:variant|form) of (?:[^|[]+\|)?([^|[]+)\[([^\]]+)\]/.exec(s);
    if (!m) return [s];
    const syls = m[2].replace(/\s*:\s*/g, ':'); // CEDICT has "女孩[nu : 3 hai2]"
    return (cedict.get(m[1]) ?? []).find((e) => e.syls.join(' ') === syls)?.senses ?? [];
  });

// Sense shapes that signal a part of speech, used to rank CC-CEDICT's unordered senses.
const POS_SENSE: Record<string, RegExp> = {
  'measure word': /^(classifier|measure word|\(after a number\)|\(used after)/i,
  verb: /^(\([^)]*\) )?to /,
  noun: /^(?!(\([^)]*\) )?to |classifier|\(.*particle)/i,
  particle: /particle|marker/i,
  'numeral-measure': /^\(after a verb\)|a bit|a little/i,
};

function cedictSenses(entries: CedictEntry[], posList: string[]): string[] {
  const all: string[] = [];
  for (const e of entries)
    for (const s of expandErhua(e.senses)) {
      if (!s || CEDICT_DROP.some((r) => r.test(s))) continue;
      const c = cleanCedict(s);
      if (!all.includes(c)) all.push(c);
    }
  const rank = (s: string) => posList.findIndex((p) => POS_SENSE[p]?.test(s));
  // Stable: senses matching the earliest-listed syllabus POS first, unmatched last.
  return all
    .map((s, i) => ({ s, i, r: rank(s) }))
    .sort((a, b) => (a.r < 0 ? 99 : a.r) - (b.r < 0 ? 99 : b.r) || a.i - b.i)
    .map((x) => x.s);
}

// ---------- Wiktionary (kaikki.org extract) ----------

interface WiktEntry { pos: string; pinyin: string[]; senses: string[] }

async function loadWiktionary(words: Set<string>): Promise<Map<string, WiktEntry[]>> {
  if (!existsSync(WIKT_CACHE)) {
    console.log('filtering Wiktionary dump (one-off, ~1 min)…');
    const subset: Record<string, WiktEntry[]> = {};
    const rl = createInterface({ input: createReadStream(WIKT_DUMP, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const e = JSON.parse(line);
      if (e.pos === 'soft-redirect' || e.pos === 'character') continue;
      const forms: string[] = (e.forms ?? [])
        .filter((f: { tags?: string[] }) => f.tags?.includes('Simplified-Chinese') && !f.tags.includes('alternative'))
        .map((f: { form: string }) => f.form);
      const keys = [...new Set([e.word, ...forms])].filter((k) => words.has(k));
      if (!keys.length) continue;
      const pinyin = (e.sounds ?? [])
        .filter((s: { tags?: string[]; zh_pron?: string }) => s.zh_pron && s.tags?.includes('Mandarin') && s.tags.includes('Pinyin'))
        .map((s: { zh_pron: string }) => s.zh_pron.split(' (')[0]);
      const senses: string[] = [];
      for (const s of e.senses ?? []) {
        const gloss: string | undefined = s.glosses?.at(-1);
        if (gloss && !WIKT_DROP_TAGS.some((t) => s.tags?.includes(t))) senses.push(gloss);
      }
      for (const k of keys) (subset[k] ??= []).push({ pos: e.pos, pinyin, senses });
    }
    writeFileSync(WIKT_CACHE, JSON.stringify(subset));
  }
  return new Map(Object.entries(JSON.parse(readFileSync(WIKT_CACHE, 'utf8'))));
}

const WIKT_DROP_TAGS = [
  'archaic', 'obsolete', 'literary', 'dialectal', 'Classical', 'Cantonese', 'Hokkien', 'Min', 'Wu', 'Hakka',
  'Taiwan', 'slang', 'vulgar', 'derogatory', 'offensive', 'rare', 'historical', 'alt-of', 'form-of',
  'abbreviation', 'euphemistic', 'Internet', 'no-gloss', 'Teochew', 'Xiang', 'Gan', 'Jin',
];

const WIKT_POS: Record<string, string[]> = {
  noun: ['noun', 'name'], verb: ['verb'], adjective: ['adj'], adverb: ['adv'], pronoun: ['pron'],
  numeral: ['num'], 'measure word': ['classifier'], preposition: ['prep'], conjunction: ['conj'],
  particle: ['particle'], interjection: ['intj', 'phrase'], 'numeral-measure': ['adv', 'num', 'classifier', 'noun'],
};

const cleanWikt = (s: string) =>
  s.replace(/\s*\(Classifier:[^)]*\)/g, '').replace(/\s*⇒.*$/, '').trim();

const WIKT_SKIP = /^(erhua form of|short for|alternative form|abbreviation of|used in|only used in|a surname|surname|synonym of|\(Cantonese|\(Hokkien|\(Taiwan)/i;

// ---------- join ----------

interface Joined {
  row: HskRow;
  numbered: string[]; // surface tones, aligned to characters
  pool: { source: 'wiktionary' | 'cedict'; senses: string[] }[]; // ranked candidates, best source first
  defs: string[];
  defSource: string;
}

const wikt = await loadWiktionary(hskWords);
const joined: Joined[] = [];
const unmatched: string[] = [];

for (const row of merged.values()) {
  let best: { score: number; syls: string[]; aligned: string[]; entries: CedictEntry[] } | null = null;
  for (const e of cedict.get(row.hanzi) ?? []) {
    const aligned = alignSyllables(row.pinyin, e.syls);
    if (!aligned) continue;
    let score = 4;
    aligned.forEach((a, i) => {
      const ot = toneOf(a), ct = Number(e.syls[i].slice(-1)) || 5;
      if (ot !== ct) score = Math.min(score, tonesCompatible(ot, ct, row.hanzi[i]) ? 3 : 1);
    });
    if (/^[A-Z]/.test(e.syls[0])) score -= 0.5; // proper-noun readings only when nothing else fits
    if (!best || score > best.score) best = { score, syls: e.syls, aligned, entries: [e] };
    else if (score === best.score && best.syls.join(' ') === e.syls.join(' ')) best.entries.push(e);
  }
  if (!best || best.score < 2) { unmatched.push(`${row.id} ${row.hanzi} ${row.pinyin}`); continue; }
  // Syllabus surface tones drive pinyinNumbered (一下 → yi2 xia4), matching the displayed pinyin.
  const numbered = best.aligned.map((a, i) => best!.syls[i].replace(/[1-5]$/, '').toLowerCase().replace('u:', 'v') + toneOf(a));

  const pool: Joined['pool'] = [];
  const wantPos = row.posList.flatMap((p) => WIKT_POS[p] ?? []);
  const readingOk = (w: WiktEntry) =>
    w.pinyin.some((p) => {
      const al = alignSyllables(p, best!.syls);
      return al?.every((a, i) => tonesCompatible(toneOf(a), toneOf(best!.aligned[i]), row.hanzi[i]));
    });
  const readingExact = (w: WiktEntry) =>
    w.pinyin.some((p) => alignSyllables(p, best!.syls)?.every((a, i) => toneOf(a) === toneOf(best!.aligned[i])));
  const wAll = wikt.get(row.hanzi) ?? [];
  // Tone-exact entries win; tolerance is only for sandhi/neutral spelling differences (东西 dōngxi ≠ dōngxī).
  const wExact = wAll.filter(readingExact);
  const wEntries = wExact.length ? wExact : wAll.filter(readingOk);
  const wPosEntries = wEntries.filter((w) => wantPos.includes(w.pos));
  const wSenses = [...new Set((wPosEntries.length ? wPosEntries : wEntries).flatMap((w) => w.senses)
    .filter((s) => !WIKT_SKIP.test(s)).map(cleanWikt).filter(Boolean))];
  const cSenses = cedictSenses(best.entries, row.posList);
  // Multi-character words: Wiktionary first. Single characters: Wiktionary's per-character pages are
  // etymological and pool readings, so CC-CEDICT (POS-ranked) leads.
  if (wSenses.length && row.hanzi.length > 1) pool.push({ source: 'wiktionary', senses: wSenses });
  if (cSenses.length) pool.push({ source: 'cedict', senses: cSenses });
  if (wSenses.length && row.hanzi.length === 1) pool.push({ source: 'wiktionary', senses: wSenses });
  if (!pool.length) { unmatched.push(`${row.id} ${row.hanzi} ${row.pinyin} (no usable senses)`); continue; }
  joined.push({ row, numbered, pool, defs: pool[0].senses.slice(0, MAX_DEFS), defSource: pool[0].source });
}

// Overrides select existing senses only; anything not found verbatim in the pool is a hard error.
const overrideErrors: string[] = [];
for (const [id, senses] of readTsv(OVERRIDES_TSV)) {
  const j = joined.find((x) => x.row.id === Number(id.replace(/^w-/, '')));
  if (!j) { overrideErrors.push(`${id}: no such entry`); continue; }
  const picks = senses.split(' | ').map((s) => s.trim());
  const available = new Set(j.pool.flatMap((p) => p.senses));
  const missing = picks.filter((p) => !available.has(p));
  if (missing.length) overrideErrors.push(`${id} ${j.row.hanzi}: not in CC-CEDICT/Wiktionary pool: ${missing.join(' | ')}`);
  j.defs = picks.slice(0, MAX_DEFS);
  j.defSource = 'override';
}
if (overrideErrors.length) throw new Error(`sense-overrides.tsv:\n  ${overrideErrors.join('\n  ')}`);

// ---------- Tatoeba ----------

const engIds = new Map<number, number[]>();
for (const l of readFileSync(`${SRC}/tatoeba/cmn-eng_links.tsv`, 'utf8').split('\n')) {
  const [a, b] = l.split('\t').map(Number);
  if (a && b) (engIds.get(a) ?? engIds.set(a, []).get(a)!).push(b);
}

// transcriptions.csv: id, lang, script, reviewer, text. For a cmn sentence it carries the *other*
// Han script (a Hans row means the original is traditional) and word-segmented numbered pinyin (Latn).
const latn = new Map<number, { text: string; reviewed: boolean }>();
const hansOf = new Map<number, string>();
for (const l of readFileSync(`${SRC}/tatoeba-tr/transcriptions.csv`, 'utf8').split('\n')) {
  const [idS, lang, script, reviewer, text] = l.split('\t');
  if (lang !== 'cmn' || !text) continue;
  if (script === 'Latn') latn.set(Number(idS), { text: text.trim(), reviewed: !!reviewer });
  else if (script === 'Hans') hansOf.set(Number(idS), text.trim());
}

const isHan = (c: string) => /\p{Script=Han}/u.test(c);
const SYLLABLE = /[a-zv]+[1-5]/gi;
const MAX_TOKEN = 8;
const NUMERAL = /[零〇一二三四五六七八九十百千万两]/;
const BLOCK_EN = /\b(fuck\w*|shit\w*|bitch\w*|asshole|bastard|damn\w*|hell|sex\w*|porn\w*|kill\w*|suicide|rape\w*|whore)\b/i;

interface Token { w: string; at: number } // `at` indexes the sentence's Han characters

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const chars = [...text];
  let i = 0, h = 0;
  while (i < chars.length) {
    if (!isHan(chars[i])) { i++; continue; }
    let run = 0;
    while (i + run < chars.length && isHan(chars[i + run])) run++;
    let len = Math.min(MAX_TOKEN, run);
    for (; len > 1; len--) {
      const w = chars.slice(i, i + len).join('');
      if (hskWords.has(w) || cedict.has(w)) break;
    }
    out.push({ w: chars.slice(i, i + len).join(''), at: h });
    i += len;
    h += len;
  }
  return out;
}

/** 一/不 tone sandhi on citation-tone syllables, so sentence pinyin matches card pinyin. */
function applySandhi(syls: string[], han: string[]): string[] {
  return syls.map((s, i) => {
    const next = syls[i + 1];
    if (!next) return s;
    const nt = next.slice(-1);
    if (han[i] === '不' && /^bu4$/i.test(s) && nt === '4') return s.replace('4', '2');
    if (han[i] === '一' && /^yi1$/i.test(s)) {
      const prev = han[i - 1] ?? '', after = han[i + 1] ?? '';
      if (prev === '第' || NUMERAL.test(prev) || NUMERAL.test(after) || /[月号日]/.test(after)) return s;
      if (nt === '4') return s.replace('1', '2');
      if ('123'.includes(nt)) return s.replace('1', '4');
    }
    return s;
  });
}

interface Cand { id: number; text: string; tokens: Token[]; syls: string[]; latn: string; reviewed: boolean; oov: number }
const byWord = new Map<string, Cand[]>();
const freq = new Map<string, number>();
const indexWords = new Set([...hskWords, ...[...hskWords].filter((w) => w.length > 1 && w.endsWith('儿')).map((w) => w.slice(0, -1))]);

for (const l of readFileSync(`${SRC}/tatoeba/cmn_sentences.tsv`, 'utf8').split('\n')) {
  const [idS, , original] = l.split('\t');
  if (!original) continue;
  const id = Number(idS);
  const text = hansOf.get(id) ?? original.trim();
  const han = [...text].filter(isHan);
  if (han.length < 3 || han.length > 20) continue;
  if (han.some((c) => tradOnly.has(c))) continue;
  const tr = latn.get(id);
  if (!engIds.has(id) || !tr) continue;
  const syls = tr.text.match(SYLLABLE) ?? [];
  if (syls.length !== han.length) continue;
  const tokens = tokenize(text);
  for (const t of tokens) freq.set(t.w, (freq.get(t.w) ?? 0) + 1);
  const cand = { id, text, tokens, syls: applySandhi(syls, han), latn: tr.text, reviewed: tr.reviewed, oov: tokens.filter((t) => !hskWords.has(t.w)).length };
  for (const w of new Set(tokens.map((t) => t.w))) if (indexWords.has(w)) (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(cand);
}

const english = new Map<number, string>();
for (const l of readFileSync(`${SRC}/tatoeba/eng_sentences.tsv`, 'utf8').split('\n')) {
  const tab = l.indexOf('\t');
  english.set(Number(l.slice(0, tab)), l.slice(l.indexOf('\t', tab + 1) + 1).trim());
}
const englishOf = (id: number) => engIds.get(id)!.map((e) => english.get(e)).find((s) => s && !BLOCK_EN.test(s));

/** The sentence must use the card's reading of the word: rejects 我只吃肉 (zhǐ) for the 只 zhī card. */
const usesReading = (c: Cand, word: string, card: string[]) =>
  c.tokens.some((t) =>
    word.startsWith(t.w) && t.w.length >= word.length - 1 &&
    [...t.w].every((ch, k) => {
      const s = c.syls[t.at + k].toLowerCase();
      return s.slice(0, -1) === card[k].slice(0, -1) && tonesCompatible(Number(s.slice(-1)), Number(card[k].slice(-1)), ch);
    }));

function pickSentences(word: string, card: string[]): Cand[] {
  const seen = new Set<string>();
  const pool = byWord.get(word) ?? (word.endsWith('儿') ? byWord.get(word.slice(0, -1)) : undefined) ?? [];
  return pool
    .filter((c) => usesReading(c, word, card) && englishOf(c.id))
    .sort((a, b) => a.oov - b.oov || Number(b.reviewed) - Number(a.reviewed) || a.text.length - b.text.length || a.id - b.id)
    .filter((c) => !seen.has(c.text) && seen.add(c.text))
    .slice(0, MAX_SENTENCES);
}

// ---------- week assignment ----------
// Course-page theme words are deadlines ("taught by week N"). Each week takes its due anchors, then
// fills with the most frequent remaining words: L1 first (course checkpoint: HSK 1 by week 7), then L2.

const anchorWeek = new Map<string, number>();
const anchorMisses: string[] = [];
for (const [week, words] of readTsv(ANCHORS_TSV)) {
  for (const w of words.split(' ')) {
    if (!hskWords.has(w)) { anchorMisses.push(w); continue; }
    anchorWeek.set(w, Math.min(anchorWeek.get(w) ?? 99, Number(week)));
  }
}

const weekOf = new Map<Joined, number>();
const remaining = new Set(joined);
const byFreq = (a: Joined, b: Joined) =>
  a.row.level - b.row.level || (freq.get(b.row.hanzi) ?? 0) - (freq.get(a.row.hanzi) ?? 0) || a.row.id - b.row.id;
for (let w = 1; w <= WEEK_COUNTS.length; w++) {
  const quota = w === WEEK_COUNTS.length ? remaining.size : WEEK_COUNTS[w - 1];
  const due = [...remaining].filter((j) => (anchorWeek.get(j.row.hanzi) ?? 99) <= w).sort(byFreq);
  const rest = [...remaining].filter((j) => !due.includes(j)).sort(byFreq);
  for (const j of [...due, ...rest].slice(0, Math.max(quota, due.length))) {
    weekOf.set(j, w);
    remaining.delete(j);
  }
}

// ---------- emit ----------

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');
const manifest: { file: string; kind: 'word' | 'sentence'; text: string; pinyinNumbered: string }[] = [];

const ordered = [...joined].sort((a, b) => weekOf.get(a)! - weekOf.get(b)! || byFreq(a, b));
const entries: VocabEntry[] = ordered.map((j) => {
  const pinyinNumbered = j.numbered.join(' ');
  const audioFile = `${sha1(`${j.row.hanzi}|${pinyinNumbered}`)}.opus`;
  manifest.push({ file: audioFile, kind: 'word', text: j.row.hanzi, pinyinNumbered });
  const candidateSentences: Sentence[] = pickSentences(j.row.hanzi, j.numbered).map((c) => {
    let k = 0;
    const numbered = c.syls.map((s) => s.toLowerCase()).join(' ');
    const file = `${sha1(`${c.text}|${numbered}`)}.opus`;
    manifest.push({ file, kind: 'sentence', text: c.text, pinyinNumbered: numbered });
    return {
      simplified: c.text,
      pinyin: c.latn.replace(SYLLABLE, () => numberedToMarked(c.syls[k++])),
      english: englishOf(c.id)!,
      source: 'tatoeba',
      tatoebaId: c.id,
      audioFile: file,
    };
  });
  return {
    id: `w-${String(j.row.id).padStart(4, '0')}`,
    simplified: j.row.hanzi,
    pinyin: j.row.pinyin.replace(/\s+/g, ''),
    pinyinNumbered,
    definitions: j.defs,
    hskLevel: j.row.level,
    week: weekOf.get(j)!,
    ...(j.row.posList.length ? { partOfSpeech: j.row.posList.join(', ') } : {}),
    audioFile,
    candidateSentences,
  };
});

const out = sampleWords ? entries.filter((e) => sampleWords.includes(e.simplified)) : entries;
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
if (!sampleWords) {
  const unique = [...new Map(manifest.map((m) => [m.file, m])).values()];
  writeFileSync(MANIFEST, JSON.stringify(unique, null, 1) + '\n');
}

if (reportPath) {
  const md = ['# Vocabulary review', '', 'Generated by `node tools/build-vocab.ts --report`. `source` = where the definitions came from.', '',
    '| id | word | pinyin | POS | wk | source | definitions | alternatives not shown |', '|---|---|---|---|---|---|---|---|'];
  for (const e of entries) {
    const j = joined.find((x) => `w-${String(x.row.id).padStart(4, '0')}` === e.id)!;
    const others = j.pool.flatMap((p) => p.senses).filter((s) => !e.definitions.includes(s));
    md.push(`| ${e.id} | ${e.simplified} | ${e.pinyin} | ${e.partOfSpeech ?? ''} | ${e.week} | ${j.defSource} | ${e.definitions.join(' · ')} | ${others.join(' · ')} |`.replace(/\n/g, ' '));
  }
  writeFileSync(reportPath, md.join('\n') + '\n');
}

const count = (f: (e: VocabEntry) => boolean) => entries.filter(f).length;
const src = new Map<string, number>();
for (const j of joined) src.set(j.defSource, (src.get(j.defSource) ?? 0) + 1);
console.log(`entries ${entries.length} (L1 ${count((e) => e.hskLevel === 1)}, L2 ${count((e) => e.hskLevel === 2)}); unmatched ${unmatched.length}${unmatched.length ? ':\n  ' + unmatched.join('\n  ') : ''}`);
console.log(`definition source: ${[...src].map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`sentences per word: ${[0, 1, 2, 3].map((n) => `${n}:${count((e) => e.candidateSentences.length === n)}`).join(' ')}; none: ${entries.filter((e) => !e.candidateSentences.length).map((e) => e.simplified).join(' ')}`);
console.log(`week sizes: ${WEEK_COUNTS.map((_, i) => count((e) => e.week === i + 1)).join(' ')}; last L1 week: ${Math.max(...entries.filter((e) => e.hskLevel === 1).map((e) => e.week))}`);
console.log(`anchor words not in syllabus: ${anchorMisses.join(' ') || 'none'}`);
console.log(`audio files: ${new Set(manifest.map((m) => m.file)).size}`);
console.log(`wrote ${out.length} entries → ${outPath}`);
