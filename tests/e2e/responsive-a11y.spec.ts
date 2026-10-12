import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, AdminApi, noHorizontalOverflow, registerTeam } from './helpers';

test.describe.configure({ mode: 'serial' });

const VIEWPORTS = [
  { name: 'phone-320', width: 320, height: 640 },
  { name: 'phone-375', width: 375, height: 667 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'laptop-1280', width: 1280, height: 800 },
  { name: 'projector-1920', width: 1920, height: 1080 },
];

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 140)}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

test('layouts have no horizontal overflow and pass automated accessibility checks at every size', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Responsive Arena' });
  await api.patch('/event', { settings: { autoApprove: true } });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;

  // join screen at every width
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(`/join?pin=${pin}`);
    await expect(page.getByRole('button', { name: 'Register team' })).toBeVisible();
    await noHorizontalOverflow(page);
    if (vp.name === 'phone-320' || vp.name === 'laptop-1280') await axe(page, `join ${vp.name}`);
    await ctx.close();
  }

  // 20 teams fill the projector's registration + leaderboard views
  const first = await registerTeam(browser, pin, 'The Quick Brown Foxes 01', 'Anna', 'Ben');
  for (let i = 2; i <= 20; i++) {
    const r = await first.page.context().browser()!.newContext();
    const resp = await r.request.post('/api/team/join', { data: { pin, name: `Squad ${String(i).padStart(2, '0')}`, players: [`P${i}a`, `P${i}b`] } });
    expect(resp.status()).toBe(201);
    await r.close();
  }

  const display = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const dp = await display.newPage();
  await dp.goto('/display');
  await expect(dp.getByLabel('Team slots').getByRole('listitem')).toHaveCount(20);
  await noHorizontalOverflow(dp);
  await axe(dp, 'display registration');

  await api.post('/registration/confirm');
  for (const level of [1, 2, 4]) await api.patch(`/round/${level}/config`, { questionSec: 120 }); // keep questions open while the checks run
  await api.post('/round/prepare');
  await api.post('/round/start');

  // ---- Level 1 (Tech Faces, live) with 20 teams ----------------------------------------------
  for (const vp of VIEWPORTS) {
    const dctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const d = await dctx.newPage();
    await d.goto('/display');
    await expect(d.getByRole('timer')).toBeVisible();
    await expect(d.getByRole('list', { name: 'Answer options' }).getByRole('listitem')).toHaveCount(4);
    await expect(d.locator('tbody tr')).toHaveCount(20);
    await noHorizontalOverflow(d);
    if (vp.name === 'projector-1920') {
      // every one of the 20 rows must fit inside the 16:9 viewport without page scrolling
      const h = await d.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(h.sh, 'projector page scrolls vertically').toBeLessThanOrEqual(h.ch + 2);
      await axe(d, 'display faces question');
    }
    await dctx.close();
  }

  // team play screen at phone sizes
  for (const vp of VIEWPORTS.slice(0, 3)) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.width < 500, hasTouch: true });
    const resp = await ctx.request.post('/api/team/link', { data: { pin, code: (await (await first.page.request.get('/api/team/me')).json()).team.code } });
    expect(resp.status()).toBe(201);
    const p = await ctx.newPage();
    await p.goto('/');
    await expect(p.getByText('Question 1 of 10')).toBeVisible();
    await noHorizontalOverflow(p);
    // choice buttons are touch friendly (>= 44px tall)
    const box = await p.getByRole('radio').first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (vp.name === 'phone-320') await axe(p, 'team faces question');
    await ctx.close();
  }

  // keyboard-only answer: tab to an option, select with Space
  const kb = first.page;
  await kb.reload();
  await kb.getByRole('radio').first().focus();
  await kb.keyboard.press('Space');
  await expect(kb.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');

  // reduced motion is honoured
  await kb.emulateMedia({ reducedMotion: 'reduce' });
  const anim = await kb.evaluate(() => getComputedStyle(document.querySelector('article')!).animationName);
  expect(anim).toBe('none');

  // reveal of the faces question on the projector still fits the screen
  await api.post('/round/live/advance'); // close the question -> reveal
  const fr = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await fr.goto('/display');
  await expect(fr.getByText('Reveal')).toBeVisible();
  const hf = await fr.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(hf.sh, 'faces reveal view scrolls vertically').toBeLessThanOrEqual(hf.ch + 2);
  await axe(fr, 'display faces reveal');
  await fr.context().close();

  // ---- Level 2 (Tech Bingo, live) with 20 teams: projector, phone and keyboard -----------------
  await api.post('/round/end');
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(kb.getByText(/Tech Bingo/).first()).toBeVisible();
  for (const vp of VIEWPORTS) {
    const dctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const d = await dctx.newPage();
    await d.goto('/display');
    await expect(d.getByRole('list', { name: /Bingo board/ }).getByRole('listitem')).toHaveCount(16);
    await expect(d.locator('tbody tr')).toHaveCount(20);
    await noHorizontalOverflow(d);
    if (vp.name === 'projector-1920') {
      const h = await d.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(h.sh, 'bingo projector view scrolls vertically').toBeLessThanOrEqual(h.ch + 2);
      await axe(d, 'display bingo question');
    }
    await dctx.close();
  }
  const card = kb.getByRole('group', { name: 'Your bingo card' });
  await expect(card.getByRole('button')).toHaveCount(16);
  await noHorizontalOverflow(kb);
  const cell = await card.getByRole('button').first().boundingBox();
  expect(cell!.height).toBeGreaterThanOrEqual(44);
  expect(cell!.width).toBeGreaterThanOrEqual(44);
  // keyboard: focus a tile, select it with Space, lock in with Enter on the button
  await card.getByRole('button').nth(5).focus();
  await kb.keyboard.press('Space');
  await expect(card.getByRole('button').nth(5)).toHaveAttribute('aria-pressed', 'true');
  await kb.getByRole('button', { name: /^Lock in / }).focus();
  await kb.keyboard.press('Enter');
  await expect(kb.getByText(/Answer locked in/)).toBeVisible();
  await axe(kb, 'team bingo locked');
  await api.post('/round/live/advance'); // close the call -> reveal
  await expect(kb.getByText(/The tile|Correct answer/).first()).toBeVisible();
  await noHorizontalOverflow(kb);
  const bctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const rv0 = await bctx.newPage();
  await rv0.goto('/display');
  await expect(rv0.getByText('The tile was')).toBeVisible();
  const hb = await rv0.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(hb.sh, 'bingo reveal view scrolls vertically').toBeLessThanOrEqual(hb.ch + 2);
  await axe(rv0, 'display bingo reveal');
  await bctx.close();
  // (a team may hold at most 6 devices, so the later phone checks use one extra device each)
  for (const vp of VIEWPORTS.slice(0, 1)) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });
    const resp = await ctx.request.post('/api/team/link', { data: { pin, code: (await (await first.page.request.get('/api/team/me')).json()).team.code } });
    expect(resp.status()).toBe(201);
    const p = await ctx.newPage();
    await p.goto('/');
    await expect(p.getByText(/Call \d+ of 16/)).toBeVisible();
    await noHorizontalOverflow(p);
    if (vp.name === 'phone-320') await axe(p, 'team bingo');
    await ctx.close();
  }

  // ---- Level 3 (Quick Brain, self-paced) ---------------------------------------------------------
  await api.post('/round/end');
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(kb.getByText('Question 1 of 12')).toBeVisible();
  await noHorizontalOverflow(kb);
  const qbox = await kb.getByRole('radio').first().boundingBox();
  expect(qbox!.height).toBeGreaterThanOrEqual(44);
  await axe(kb, 'team quick brain');

  // ---- Level 4 (Reel Rush, live) with 20 teams: projector, phone and keyboard -------------------
  await api.post('/round/end');
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(kb.getByText(/Reel Rush/).first()).toBeVisible();
  for (const vp of VIEWPORTS) {
    const dctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const d = await dctx.newPage();
    await d.goto('/display');
    await expect(d.getByRole('list', { name: 'Answer options' }).getByRole('listitem')).toHaveCount(4);
    await expect(d.locator('tbody tr')).toHaveCount(20);
    await noHorizontalOverflow(d);
    if (vp.name === 'projector-1920') {
      const h = await d.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(h.sh, 'live projector view scrolls vertically').toBeLessThanOrEqual(h.ch + 2);
      await axe(d, 'display live question');
    }
    await dctx.close();
  }
  await expect(kb.getByRole('radio').first()).toBeVisible();
  await noHorizontalOverflow(kb);
  const live = (await (await kb.request.get('/api/team/me')).json()).live;
  expect(live.doubleAvailable).toBe(true);
  // keyboard: choose an option with the arrow-free Space key, then lock in with Enter on the button
  await kb.getByRole('radio').nth(1).focus();
  await kb.keyboard.press('Space');
  await kb.getByRole('button', { name: 'Lock in answer' }).focus();
  await kb.keyboard.press('Enter');
  await expect(kb.getByText(/Answer locked in/)).toBeVisible();
  await axe(kb, 'team live locked');
  await api.post('/round/live/advance'); // close the question -> reveal
  await expect(kb.getByRole('status').filter({ hasText: /Correct answer|Wrong answer|No answer|Correct!/ }).first()).toBeVisible();
  await noHorizontalOverflow(kb);
  const dctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const rv = await dctx2.newPage();
  await rv.goto('/display');
  await expect(rv.getByText('Correct answer').first()).toBeVisible();
  const h2 = await rv.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(h2.sh, 'projector reveal view scrolls vertically').toBeLessThanOrEqual(h2.ch + 2);
  await axe(rv, 'display live reveal');
  await dctx2.close();

  // phone at the smallest size in the live game
  for (const vp of VIEWPORTS.slice(0, 1)) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });
    const resp = await ctx.request.post('/api/team/link', { data: { pin, code: (await (await first.page.request.get('/api/team/me')).json()).team.code } });
    expect(resp.status()).toBe(201);
    const p = await ctx.newPage();
    await p.goto('/');
    await expect(p.getByText(/Question \d+ of 12/)).toBeVisible();
    await noHorizontalOverflow(p);
    if (vp.name === 'phone-320') await axe(p, 'team live reveal');
    await ctx.close();
  }

  // admin dashboard on laptop and tablet
  for (const vp of [VIEWPORTS[3]!, VIEWPORTS[2]!]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    await p.goto('/admin');
    await p.getByLabel('Username').fill(ADMIN.username);
    await p.getByLabel('Password').fill(ADMIN.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p.getByTestId('event-state')).toHaveText('ROUND RUNNING');
    await expect(p.getByTestId('live-status')).toBeVisible();
    await noHorizontalOverflow(p);
    if (vp.name === 'laptop-1280') await axe(p, 'admin control');
    for (const tab of ['Teams', 'Rounds & scoring', 'Leaderboard', 'Audit log', 'Event']) {
      await p.getByRole('tab', { name: tab }).click();
      await noHorizontalOverflow(p);
    }
    await p.getByRole('tab', { name: 'Teams' }).click();
    await expect(p.getByRole('row')).toHaveCount(21); // header + 20 slots
    await axe(p, `admin teams ${vp.name}`);
    await ctx.close();
  }
  await first.ctx.close();
  await display.close();
  await req.dispose();
});
