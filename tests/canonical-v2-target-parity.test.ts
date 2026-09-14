import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { differences, derivatives } from './canonical-v2-target-parity.mjs';
const reference = JSON.parse(readFileSync('tests/fixtures/canonical-v2-arm64-reference.json', 'utf8'));
describe('V2 target parity gate', () => {
  test('preserves all retained input and output receipts, including derivatives', () => {
    expect(reference.fixtures).toHaveLength(17);
    const source = readFileSync('tests/fixtures/photos/basketball-action-usaf-pd.jpg');
    for (const [id, bytes] of derivatives(source))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.fixtures.find(f => f.id === id).sha256);
  });
  test('exact stage receipts pass but a one-byte stage hash difference fails', () => {
    const good = reference.fixtures[0].receipt;
    expect(differences(good, good, 0)).toEqual([]);
    const bad = structuredClone(good); bad.stages[1].sha256 = '0'.repeat(64);
    expect(differences(good, bad, 0)).toContain('stages');
  });
  test('dimensions, contract, orientation, tensor and canonical provenance are mandatory', () => {
    const good = reference.fixtures[0].receipt;
    for (const key of ['domain', 'contract', 'orientation', 'tensor', 'canonical', 'source']) {
      const bad = structuredClone(good); delete bad[key];
      expect(differences(good, bad, 0)).toContain(key);
    }
    const bad = structuredClone(good); bad.stages[0].width++;
    expect(differences(good, bad, 0)).toContain('stages');
  });
  test('wrong exit code, malformed output and sanitizer findings fail closed', () => {
    const good = reference.fixtures[0].receipt;
    expect(differences(good, good, 1)).toContain('exit');
    expect(differences(good, null, 0)).toContain('status');
    for (const error of ['runtime error:', 'ERROR: AddressSanitizer', 'LeakSanitizer: detected'])
      expect(differences(good, good, 0, error)).toContain('sanitizer finding');
  });
  test('negative cases require matching typed category and stage, not library wording', () => {
    const bad = reference.fixtures.find(f => f.expected !== 'ok').receipt;
    expect(differences(bad, { ...bad, message: 'Different platform wording' }, 1)).toEqual([]);
    expect(differences(bad, { ...bad, code: 'INTERNAL_ERROR' }, 1)).toContain('code');
    expect(differences(bad, { ...bad, stage: 'wrong' }, 1)).toContain('stage');
  });
});
