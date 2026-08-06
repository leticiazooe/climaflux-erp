import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const RELEASE_DIR = resolve(ROOT, '.release-v050');
const OUTPUT_DIR = resolve(ROOT, 'public');
const EXPECTED_ARCHIVE_SHA256 = 'c16df5ef402bb1146f0638da5d939d4bb20252ff0028f1b33a2bbfd295387d7d';
const EXPECTED_PART_SHA1 = [
  '2400befbdc2583b2c21321a86ee8c97a0d7fdaf6',
  '469e7953490e2422b0e3e1e709c1eadb9fb55c48',
  '6ccb770207260e83e4cb9b8a58a6f00cdbafed71',
  '60ae7364be93fc1340665350a2cfca64bc351170',
  'b196d721ac386edea6ad24f0e8085a42f62d5ebc',
  '74844a6d11d1b739cd9573016e69b2c1ed5113b9',
  '9e83fa7e75334cd26e5e63997a225ea29349b944',
  '21b212d16ff3a25c15d4a7e0cc6adc3e95353fe9',
  '4e67a8a41c2d72db8eb5292eca0e6ab1fbacae72',
  '54941f00b3a877928c634410722b673cec9894cc',
  '7aaffb4be5f7bd77428ede471ec317834f6ecdae',
  'ff5e1aab2debddbcb4cf52a56339cd1d7d224586',
  'd2805338f4f9b638fe63c94fb1387f53de12019d',
  '2e3f49f9b8ea82e338da10b5c469e8fc872427b1',
  'c3b332db5b4ceab4996cf0834dfd309a9de49971',
  '8b3d3f7fed58da84ad461da75bf843f277ccb40e',
  '7dbda7956aa68935ccc8243b89dc8ad8b5c4595f',
  '18830b7552c5402e4cfe18c368167439543a0756',
  '653cd1d5453ab6bd6dd93bdbf17cc4fc145fad5d',
  '091bd9fe71a7c9a704c89845dfdcabd1f3832622',
  '707edf7333186724f9b97877be9ad5f0cf690337',
  '3362a613193aa5c86ad7b1fa3760c50df3c97eb8',
];

function gitBlobSha1(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

async function rebuildArchive() {
  const files = (await readdir(RELEASE_DIR))
    .filter((name) => /^part-\d{2}\.b64$/.test(name))
    .sort();

  if (files.length !== EXPECTED_PART_SHA1.length) {
    throw new Error(`Pacote incompleto: esperadas ${EXPECTED_PART_SHA1.length} partes, recebidas ${files.length}.`);
  }

  const encoded = [];
  for (const [index, name] of files.entries()) {
    const raw = await readFile(resolve(RELEASE_DIR, name));
    const actualPartSha = gitBlobSha1(raw);
    const expectedPartSha = EXPECTED_PART_SHA1[index];
    if (actualPartSha !== expectedPartSha) {
      throw new Error(`Parte corrompida: ${name}. Esperado ${expectedPartSha}, recebido ${actualPartSha}.`);
    }
    encoded.push(raw.toString('utf8'));
  }

  const archive = Buffer.from(encoded.join('').replace(/\s/g, ''), 'base64');
  const actualArchiveSha = createHash('sha256').update(archive).digest('hex');
  if (actualArchiveSha !== EXPECTED_ARCHIVE_SHA256) {
    throw new Error(`Falha de integridade do release: esperado ${EXPECTED_ARCHIVE_SHA256}, recebido ${actualArchiveSha}.`);
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
        throw new Error(`Caminho inseguro no release: ${name}`);
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
  console.log('Preparando ClimaFlux ERP v0.5.0...');
  const archive = await rebuildArchive();
  const files = await extractTar(gunzipSync(archive));
  console.log(`Release validado: ${files} arquivos publicados em ${OUTPUT_DIR}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
