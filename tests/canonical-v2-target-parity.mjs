// Compare a target binary to RETAINED ARM64 evidence; never create/update goldens.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { tmpdir, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const receiptFields = ['domain', 'contract', 'source', 'preview', 'jpeg', 'input_profile',
  'output_profile', 'profile_policy', 'orientation', 'canonical', 'tensor', 'stages'];

export function differences(expected, actual, exitCode, stderr = '') {
  const errors = [];
  if (/runtime error:|ERROR: AddressSanitizer|LeakSanitizer: detected/.test(stderr)) errors.push('sanitizer finding');
  if (expected.status !== actual?.status) errors.push('status');
  if (expected.status === 'ok') {
    if (exitCode !== 0) errors.push('exit');
    for (const key of receiptFields) if (!same(expected[key], actual?.[key])) errors.push(key);
  } else {
    if (exitCode !== 1) errors.push('exit');
    for (const key of ['code', 'stage']) if (expected[key] !== actual?.[key]) errors.push(key);
  }
  return errors;
}

// Same derivative bytes as canonical-v2-parity.mjs; reference input hashes verify this.
export function derivatives(jpeg) {
  const segment = (marker, payload) => {
    const h = Buffer.from([255, marker, 0, 0]); h.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([h, payload]);
  };
  const inject = p => Buffer.concat([jpeg.subarray(0, 2), p, jpeg.subarray(2)]);
  const result = new Map([
    ['truncated-jpeg', jpeg.subarray(0, jpeg.length - 100)],
    ['unsupported-bytes', Buffer.from('not an image')],
    ['malformed-icc', inject(segment(226, Buffer.concat([Buffer.from('ICC_PROFILE\0'), Buffer.from([1, 1, 1, 2, 3])])))],
    ['conflicting-orientation', inject(segment(225, Buffer.from('45786966000049492a0008000000010012010300010000000900000000000000', 'hex')))],
  ]);
  const parts = [jpeg.subarray(0, 2)]; let at = 2;
  while (at < jpeg.length) {
    if (jpeg[at] !== 255) throw Error('Unexpected fixture header');
    const marker = jpeg[at + 1]; if (marker === 218) { parts.push(jpeg.subarray(at)); break; }
    const size = jpeg.readUInt16BE(at + 2) + 2;
    if (size < 4 || at + size > jpeg.length) throw Error('Invalid fixture segment');
    if (!(marker === 225 && jpeg.subarray(at + 4, at + 10).equals(Buffer.from('Exif\0\0')))) parts.push(jpeg.subarray(at, at + size));
    at += size;
  }
  const clean = Buffer.concat(parts);
  for (let o = 1; o <= 8; o++) {
    const exif = Buffer.from('45786966000049492a0008000000010012010300010000000100000000000000', 'hex'); exif[24] = o;
    result.set(`exif-${o}`, Buffer.concat([clean.subarray(0, 2), segment(225, exif), clean.subarray(2)]));
  }
  return result;
}

function execute(probe, args) {
  return new Promise((done, reject) => {
    const started = performance.now();
    const child = spawn(probe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 120000);
    child.stdout.on('data', b => { out += b; if (out.length > 1048576) child.kill('SIGKILL'); });
    child.stderr.on('data', b => { err += b; if (err.length > 1048576) child.kill('SIGKILL'); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      let receipt; try { receipt = JSON.parse(out); } catch { receipt = { status: 'harness-error' }; }
      done({ code, signal, timedOut, receipt, stderr: err, elapsedMs: performance.now() - started });
    });
  });
}

