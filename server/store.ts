// Small JSON files under data/ for what the server must remember between restarts.
// Everything in that folder is runtime data and may hold visitors' emails, so it must never be committed:
// the folder gets its own .gitignore that ignores all of it.
import fs from 'node:fs';
import path from 'node:path';

export function readJson<T>(file: string | null, fallback: T): T {
  if (!file) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; }
}

/** Write the whole file in one step. A disk that cannot be written must not take the server down. */
export function writeJson(file: string | null, value: unknown): boolean {
  if (!file) return true;
  try {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const guard = path.join(dir, '.gitignore');
    if (!fs.existsSync(guard)) fs.writeFileSync(guard, '# runtime data, may hold visitors\' emails: never commit\n*\n');
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/** Thrown for input a visitor can fix; the message is safe to show. */
export class InputError extends Error {}

/** Plain text on one line: no control characters, single spaces, trimmed. */
export const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

export const looksLikeEmail = (s: string) => s.length <= 120 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
