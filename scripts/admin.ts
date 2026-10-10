import { createAdmin, resetAdminPassword } from '../server/http/auth.js';
import { askPassword, openCtx } from './lib.js';

const [cmd, username] = process.argv.slice(2);
if (!['create', 'reset'].includes(cmd ?? '') || !username) {
  console.error('Usage: npm run admin:create -- <username>\n       npm run admin:reset-password -- <username>\n(set ADMIN_PASSWORD to skip the prompt)');
  process.exit(1);
}
const { ctx } = openCtx();
try {
  const pw = await askPassword('New password (min 10 chars): ');
  if (!process.env.ADMIN_PASSWORD) {
    const again = await askPassword('Repeat password: ');
    if (again !== pw) throw new Error('Passwords do not match.');
  }
  if (cmd === 'create') {
    await createAdmin(ctx, username, pw);
    console.log(`Admin "${username}" created.`);
  } else {
    await resetAdminPassword(ctx, username, pw);
    console.log(`Password for "${username}" reset; all of their sessions were signed out.`);
  }
} catch (e) {
  const msg = (e as Error).message;
  console.error(msg.includes('UNIQUE') ? `An admin named "${username}" already exists. Use admin:reset-password.` : `Error: ${msg}`);
  process.exitCode = 1;
} finally {
  ctx.db.close();
}
