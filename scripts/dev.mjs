// Runs the API (tsx watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0); }));
console.log('\nDev: UI on http://localhost:5173 (proxying API on :3000)\n');
