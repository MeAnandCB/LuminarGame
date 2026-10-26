import { describe, expect, it } from 'vitest';
import { ChallengeEditError, applyEdit, applyTileEdit, type Editable } from '../../server/game/challengeEdit.js';

const choice: Editable = {
  kind: 'choice',
  title: 'Web styling',
  prompt: 'Which technology controls the colours of a web page?',
  options: [{ id: 'a', text: 'SQL' }, { id: 'b', text: 'CSS' }, { id: 'c', text: 'Bash' }, { id: 'd', text: 'JSON' }],
  answers: ['b'],
};
const number: Editable = { kind: 'number', title: 'First iPhone', prompt: 'Which year?', options: null, answers: ['2007'] };
const text: Editable = { kind: 'text', title: 'Acronym', prompt: 'Expand CPU', options: null, answers: ['Central Processing Unit'] };
const tiles = [{ id: 'a', text: 'Python', icon: '🐍' }, { id: 'b', text: 'Wi-Fi', icon: '📶' }, { id: 'c', text: 'Cloud', icon: '☁️' }];
const bingoCall: Editable = { kind: 'choice', title: 'Call 1', prompt: 'Warm and wireless', options: tiles, answers: ['b'] };

const fails = (fn: () => unknown, msg: RegExp) => {
  expect(fn).toThrow(ChallengeEditError);
  expect(fn).toThrow(msg);
};

describe('editing a question', () => {
  it('changes the wording, tidying whitespace, and leaves everything else alone', () => {
    const r = applyEdit(choice, 'quiz', { title: '  Web   styling 2 ', prompt: ' Which language styles pages? ' });
    expect(r).toMatchObject({ title: 'Web styling 2', prompt: 'Which language styles pages?', answers: ['b'] });
    expect(r.options).toEqual(choice.options);
    expect(choice.prompt).toBe('Which technology controls the colours of a web page?'); // the input is never mutated
  });

  it('renames options and moves the correct answer, keeping the letters', () => {
    const r = applyEdit(choice, 'quiz', { options: [{ id: 'd', text: 'XML' }, { id: 'c', text: 'Shell' }, { id: 'b', text: 'Stylesheets' }, { id: 'a', text: 'SQL' }], answers: ['d'] });
    expect(r.options!.map((o) => `${o.id}:${o.text}`)).toEqual(['a:SQL', 'b:Stylesheets', 'c:Shell', 'd:XML']);
    expect(r.answers).toEqual(['d']);
  });

  it('refuses options that change the structure or repeat a text', () => {
    fails(() => applyEdit(choice, 'quiz', { options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] }), /keep its letter/);
    fails(() => applyEdit(choice, 'quiz', { options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }, { id: 'e', text: 'w' }] }), /keep its letter/);
    fails(() => applyEdit(choice, 'quiz', { options: [{ id: 'a', text: 'Same' }, { id: 'b', text: ' same ' }, { id: 'c', text: 'z' }, { id: 'd', text: 'w' }] }), /different text/);
    fails(() => applyEdit(choice, 'quiz', { options: [{ id: 'a', text: '' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }, { id: 'd', text: 'w' }] }), /cannot be empty/);
    fails(() => applyEdit(number, 'quiz', { options: [{ id: 'a', text: 'x' }] }), /no options/);
  });

  it('the correct answer of a choice question must be one of its options', () => {
    expect(applyEdit(choice, 'quiz', { answers: ['c'] }).answers).toEqual(['c']);
    expect(applyEdit(choice, 'quiz', { answers: ['C'] }).answers).toEqual(['c']);
    fails(() => applyEdit(choice, 'quiz', { answers: ['e'] }), /one of the options/);
    fails(() => applyEdit(choice, 'quiz', { answers: [] }), /at least one/);
  });

  it('numeric answers must be numbers; alternatives are kept once', () => {
    expect(applyEdit(number, 'quiz', { answers: ['2008', ' 2009 ', '2008.0', '2008'] }).answers).toEqual(['2008', '2009']); // 2008.0 is the same number as 2008
    expect(applyEdit(number, 'quiz', { answers: ['3.14', '-5'] }).answers).toEqual(['3.14', '-5']);
    fails(() => applyEdit(number, 'quiz', { answers: ['about 2007'] }), /plain numbers/);
    fails(() => applyEdit(number, 'quiz', { answers: ['1e3'] }), /plain numbers/);
  });

  it('text answers accept alternatives, ignoring case and spacing duplicates', () => {
    const r = applyEdit(text, 'quiz', { answers: ['Central Processing Unit', 'central  processing unit', 'CPU'] });
    expect(r.answers).toEqual(['Central Processing Unit', 'CPU']);
  });

  it('enforces length limits and rejects control characters', () => {
    fails(() => applyEdit(choice, 'quiz', { title: 'x'.repeat(61) }), /at most 60/);
    fails(() => applyEdit(choice, 'quiz', { prompt: '   ' }), /cannot be empty/);
    fails(() => applyEdit(choice, 'quiz', { prompt: 'a'.repeat(501) }), /at most 500/);
    fails(() => applyEdit(choice, 'quiz', { prompt: 'bad\u0007bell' }), /not allowed/);
    fails(() => applyEdit(text, 'quiz', { answers: Array.from({ length: 11 }, (_, i) => `answer ${i}`) }), /At most 10/);
  });

  it('keeps characters that look like markup: the UI escapes them', () => {
    expect(applyEdit(text, 'quiz', { prompt: 'What does <html> stand for?' }).prompt).toBe('What does <html> stand for?');
  });
});

