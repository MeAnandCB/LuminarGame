import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, AdminApi, PROJECTOR, noHorizontalOverflow } from './helpers';

const TEAMS = 60;

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 140)}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function fits(page: Page, label: string) {
  await noHorizontalOverflow(page);
  const h = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight }));
  expect(h.sh, `${label}: the projector page scrolls vertically`).toBeLessThanOrEqual(h.ch + 2);
}

// Creates its own event. Files run alphabetically and event.spec.ts expects an empty database, so keep this name sorted after it.
test('a 60-team room: the host raises the capacity and the projector still fits the screen', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Big Room' });

  // ---- the host raises the capacity in the admin ----------------------------------------
  const actx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await actx.newPage();
  await admin.goto('/admin');
  await admin.getByLabel('Username').fill(ADMIN.username);
  await admin.getByLabel('Password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('tab', { name: 'Event' }).click();
  const capacity = admin.getByLabel(/Team capacity/);
  await expect(capacity).toHaveValue('20');
  await capacity.fill(String(TEAMS));
  await admin.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(async () => (await api.state()).event.settings.maxTeams).toBe(TEAMS);

  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;
  const joiner = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  for (let i = 1; i <= TEAMS; i++) {
    const r = await joiner.post('/api/team/join', { data: { pin, name: `Team ${String(i).padStart(2, '0')} Rockets`, players: [`P${i}a`, `P${i}b`] } });
    expect(r.status(), `team ${i}`).toBe(201);
  }
  const over = await joiner.post('/api/team/join', { data: { pin, name: 'One Too Many', players: ['a', 'b'] } });
  expect(over.status()).toBe(409);

  // ---- projector: registration, then every later screen, with 60 teams ---------------------
  const dctx = await browser.newContext({ viewport: PROJECTOR });
  const d = await dctx.newPage();
  await d.goto('/display');
  await expect(d.getByLabel('Team slots').getByRole('listitem')).toHaveCount(TEAMS);
  await fits(d, 'registration');
  await axe(d, 'registration with 60 slots');

  await api.post('/registration/confirm');
  await expect(d.getByRole('heading', { name: 'Registration closed' })).toBeVisible();
  await fits(d, 'lobby');

  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(d.getByRole('timer')).toBeVisible();
  await expect(d.locator('tbody tr')).toHaveCount(20); // the top of the table; the rest is summarised
  await expect(d.getByTestId('more-teams')).toHaveText(/\+ 40 more teams/);
  await d.waitForTimeout(6000); // let the level intro finish
  await fits(d, 'live question');
  await axe(d, 'live question with 60 teams');

  await api.post('/round/end');
  await expect(d.getByText('Round standings')).toBeVisible();
  await expect(d.locator('tbody tr')).toHaveCount(20);
  await expect(d.getByTestId('more-teams')).toBeVisible();
  await fits(d, 'round standings');

  // phones and the host still see the whole field
  expect((await api.state()).leaderboard).toHaveLength(TEAMS);
  await admin.getByRole('tab', { name: 'Teams' }).click();
  await expect(admin.getByRole('heading', { name: `Team slots (${TEAMS}/${TEAMS})` })).toBeVisible();

  await api.post('/event/complete');
  await expect(d.getByText('Final standings')).toBeVisible();
  await d.waitForTimeout(4000);
  await fits(d, 'podium and final standings');
  await expect(d.locator('tbody tr')).toHaveCount(20);
  await expect(d.getByTestId('more-teams')).toBeVisible();
  await axe(d, 'final standings with 60 teams');
  for (const c of [actx, dctx]) await c.close();
});
