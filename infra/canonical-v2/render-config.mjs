// Generate a local deploy config only after the packaged image has qualified.
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [image] = process.argv.slice(2);
const account = '126e9ae2c8ea356a21ca5f2cf95dd022';
if (!new RegExp(`^registry\\.cloudflare\\.com/${account}/lenslab-v2@sha256:[a-f0-9]{64}$`).test(image ?? ''))
  throw Error('Require the exact qualified Lenslab registry image reference');
const sha = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const config = {
  name:'lenslab-canonical-v2-private',main:'worker.ts',account_id:account,compatibility_date:'2026-09-14',
  compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,keep_vars:true,
  vars:{LENSLABS_CANONICAL_V2_ENABLED:'false',LENSLABS_V2_OWNER_IDS:'',RELEASE_SHA:sha},
  containers:[{class_name:'NativeV2',image,max_instances:1,instance_type:'standard-1'}],
  durable_objects:{bindings:[{name:'NATIVE',class_name:'NativeV2'}]},
  migrations:[{tag:'v2-private-1',new_sqlite_classes:['NativeV2']}],
  observability:{enabled:true,head_sampling_rate:1},
};
writeFileSync(new URL('wrangler.deploy.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({name:config.name,release:sha,image,enabled:false,maxInstances:1}));
