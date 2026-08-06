import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());
const RELEASE_DIR = resolve(ROOT, '.release-v040');
const OUTPUT_DIR = resolve(ROOT, 'public');
const EXPECTED_ARCHIVE_SHA256 = '34804cc826c0cced08375ff288b0de9ba7bcee723aa538cf6c5e5d44c9b9f3f0';
const EXPECTED_PART_SHA1 = [
  '9d00f9fb0017d812d12ec8c5b5129e8fd0aef684',
  '8bd9ab5363da9d09389bd98c47d93aad77759897',
  'ee2e5a9cdb2a299e2ef07d2ce9255f4176a9a6be',
  '3bac5104ecd06795cbb2241e2141ce05080b731e',
  '480a383bb6c5f38c19d6c4438023a848a1d6931c',
  'c3413bdd285248c618ed8e91d1bc90a165ff65d7',
  '0ea8459b5b4618ec2f83f91f3f4e9a3c83336dbc',
  '16ce3c3b7dfe0913a30a6892f411494807bf416c',
  'c5314d23f7ae97a3bddb4baed11512c67b7ff5c6',
  '2dd3db52ad97741143b4a9a5d69416d32159a7ff',
  '426198e2b3013304a211f1711e9e548775e51825',
  '1e49d54cab68d0f8310f433f771839e55f6207e1',
  '2251d95c8c9684916ed9abe938392c1757e73ec3',
  '7dc611d768b2c3fcb5c5b8b22b9b8206f4634859',
  '10f2e5abb78135c97dc83727c766763372cb1bcf',
  'ed99295b561b95f00c9d16debd30fa43ef7998ca',
  '3b7d7b55084e58add20041aabb761764f3b4098b',
  '8fe214ec9c94a98d364811a0d19cb400cc755d85',
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
  console.log('Preparando ClimaFlux ERP v0.4.0...');
  const archive = await rebuildArchive();
  const files = await extractTar(gunzipSync(archive));
  console.log(`Release validado: ${files} arquivos publicados em ${OUTPUT_DIR}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
