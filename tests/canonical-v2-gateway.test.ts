import {test,expect} from 'bun:test';
import {handleV2Gateway,type V2GatewayEnv} from '../src/lib/canonical-v2-gateway.server';
const user='11111111-2222-4333-8444-555555555555',shoot='22222222-2222-4333-8444-555555555555';
const headers={Authorization:'Bearer a.b.c','X-Shoot-Id':shoot,'X-Source-Sha256':'c'.repeat(64),'Content-Length':'4','Content-Type':'application/octet-stream'};
const request=(extra={})=>new Request('https://lenslab.dev/api/native/v2',{method:'POST',headers:{...headers,...extra},body:'test'});
const env:V2GatewayEnv={LENSLABS_CANONICAL_V2_ENABLED:'true',LENSLABS_V2_OWNER_IDS:user,LENSLABS_V2_BRIDGE_TOKEN:'a'.repeat(64)};
test('V2 gateway authenticates and authorizes before contacting native processing',async()=>{
  let calls=0;const e={...env,CANONICAL_V2:{fetch:async()=>{calls++;return Response.json({});}}};
  expect((await handleV2Gateway(request({Authorization:''}),e)).status).toBe(401);
  expect((await handleV2Gateway(request(),e,async()=>null)).status).toBe(401);
  expect((await handleV2Gateway(request(),e,async()=>({user,owns:false}))).status).toBe(404);
  expect((await handleV2Gateway(request(),{...e,LENSLABS_V2_OWNER_IDS:''},async()=>({user,owns:true}))).status).toBe(403);
  expect((await handleV2Gateway(request(),{...e,LENSLABS_CANONICAL_V2_ENABLED:'false'},async()=>({user,owns:true}))).status).toBe(503);
  expect((await handleV2Gateway(request(),e,async()=>{throw Error('offline');})).status).toBe(503);
  expect(calls).toBe(0);
});
test('V2 gateway bounds upload and strips untrusted identity and private photo properties',async()=>{
  let calls=0;
  const e={...env,CANONICAL_V2:{fetch:async(r:Request)=>{
    calls++;expect(r.headers.get('X-User-Id')).toBe(user);expect(r.headers.get('Authorization')).toBe('Bearer '+'a'.repeat(64));
    expect(r.headers.has('X-Filename')).toBe(false);expect(r.headers.has('X-Local-Path')).toBe(false);
    expect(r.headers.get('X-Job-Id')).toMatch(/^[a-f0-9]{32}$/);expect(await r.text()).toBe('test');
    return Response.json({decoder_domain:'sports-canonical-rgba256-v2',customer_authority:false});
  }}};
  expect((await handleV2Gateway(request({'Content-Length':String(64*1024*1024+1)}),e,async()=>({user,owns:true}))).status).toBe(413);
  expect((await handleV2Gateway(request({'X-Filename':'private.jpg','X-Local-Path':'/private/photo','X-User-Id':'attacker'}),e,async()=>({user,owns:true}))).status).toBe(200);
  expect(calls).toBe(1);
});
test('native failure never falls back to V1',async()=>{
  const response=await handleV2Gateway(request(),{...env,CANONICAL_V2:{fetch:async()=>{throw Error('offline');}}},async()=>({user,owns:true}));
  expect(response.status).toBe(503);expect((await response.json()).code).toBe('native_unavailable');
});
