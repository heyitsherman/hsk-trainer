// Shared data model (PRD §6). Timestamps are epoch milliseconds; see CLAUDE.md.

export type CardType = 'recognition' | 'audio' | 'production' | 'cloze';
export type Grade = 1 | 2 | 3 | 4; // Again / Hard / Good / Easy

export interface Sentence {
  simplified: string;
  pinyin: string; // '' for user-written sentences
  english: string;
  source: 'tatoeba' | 'user';
  tatoebaId?: number;
  audioFile?: string; // pre-generated for Tatoeba candidates; user sentences use Web Speech
}

export interface VocabEntry {
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

/** ts-fsrs Card fields (v5.4.2), with Date fields stored as epoch ms. */
export interface CardRow {
  id: string; // `${vocabId}:${type}`
  vocabId: string;
  type: CardType;
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number; // deprecated in ts-fsrs 6; kept for round-tripping
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // ts-fsrs State: 0 New, 1 Learning, 2 Review, 3 Relearning
  last_review: number | null;
  createdAt: number;
}

export interface ActivatedWord {
  vocabId: string;
  activatedAt: number;
  chosenSentence: Sentence | null;
  userNote?: string;
}

export interface ReviewLogRow {
  id?: number;
  cardId: string;
  rating: Grade;
  reviewedAt: number;
  durationMs: number;
  stabilityAfter: number;
}

export interface WeekProgress {
  week: number;
  tasksCompleted: number[]; // indexes into the module's tasks
  assignmentText: string;
  notesText: string;
  curatedAt: number | null;
  completedAt: number | null;
  finalProject?: string[]; // week 12 only: the course page's three final-project parts
}

export interface AppSettings {
  newCardsPerDay: number;
  dailyReviewCap: number;
  syncEnabled: boolean;
  syncToken: string | null;
  lastSyncAt: number | null;
  startDate: string; // ISO date
  installDismissedAt: number | null;
  theme: 'dark' | 'light';
  createdAt: number; // first run; drives the 14-day new-card lock (PRD §9.3)
  persistGranted: boolean | null; // navigator.storage.persist() result (PRD §4)
}
