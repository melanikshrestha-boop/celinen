// Runs in its own process: Cloudflare SDK mock must not leak into other tests.
import {mock} from 'bun:test';
import assert from 'node:assert/strict';
const DOMAIN='sports-canonical-rgba256-v2';
class Stub {
  ctx:any;env:any;envVars={}; destroyed=0;
  responder:(...args:any[])=>Promise<Response>=async()=>Response.json({});
  constructor(ctx:any,env:any){this.ctx=ctx;this.env=env;}
  containerFetch(...args:any[]){return this.responder(...args);}
  async destroy(){this.destroyed++;}
}
mock.module('@cloudflare/containers',()=>({Container:Stub,getContainer:()=>{throw Error('unused');}}));
const {NativeV2}=await import('../infra/canonical-v2/worker');
const user='11111111-2222-4333-8444-555555555555',shoot='22222222-2222-4333-8444-555555555555';
const token='a'.repeat(64),job='b'.repeat(32),sha='c'.repeat(64);
const headers={Authorization:'Bearer '+token,'X-User-Id':user,'X-Shoot-Id':shoot,'X-Job-Id':job,
  'X-Source-Sha256':sha,'Content-Type':'application/octet-stream','Content-Length':'4'};
function request(path='/v2/decode',method='POST',extra={}){
  return new Request('https://private'+path,{method,headers:{...headers,...extra},...(method==='POST'?{body:'test'}:{})});
}
async function controller(initial=new Map<string,any>()){
  const store=initial;let ready:Promise<any>;
  const ctx={storage:{get:async(k:string)=>store.get(k),put:async(k:string,v:any)=>{store.set(k,v);},
    delete:async(k:string)=>store.delete(k),list:async({prefix,limit}:any)=>new Map([...store].filter(([k])=>k.startsWith(prefix)).slice(0,limit))},
    blockConcurrencyWhile:(fn:any)=>{ready=fn();}};
  const env={LENSLABS_V2_BRIDGE_TOKEN:token,LENSLABS_CANONICAL_V2_ENABLED:'true',LENSLABS_V2_OWNER_IDS:user,RELEASE_SHA:'d'.repeat(40)};
  const service=new NativeV2(ctx as any,env as any) as NativeV2 & Stub;
  await ready!;return {service,store,env};
}
const receipt=()=>Response.json({decoder_domain:DOMAIN,customer_authority:false,source:sha,canonical:'d'.repeat(64),
  architecture:'linux-amd64',image:{rgba:'PRIVATE_PIXEL_DATA'}});
let checks=0;
const check=(actual:any,expected:any)=>{assert.deepEqual(actual,expected);checks++;};
{
  const {service,env}=await controller();let calls=0;service.responder=async()=>{calls++;return receipt();};
  check((await service.fetch(request('/health','GET',{Authorization:''}))).status,401);
  env.LENSLABS_CANONICAL_V2_ENABLED='false';check((await service.fetch(request())).status,503);
  env.LENSLABS_CANONICAL_V2_ENABLED='true';env.LENSLABS_V2_OWNER_IDS='';check((await service.fetch(request())).status,403);
  check(calls,0);
}
{
  const {service,store}=await controller();let release!:(r:Response)=>void;
  service.responder=()=>new Promise(r=>{release=r;});
  const pending=service.fetch(request());
  while(!release) await Bun.sleep(1);
  check((await service.fetch(request('/v2/decode','POST',{'X-Job-Id':'e'.repeat(32)}))).status,429);
  check((await service.fetch(request('/jobs/'+job,'GET',{'X-User-Id':shoot}))).status,404);
  check((await service.fetch(request('/jobs/'+job,'GET'))).status,200);
  release(receipt());check((await pending).status,200);
  check(store.get('active'),undefined);
  check(JSON.stringify(store.get('result:'+job)).includes('PRIVATE_PIXEL_DATA'),false);
  check((await service.fetch(request())).status,409);
  store.set('rate:'+user,{window:Date.now(),count:30});
  check((await service.fetch(request('/v2/decode','POST',{'X-Job-Id':'e'.repeat(32)}))).status,429);
}
{
  const {service,store}=await controller();let release!:(r:Response)=>void;
  service.responder=()=>new Promise(r=>{release=r;});const pending=service.fetch(request());
  while(!release) await Bun.sleep(1);
  check((await service.fetch(request('/jobs/'+job,'DELETE'))).status,202);
  release(receipt());check((await pending).status,499);check(store.get('result:'+job).status,'cancelled');
  check(service.destroyed>0,true);check(store.get('active'),undefined);
}
{
  const {service,store}=await controller();
  check((await service.fetch(request('/kill'))).status,200);check(store.get('killed'),true);
  check((await service.fetch(request())).status,503);
  const restarted=await controller(store);check((await restarted.service.fetch(request())).status,503);
  check((await restarted.service.fetch(request('/reset-kill'))).status,409);
  restarted.env.LENSLABS_CANONICAL_V2_ENABLED='false';
  check((await restarted.service.fetch(request('/reset-kill'))).status,200);
  check(store.has('killed'),false);check((await restarted.service.fetch(request())).status,503);
}
{
  const store=new Map([['active',{job,user,shoot,status:'running',expires:Date.now()+60000}]]);
  const {service}=await controller(store);check(service.destroyed,1);check(store.has('active'),false);
  check(store.get('result:'+job)?.status,'interrupted');
}
{
  const {service,store}=await controller();service.responder=async()=>{throw Error('private upstream details');};
  const response=await service.fetch(request());check(response.status,502);
  check((await response.text()).includes('private upstream'),false);check(store.has('active'),false);
  check(service.destroyed,1);
}
{
  const {service,store}=await controller();const originalTimer=globalThis.setTimeout;
  globalThis.setTimeout=((callback:any,ms:any)=>{check(ms,75000);queueMicrotask(callback);return 0;}) as any;
  service.responder=async(_url,init)=>new Promise((_resolve,reject)=>{
    if(init.signal.aborted) reject(Error('aborted'));
    else init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});
  });
  try{
    const r=await service.fetch(request());check(r.status,504);check((await r.json()).code,'processing_timeout');
    check(store.get('result:'+job).status,'timeout');check(store.has('active'),false);
  }finally{globalThis.setTimeout=originalTimer;}
}
console.log(JSON.stringify({controller_assertions:checks,failed:0}));
