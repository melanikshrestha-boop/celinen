// Real HTTP contract tests against the packaged native service. No user corpus.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {differences, derivatives} from './canonical-v2-target-parity.mjs';
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const origin = value('--origin'), rawRoot = value('--raw-root'), name = value('--container');
assert(origin && rawRoot && name);
const token = 'a'.repeat(64); // CI-only token. Never a production credential.
const sha = b => createHash('sha256').update(b).digest('hex');
const suite = JSON.parse(readFileSync('tests/fixtures/canonical-v2.json'));
const reference = JSON.parse(readFileSync('tests/fixtures/canonical-v2-arm64-reference.json'));
const bytes = new Map(suite.fixtures.map(f => [f.id, readFileSync(f.externalFile ? `${rawRoot}/${f.externalFile}` : f.file)]));
for (const [id, data] of derivatives(bytes.get(suite.fixtures[0].id))) bytes.set(id, data);
const results = [];
const headers = data => ({'Content-Type':'application/octet-stream','X-Native-Authorization':token,
  'X-Job-Id':'b'.repeat(32), 'X-Source-Sha256':sha(data)});
const post = (data, h = headers(data)) => fetch(`${origin}/v2/decode`, {method:'POST',headers:h,body:data});
// Auth/disabled/size/type checks deliberately reject before reading the body.
// A streaming fetch racing that early close may report EPIPE instead of exposing
// the HTTP response. Send headers only and assert the actual wire status/body;
// do not drain a photograph into a route that has already rejected admission.
const preflight = (data,h=headers(data)) => new Promise((resolve,reject)=>{
  const r=httpRequest(`${origin}/v2/decode`,{method:'POST',headers:{...h,'Content-Length':String(data.length)},timeout:5000},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));
    response.on('end',()=>{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});r.destroy();});
  });
  r.on('error',reject);r.on('timeout',()=>r.destroy(Error('header rejection timeout')));r.flushHeaders();
});
assert.equal((await fetch(`${origin}/health`)).status,200);
const ready = await (await fetch(`${origin}/ready`)).json();
assert.equal(ready.ready,true); assert.equal(ready.customer_authority,false);
const jpeg = bytes.get(suite.fixtures[0].id);
assert.equal((await preflight(jpeg, {'Content-Type':'application/octet-stream'})).status,401);
if (args.includes('--dark')) {
  assert.equal(ready.enabled,false); const r = await preflight(jpeg); assert.equal(r.status,503);
  assert.equal(r.body.code,'disabled'); console.log('PASS dark /health /ready, unauthenticated and disabled processing');
} else {
  assert.equal(ready.enabled,true);
  for (const fixture of reference.fixtures) {
    const data = bytes.get(fixture.id), before = sha(data);
    const response = await post(data), receipt = await response.json();
    assert.equal(response.status,fixture.receipt.status === 'ok' ? 200 : 422,
      `${fixture.id}: ${receipt.code ?? receipt.status}`);
    assert.deepEqual(differences(fixture.receipt,receipt,response.status === 200 ? 0 : 1),[],fixture.id);
    assert.equal(receipt.decoder_domain,'sports-canonical-rgba256-v2');
    assert.equal(receipt.customer_authority,false);
    if (receipt.status === 'ok') {
      const rgba = Buffer.from(receipt.image.data,'base64');
      assert.equal(rgba.length,receipt.image.width * receipt.image.height * 4);
      assert.equal(sha(rgba),receipt.canonical);
      assert.equal(receipt.architecture,'linux-amd64');
      for (let i=3;i<rgba.length;i+=4) assert.equal(rgba[i],255);
    }
    assert.equal(before,sha(data));
    assert.equal(execFileSync('docker',['exec',name,'find','/tmp/lenslab-v2','-mindepth','1'],{encoding:'utf8'}).trim(),'');
    results.push({id:fixture.id,status:response.status,canonical:receipt.canonical,
      processingMs:Number(response.headers.get('X-Processing-Ms')),peakMemoryKiB:Number(response.headers.get('X-Peak-Memory-KiB'))});
  }
  assert.equal((await post(jpeg,{...headers(jpeg),'X-Source-Sha256':'0'.repeat(64)})).status,422);
  assert.equal((await preflight(jpeg,{...headers(jpeg),'Content-Type':'image/jpeg'})).status,400);
  assert.equal((await preflight(jpeg,{...headers(jpeg),'X-Job-Id':'../invalid'})).status,400);
  const oversize = Buffer.alloc(64*1024*1024+1);
  assert.equal((await preflight(oversize)).status,413);
  assert.equal(execFileSync('docker',['exec',name,'id','-u'],{encoding:'utf8'}).trim(),'10001');
  assert.equal(execFileSync('docker',['exec',name,'find','/tmp/lenslab-v2','-mindepth','1'],{encoding:'utf8'}).trim(),'');
  assert.equal((await fetch(`${origin}/ready`)).status,200);
  writeFileSync('/tmp/lenslab-v2-http-receipts.json',JSON.stringify({passed:true,results,sourcePreserved:true},null,2));
  console.log(`PASS ${results.length} real HTTP parity cases, RGBA hashes, negative validation, immutable inputs, cleanup, UID10001`);
}
