// Explicit operator step after both reviewed Workers exist. Credentials live only
// in this process and Cloudflare encrypted secrets, never files or command args.
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const config=new URL('wrangler.deploy.json',import.meta.url).pathname;
const deploy=JSON.parse(readFileSync(config,'utf8'));
if(process.argv[2]!=='--rotate-and-probe' || deploy.name!=='lenslab-canonical-v2-private' ||
   deploy.vars.LENSLABS_CANONICAL_V2_ENABLED!=='false' || deploy.vars.LENSLABS_V2_OWNER_IDS!=='' ||
   !deploy.containers[0].image.includes('@sha256:')) throw Error('Require reviewed digest-pinned dark deployment');
const token=randomBytes(32).toString('hex');
const cli=new URL('node_modules/wrangler/bin/wrangler.js',import.meta.url).pathname;
const env={...process.env,CLOUDFLARE_ACCOUNT_ID:deploy.account_id,WRANGLER_SEND_METRICS:'false'};
for(const name of ['lenslab-canonical-v2-private','lenslab-web']){
  execFileSync(process.execPath,[cli,'secret','put','LENSLABS_V2_BRIDGE_TOKEN','--name',name,'--config',config],
    {input:token+'\n',env,stdio:['pipe','pipe','pipe']});
  console.log(JSON.stringify({secret_configured:true,worker:name}));
}
const origin='https://lenslab-canonical-v2-private.melanikshrestha.workers.dev';
const auth={Authorization:'Bearer '+token};
if((await fetch(origin+'/health')).status!==401) throw Error('Anonymous health must require credentials');
for(const path of ['/health','/ready']){
  let body;
  for(let attempt=0;attempt<4;attempt++){
    const r=await fetch(origin+path,{headers:auth,signal:AbortSignal.timeout(35000)});
    body=await r.json();
    if(r.ok) break;
    if(attempt===3) throw Error('Cold-start health/ready not verified');
    await new Promise(r=>setTimeout(r,5000));
  }
  if(body.enabled!==false || body.customer_authority!==false || body.release_sha!==deploy.vars.RELEASE_SHA ||
    (path==='/health'&&body.native.architecture!=='linux-amd64') || (path==='/ready'&&body.native.enabled!==false))
    throw Error('Unexpected dark service provenance');
  console.log(JSON.stringify({path,...body}));
}
const data=Buffer.from('dark probe, not a photograph');
const response=await fetch(origin+'/v2/decode',{method:'POST',headers:{...auth,'Content-Type':'application/octet-stream',
  'X-User-Id':'11111111-2222-4333-8444-555555555555','X-Shoot-Id':'22222222-2222-4333-8444-555555555555',
  'X-Job-Id':'b'.repeat(32),'X-Source-Sha256':createHash('sha256').update(data).digest('hex')},body:data});
if(response.status!==503 || (await response.json()).code!=='disabled') throw Error('Dark processing did not fail closed');
console.log(JSON.stringify({dark_processing:'disabled',anonymous:'401',source_photos_uploaded:0}));
