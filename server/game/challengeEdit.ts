/**
 * Pure rules for the host editing a question and its answer key (admin -> Rounds & scoring).
 * Everything here throws ChallengeEditError with a message written for the host; the engine turns it into HTTP 400.
 *
 * What may change:  title, prompt, the text of each option, and which answer(s) are correct.
 * What may not:     the kind of question, the option letters (a, b, c ...) or how many options there are,
 *                   because live bookkeeping and the bingo cards are keyed by them.
 */
import type { ChallengeKind, RoundKind } from '../../shared/types.js';
import { normalizeText, parseNumber } from './normalize.js';

export class ChallengeEditError extends Error {}

export interface EditableOption {
  id: string;
  text: string;
  /** Bingo tiles carry an emoji. */
  icon?: string;
}

export interface Editable {
  kind: ChallengeKind;
  title: string;
  prompt: string;
  options: EditableOption[] | null;
  answers: string[];
}

export interface EditPatch {
  title?: string;
  prompt?: string;
  /** New texts for the existing option letters. */
  options?: { id: string; text: string }[];
  answers?: string[];
}

export const LIMITS = { title: 60, prompt: 500, option: 80, answer: 100, answers: 10, tile: 24, icon: 12 } as const;

const CONTROL = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex -- rejecting control characters is the point

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function need(value: string, what: string, max: number): string {
  const v = clean(value);
  if (v.length === 0) throw new ChallengeEditError(`${what} cannot be empty.`);
  if (v.length > max) throw new ChallengeEditError(`${what} can be at most ${max} characters.`);
  if (CONTROL.test(v)) throw new ChallengeEditError(`${what} contains characters that are not allowed.`);
  return v;
}

/** Applies the host's edit to one question and returns the new version. Throws if the result would not be playable. */
export function applyEdit(cur: Editable, roundKind: RoundKind, patch: EditPatch): Editable {
  const next: Editable = { ...cur, options: cur.options ? cur.options.map((o) => ({ ...o })) : null, answers: [...cur.answers] };

  if (patch.title !== undefined) next.title = need(patch.title, 'The title', LIMITS.title);
  if (patch.prompt !== undefined) next.prompt = need(patch.prompt, roundKind === 'bingo' ? 'The clue' : 'The question', LIMITS.prompt);

  if (patch.options !== undefined) {
    if (cur.kind !== 'choice' || !cur.options) throw new ChallengeEditError('This question has no options to edit.');
    if (roundKind === 'bingo') throw new ChallengeEditError('Bingo tiles are shared by every call: edit them in the Bingo tiles panel.');
    const incoming = new Map(patch.options.map((o) => [o.id, o.text]));
    if (incoming.size !== patch.options.length || incoming.size !== cur.options.length || !cur.options.every((o) => incoming.has(o.id))) {
      throw new ChallengeEditError('Every option must keep its letter, and options cannot be added or removed.');
    }
    next.options = cur.options.map((o) => ({ ...o, text: need(incoming.get(o.id)!, `Option ${o.id.toUpperCase()}`, LIMITS.option) }));
    const seen = new Set<string>();
    for (const o of next.options) {
      const key = normalizeText(o.text);
      if (seen.has(key)) throw new ChallengeEditError(`Two options read "${o.text}". Every option needs different text.`);
      seen.add(key);
    }
  }

  if (patch.answers !== undefined) {
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const raw of patch.answers) {
      const a = need(raw, 'An answer', LIMITS.answer);
      const key = cur.kind === 'number' ? String(parseNumber(a) ?? a) : cur.kind === 'choice' ? a.toLowerCase() : normalizeText(a);
      if (!seen.has(key)) {
        seen.add(key);
        cleaned.push(cur.kind === 'choice' ? a.toLowerCase() : a);
      }
    }
    if (cleaned.length === 0) throw new ChallengeEditError('A question needs at least one correct answer.');
    if (cleaned.length > LIMITS.answers) throw new ChallengeEditError(`At most ${LIMITS.answers} accepted answers.`);
    if (cur.kind === 'number' && cleaned.some((a) => parseNumber(a) === null)) throw new ChallengeEditError('Numeric answers must be plain numbers such as 2007 or 3.14.');
    next.answers = cleaned;
  }

  if (next.kind === 'choice') {
    const ids = new Set((next.options ?? []).map((o) => o.id));
    if (!next.answers.every((a) => ids.has(a))) throw new ChallengeEditError('The correct answer must be one of the options.');
    if (roundKind === 'bingo' && next.answers.length !== 1) throw new ChallengeEditError('A bingo call names exactly one tile.');
  }
  return next;
}

/** New names/emoji for the shared bingo tiles. The letters stay, so every call and every team's card still lines up. */
export function applyTileEdit(current: EditableOption[], incoming: { id: string; text: string; icon: string }[]): EditableOption[] {
  const byId = new Map(incoming.map((t) => [t.id, t]));
  if (byId.size !== incoming.length || byId.size !== current.length || !current.every((t) => byId.has(t.id))) {
    throw new ChallengeEditError('Every tile must keep its place: send all tiles, none added or removed.');
  }
  const out = current.map((t) => {
    const n = byId.get(t.id)!;
    const icon = clean(n.icon);
    if (icon.length > LIMITS.icon || CONTROL.test(icon)) throw new ChallengeEditError(`The emoji for tile ${t.id.toUpperCase()} is not valid.`);
    return { id: t.id, text: need(n.text, `Tile ${t.id.toUpperCase()}`, LIMITS.tile), icon };
  });
  const seen = new Set<string>();
  for (const t of out) {
    const key = normalizeText(t.text);
    if (seen.has(key)) throw new ChallengeEditError(`Two tiles are called "${t.text}". Every tile needs a different name.`);
    seen.add(key);
  }
  return out;
}
