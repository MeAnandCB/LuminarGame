import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, AdminApi, PROJECTOR, noHorizontalOverflow, playLiveRound, registerTeam } from './helpers';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 140)}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

// Creates its own event. Files run alphabetically and event.spec.ts expects an empty database, so keep this name sorted after it.
test('host sets a cut-off in the admin: the field narrows after the round and everyone sees who is through', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Cut-off Arena' });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;
  const alpha = await registerTeam(browser, pin, 'Alpha Wolves', 'Asha', 'Arun');
  const beta = await registerTeam(browser, pin, 'Beta Hawks', 'Bela', 'Bram');
  const gamma = await registerTeam(browser, pin, 'Gamma Owls', 'Gita', 'Gopi');
  await api.post('/registration/confirm');

  // ---- the host sets the plan in the Event tab ----------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await ctx.newPage();
  await admin.goto('/admin');
  await admin.getByLabel('Username').fill(ADMIN.username);
  await admin.getByLabel('Password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('tab', { name: 'Event' }).click();

  const plan = admin.getByTestId('advancement');
  const afterLevel1 = plan.getByLabel(/keep playing after Level 1/);
  await expect(afterLevel1).toHaveValue('');
  await expect(plan.getByText('3 → 3 → 3 → 3 → 3')).toBeVisible();
  await afterLevel1.fill('2');
  await expect(plan.getByText('3 → 2 → 2 → 2 → 2')).toBeVisible();
  await axe(admin, 'admin event tab with a cut-off');

  // a plan that widens the field again is explained and cannot be saved
  const afterLevel3 = plan.getByLabel(/keep playing after Level 3/);
  await afterLevel3.fill('3');
  await expect(plan.getByRole('alert')).toContainText('cannot keep 3');
  await expect(admin.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  await axe(admin, 'admin event tab with a rejected plan');
  await afterLevel3.fill('');
  await expect(plan.getByRole('alert')).toHaveCount(0);

  await admin.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(async () => (await api.state()).event.settings.advance).toEqual([2, null, null]);
  await admin.reload();
  await admin.getByRole('tab', { name: 'Event' }).click();
  await expect(admin.getByTestId('advancement').getByLabel(/keep playing after Level 1/)).toHaveValue('2');

  // ---- Level 1: Alpha is perfect, Beta answers half, Gamma sits it out -------------
  await api.post('/round/prepare');
  await api.post('/round/start');
  await playLiveRound(api, [alpha.page, beta.page, gamma.page], 1, (team, q) => (team === 0 ? 'right' : team === 1 && q < 5 ? 'right' : null));
  expect((await api.state()).event.state).toBe('ROUND_ENDED');

  // phones: the verdict appears on the round-finished card
  await expect(alpha.page.getByTestId('cut-through')).toHaveText('✔ You move on to Level 2!');
  await expect(beta.page.getByTestId('cut-through')).toBeVisible();
  await expect(gamma.page.getByTestId('cut-out')).toHaveText('You did not make the cut for Level 2 – thank you for playing!');
  await expect(gamma.page.getByText('Out after L1')).toBeVisible();

  // projector: banner plus an "Out" badge next to the cut team
  const proj = await browser.newContext({ viewport: PROJECTOR });
  const display = await proj.newPage();
  await display.goto('/display');
  await expect(display.getByTestId('cutoff-banner')).toContainText('2 teams move on to Level 2');
  await expect(display.getByTestId('cutoff-banner')).toContainText('1 team is out');
  await expect(display.getByRole('row', { name: /Gamma Owls/ })).toContainText('Out · L1');
  await expect(display.getByRole('row', { name: /Alpha Wolves/ })).not.toContainText('Out');
  await axe(display, 'projector after a cut-off');
  await noHorizontalOverflow(display);
  await axe(gamma.page, 'phone of a cut team');

  // host dashboard: who is out, and it is final only once the next round is prepared
  await admin.getByRole('tab', { name: 'Control' }).click();
  await expect(admin.getByTestId('cutoff-panel')).toContainText('2 teams move on, 1 out');
  await expect(admin.getByTestId('cutoff-panel')).toContainText('Gamma Owls');
  await admin.waitForTimeout(500); // let the tab buttons finish their colour transition before axe measures contrast
  await axe(admin, 'admin control tab with a cut-off panel');

  // ---- Level 2: the cut team sits it out ------------------------------------------
  await api.post('/round/prepare');
  await expect(gamma.page.getByText('Your team was cut after Level 1. Thank you for playing!')).toBeVisible();
  await expect(alpha.page.getByText('Your team was cut')).toHaveCount(0);
  await expect(display.getByTestId('cutoff-banner')).toHaveCount(0);

  await ctx.close();
  await proj.close();
  for (const t of [alpha, beta, gamma]) await t.ctx.close();
});
