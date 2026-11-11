// People asking for this to be run on their own machines. Stored on the server only; no route ever returns them.
// Owner: the backend conversation.
import type { LeadInput } from '../src/lib/types';
import { InputError, looksLikeEmail, plain, readJson, writeJson } from './store';

export const MAX_LEADS = 5_000;

interface StoredLead extends LeadInput { at: string }

export function createLeadBook(opts: { file?: string | null; now?: () => Date } = {}) {
  const file = opts.file ?? null, now = opts.now ?? (() => new Date());
  const loaded = readJson<unknown>(file, []);
  const leads: StoredLead[] = Array.isArray(loaded) ? (loaded as StoredLead[]) : [];

  /** Check and keep one request. Throws InputError, in words that can be shown, when something is missing. */
  function add(input: unknown): void {
    const l = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const name = typeof l.name === 'string' ? plain(l.name) : '';
    if (name.length < 2 || name.length > 80) throw new InputError('Give a name of 2 to 80 characters.');
    const email = typeof l.email === 'string' ? l.email.trim() : '';
    if (!looksLikeEmail(email)) throw new InputError('The email does not look right.');
    const note = typeof l.note === 'string' ? plain(l.note) : '';
    if (note.length > 500) throw new InputError('Keep the note under 500 characters.');
    if (leads.length >= MAX_LEADS) throw new InputError('The list is full for now. Try again tomorrow.');
    leads.push({ name, email, ...(note ? { note } : {}), at: now().toISOString() });
    writeJson(file, leads);
  }

  return { add, count: () => leads.length };
}

export type LeadBook = ReturnType<typeof createLeadBook>;
