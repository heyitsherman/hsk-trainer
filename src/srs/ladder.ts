// Card-type promotion (PRD §9.1). Rule pending owner decision; see task 8.

import type { HskDb } from '../db/schema';

export async function promoteAll(_db: HskDb, _now: number): Promise<number> {
  return 0;
}
