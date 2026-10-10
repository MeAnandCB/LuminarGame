import { expect, test } from '@playwright/test';
import { ADMIN, AdminApi, PROJECTOR, answerFor, apiAnswer, registerTeam, solveRemaining } from './helpers';

test.describe.configure({ mode: 'serial' });

test('complete event: admin, two phones, projector, 3 levels, podium, CSV', async ({ browser }) => {
  // ---- 1. admin signs in through the UI and creates the event -----------------
  const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const admin = await adminCtx.newPage();
  await admin.goto('/admin');
  await admin.getByLabel('Username').fill(ADMIN.username);
  await admin.getByLabel('Password').fill('wrong-password-here');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByRole('alert')).toContainText('Incorrect username or password');
  await admin.getByLabel('Password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Event name').fill('E2E Arena');
  await admin.getByRole('button', { name: 'Create event' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('SETUP');
  const pin = (await admin.getByTestId('pin').textContent())!.trim();
  expect(pin).toMatch(/^\d{6}$/);

  // finalists = 1 so qualification actually selects somebody
  await admin.getByRole('tab', { name: 'Event' }).click();
  await admin.getByLabel('Finalists advancing').fill('1');
  await admin.getByRole('button', { name: 'Save settings' }).click();
  await admin.getByRole('tab', { name: 'Control' }).click();

  // ---- 2. projector shows the PIN + QR once registration opens ----------------
  const dispCtx = await browser.newContext({ viewport: PROJECTOR });
  const display = await dispCtx.newPage();
  await display.goto('/display');
  await admin.getByTestId('act-registration.open').click();
  await expect(admin.getByTestId('event-state')).toHaveText('REGISTRATION OPEN');
  await expect(display.getByText('Scan to join')).toBeVisible();
  await expect(display.getByRole('img', { name: /QR code to join/ })).toBeVisible();
  await expect(display.locator('.mono', { hasText: pin }).first()).toBeVisible();

  // ---- 3. two teams register on phones ------------------------------------------
  const a = await registerTeam(browser, pin, 'Alpha Wolves', 'Asha', 'Arun');
  const b = await registerTeam(browser, pin, 'Beta Hawks', 'Bela', 'Bram');
  await expect(a.page.getByText('Registered!')).toBeVisible();
  await expect(display.getByLabel('Team slots').getByText('Alpha Wolves')).toBeVisible();
  await expect(display.getByLabel('Team slots').getByText('Beta Hawks')).toBeVisible();

  // a duplicate name is refused with a clear message
  const dup = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const dupPage = await dup.newPage();
  await dupPage.goto(`/join?pin=${pin}`);
  await dupPage.getByLabel(/Team name/).fill('alpha wolves');
  await dupPage.getByLabel('Player 1 name').fill('X');
  await dupPage.getByLabel('Player 2 name').fill('Y');
  await dupPage.getByRole('button', { name: 'Register team' }).click();
  await expect(dupPage.getByRole('alert')).toContainText('already uses that name');
  await dup.close();

  // ---- 4. close registration, lobby ----------------------------------------------
  await admin.getByTestId('act-registration.confirm').click();
  await expect(admin.getByTestId('event-state')).toHaveText('LOBBY');
  await expect(a.page.getByText("You're in the lobby")).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Registration closed' })).toBeVisible();

  // ---- 5. Level 1 ------------------------------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await expect(a.page.getByText('Waiting for the host to press start')).toBeVisible();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Question 1 of 12')).toBeVisible();

  // Alpha answers question 1 correctly through the UI, Beta answers wrongly
  await a.page.getByRole('radio', { name: /Jeethu Joseph/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(a.page.getByRole('status').filter({ hasText: /Correct! \+\d+/ })).toBeVisible();
  await expect(a.page.getByText('Question 2 of 12')).toBeVisible();
  await b.page.getByRole('radio', { name: /Priyadarshan/ }).click();
  await b.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(b.page.getByRole('status').filter({ hasText: 'Incorrect' })).toBeVisible();

  // projector leaderboard updates live (no refresh)
  const alphaRow = display.getByRole('row', { name: /Alpha Wolves/ });
  await expect(alphaRow).toContainText(/1\D*1\d\d/); // rank 1, 100 + speed bonus
  await expect(display.getByRole('row', { name: /Beta Hawks/ })).toContainText('0');
  await expect(display.getByText(/PROVISIONAL –/)).toBeVisible();

  // finish the rest through the API (same sessions)
  await solveRemaining(a.page, 1, 1);
  await expect(a.page.getByText('Round complete!')).toBeVisible();
  await solveRemaining(b.page, 1, 1);

  await admin.getByTestId('act-round.end').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End round' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  await expect(a.page.getByText('finished').first()).toBeVisible();
  await admin.getByRole('button', { name: /Reveal answers/ }).click();
  await expect(display.getByText('Answer key')).toBeVisible();

  // ---- 6. Level 2: codebreaker progression ---------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Stage 1 of 5')).toBeVisible();
  await expect(a.page.getByText('01001101')).toBeVisible();

  // incorrect code does not advance
  await a.page.getByLabel('Your answer').fill('B');
  await a.page.getByRole('button', { name: 'Submit code' }).click();
  await expect(a.page.getByRole('status').filter({ hasText: 'Incorrect code' })).toBeVisible();
  await expect(a.page.getByText('Stage 1 of 5')).toBeVisible();

  // correct code advances exactly once
  await a.page.getByLabel('Your answer').fill('m');
  await a.page.getByRole('button', { name: 'Submit code' }).click();
  await expect(a.page.getByText('Stage 2 of 5')).toBeVisible();
  const before = await (await a.page.request.get('/api/team/me')).json();
  expect(before.score.total).toBeGreaterThan(0);
  const stage1 = before.challenge.id - 1; // stage 1 id precedes stage 2 id in the seed
  const replay = await a.page.request.post('/api/team/answer', { data: { requestId: 'replay-0000001', answer: 'M', challengeId: stage1 } });
  expect((await replay.json()).outcome).toBe('rejected');
  const after = await (await a.page.request.get('/api/team/me')).json();
  expect(after.score.total).toBe(before.score.total);
  // hint costs once
  await a.page.getByRole('button', { name: /Reveal hint/ }).click();
  await expect(a.page.getByText('Hint:')).toBeVisible();

  await solveRemaining(a.page, 2, 1);
  expect((await apiAnswer(b.page, 'M')).outcome).toBe('correct'); // Beta only completes stage 1
  await expect(display.getByRole('row', { name: /Alpha Wolves/ })).toContainText('5/5');

  await admin.getByTestId('act-round.end').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End round' }).click();

  // ---- 7. qualification --------------------------------------------------------------
  await admin.getByTestId('act-qualification.open').click();
  await expect(admin.getByTestId('event-state')).toHaveText('QUALIFICATION');
  await expect(a.page.getByText('You qualified for The Final Hack')).toBeVisible();
  await expect(b.page.getByText('did not qualify for the final')).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Finalists' })).toBeVisible();
  await expect(display.getByRole('listitem').filter({ hasText: 'Alpha Wolves' })).toBeVisible();

  // ---- 8. Level 3 -----------------------------------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Stage 1 of 4')).toBeVisible();
  await expect(b.page.getByText('finalists only')).toBeVisible();
  const blocked = await apiAnswer(b.page, 'PREMAM').catch(() => null);
  expect(blocked === null || blocked.outcome === undefined).toBeTruthy(); // 403 payload has no outcome
  await a.page.getByLabel('Your answer').fill('premam');
  await a.page.getByRole('button', { name: 'Submit code' }).click();
  await expect(a.page.getByText('Stage 2 of 4')).toBeVisible();
  // pasting the final password early fails: it depends on the clues
  const early = await apiAnswer(a.page, 'MOHANLAL-231-PRE');
  expect(early.outcome).toBe('incorrect');
  await solveRemaining(a.page, 3, 1);
  await expect(a.page.getByText('Round complete!')).toBeVisible();

  await admin.getByTestId('act-round.end').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End round' }).click();
  await admin.getByTestId('act-event.complete').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Finish event' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('EVENT COMPLETED');

  // ---- 9. podium + champion screens ----------------------------------------------------
  await expect(display.getByRole('heading', { name: 'Alpha Wolves' })).toBeVisible();
  await expect(display.getByRole('list', { name: 'Podium' })).toContainText('Beta Hawks');
  await expect(a.page.getByText('Champion', { exact: true })).toBeVisible();
  await expect(b.page.getByText('Runner-up')).toBeVisible();

  // ---- 10. CSV matches the leaderboard ----------------------------------------------------
  const csv = await (await adminCtx.request.get('/api/admin/export.csv')).text();
  const state = await (await adminCtx.request.get('/api/admin/state')).json();
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  expect(lines).toHaveLength(3);
  for (const row of state.leaderboard) {
    const cells = lines.find((l: string) => l.split(',')[1] === row.name)!.split(',');
    expect(Number(cells[0])).toBe(row.rank);
    expect(Number(cells[8])).toBe(row.total);
  }
  expect(state.leaderboard[0].name).toBe('Alpha Wolves');
  expect(answerFor(3, 3)).toBe('MOHANLAL-231-PRE');

  // ---- 11. audit trail ---------------------------------------------------------------------
  await admin.getByRole('tab', { name: 'Audit log' }).click();
  await expect(admin.getByRole('cell', { name: 'event.complete' })).toBeVisible();

  await Promise.all([adminCtx.close(), dispCtx.close(), a.ctx.close(), b.ctx.close()]);
});

test('a team that loses Wi-Fi reconnects with its progress intact', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Reconnect Arena' });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;
  const t = await registerTeam(browser, pin, 'Wanderers', 'W1', 'W2');
  await api.post('/registration/confirm');
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(t.page.getByText('Question 1 of 12')).toBeVisible();
  await expect(t.page.getByRole('status').filter({ hasText: /^\W*Connected$/ })).toBeVisible();

  await t.page.getByRole('radio', { name: /Jeethu Joseph/ }).click();
  await t.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(t.page.getByText('Question 2 of 12')).toBeVisible();

  await t.ctx.setOffline(true);
  await expect(t.page.getByText('Reconnecting…')).toBeVisible();
  // while offline the host pauses; the phone catches up when it is back
  await api.post('/round/pause');
  await t.ctx.setOffline(false);
  await expect(t.page.getByRole('status').filter({ hasText: /^\W*Connected$/ })).toBeVisible({ timeout: 20_000 });
  await expect(t.page.getByText('Round paused')).toBeVisible();
  await api.post('/round/resume');
  await expect(t.page.getByText('Question 2 of 12')).toBeVisible();

  // a full page refresh keeps the session and the question position
  await t.page.reload();
  await expect(t.page.getByText('Wanderers').first()).toBeVisible();
  await expect(t.page.getByText('Question 2 of 12')).toBeVisible();
  const me = await (await t.page.request.get('/api/team/me')).json();
  expect(me.score.total).toBeGreaterThanOrEqual(100);
  await t.ctx.close();
  await req.dispose();
});
