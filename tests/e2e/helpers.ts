import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SEED_ROUNDS } from '../../server/content/seed.js';

export const ADMIN = { username: 'e2eadmin', password: 'e2e-admin-password' };
export const MOBILE = { width: 375, height: 667 };
export const PROJECTOR = { width: 1920, height: 1080 };

export class AdminApi {
  csrf = '';
  constructor(readonly req: APIRequestContext) {}
  async login() {
    const r = await this.req.post('/api/admin/login', { data: ADMIN });
    expect(r.ok()).toBeTruthy();
    this.csrf = (await r.json()).csrfToken;
  }
  async post(path: string, data: unknown = {}) {
    const r = await this.req.post(`/api/admin${path}`, { data, headers: { 'x-csrf-token': this.csrf } });
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
    return r.json();
  }
  async patch(path: string, data: unknown) {
    const r = await this.req.patch(`/api/admin${path}`, { data, headers: { 'x-csrf-token': this.csrf } });
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
  }
  async state() {
    return (await this.req.get('/api/admin/state')).json();
  }
}

export const answerFor = (level: number, pos: number) => SEED_ROUNDS[level - 1]!.challenges[pos]!.answers[0]!;
export const stageCount = (level: number) => SEED_ROUNDS[level - 1]!.challenges.length;

/** Fills the join form on a fresh mobile page. */
export async function registerTeam(browser: Browser, pin: string, name: string, p1: string, p2: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: MOBILE, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`/join?pin=${pin}`);
  await page.getByLabel(/Team name/).fill(name);
  await page.getByLabel('Player 1 name').fill(p1);
  await page.getByLabel('Player 2 name').fill(p2);
  await page.getByRole('button', { name: 'Register team' }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  return { ctx, page };
}

/** Submit answers through the team's own authenticated session (same cookie as the browser). */
export async function apiAnswer(page: Page, answer: string, challengeId?: number) {
  const r = await page.request.post('/api/team/answer', { data: { requestId: Math.random().toString(36).slice(2) + Date.now(), answer, challengeId } });
  return r.json() as Promise<{ outcome: string; points: number; advanced: boolean }>;
}

/** Plays out a live round via the teams' own sessions, using the host's API to move between phases. */
export async function playLiveRound(admin: AdminApi, pages: Page[], level: number, pick: (team: number, q: number) => 'right' | 'wrong' | null, fromQuestion = 0) {
  for (let guard = 0; guard < 40; guard++) {
    const s = await admin.state();
    if (s.event.state !== 'ROUND_RUNNING') return;
    const round = s.rounds.find((r: { id: number }) => r.id === s.event.currentRoundId);
    const q = round.liveIndex as number;
    if (round.livePhase === 'open' && q >= fromQuestion) {
      for (let i = 0; i < pages.length; i++) {
        const p = pick(i, q);
        if (p === null) continue;
        const ans = answerFor(level, q);
        const wrong = ans === 'a' ? 'b' : 'a';
        await pages[i]!.request.post('/api/team/answer', { data: { requestId: Math.random().toString(36).slice(2) + Date.now(), answer: p === 'right' ? ans : wrong } });
      }
    }
    const mid = await admin.state();
    if (mid.event.state !== 'ROUND_RUNNING') return;
    if (mid.rounds.find((r: { id: number }) => r.id === mid.event.currentRoundId).livePhase === 'open') await admin.post('/round/live/advance');
    await admin.post('/round/live/advance');
  }
  throw new Error('live round did not finish');
}

/** Level 3 (Quick Brain) is the self-paced quiz. */
export async function solveQuiz(page: Page, from: number) {
  for (let i = from; i < stageCount(3); i++) {
    const r = await apiAnswer(page, answerFor(3, i));
    expect(r.outcome).toBe('correct');
  }
}

/** Plays Tech Faces and Tech Bingo with nobody answering so the next round to prepare is Quick Brain. */
export async function skipIntroRounds(admin: AdminApi) {
  for (let i = 0; i < 2; i++) {
    await admin.post('/round/prepare');
    await admin.post('/round/start');
    await admin.post('/round/end');
  }
}

export async function noHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth;
    // name the elements that stick out (decorative fixed backdrops cannot scroll the page, so they are ignored)
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > cw + 1 && !el.closest('.bd, .intro, .bd-confetti'))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
    return { sw: document.documentElement.scrollWidth, cw, wide };
  });
  expect(o.sw, `scrollWidth ${o.sw} > clientWidth ${o.cw}; wide elements: ${o.wide.join(' | ')}`).toBeLessThanOrEqual(o.cw);
}

/** The projector never scrolls: the page is no taller than the screen. */
export async function fitsProjector(page: Page, label: string) {
  const h = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(h.sh, `${label}: the projector page scrolls vertically`).toBeLessThanOrEqual(h.ch + 2);
}

/** A question on a phone must be answerable without scrolling: the page is no taller than the window and Lock in is on screen. */
export async function fitsOneScreen(page: Page) {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const lock = [...document.querySelectorAll('button')].find((b) => /Lock in/.test(b.textContent ?? ''));
    return { sh: de.scrollHeight, ch: de.clientHeight, vh: window.innerHeight, lockBottom: lock?.getBoundingClientRect().bottom ?? null };
  });
  expect(m.sh, 'the question page scrolls vertically').toBeLessThanOrEqual(m.ch + 1);
  expect(m.lockBottom, 'no Lock in button on the question page').not.toBeNull();
  expect(m.lockBottom!, 'Lock in button is below the fold').toBeLessThanOrEqual(m.vh);
}
