// Preserve qualified hash-only CI receipts beyond GitHub artifact retention.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const [normal,instrumented,out]=process.argv.slice(2);
if(!normal||!instrumented||!out) throw Error('Require normal.json instrumented.json output_directory');
const sha=b=>createHash('sha256').update(b).digest('hex');
const prepared=[];
for(const [name,path] of [['normal',normal],['asan-ubsan',instrumented]]){
  const bytes=readFileSync(path),r=JSON.parse(bytes);
  if(r.platform!=='linux'||r.architecture!=='x64'||r.nativeAmd64Runner!==true||r.cases.length!==510||
    r.stageComparisons!==1950||r.failures.length!==0||r.fixtureParityPassed!==true||r.sourcePreserved!==true||
    r.customerAuthority!==false||r.domain!=='sports-canonical-rgba256-v2'||r.cases.some(c=>c.receipt.image))
    throw Error('Receipt is not the expected complete hash-only AMD64 evidence');
  const compressed=gzipSync(bytes,{level:9});
  prepared.push({name,compressed,entry:{file:name+'.json.gz',json_sha256:sha(bytes),gzip_sha256:sha(compressed),
    git_sha:r.gitSha,probe_sha256:r.probeSha256,reference_sha256:r.referenceReportSha256,
    cases:r.cases.length,exact_stage_hashes:r.stageComparisons}});
}
mkdirSync(resolve(out),{recursive:true});
for(const {name,compressed} of prepared) writeFileSync(join(out,name+'.json.gz'),compressed,{flag:'wx'});
writeFileSync(join(out,'manifest.json'),JSON.stringify({schema:1,receipts:prepared.map(p=>p.entry)},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:prepared.length,contains_photographs:false}));
