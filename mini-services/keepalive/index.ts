import { spawn } from 'child_process';

const server = spawn('npx', ['next', 'dev', '-p', '3000'], {
  cwd: '/home/z/my-project',
  stdio: ['inherit', 'inherit', 'inherit'],
});

server.on('exit', () => {
  console.log('[keepalive] Next.js exited, restarting...');
  setTimeout(() => {
    const s2 = spawn('npx', ['next', 'dev', '-p', '3000'], {
      cwd: '/home/z/my-project',
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    s2.on('exit', () => console.log('[keepalive] Server stopped'));
  }, 2000);
});

setInterval(() => {}, 10000);
