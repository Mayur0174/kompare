// Runs the API server and the Vite dev server together.
import { spawn } from 'node:child_process';
const run = (script) => spawn('npm', ['run', script], { stdio: 'inherit', shell: process.platform === 'win32' });
const procs = [run('dev:server'), run('dev:web')];
const stop = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
