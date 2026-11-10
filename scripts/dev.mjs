import { spawn } from 'node:child_process';

const children = [];
const launch = (args, env = {}) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  child.on('exit', (code) => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
  return child;
};
let stopping = false;
function stop() { stopping = true; for (const child of children) child.kill('SIGTERM'); }
launch(['--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts'], { PORT: '3001', HOST: '127.0.0.1', NODE_ENV: 'development' });
launch(['node_modules/vite/bin/vite.js']);
process.on('SIGINT', stop); process.on('SIGTERM', stop);
