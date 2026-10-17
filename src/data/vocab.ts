import raw from './vocab.json';
import type { VocabEntry } from '../types';

export const vocab = raw as VocabEntry[];
export const vocabById = new Map(vocab.map((v) => [v.id, v]));
