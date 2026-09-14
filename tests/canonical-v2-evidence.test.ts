import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=new URL('../docs/evidence/canonical-v2-amd64-20260914/',import.meta.url);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('retained AMD64 receipts preserve complete normal and sanitizer exact-hash evidence',()=>{
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  expect(manifest.receipts.map((r:any)=>r.file)).toEqual(['normal.json.gz','asan-ubsan.json.gz']);
  for(const receipt of manifest.receipts){
    const compressed=readFileSync(new URL(receipt.file,root)),bytes=gunzipSync(compressed),r=JSON.parse(bytes.toString());
    expect(sha(compressed)).toBe(receipt.gzip_sha256);expect(sha(bytes)).toBe(receipt.json_sha256);
    expect(r.failures).toEqual([]);expect(r.cases.length).toBe(510);expect(r.stageComparisons).toBe(1950);
    expect(r.fixtureParityPassed).toBe(true);expect(r.sourcePreserved).toBe(true);
    expect(r.cases.some((c:any)=>c.receipt.image)).toBe(false);
  }
});