async function main() {
  const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1]; };
  const rawRoot = arg('--raw-root'), probeArg = arg('--probe'), output = arg('--report');
  if (!rawRoot || !probeArg || !output) throw Error('Explicit --raw-root, --probe and --report are required');
  const requireAmd64 = process.argv.includes('--require-amd64');
  // GitHub's standard X64 runner is native x86 hardware virtualization, not QEMU/Rosetta.
  if (requireAmd64 && (platform() !== 'linux' || arch() !== 'x64' ||
      process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ARCH !== 'X64'))
    throw Error('AMD64 qualification requires the declared native Linux X64 CI runner; emulation is not qualification');
  const reference = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/canonical-v2-arm64-reference.json')));
  const lock = JSON.parse(readFileSync(resolve(root, 'native/canonical-v2.lock.json')));
  const suite = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/canonical-v2.json')));
  if (sha(readFileSync(resolve(root, 'native/canonical-v2.lock.json'))) !== reference.contract) throw Error('Contract changed');
  for (const [p, hash] of Object.entries(reference.implementationHashes))
    if (sha(readFileSync(resolve(root, p))) !== hash) throw Error(`Implementation changed: ${p}`);
  for (const key of ['jpeg', 'color', 'raw', 'profile']) {
    if (sha(readFileSync(resolve(root, 'native/build-v2/downloads', lock[key].file))) !== lock[key].sha256)
      throw Error(`Dependency/profile checksum: ${key}`);
  }
  const scratch = mkdtempSync(resolve(tmpdir(), 'lenslab-v2-target-'));
  const originals = [];
  const bytes = new Map(suite.fixtures.map(f => {
    const path = f.externalFile ? resolve(rawRoot, f.externalFile) : resolve(root, f.file);
    const data = readFileSync(path);
    if (sha(data) !== f.sha256) throw Error(`Fixture checksum: ${f.id}`);
    originals.push({ path, hash: f.sha256 });
    return [f.id, data];
  }));
  for (const [id, data] of derivatives(bytes.get(suite.fixtures[0].id))) bytes.set(id, data);
  if (reference.fixtures.length !== 17 || bytes.size !== 17) throw Error('Incomplete fixture set');
  for (const f of reference.fixtures) {
    if (sha(bytes.get(f.id)) !== f.sha256) throw Error(`Derived fixture differs: ${f.id}`);
    writeFileSync(resolve(scratch, f.name), bytes.get(f.id), { mode: 0o400, flag: 'wx' });
  }
  const probe = resolve(probeArg), profile = resolve(root, 'native/build-v2/downloads/sRGB2014.icc');
  const report = { schema: 1, gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    architecture: arch(), platform: platform(), nativeAmd64Runner: requireAmd64, domain: reference.domain,
    contract: reference.contract, referenceReportSha256: reference.originReportSha256,
    probeSha256: sha(readFileSync(probe)), compiler: execFileSync('clang++', ['--version'], { encoding: 'utf8' }),
    host: execFileSync('uname', ['-a'], { encoding: 'utf8' }),
    qualified: false, customerAuthority: false, cases: [], failures: [], sourcePreserved: false };
  let stopped = false;
  try {
    for (const concurrency of [1, 2, 4]) {
      const jobs = Array.from({ length: 10 }, (_, repeat) =>
        (repeat % 2 ? [...reference.fixtures].reverse() : reference.fixtures).map(f => ({ f, repeat }))).flat();
      let index = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (!stopped && index < jobs.length) {
          const { f, repeat } = jobs[index++];
          const r = await execute(probe, ['--experimental-v2', resolve(scratch, f.name), profile]);
          const mismatch = differences(f.receipt, r.receipt, r.code, r.stderr);
          if (r.signal || r.timedOut) mismatch.push('terminated/timeout');
          report.cases.push({ id: f.id, repeat, concurrency, ...r, mismatch });
          if (mismatch.length) { stopped = true; report.failures.push({ id: f.id, repeat, concurrency, mismatch }); }
        }
      }));
      console.log(`concurrency=${concurrency}: ${stopped ? 'FAIL' : 'exact'}`);
      if (stopped) break;
    }
  } finally {
    report.sourcePreserved = originals.every(f => sha(readFileSync(f.path)) === f.hash) &&
      reference.fixtures.every(f => sha(readFileSync(resolve(scratch, f.name))) === f.sha256);
    if (!report.sourcePreserved) report.failures.push({ error: 'SOURCE_CHANGED' });
    report.stageComparisons = report.cases.filter(c => c.receipt.status === 'ok').reduce((n, c) => n + c.receipt.stages.length, 0);
    report.fixtureParityPassed = report.failures.length === 0 && report.cases.length === 510;
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ fixtureParityPassed: report.fixtureParityPassed, cases: report.cases.length,
      stageComparisons: report.stageComparisons, failures: report.failures, sourcePreserved: report.sourcePreserved }));
    if (!report.fixtureParityPassed) process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
