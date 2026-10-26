import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN, AdminApi, apiAnswer, registerTeam, skipIntroRounds } from './helpers';

async function axe(page: Page, label: string) {
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = res.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.html.slice(0, 140)}`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

// Creates its own event. Files run alphabetically and event.spec.ts expects an empty database, so keep this name sorted after it.
test('host edits questions, answers and bingo tiles in the admin; the phone shows and scores the edited question', async ({ browser, playwright }) => {
  const req = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:3100' });
  const api = new AdminApi(req);
  await api.login();
  await api.post('/event', { name: 'Editor Arena' });
  await api.post('/registration/open');
  const pin = (await api.state()).event.pin as string;
  const team = await registerTeam(browser, pin, 'Edit Owls', 'Eva', 'Eli');
  await api.post('/registration/confirm');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const admin = await ctx.newPage();
  await admin.goto('/admin');
  await admin.getByLabel('Username').fill(ADMIN.username);
  await admin.getByLabel('Password').fill(ADMIN.password);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByRole('tab', { name: 'Rounds & scoring' }).click();

  // ---- Level 3 (Quick Brain): the editor needs the answer keys on screen -------------------------
  await admin.getByRole('button', { name: /Level 3 - Quick Brain/ }).click();
  const edit = admin.getByRole('button', { name: /Edit question & answer/ });
  await expect(edit.first()).toBeDisabled();
  await admin.getByLabel(/Show answer keys/).check();
  await expect(edit.first()).toBeEnabled();
  await edit.first().click();

  const form = admin.getByRole('form', { name: /Edit Brain of the computer/ });
  await form.getByLabel('Question teams see').fill('What does CPU stand for in a modern laptop?');
  await form.getByLabel('Option C text').fill('Central Program Utility (retired)');
  await form.getByLabel('Option B text').fill('Central Processing Unit');
  await form.getByLabel('Option A text').fill('Central Processing Unit'); // duplicate of B: must be refused
  await form.getByLabel('Option B is the correct answer').check();
  await form.getByRole('button', { name: 'Save question' }).click();
  await expect(form.getByRole('alert')).toContainText('different text');
  await axe(admin, 'admin question editor with an error');

  await form.getByLabel('Option A text').fill('Computer Personal Unit');
  await form.getByRole('button', { name: 'Save question' }).click();
  await expect(form).toHaveCount(0); // closes on success
  const row = admin.getByRole('listitem').filter({ hasText: 'Brain of the computer' });
  await expect(row).toContainText('What does CPU stand for in a modern laptop?');
  await expect(row).toContainText('B) Central Processing Unit');
  await expect(row).toContainText('Answer: Central Processing Unit');

  // a number question takes a list of accepted answers
  const year = admin.getByRole('listitem').filter({ hasText: 'First iPhone' });
  await year.getByRole('button', { name: /Edit question & answer/ }).click();
  const yearForm = admin.getByRole('form', { name: /Edit First iPhone/ });
  await yearForm.getByLabel(/Correct number/).fill('2007\n2008');
  await axe(admin, 'admin question editor');
  await yearForm.getByRole('button', { name: 'Save question' }).click();
  await expect(year).toContainText('Answer: 2007 | 2008');
  await year.getByRole('button', { name: /Edit question & answer/ }).click();
  await admin.getByRole('form', { name: /Edit First iPhone/ }).getByLabel(/Correct number/).fill('about 2007');
  await admin.getByRole('form', { name: /Edit First iPhone/ }).getByRole('button', { name: 'Save question' }).click();
  await expect(admin.getByRole('form', { name: /Edit First iPhone/ }).getByRole('alert')).toContainText('plain numbers');
  await admin.getByRole('form', { name: /Edit First iPhone/ }).getByRole('button', { name: 'Cancel' }).click();

  // hiding the keys closes any open editor, so a mirrored screen never shows an answer
  await row.getByRole('button', { name: /Edit question & answer/ }).click();
  await expect(admin.getByRole('form', { name: /Edit Brain of the computer/ })).toBeVisible();
  await admin.getByLabel(/Show answer keys/).uncheck();
  await expect(admin.getByRole('form', { name: /Edit Brain of the computer/ })).toHaveCount(0);
  await admin.getByLabel(/Show answer keys/).check();

  // ---- Level 2 (Tech Bingo): rename a tile, point a clue at another tile ------------------------
  await admin.getByRole('button', { name: /Level 2 - Tech Bingo/ }).click();
  await admin.getByText(/Bingo tiles \(16\)/).click();
  await admin.getByLabel('Tile A name').fill('Java');
  await admin.getByLabel('Tile A emoji').fill('☕');
  await admin.getByRole('button', { name: 'Save tiles' }).click();
  await expect.poll(async () => (await api.state()).rounds[1].challenges[0].options[0].text).toBe('Java');
  // Swap two clues' tiles: Call 1 names Bug (F) and some other call names tile A. Pointing Call 1 at A makes a duplicate, which the list flags.
  const calls = (await api.state()).rounds[1].challenges as { id: number; title: string; answers: string[] }[];
  const first = calls[0]!;
  const other = calls.find((c) => c.id !== first.id && c.answers[0] === 'a')!;
  expect(first.answers).toEqual(['f']);
  await admin.getByTestId(`edit-${first.id}`).click();
  const call = admin.getByRole('form', { name: /Edit Call 1$/ });
  await expect(call.getByLabel('The tile this clue describes')).toHaveValue('f');
  await call.getByLabel('The tile this clue describes').selectOption('a');
  await call.getByRole('button', { name: 'Save question' }).click();
  await expect.poll(async () => (await api.state()).rounds[1].challenges[0].answers).toEqual(['a']);
  await expect(admin.getByText('⚠ same tile as another call').first()).toBeVisible();
  await admin.getByTestId(`edit-${other.id}`).click();
  const otherForm = admin.getByRole('form', { name: new RegExp(`Edit ${other.title}$`) });
  await otherForm.getByLabel('The tile this clue describes').selectOption('f');
  await otherForm.getByRole('button', { name: 'Save question' }).click();
  await expect(admin.getByText('⚠ same tile as another call')).toHaveCount(0);
  const s = await api.state();
  expect(s.rounds[1].challenges[0].options[0]).toMatchObject({ id: 'a', text: 'Java', icon: '☕' });

  // ---- the phone sees and scores the edited question -----------------------------------------
  await skipIntroRounds(api); // Level 2 starts: every call names a different tile again
  await api.post('/round/prepare');
  await api.post('/round/start');
  await expect(team.page.getByText('What does CPU stand for in a modern laptop?')).toBeVisible();
  await expect(team.page.getByText('Central Processing Unit')).toBeVisible();
  const right = await apiAnswer(team.page, 'b');
  expect(right.outcome).toBe('correct');

  await ctx.close();
  await team.ctx.close();
});
