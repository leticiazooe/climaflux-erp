import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const ARCHIVE_DIR = resolve(ROOT, '.bootstrap');
const OUTPUT_DIR = resolve(ROOT, 'source');
const EXPECTED_SHA256 = '528555dd66740baa9f83de81269f4360a70d2ca02096596d37ee4bd15fbe180d';

async function text(path) {
  return readFile(resolve(ARCHIVE_DIR, path), 'utf8');
}

async function rebuildArchive() {
  const chunks = [];

  for (let index = 1; index <= 18; index += 1) {
    chunks.push(await text(`chunk-${String(index).padStart(2, '0')}.b64`));
  }

  let encodedChunk19 = '';
  for (let index = 0; index <= 6; index += 1) {
    encodedChunk19 += await text(`chunk-19y-${String(index).padStart(2, '0')}.b64`);
  }
  chunks.push(Buffer.from(encodedChunk19.replace(/\s/g, ''), 'base64').toString('utf8'));

  for (let index = 20; index <= 23; index += 1) {
    chunks.push(await text(`chunk-${String(index).padStart(2, '0')}.b64`));
  }

  const archive = Buffer.from(chunks.join('').replace(/\s/g, ''), 'base64');
  const sha256 = createHash('sha256').update(archive).digest('hex');

  if (sha256 !== EXPECTED_SHA256) {
    throw new Error(`Falha de integridade: esperado ${EXPECTED_SHA256}, recebido ${sha256}.`);
  }

  return archive;
}

function parseOctal(buffer) {
  const value = buffer.toString('utf8').replace(/\0/g, '').trim();
  return value ? Number.parseInt(value, 8) : 0;
}

async function extractTar(tarBuffer) {
  await rm(OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(OUTPUT_DIR, { recursive: true });

  let offset = 0;
  let files = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const name = `${prefix ? `${prefix}/` : ''}${rawName}`.replace(/^\.\//, '');
    const size = parseOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (name && type !== '5') {
      const target = resolve(OUTPUT_DIR, name);
      if (!target.startsWith(`${OUTPUT_DIR}${sep}`) && target !== OUTPUT_DIR) {
        throw new Error(`Caminho inseguro encontrado no pacote: ${name}`);
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, tarBuffer.subarray(dataStart, dataEnd));
      files += 1;
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

try {
  console.log('Reconstruindo o pacote ClimaFlux ERP v0.3.0...');
  const archive = await rebuildArchive();
  const tar = gunzipSync(archive);
  const files = await extractTar(tar);
  console.log(`Concluído: ${files} arquivos extraídos em ${OUTPUT_DIR}.`);
  console.log('Execute: cd source && npm run quality');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
