# Attribution

HSK Trainer is built from the open sources below. The code is MIT ([LICENSE](LICENSE)). Data derived
from CC BY-SA sources is CC BY-SA 4.0 ([LICENSE-DATA](LICENSE-DATA)); that ShareAlike term is why the
repository is dual-licensed.

## Sources

| Source | Used for | License | Obligation |
|---|---|---|---|
| **HSK syllabus**: 《HSK 考试大纲》 *Syllabus for the Chinese Proficiency Test*, Center for Language Education and Cooperation (CLEC) / Chinese Testing International, published November 2025, effective July 2026 ([chinesetest.cn](https://www.chinesetest.cn/HSK)) | The 500-word Level 1–2 target list, levels, syllabus pinyin and parts of speech | Official syllabus; no open license granted. CLEC retains its rights. | Cited here. `tools/data/hsk-2025-l1-l2.tsv` was verified entry-by-entry against the PDF (SHA-256 `ec74ce0439e837bbb15154be13e747ae798903b2fd3a331629df6c3b45504941`). The transcription used for that check came from [hsk-3.0-vocabulary-dataset](https://github.com/uranbekanarbaev/hsk-3.0-vocabulary-dataset). |
| **CC-CEDICT**, via [MDBG](https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | Definitions (mostly single-character words), pinyin syllables | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Attribute; derived data stays CC BY-SA |
| **English Wiktionary**, via the [kaikki.org](https://kaikki.org/dictionary/Chinese/) extract made with [wiktextract](https://github.com/tatuylonen/wiktextract) (Tatu Ylonen) | Definitions for multi-character words | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (and GFDL) | Attribute; derived data stays CC BY-SA |
| **[Tatoeba](https://tatoeba.org/)** | Example sentences, their English translations and pinyin transcriptions | [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) (some sentences CC0) | Attribute. Every sentence keeps its `tatoebaId`; the original and its contributors are at `https://tatoeba.org/sentences/show/{tatoebaId}`. |
| **[Kokoro TTS](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)** (hexgrad), model Kokoro-82M-v1.1-zh, with [misaki](https://github.com/hexgrad/misaki) G2P | Generated audio in `public/audio/` | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) | Output is freely usable |
| **[FSRS](https://github.com/open-spaced-repetition)** (Jarrett Ye et al.), via [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | Review scheduling | MIT | Credited here |

## Which files carry which license

- **CC BY-SA 4.0** (dictionary- and sentence-derived): `src/data/vocab.json`,
  `tools/data/sense-overrides.tsv`, `tools/data/audio-manifest.json`, `docs/vocab-review.md`,
  `public/audio/*.opus`. Tatoeba material inside them remains under CC BY 2.0 FR as well.
- **CLEC syllabus content**: `tools/data/hsk-2025-l1-l2.tsv`. Included for reproducibility and citation only; no license is granted for it.
- **MIT**: everything else, including `src/data/schedule.json` (the owner's own course content).

## Changes made to the sources

- Definitions are **selected and reordered**, never written: at most three senses per word, archaic,
  dialectal, vulgar and cross-reference senses dropped, inline classifier notes removed. Manual
  selections are listed in `tools/data/sense-overrides.tsv`, and the build rejects any text that isn't
  in CC-CEDICT or Wiktionary.
- Tatoeba sentences in traditional characters use Tatoeba's own simplified transcription. 一/不 tone
  changes are applied to the transcription pinyin so it matches the syllabus.
