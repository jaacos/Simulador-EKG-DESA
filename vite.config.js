import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Tiene que coincidir EXACTAMENTE con el nombre del repositorio en GitHub,
// porque GitHub Pages sirve un proyecto personal desde una subruta
// (/ese-nombre/), no desde la raíz. Si renombras el repo, cambia esto
// antes de la siguiente build.
const REPO_NAME = 'Simulador-EKG-DESA';

export default defineConfig({
  base: `/${REPO_NAME}/`,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'CardioSim Pro & DESA — Simulador ECG',
        short_name: 'CardioSim DESA',
        description:
          'Simulador didáctico de trazados ECG y algoritmo de soporte vital con DESA para formación sanitaria.',
        theme_color: '#059669',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'any',
        start_url: `/${REPO_NAME}/`,
        scope: `/${REPO_NAME}/`,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `/${REPO_NAME}/index.html`,
      },
    }),
  ],
});
