// Genera el set de iconos PNG de la PWA a partir de public/favicon.svg.
// Placeholder genérico (trazo ECG verde sobre fondo oscuro) — sustituye
// public/favicon.svg por tu logo definitivo y vuelve a ejecutar:
//   npm run gen-icons
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'public', 'favicon.svg');
const iconsDir = path.join(root, 'public', 'icons');

const targets = [
  { name: 'icon-16.png', size: 16 },
  { name: 'icon-32.png', size: 32 },
  { name: 'icon-180.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
];

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const svg = await readFile(svgPath);

  for (const { name, size } of targets) {
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    await writeFile(path.join(iconsDir, name), buf);
    console.log(`✓ ${name} (${size}x${size})`);
  }

  // Icono "maskable": mismo diseño con margen de seguridad (safe zone ~20%)
  // para que Android no recorte el trazo al aplicar la máscara del sistema.
  const maskableSize = 512;
  const safeInner = Math.round(maskableSize * 0.6);
  const inner = await sharp(svg, { density: 384 }).resize(safeInner, safeInner).png().toBuffer();
  const maskable = await sharp({
    create: {
      width: maskableSize,
      height: maskableSize,
      channels: 4,
      background: '#020617',
    },
  })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toBuffer();
  await writeFile(path.join(iconsDir, 'icon-maskable-512.png'), maskable);
  console.log('✓ icon-maskable-512.png (512x512, safe zone 60%)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
