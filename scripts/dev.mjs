import { spawn } from 'node:child_process';

const frontendPort = process.env.FRONTEND_PORT || '5173';
const providerPort = process.env.PORT || '8787';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(npmCommand, ['exec', '--', 'vite', 'src/local-host', '--host', '127.0.0.1', '--port', frontendPort], {
    stdio: 'inherit',
    env: { ...process.env, VITE_PROVIDER_PORT: providerPort },
  }),
  spawn(npmCommand, ['exec', '--', 'tsx', 'watch', 'src/provider/server.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: providerPort, TYPEROLL_LOCAL_DEVELOPMENT: '1' },
  }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}

console.log(`Local host: http://127.0.0.1:${frontendPort}/?quote=demo-customer-token`);
