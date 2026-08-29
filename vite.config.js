import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src',
  // 生产包用 file:// 加载，必须是相对路径
  base: './',
  publicDir: false,
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/index.html'),
        settings: resolve(__dirname, 'src/settings.html')
      }
    }
  }
});