describe('editing a bingo call and the shared tiles', () => {
  it('a call names exactly one of the tiles and its options are edited elsewhere', () => {
    expect(applyEdit(bingoCall, 'bingo', { answers: ['c'], prompt: 'Lives in the sky' })).toMatchObject({ answers: ['c'], prompt: 'Lives in the sky' });
    fails(() => applyEdit(bingoCall, 'bingo', { answers: ['b', 'c'] }), /exactly one tile/);
    fails(() => applyEdit(bingoCall, 'bingo', { answers: ['z'] }), /one of the options/);
    fails(() => applyEdit(bingoCall, 'bingo', { options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }), /Bingo tiles panel/);
  });

  it('tiles keep their letters while names and emoji change', () => {
    const next = applyTileEdit(tiles, [{ id: 'c', text: 'Satellite', icon: '🛰️' }, { id: 'a', text: 'Java', icon: '☕' }, { id: 'b', text: 'Wi-Fi', icon: '📶' }]);
    expect(next).toEqual([{ id: 'a', text: 'Java', icon: '☕' }, { id: 'b', text: 'Wi-Fi', icon: '📶' }, { id: 'c', text: 'Satellite', icon: '🛰️' }]);
  });

  it('refuses missing, extra or duplicate tiles', () => {
    fails(() => applyTileEdit(tiles, [{ id: 'a', text: 'x', icon: '' }, { id: 'b', text: 'y', icon: '' }]), /none added or removed/);
    fails(() => applyTileEdit(tiles, [...tiles, { id: 'd', text: 'Extra', icon: '' }]), /none added or removed/);
    fails(() => applyTileEdit(tiles, [{ id: 'a', text: 'Same', icon: '' }, { id: 'b', text: 'same', icon: '' }, { id: 'c', text: 'z', icon: '' }]), /different name/);
    fails(() => applyTileEdit(tiles, [{ id: 'a', text: '', icon: '' }, { id: 'b', text: 'y', icon: '' }, { id: 'c', text: 'z', icon: '' }]), /cannot be empty/);
    fails(() => applyTileEdit(tiles, [{ id: 'a', text: 'x', icon: 'e'.repeat(13) }, { id: 'b', text: 'y', icon: '' }, { id: 'c', text: 'z', icon: '' }]), /emoji/);
  });
});
