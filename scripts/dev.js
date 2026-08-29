'use strict';

/**
 * 开发模式：先起 Vite dev server，拿到实际 URL 后再拉起 Electron。
 * 不引 concurrently / wait-on，少两个依赖。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

(async () => {
  const { createServer } = await import('vite');

  const server = await createServer({ configFile: path.join(root, 'vite.config.js') });
  await server.listen();
  server.printUrls();

  const url = server.resolvedUrls?.local?.[0];
  if (!url) {
    console.error('拿不到 Vite dev server 地址');
    process.exit(1);
  }

  const electronBin = require('electron');
  const child = spawn(electronBin, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url, ELECTRON_ENABLE_LOGGING: '1' }
  });

  child.on('close', async (code) => {
    await server.close();
    process.exit(code ?? 0);
  });

  const shutdown = () => {
    child.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
