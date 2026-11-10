import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DEFAULT_PORT, readConfiguration } from '../server/config.js';

function folder(t: { after: (callback: () => void) => void }) {
  const directory = mkdtempSync(join(tmpdir(), 'beango-config-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('beango-config-test-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

test('.env задаёт порт, адрес и папку данных с приоритетом над унаследованными переменными', (t) => {
  const directory = folder(t);
  writeFileSync(join(directory, '.env'), 'export PORT = "54789" # custom\nHOST=127.0.0.1\nDATA_DIR=./saved\nPUBLIC_URL=http://203.0.113.10:54789\n');
  const config = readConfiguration(directory, { PORT: '4321', HOST: '0.0.0.0', DATA_DIR: './wrong', PUBLIC_URL: 'http://198.51.100.20:4321' });
  assert.equal(config.port, 54789);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dataDirectory, join(directory, 'saved'));
  assert.equal(config.publicUrl, 'http://203.0.113.10:54789');
  assert.equal(config.envPath, join(directory, '.env'));
  assert.equal(config.loaded, true);
  assert.equal(readConfiguration(directory, {}, { PORT: '3001' }).port, 3001);
});

test('.env поддерживает UTF-8 с BOM и оба варианта UTF-16 с BOM', (t) => {
  const directory = folder(t);
  const text = 'PORT=54788\nDATA_DIR=./сохранения\n';
  const littleEndian = Buffer.from(text, 'utf16le');
  const bigEndian = Buffer.from(littleEndian).swap16();
  for (const content of [Buffer.from(text), Buffer.from('\ufeff' + text), Buffer.concat([Buffer.from([255, 254]), littleEndian]), Buffer.concat([Buffer.from([254, 255]), bigEndian])]) {
    writeFileSync(join(directory, '.env'), content);
    const config = readConfiguration(directory, { PORT: '4321' });
    assert.equal(config.port, 54788);
    assert.equal(config.dataDirectory, join(directory, 'сохранения'));
  }
});

test('без .env и PORT используется 54321; некорректная конфигурация сообщает об ошибке', (t) => {
  const directory = folder(t);
  assert.equal(DEFAULT_PORT, 54321);
  assert.equal(readConfiguration(directory, {}).port, 54321);
  assert.equal(readConfiguration(directory, { PORT: '54787' }).port, 54787);
  for (const port of ['abc', '0', '65536', '-1', '12.5']) {
    writeFileSync(join(directory, '.env'), `PORT=${port}\n`);
    assert.throws(() => readConfiguration(directory, {}), /PORT/);
  }
  writeFileSync(join(directory, '.env'), Buffer.from('PORT=54787', 'utf16le'));
  assert.throws(() => readConfiguration(directory, {}), /UTF-8/);
});
