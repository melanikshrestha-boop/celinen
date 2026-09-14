import {expect,test} from 'bun:test';
import {bridgeAuthorized,validate,MAX_BYTES,DOMAIN} from '../infra/canonical-v2/policy';
const token = 'a'.repeat(64);
const user = '11111111-2222-4333-8444-555555555555';
const good = {'X-User-Id':user,'X-Shoot-Id':user,'X-Job-Id':'b'.repeat(32),'X-Source-Sha256':'c'.repeat(64),
  'Content-Type':'application/octet-stream','Content-Length':'12'};
test('private V2 bridge rejects missing, malformed and wrong credentials',async()=>{
  for (const secret of [undefined,'',token]) expect(await bridgeAuthorized(new Request('https://private'),secret)).toBe(false);
  expect(await bridgeAuthorized(new Request('https://private',{headers:{Authorization:'Bearer '+'b'.repeat(64)}}),token)).toBe(false);
  expect(await bridgeAuthorized(new Request('https://private',{headers:{Authorization:'Bearer '+token}}),token)).toBe(true);
});
test('private V2 validates bounded length, identity, job and expected source hash',()=>{
  const request = (headers:Record<string,string>) => new Request('https://private',{method:'POST',headers});
  expect(validate(request(good))).toEqual({user,shoot:user,job:'b'.repeat(32),sha:'c'.repeat(64),length:12});
  for (const [key,val] of [['X-User-Id','email@example.com'],['X-Shoot-Id','../'],['X-Job-Id','x'],['X-Source-Sha256','wrong'],
    ['Content-Length','-1'],['Content-Length','1.5'],['Content-Length','0'],['Content-Type','image/jpeg'],['Content-Encoding','gzip']]) {
    expect(validate(request({...good,[key]:val}))).toHaveProperty('failure');
  }
  const large = validate(request({...good,'Content-Length':String(MAX_BYTES+1)}));
  expect('failure' in large && large.failure.status).toBe(413);
  expect(DOMAIN).toBe('sports-canonical-rgba256-v2');
});
