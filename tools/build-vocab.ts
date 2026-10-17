// HSK 3.0 L1–2 list + CC-CEDICT + Tatoeba → src/data/vocab.json
// Run: node tools/build-vocab.ts [--sample 爱,只,...] [--out path]
// Inputs in .sources/ (gitignored); see README for download URLs.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

interface Sentence {
  simplified: string;
  pinyin: string;
  english: string;
  source: 'tatoeba' | 'user';
  tatoebaId?: number;
}

interface VocabEntry {
  id: string;
  simplified: string;
  pinyin: string;
  pinyinNumbered: string;
  definitions: string[];
  hskLevel: 1 | 2;
  week: number;
  partOfSpeech?: string;
  audioFile: string;
  candidateSentences: Sentence[];
}

const SRC = '.sources';
const HSK_TSV = 'tools/data/hsk-2025-l1-l2.tsv';
const WEEKS = 12;
const MAX_DEFS = 3;
const MAX_SENTENCES = 3;

const args = process.argv.slice(2);
const argOf = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const sampleWords = argOf('--sample')?.split(',');
const outPath = argOf('--out') ?? 'src/data/vocab.json';

// ---------- pinyin helpers ----------

const MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'], e: ['ē', 'é', 'ě', 'è'], i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'], u: ['ū', 'ú', 'ǔ', 'ù'], ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** "lu:4" → "lǜ", "hao3" → "hǎo", "r5" → "r" */
export function numberedToMarked(syl: string): string {
  const m = /^([a-zü:]+?)([1-5])?$/i.exec(syl.replace(/u:|v/g, 'ü'));
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
 * Split the syllabus's tone-marked pinyin (e.g. "nǚ’ér", "bú kèqi") into syllables using the
 * CEDICT syllable sequence as the template. Returns null if the toneless forms don't align.
 */
function alignSyllables(official: string, cedictSyls: string[]): string[] | null {
  const off = official.replace(/[\s’'·-]/g, '').normalize('NFC');
  const out: string[] = [];
  let pos = 0;
  for (const s of cedictSyls) {
    const bare = stripTones(s.replace(/[1-5]$/, ''));
    const chunk = off.slice(pos, pos + bare.length);
    if (stripTones(chunk) !== bare) return null;
    out.push(chunk);
    pos += bare.length;
  }
  return pos === off.length ? out : null;
}

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
  const e = { trad, simp, syls: py.split(' '), senses: defs.split('/') };
  (cedict.get(simp) ?? cedict.set(simp, []).get(simp)!).push(e);
  for (const c of trad) tradChars.add(c);
  for (const c of simp) simpChars.add(c);
}
const tradOnly = new Set([...tradChars].filter((c) => !simpChars.has(c)));

const DROP_SENSE = [
  /^(old |archaic |unofficial |erroneous )?variant of/i,
  /^(see |used in |surname [A-Z]|abbr\. for|CL:|Taiwan pr\.|also pr\.|also written|pr\. )/,
  /^\((archaic|old|literary|dialect|Cantonese|Tw|Taiwan|slang|vulgar|derog\.|offensive|obscene)/i,
  /vulgar|obscene|offensive|sexual/i,
];

const cleanSense = (s: string) =>
  s
    // 得[de2] / 無|无[wu2] → 得 (dé) / 无 (wú)
    .replace(/(?:[^\s|[\]]+\|)?([^\s|[\]]+)\[([^\]]+)\]/g, (_, hz: string, py: string) =>
      `${hz} (${py.split(' ').map(numberedToMarked).join('')})`)
    .trim();

/** "erhua variant of 麵條|面条[mian4 tiao2]" → the base word's senses */
function erhuaBase(senses: string[]): string[] {
  return senses.flatMap((s) => {
    const m = /^erhua variant of (?:[^|[]+\|)?([^|[]+)\[([^\]]+)\]/.exec(s);
    if (!m) return [s];
    const base = (cedict.get(m[1]) ?? []).find((e) => e.syls.join(' ') === m[2]);
    return base ? base.senses : [];
  });
}

function pickDefinitions(entries: CedictEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries)
    for (const s of erhuaBase(e.senses)) {
      if (!s || DROP_SENSE.some((r) => r.test(s))) continue;
      const c = cleanSense(s);
      if (!out.includes(c)) out.push(c);
    }
  return out.slice(0, MAX_DEFS);
}

// ---------- HSK list ----------

const POS: Record<string, string> = {
  名: 'noun', 动: 'verb', 形: 'adjective', 副: 'adverb', 代: 'pronoun', 数: 'numeral',
  量: 'measure word', 介: 'preposition', 连: 'conjunction', 助: 'particle', 叹: 'interjection',
  拟声: 'onomatopoeia', 数量: 'numeral-measure', 前缀: 'prefix', 后缀: 'suffix',
};

interface HskRow { id: number; level: 1 | 2; hanzi: string; pinyin: string; pos: string }

const hskRows: HskRow[] = readFileSync(HSK_TSV, 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#') && !l.startsWith('id\t'))
  .map((l) => {
    const [id, level, , hanzi, pinyin, pos] = l.split('\t');
    return { id: Number(id), level: Number(level) as 1 | 2, hanzi, pinyin, pos };
  });

// Homographs with identical hanzi + reading (点1/点2, 花1/花2) merge into one entry at the lower level.
const merged = new Map<string, HskRow & { posList: string[] }>();
for (const r of hskRows) {
  const key = `${r.hanzi}|${stripTones(r.pinyin.replace(/[\s’']/g, ''))}|${r.pinyin}`;
  // Only parenthesis-free POS belong to this level; parenthesised ones are later-level senses.
  const pos = r.pos.replace(/（[^）]*）/g, '').split('、').filter(Boolean).map((p) => POS[p] ?? p);
  const prev = merged.get(key);
  if (prev) prev.posList.push(...pos.filter((p) => !prev.posList.includes(p)));
  else merged.set(key, { ...r, posList: pos });
}
const hskWords = new Set(hskRows.map((r) => r.hanzi));
// Erhua entries (面条儿) also index their base form so plain-form sentences can be found.
const indexWords = new Set([...hskWords, ...[...hskWords].filter((w) => w.length > 1 && w.endsWith('儿')).map((w) => w.slice(0, -1))]);

// ---------- join ----------

interface Joined { row: HskRow & { posList: string[] }; syls: string[]; defs: string[]; quality: string }
const joined: Joined[] = [];
const unmatched: string[] = [];
const warnings: string[] = [];

for (const row of merged.values()) {
  const cands = cedict.get(row.hanzi) ?? [];
  // Score: 3 = exact tones; 2 = differs only by 一/不 sandhi or neutral-vs-full tone; 1 = toneless only.
  let best: { score: number; rank: number; syls: string[]; aligned: string[]; entries: CedictEntry[] } | null = null;
  for (const e of cands) {
    const aligned = alignSyllables(row.pinyin.split('/')[0], e.syls);
    if (!aligned) continue;
    let score = 3;
    aligned.forEach((a, i) => {
      const ot = toneOf(a), ct = Number(e.syls[i].slice(-1)) || 5;
      if (ot === ct) return;
      const sandhi = '一不'.includes(row.hanzi[i]);
      score = Math.min(score, sandhi || ot === 5 || ct === 5 ? 2 : 1);
    });
    // Proper-noun (capitalised) readings only win when nothing lowercase matches as well.
    const rank = score * 2 + (/^[a-z]/.test(e.syls[0]) ? 1 : 0);
    const key = e.syls.join(' ');
    if (!best || rank > best.rank) best = { score, rank, syls: e.syls, aligned, entries: [e] };
    else if (rank === best.rank && best.syls.join(' ') === key) best.entries.push(e);
  }
  if (!best) { unmatched.push(`${row.id} ${row.hanzi} ${row.pinyin}`); continue; }
  if (best.score === 1) warnings.push(`tone mismatch: ${row.hanzi} syllabus=${row.pinyin} cedict=${best.syls.join(' ')}`);
  // Surface tones from the syllabus drive pinyinNumbered (so 一下 → yi2 xia4, matching the display).
  const numbered = best.aligned
    .map((a, i) => best!.syls[i].replace(/[1-5]$/, '').toLowerCase().replace('u:', 'v') + toneOf(a))
    .join(' ');
  const defs = pickDefinitions(best.entries);
  if (!defs.length) { unmatched.push(`${row.id} ${row.hanzi} ${row.pinyin} (no usable senses)`); continue; }
  joined.push({ row, syls: numbered.split(' '), defs, quality: ['', 'toneless', 'sandhi/neutral', 'exact'][best.score] });
}

// ---------- Tatoeba ----------

const engIds = new Map<number, number[]>();
for (const l of readFileSync(`${SRC}/tatoeba/cmn-eng_links.tsv`, 'utf8').split('\n')) {
  const [a, b] = l.split('\t').map(Number);
  if (a && b) (engIds.get(a) ?? engIds.set(a, []).get(a)!).push(b);
}

// transcriptions.csv rows: id, lang, script, reviewer, text. For a cmn sentence it carries the *other*
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

interface Token { w: string; at: number } // `at` = index into the sentence's Han characters

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

interface Cand { id: number; text: string; tokens: Token[]; syls: string[]; latn: string; reviewed: boolean; oov: number }
const byWord = new Map<string, Cand[]>();
const freq = new Map<string, number>();
let skippedAlign = 0;

for (const l of readFileSync(`${SRC}/tatoeba/cmn_sentences.tsv`, 'utf8').split('\n')) {
  const [idS, , original] = l.split('\t');
  if (!original) continue;
  const id = Number(idS);
  const text = hansOf.get(id) ?? original.trim();
  const han = [...text].filter(isHan);
  if (han.length < 3 || han.length > 20) continue;
  if (han.some((c) => tradOnly.has(c))) continue; // belt and braces: simplified only
  const tr = latn.get(id);
  if (!engIds.has(id) || !tr) continue;
  const syls = tr.text.match(SYLLABLE) ?? [];
  if (syls.length !== han.length) { skippedAlign++; continue; }
  const tokens = tokenize(text);
  for (const t of tokens) freq.set(t.w, (freq.get(t.w) ?? 0) + 1);
  const oov = tokens.filter((t) => !hskWords.has(t.w)).length;
  const cand = { id, text, tokens, syls, latn: tr.text, reviewed: tr.reviewed, oov };
  for (const w of new Set(tokens.map((t) => t.w))) if (indexWords.has(w)) (byWord.get(w) ?? byWord.set(w, []).get(w)!).push(cand);
}

/** Tone-insensitive where Tatoeba's citation tones legitimately differ: neutral tone and 一/不 sandhi. */
const sameSyllable = (tatoeba: string, card: string, ch: string) => {
  const t = tatoeba.toLowerCase();
  if (t.slice(0, -1) !== card.slice(0, -1)) return false;
  const a = t.slice(-1), b = card.slice(-1);
  return a === b || a === '5' || b === '5' || '一不'.includes(ch);
};

/** The sentence must use the card's reading of the word: rejects 我只吃肉 (zhǐ) for the 只 zhī card. */
const usesReading = (c: Cand, word: string, cardSyls: string[]) =>
  c.tokens.some((t) =>
    word.startsWith(t.w) && t.w.length >= word.length - 1 &&
    [...t.w].every((ch, k) => sameSyllable(c.syls[t.at + k], cardSyls[k], ch)));

const pickSentences = (word: string, cardSyls: string[]): Cand[] => {
  const seen = new Set<string>();
  const pool = byWord.get(word) ?? (word.endsWith('儿') ? byWord.get(word.slice(0, -1)) : undefined);
  return (pool ?? [])
    .filter((c) => usesReading(c, word, cardSyls))
    .sort((a, b) => a.oov - b.oov || Number(b.reviewed) - Number(a.reviewed) || a.text.length - b.text.length || a.id - b.id)
    .filter((c) => !seen.has(c.text) && seen.add(c.text))
    .slice(0, MAX_SENTENCES);
};

const chosen = new Map<string, Cand[]>();
const neededEng = new Set<number>();
for (const j of joined) {
  const s = pickSentences(j.row.hanzi, j.syls);
  chosen.set(j.row.hanzi, s);
  for (const c of s) for (const e of engIds.get(c.id)!) neededEng.add(e);
}

const english = new Map<number, string>();
for (const l of readFileSync(`${SRC}/tatoeba/eng_sentences.tsv`, 'utf8').split('\n')) {
  const tab = l.indexOf('\t');
  const id = Number(l.slice(0, tab));
  if (neededEng.has(id)) english.set(id, l.slice(l.indexOf('\t', tab + 1) + 1).trim());
}

// ---------- week assignment: L1 before L2, then Tatoeba corpus frequency, then syllabus order ----------

joined.sort((a, b) =>
  a.row.level - b.row.level || (freq.get(b.row.hanzi) ?? 0) - (freq.get(a.row.hanzi) ?? 0) || a.row.id - b.row.id);

// ---------- emit ----------

const sha1 = (s: string) => createHash('sha1').update(s, 'utf8').digest('hex');

const entries: VocabEntry[] = joined.map((j, rank) => {
  const sentences: Sentence[] = chosen.get(j.row.hanzi)!.map((c) => ({
    simplified: c.text,
    pinyin: c.latn.replace(SYLLABLE, numberedToMarked),
    english: english.get(engIds.get(c.id)![0]) ?? '',
    source: 'tatoeba',
    tatoebaId: c.id,
  }));
  const pinyinNumbered = j.syls.join(' ');
  return {
    id: `w-${String(j.row.id).padStart(4, '0')}`,
    simplified: j.row.hanzi,
    pinyin: j.row.pinyin.split('/')[0].replace(/\s+/g, ''),
    pinyinNumbered,
    definitions: j.defs,
    hskLevel: j.row.level,
    week: Math.floor((rank * WEEKS) / joined.length) + 1,
    ...(j.row.posList.length ? { partOfSpeech: j.row.posList.join(', ') } : {}),
    audioFile: `${sha1(`${j.row.hanzi}|${pinyinNumbered}`)}.opus`,
    candidateSentences: sentences.filter((s) => s.english),
  };
});

const out = sampleWords ? entries.filter((e) => sampleWords.includes(e.simplified)) : entries;
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

const q = new Map<string, number>();
for (const j of joined) q.set(j.quality, (q.get(j.quality) ?? 0) + 1);
const noSent = entries.filter((e) => !e.candidateSentences.length);
console.log(`syllabus rows ${hskRows.length}, merged entries ${merged.size}, joined ${joined.length}`);
console.log(`match quality: ${[...q].map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`unmatched (${unmatched.length}):\n  ${unmatched.join('\n  ')}`);
console.log(`warnings (${warnings.length}):\n  ${warnings.join('\n  ')}`);
console.log(`entries with 0 sentences (${noSent.length}): ${noSent.map((e) => e.simplified).join(' ')}`);
console.log(`sentence count histogram: ${[0, 1, 2, 3].map((n) => `${n}:${entries.filter((e) => e.candidateSentences.length === n).length}`).join(' ')}`);
console.log(`sentences skipped (Han/pinyin syllable count mismatch): ${skippedAlign}`);
console.log(`wrote ${out.length} entries → ${outPath}`);
