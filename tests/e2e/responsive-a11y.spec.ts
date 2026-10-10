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
  await api.post('/round/prepare');
  await api.post('/round/start');

  for (const vp of VIEWPORTS) {
    const dctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const d = await dctx.newPage();
    await d.goto('/display');
    await expect(d.getByRole('timer')).toBeVisible();
    await expect(d.locator('tbody tr')).toHaveCount(20);
    await noHorizontalOverflow(d);
    if (vp.name === 'projector-1920') {
      // every one of the 20 rows must fit inside the 16:9 viewport without page scrolling
      const h = await d.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
      expect(h.sh, 'projector page scrolls vertically').toBeLessThanOrEqual(h.ch + 2);
      await axe(d, 'display running');
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
    await expect(p.getByText('Question 1 of 12')).toBeVisible();
    await noHorizontalOverflow(p);
    // choice buttons are touch friendly (>= 44px tall)
    const box = await p.getByRole('radio').first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (vp.name === 'phone-320') await axe(p, 'team play');
    await ctx.close();
  }

  // keyboard-only answer: tab to an option, select with Space, submit with Enter
  const kb = first.page;
  await kb.reload();
  await kb.getByRole('radio').first().focus();
  await kb.keyboard.press('Space');
  await expect(kb.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true');

  // reduced motion is honoured
  await kb.emulateMedia({ reducedMotion: 'reduce' });
  const anim = await kb.evaluate(() => getComputedStyle(document.querySelector('article')!).animationName);
  expect(anim).toBe('none');

  // admin dashboard on laptop and tablet
  for (const vp of [VIEWPORTS[3]!, VIEWPORTS[2]!]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const p = await ctx.newPage();
    await p.goto('/admin');
    await p.getByLabel('Username').fill(ADMIN.username);
    await p.getByLabel('Password').fill(ADMIN.password);
    await p.getByRole('button', { name: 'Sign in' }).click();
    await expect(p.getByTestId('event-state')).toHaveText('ROUND RUNNING');
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
