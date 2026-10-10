import { createEvent } from '../server/engine/events.js';
import { openCtx } from './lib.js';

const { ctx } = openCtx();
const existing = ctx.currentEvent();
if (existing) {
  console.log(`An event already exists ("${existing.name}", PIN ${existing.pin}). Nothing to seed.`);
} else {
  const ev = createEvent(ctx, 'seed-script', { name: 'BrainByte Arena' });
  const rounds = ctx.rounds(ev.id);
  console.log(`Created event "${ev.name}" with PIN ${ev.pin}.`);
  for (const r of rounds) console.log(`  ${r.name}: ${ctx.challenges(r.id).length} challenges`);
}
ctx.db.close();
