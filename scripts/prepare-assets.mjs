import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'concepts/manifest.json'), 'utf8'));
const destination = join(root, 'public/avatars');
await mkdir(destination, { recursive: true });
for (const avatar of manifest.avatars) {
  const source = join(root, 'concepts/avatars', `${avatar.id}.png`);
  await sharp(source).resize(320, 320, { fit: 'contain', background: '#00000000' })
    .webp({ quality: 86, alphaQuality: 100 }).toFile(join(destination, `${avatar.id}.webp`));
}
console.log(`Подготовлено ${manifest.avatars.length} аватарок для игры.`);
