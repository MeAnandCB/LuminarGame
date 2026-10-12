import { expect, test } from '@playwright/test';
import { ADMIN, AdminApi, PROJECTOR, answerFor, playLiveRound, registerTeam, skipIntroRounds, solveQuiz } from './helpers';

test.describe.configure({ mode: 'serial' });

test('complete event: admin, two phones, projector, 5 levels, podium, CSV', async ({ browser, playwright }) => {
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

  // a separate API session (its own cookie jar) so the browser's admin session is untouched
  const apiCtx = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const adminApi = new AdminApi(apiCtx);
  await adminApi.login();
  // generous live-question timers so a slow machine cannot make the UI steps race the clock
  for (const level of [1, 2, 4, 5]) await adminApi.patch(`/round/${level}/config`, { questionSec: 120 });

  // two finalists: the Showdown is a head-to-head between the two teams
  await admin.getByRole('tab', { name: 'Event' }).click();
  await admin.getByLabel('Finalists advancing').fill('2');
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

  // ---- 5. Level 1: Tech Faces (live) -----------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await expect(a.page.getByText('Waiting for the host to press start')).toBeVisible();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Question 1 of 10')).toBeVisible();
  await expect(a.page.getByText('Tech Faces').first()).toBeVisible();
  // the picture is on the projector (a silhouette stands in until real photos are added) with the four names
  await expect(display.getByRole('img', { name: /Photo not added yet|mystery tech personality/ })).toBeVisible();
  await expect(display.getByRole('list', { name: 'Answer options' }).getByRole('listitem')).toHaveCount(4);
  await expect(a.page.getByRole('img', { name: /Photo not added yet|mystery tech personality/ })).toBeVisible();

  await a.page.getByRole('radio', { name: /Steve Jobs/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(a.page.getByText(/Answer locked in/)).toBeVisible();
  await b.page.getByRole('radio', { name: /Steve Wozniak/ }).click();
  await b.page.getByRole('button', { name: 'Lock in answer' }).click();
  // both answered -> the question closes by itself and the reveal appears everywhere
  await expect(a.page.getByText('Correct!')).toBeVisible();
  await expect(a.page.getByText('Fastest finger')).toBeVisible();
  await expect(a.page.getByText(/Co-founded Apple/)).toBeVisible(); // the fact after the reveal
  await expect(b.page.getByText('Wrong answer')).toBeVisible();
  await expect(display.getByText(/Fastest finger: Alpha Wolves/)).toBeVisible();
  await expect(display.getByText(/Co-founded Apple/)).toBeVisible();
  await adminApi.post('/round/live/advance'); // leave the reveal -> question 2
  await playLiveRound(adminApi, [a.page, b.page], 1, (i, q) => (i === 0 || q % 2 === 0 ? 'right' : 'wrong'), 1);
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  const l1 = await (await a.page.request.get('/api/team/me')).json();
  expect(l1.score.round).toBeGreaterThan(1500);

  // ---- 5b. Level 2: Tech Bingo (live) ------------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Call 1 of 16')).toBeVisible();
  await expect(a.page.getByRole('group', { name: 'Your bingo card' }).getByRole('button')).toHaveCount(16);
  await expect(display.getByRole('list', { name: /Bingo board/ }).getByRole('listitem')).toHaveCount(16);
  await expect(display.getByText(/real one on record|first one on record/)).toBeVisible(); // the clue is on the projector
  // Alpha taps the right tile (Bug) and locks in, Beta taps the wrong one (Cloud)
  await a.page.getByRole('button', { name: /^Bug/ }).click();
  await a.page.getByRole('button', { name: 'Lock in Bug' }).click();
  await expect(a.page.getByText(/Answer locked in: Bug/)).toBeVisible();
  await b.page.getByRole('button', { name: /^Cloud/ }).click();
  await b.page.getByRole('button', { name: 'Lock in Cloud' }).click();
  await expect(a.page.getByText('Correct!')).toBeVisible();
  await expect(a.page.getByRole('button', { name: /^Bug, marked/ })).toBeVisible(); // the tile is stamped on the card
  await expect(b.page.getByText('Wrong answer')).toBeVisible();
  await expect(b.page.getByRole('button', { name: /^Bug, called but missed/ })).toBeVisible();
  await expect(display.getByRole('listitem', { name: /^Bug, called number 1/ })).toBeVisible();
  await adminApi.post('/round/live/advance');
  // Alpha is perfect for the rest of the card (blackout), Beta only gets the even-numbered calls
  await playLiveRound(adminApi, [a.page, b.page], 2, (i, q) => (i === 0 || q % 2 === 1 ? 'right' : 'wrong'), 1);
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  const l2b = await (await a.page.request.get('/api/team/me')).json();
  expect(l2b.live.bingo).toMatchObject({ lines: 10 });
  expect(l2b.live.bingo.marked).toHaveLength(16);
  expect(l2b.score.round).toBeGreaterThanOrEqual(16 * 50 + 10 * 75 + 250); // every call, every line and the blackout, plus speed bonuses

  // ---- 5c. Level 3: Quick Brain (self-paced) ------------------------------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await expect(a.page.getByText('Waiting for the host to press start')).toBeVisible();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Question 1 of 12')).toBeVisible();
  await expect(a.page.getByText('Quick Brain').first()).toBeVisible();

  // Alpha answers question 1 correctly through the UI, Beta answers wrongly
  await a.page.getByRole('radio', { name: /Central Processing Unit/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(a.page.getByRole('status').filter({ hasText: /Correct! \+\d+/ })).toBeVisible();
  await expect(a.page.getByText('Question 2 of 12')).toBeVisible();
  await b.page.getByRole('radio', { name: /Computer Personal Unit/ }).click();
  await b.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(b.page.getByRole('status').filter({ hasText: 'Incorrect' })).toBeVisible();

  // projector leaderboard updates live (no refresh)
  const alphaRow = display.getByRole('row', { name: /Alpha Wolves/ });
  await expect(alphaRow).toContainText(/1\D*1\d\d/); // rank 1, 100 + speed bonus
  await expect(display.getByRole('row', { name: /Beta Hawks/ })).toContainText('0');
  await expect(display.getByText(/PROVISIONAL –/)).toBeVisible();

  // Alpha skips question 2 with the new Skip button (confirm step first)
  await a.page.getByRole('button', { name: /Skip question/ }).click();
  await expect(a.page.getByText('Skip this question?')).toBeVisible();
  await a.page.getByRole('button', { name: 'Skip it' }).click();
  await expect(a.page.getByText('Question 3 of 12')).toBeVisible();
  const afterSkip = await (await a.page.request.get('/api/team/me')).json();
  expect(afterSkip.history.find((h: { outcome: string }) => h.outcome === 'skipped')).toBeTruthy();

  // finish the rest through the API (same sessions)
  await solveQuiz(a.page, 2);
  await expect(a.page.getByText('Round complete!')).toBeVisible();
  await solveQuiz(b.page, 1);

  await admin.getByTestId('act-round.end').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End round' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  await expect(a.page.getByText('finished').first()).toBeVisible();
  await admin.getByRole('button', { name: /Reveal answers/ }).click();
  await expect(display.getByText('Answer key')).toBeVisible();

  // ---- 6. Level 4: Reel Rush (live) ----------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Question 1 of 12')).toBeVisible();
  await expect(a.page.getByText('Reel Rush').first()).toBeVisible();
  await expect(display.getByRole('timer')).toBeVisible();
  await expect(display.getByText(/Java programming language/)).toBeVisible(); // the question is on the projector
  await expect(display.getByRole('list', { name: 'Answer options' }).getByRole('listitem')).toHaveCount(4);
  await expect(admin.getByTestId('live-status')).toContainText('1 / 12 · open');

  // Alpha answers correctly; Beta bets a Double Down on a wrong answer
  await a.page.getByRole('radio', { name: /Sun Microsystems/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(a.page.getByText(/Answer locked in/)).toBeVisible();
  // locked-in answers do not reveal correctness or move the score yet
  await expect(a.page.getByText('Correct!')).toHaveCount(0);
  await b.page.getByRole('checkbox', { name: /Double Down/ }).check();
  await b.page.getByRole('radio', { name: /Intel/ }).click();
  await b.page.getByRole('button', { name: /Lock in with Double Down/ }).click();
  // Beta answers last, so the reveal can land before the locked-in panel is painted: accept either.
  await expect(b.page.getByText(/Answer locked in|Wrong answer/)).toBeVisible();

  // everyone answered -> the question closes by itself and the reveal appears everywhere
  await expect(a.page.getByText('Correct!')).toBeVisible();
  await expect(a.page.getByText('Fastest finger')).toBeVisible();
  await expect(b.page.getByText('Wrong answer')).toBeVisible();
  await expect(b.page.getByText('Double Down failed')).toBeVisible();
  await expect(display.getByRole('status').filter({ hasText: 'Correct answer' })).toContainText('Sun Microsystems');
  await expect(display.getByText(/Fastest finger: Alpha Wolves/)).toBeVisible();

  // host skips question 2 (void): nobody scores, question 3 opens
  await admin.getByTestId('act-live.advance').click(); // reveal -> question 2
  await expect(admin.getByTestId('live-status')).toContainText('2 / 12 · open');
  await a.page.getByRole('radio', { name: /Qualcomm/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  const scoreBeforeSkip = (await (await a.page.request.get('/api/team/me')).json()).score.total;
  await admin.getByTestId('act-live.skip').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Skip question' }).click();
  await expect(admin.getByTestId('live-status')).toContainText('3 / 12 · open');
  await expect(a.page.getByText('Question 3 of 12')).toBeVisible();
  expect((await (await a.page.request.get('/api/team/me')).json()).score.total).toBe(scoreBeforeSkip);

  // the rest of Reel Rush: Alpha always right, Beta right except every third question
  await playLiveRound(adminApi, [a.page, b.page], 4, (i, q) => (i === 0 || q % 3 !== 0 ? 'right' : 'wrong'), 2);
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  const l2 = await (await a.page.request.get('/api/team/me')).json();
  expect(l2.score.round).toBeGreaterThan(1000);
  expect(l2.live.streak).toBeGreaterThanOrEqual(10);

  // ---- 7. qualification (two finalists) -------------------------------------------------
  await admin.getByTestId('act-qualification.open').click();
  await expect(admin.getByTestId('event-state')).toHaveText('QUALIFICATION');
  await expect(a.page.getByText('You qualified for the Final Showdown')).toBeVisible();
  await expect(b.page.getByText('You qualified for the Final Showdown')).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Finalists' })).toBeVisible();
  await expect(display.getByRole('listitem').filter({ hasText: 'Alpha Wolves' })).toBeVisible();

  // ---- 8. Level 5: Final Showdown ----------------------------------------------------------
  await admin.getByTestId('act-round.prepare').click();
  await admin.getByTestId('act-round.start').click();
  await expect(a.page.getByText('Final Showdown').first()).toBeVisible();
  await expect(a.page.getByLabel('3 lives left')).toBeVisible();
  await expect(display.getByRole('heading', { name: 'Who is still standing?' })).toBeVisible();
  // Alpha answers question 1 through the UI; Beta answers wrongly and loses a life
  await a.page.getByRole('radio', { name: /Mozilla/ }).click();
  await a.page.getByRole('button', { name: 'Lock in answer' }).click();
  await b.page.getByRole('radio', { name: /Apache/ }).click();
  await b.page.getByRole('button', { name: 'Lock in answer' }).click();
  await expect(b.page.getByText('You lost a life')).toBeVisible();
  await expect(display.getByText(/stole \d+ from Beta Hawks/)).toBeVisible();
  await expect(b.page.getByLabel('2 lives left')).toBeVisible();
  // Beta keeps missing: three strikes and out, the round ends with Alpha as last team standing
  await adminApi.post('/round/live/advance'); // leave reveal (Q1 done)
  await playLiveRound(adminApi, [a.page, b.page], 5, (i) => (i === 0 ? 'right' : 'wrong'), 1);
  await expect(admin.getByTestId('event-state')).toHaveText('ROUND ENDED');
  const survivors = await (await a.page.request.get('/api/team/me')).json();
  expect(survivors.live.eliminated).toBe(false);
  expect((await (await b.page.request.get('/api/team/me')).json()).live.eliminated).toBe(true);
  expect((await adminApi.state()).audit.some((x: { details: string }) => x.details.includes('last team standing'))).toBe(true);

  await admin.getByTestId('act-event.complete').click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Finish event' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('EVENT COMPLETED');

  // ---- 9. podium + champion screens ------------------------------------------------------
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
    expect(Number(cells[10])).toBe(row.total);
  }
  expect(state.leaderboard[0].name).toBe('Alpha Wolves');
  expect(answerFor(5, 0)).toBe('a');

  // ---- 11. audit trail ---------------------------------------------------------------------
  await admin.getByRole('tab', { name: 'Audit log' }).click();
  await expect(admin.getByRole('cell', { name: 'event.complete' })).toBeVisible();

  await Promise.all([adminCtx.close(), dispCtx.close(), a.ctx.close(), b.ctx.close(), apiCtx.dispose()]);
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
  await skipIntroRounds(api); // Quick Brain is the self-paced round this scenario needs
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(t.page.getByText('Question 1 of 12')).toBeVisible();
  await expect(t.page.getByRole('status').filter({ hasText: /^\W*Connected$/ })).toBeVisible();

  await t.page.getByRole('radio', { name: /Central Processing Unit/ }).click();
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

test('the host sees and hears it when a team goes offline', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Offline Arena' });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;

  // The alert is three tones per alarm; count them as the browser plays them.
  const adminCtx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  await adminCtx.addInitScript(() => {
    const w = window as unknown as { __tones: number };
    w.__tones = 0;
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.__tones++;
      return create.call(this);
    };
  });
  const admin = await adminCtx.newPage();
  const tones = () => admin.evaluate(() => (window as unknown as { __tones: number }).__tones);
  await admin.goto('/admin');
  await admin.getByLabel('Username').fill(ADMIN.username);
  await admin.getByLabel('Password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByTestId('event-state')).toHaveText('REGISTRATION OPEN');
  const banner = admin.getByTestId('offline-banner');

  const drifters = await registerTeam(browser, pin, 'Drifters', 'D1', 'D2');
  const ghosts = await registerTeam(browser, pin, 'Ghosts', 'G1', 'G2');
  await expect(banner).toBeHidden();

  // a team drops: after the short grace period it is listed and the host hears the alert
  await drifters.page.close();
  await expect(banner).toContainText('1 team is offline');
  await expect(banner).toContainText('Drifters');
  await expect.poll(tones).toBe(3);
  await admin.getByRole('tab', { name: 'Teams' }).click();
  await expect(admin.getByRole('row', { name: /Drifters/ }).locator('.badge-bad')).toContainText('offline');

  // reloading the admin page lists the team that is still offline, but stays quiet
  await admin.reload();
  await expect(banner).toContainText('Drifters');
  await admin.waitForTimeout(4000);
  expect(await tones()).toBe(0);

  // with the alert switched off a second drop is still listed, without a sound
  await admin.getByTestId('offline-sound').click();
  await expect(admin.getByTestId('offline-sound')).toHaveText(/off/);
  await ghosts.page.close();
  await expect(banner).toContainText('2 teams are offline');
  await admin.waitForTimeout(500);
  expect(await tones()).toBe(0);

  // both phones come back (same cookies, so same team): the banner clears
  await (await drifters.ctx.newPage()).goto('/');
  await (await ghosts.ctx.newPage()).goto('/');
  await expect(banner).toBeHidden();

  await Promise.all([adminCtx.close(), drifters.ctx.close(), ghosts.ctx.close(), req.dispose()]);
});
