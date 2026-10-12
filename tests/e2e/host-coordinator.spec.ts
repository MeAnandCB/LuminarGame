import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, AdminApi, noHorizontalOverflow, registerTeam } from './helpers';

// Creates its own event. Files run alphabetically and event.spec.ts expects an empty database, so keep this name sorted after it.
test('coordinator desk: see the question and answer, reveal, next question, repeat', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Coordinator Arena' });
  // generous timers: only the coordinator's clicks move this round along
  await api.patch('/round/1/config', { questionSec: 120, revealSec: 60 });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;
  const alpha = await registerTeam(browser, pin, 'Alpha Wolves', 'Asha', 'Arun');
  const beta = await registerTeam(browser, pin, 'Beta Hawks', 'Bela', 'Bram');
  await api.post('/registration/confirm');
  await api.post('/round/prepare');

  // the coordinator signs in on a device of their own
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  await page.goto('/coordinator');
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // ready to start: the answer sheet is already on screen for preparation
  await expect(page.getByTestId('coord-headline')).toHaveText('Level 1 - Tech Faces is ready');
  await expect(page.getByRole('list').getByText('Steve Jobs', { exact: true })).toBeVisible();
  await page.getByTestId('coord-start').click();

  // question 1 is open: the coordinator sees the question AND its answer
  await expect(page.getByTestId('coord-progress')).toHaveText('Question 1 of 10');
  await expect(page.getByTestId('coord-phase')).toHaveText('Question open');
  await expect(page.getByTestId('coord-answer')).toContainText('Steve Jobs');
  await expect(page.getByRole('list', { name: 'Answer options' }).getByRole('listitem')).toHaveCount(4);
  await expect(page.getByRole('img', { name: 'correct answer' })).toHaveCount(1);
  await expect(page.getByTestId('coord-advance')).toHaveText(/Reveal answer/);

  // a team locks in: the answers-in counter follows live
  await alpha.page.getByRole('radio', { name: /Steve Jobs/ }).click();
  await alpha.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(page.getByTestId('coord-answered')).toHaveText('1');
  await expect(page.getByTestId('coord-phase')).toHaveText('Question open'); // Beta has not answered yet

  // reveal answer
  await page.getByTestId('coord-advance').click();
  await expect(page.getByTestId('coord-phase')).toHaveText('Answer revealed');
  await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
  await expect(page.getByText('1 of 1 teams that answered got it right.')).toBeVisible();
  await expect(alpha.page.getByText('Correct!')).toBeVisible();
  await expect(beta.page.getByText('No answer')).toBeVisible();
  await expect(page.getByTestId('coord-advance')).toHaveText(/Next question/);

  // next question
  await page.getByTestId('coord-advance').click();
  await expect(page.getByTestId('coord-progress')).toHaveText('Question 2 of 10');
  await expect(page.getByTestId('coord-phase')).toHaveText('Question open');
  await expect(page.getByTestId('coord-answer')).toContainText('Bill Gates');

  // privacy toggle for a shared screen
  await page.getByTestId('coord-hide').click();
  await expect(page.getByTestId('coord-answer')).not.toContainText('Bill Gates');
  await expect(page.getByTestId('coord-answer')).toContainText('••••••');
  await expect(page.getByRole('img', { name: 'correct answer' })).toHaveCount(0);
  await page.getByTestId('coord-hide').click();
  await expect(page.getByTestId('coord-answer')).toContainText('Bill Gates');

  // pause freezes the loop until resumed
  await alpha.page.getByRole('radio', { name: /Satya Nadella/ }).click(); // picked, not locked in yet
  await page.getByTestId('coord-pause').click();
  await expect(page.getByTestId('coord-phase')).toHaveText('⏸ Paused');
  await expect(page.getByTestId('coord-advance')).toHaveCount(0);
  // the phones keep the question on screen but cannot answer; the pick made before the pause is still there
  await expect(alpha.page.getByText('Game paused')).toBeVisible();
  await expect(alpha.page.getByRole('heading', { name: 'Face 2' })).toBeVisible();
  await expect(alpha.page.getByRole('radio', { name: /Bill Gates/ })).toBeDisabled();
  await expect(alpha.page.getByRole('radio', { name: /Satya Nadella/ })).toHaveAttribute('aria-checked', 'true');
  await expect(alpha.page.getByRole('button', { name: '⏸ Paused' })).toBeDisabled();
  await page.getByTestId('coord-resume').click();
  await expect(page.getByTestId('coord-phase')).toHaveText('Question open');
  await expect(alpha.page.getByText('Game paused')).toHaveCount(0);
  await expect(alpha.page.getByRole('radio', { name: /Bill Gates/ })).toBeEnabled();
  await expect(alpha.page.getByRole('radio', { name: /Satya Nadella/ })).toHaveAttribute('aria-checked', 'true');
  await expect(alpha.page.getByRole('button', { name: 'Lock in answer' })).toBeEnabled();

  // fits a phone and passes the accessibility scan
  await page.setViewportSize({ width: 375, height: 667 });
  await noHorizontalOverflow(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);

  // repeat to the end: the last reveal offers "Finish round" and the desk goes back to standby
  for (let q = 2; q <= 10; q++) {
    await expect(page.getByTestId('coord-progress')).toHaveText(`Question ${q} of 10`);
    await page.getByTestId('coord-advance').click(); // reveal answer
    await expect(page.getByTestId('coord-phase')).toHaveText('Answer revealed');
    if (q === 10) await expect(page.getByTestId('coord-advance')).toHaveText(/Finish round/);
    await page.getByTestId('coord-advance').click(); // next question / finish
  }
  await expect(page.getByTestId('coord-headline')).toHaveText('Level 1 - Tech Faces is over');
  await expect(page.getByTestId('event-state')).toHaveText('ROUND ENDED');

  await ctx.close();
  await alpha.ctx.close();
  await beta.ctx.close();
  await req.dispose();
});

test('the coordinator page needs an admin sign-in', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/coordinator');
  await expect(page.getByRole('heading', { name: /COORDINATOR/ })).toBeVisible();
  await page.getByLabel('Username').fill(ADMIN.username);
  await page.getByLabel('Password').fill('wrong-password-here');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password');
  await expect(page.getByTestId('coord-headline')).toHaveCount(0);
  await ctx.close();
});
