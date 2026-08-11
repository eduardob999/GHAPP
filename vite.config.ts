import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages serves this app from a sub-path (e.g. /GHAPP/), so the default
 * base is relative. Every emitted URL then resolves against wherever the app
 * happens to live, which keeps the same build working on Pages, Firebase
 * Hosting and `vite preview` without a rebuild.
 *
 * Override with VITE_BASE_PATH=/my-repo/ if you ever need absolute URLs.
 */
const base = process.env['VITE_BASE_PATH'] ?? './';

/** App-shell files that live in public/ and are not part of the JS bundle. */
const SHELL_ASSETS = [
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

/**
 * Vite fingerprints bundle filenames, so the hand-written service worker in
 * public/ cannot know them ahead of time. This plugin rewrites the worker's
 * BUILD_MANIFEST line after the bundle is emitted, giving it the real precache
 * list plus a version string that changes whenever the output changes (which is
 * what causes old caches to be dropped on activate).
 */
function serviceWorkerManifest(): Plugin {
  let outDir = 'dist';
  let bundledAssets: string[] = [];

  return {
    name: 'gpc:service-worker-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle(_options, bundle) {
      bundledAssets = Object.keys(bundle).filter((file) => /\.(js|css)$/.test(file));
    },
    closeBundle() {
      const swPath = resolve(outDir, 'service-worker.js');
      if (!existsSync(swPath)) {
        this.warn('service-worker.js not found in the build output; precaching is disabled.');
        return;
      }

      const precache = [...SHELL_ASSETS, ...bundledAssets].sort();
      const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 12);
      const manifest = JSON.stringify({ version, precache });

      const source = readFileSync(swPath, 'utf8');
      const injected = source.replace(
        /const BUILD_MANIFEST = .*?; \/\/ __BUILD_MANIFEST__/,
        `const BUILD_MANIFEST = ${manifest};`,
      );

      if (injected === source) {
        this.warn('Could not find the BUILD_MANIFEST marker in service-worker.js.');
        return;
      }

      writeFileSync(swPath, injected);
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), serviceWorkerManifest()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
