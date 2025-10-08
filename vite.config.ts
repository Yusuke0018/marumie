import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(() => {
  const basePath = process.env.GITHUB_ACTIONS ? '/marumie/' : '/';

  return {
    plugins: [react()],
    base: basePath,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true
    }
  };
});
