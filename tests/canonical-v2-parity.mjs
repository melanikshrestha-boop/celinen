// Explicit local Stage A/B experiment. No V1 writes, deployments or customer routes.
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const rawRoot=arg('--raw-root');
const instrumented=process.argv.includes('--instrumented');
if(!rawRoot)throw new Error('An explicitly approved --raw-root fixture directory is required');
const runRoot=mkdtempSync(resolve(tmpdir(),'celinen-v2-parity-'));
const report={schema:1,domain:'sports-canonical-rgba256-v2',runRoot,qualified:false,
  deploymentAllowed:false,linuxX86_64:{status:'BLOCKED',reason:'No physical x86-64 target supplied; emulation is not qualification'},
  instrumented,commands:[],fixtures:[],failures:[],sourcePreservation:[],unitTests:{}};
const sha=b=>createHash('sha256').update(b).digest('hex');
const lock=JSON.parse(readFileSync(resolve(root,'native/canonical-v2.lock.json')));
const context=arg('--docker-context')||'colima-celinen-linux';let container;
const sanitizeFlags='-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -Werror -pthread -fno-fast-math -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer';
const makeVariant=instrumented?['V2_DEPS_ROOT=build-v2/instrumented','V2_DIR=build-v2/instrumented',`FLAGS=${sanitizeFlags}`]:[];
const probeDirectory=instrumented?'build-v2/instrumented':'build-v2';
const record=()=>writeFileSync(resolve(runRoot,'run.json'),JSON.stringify(report,null,2));
function run(cmd,args,options={}) {
  const r=spawnSync(cmd,args,{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,...options});
  if(r.status!==0)throw new Error(`${cmd} failed (${r.status}): ${r.stderr?.toString().slice(-3000)||r.error?.message||r.stdout?.toString().slice(-3000)}`);
  return r.stdout;
}
const docker=args=>run('docker',['--context',context,...args]);
function execute(cmd,args,{timeout=120000,env=process.env}={}) {
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(cmd,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
    child.stdout.on('data',b=>{out+=b;if(out.length>16*1024*1024)child.kill('SIGKILL');});
    child.stderr.on('data',b=>{err+=b;if(err.length>16*1024*1024)child.kill('SIGKILL');});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',(status,signal)=>{clearTimeout(timer);resolvePromise({status,signal,out,err});});
  });
}
const snapshotFiles=['native/Makefile','native/src/decode_mac.cpp',
 'native/src/analysis.cpp','native/src/worker.cpp','native/src/develop_raw.cpp',
 'native/include/lenslabs/engine.hpp','tests/fixtures/canonical-v2.json'];
const before=Object.fromEntries(snapshotFiles.map(p=>[p,sha(readFileSync(resolve(root,p)))]));
try {
  for(const key of ['jpeg','color','raw','profile']) {
    const d=lock[key],p=resolve(root,'native/build-v2/downloads',d.file);
    if(sha(readFileSync(p))!==d.sha256)throw new Error(`Dependency hash mismatch: ${key}`);
  }
  report.dependencyLock=lock;report.contract=sha(readFileSync(resolve(root,'native/canonical-v2.lock.json')));
  const cmake=resolve(root,'native/build-v2/downloads/cmake-linux.tar.gz');
  if(sha(readFileSync(cmake))!=='609735983e3bdf24b6ab379d918458d64196fe72b98226f62dd5e9fe7b2997cc')throw new Error('Linux CMake hash mismatch');
  const suite=JSON.parse(readFileSync(resolve(root,'tests/fixtures/canonical-v2.json')));
  mkdirSync(resolve(runRoot,'fixtures'));
  const fixtures=suite.fixtures.map(f=>{
    const p=f.externalFile?resolve(rawRoot,f.externalFile):resolve(root,f.file),bytes=readFileSync(p);
    if(sha(bytes)!==f.sha256)throw new Error(`Fixture hash mismatch: ${f.id}`);
    const name=basename(p);writeFileSync(resolve(runRoot,'fixtures',name),bytes);
    return {id:f.id,name,original:p,hash:f.sha256,expected:'ok',orientation:f.orientation};
  });
  // Independent parser/error fixtures derive from approved JPEG bytes, never originals.
  const jpeg=readFileSync(fixtures[0].original);
  const add=(id,bytes,expected,orientation)=>{
    const name=id+'.jpg';writeFileSync(resolve(runRoot,'fixtures',name),bytes);
    fixtures.push({id,name,hash:sha(bytes),expected,orientation});
  };
  const segment=(marker,payload)=>{const h=Buffer.from([255,marker,0,0]);h.writeUInt16BE(payload.length+2,2);return Buffer.concat([h,payload]);};
  const inject=p=>Buffer.concat([jpeg.subarray(0,2),p,jpeg.subarray(2)]);
  add('truncated-jpeg',jpeg.subarray(0,jpeg.length-100),'INVALID_JPEG');
  add('unsupported-bytes',Buffer.from('not an image'),'UNSUPPORTED_SOURCE');
  add('malformed-icc',inject(segment(226,Buffer.concat([Buffer.from('ICC_PROFILE\0'),Buffer.from([1,1,1,2,3])]))),'INVALID_ICC_PROFILE');
  add('conflicting-orientation',inject(segment(225,Buffer.from('45786966000049492a0008000000010012010300010000000900000000000000','hex'))),'INVALID_ORIENTATION');
  // Remove existing EXIF, then insert a unique valid orientation tag.
  const parts=[jpeg.subarray(0,2)];let at=2;
  while(at<jpeg.length) {
    if(jpeg[at]!==255)throw new Error('Unexpected fixture header');
    const marker=jpeg[at+1];if(marker===218){parts.push(jpeg.subarray(at));break;}
    const size=jpeg.readUInt16BE(at+2)+2;
    if(!(marker===225&&jpeg.subarray(at+4,at+10).equals(Buffer.from('Exif\0\0'))))parts.push(jpeg.subarray(at,at+size));
    at+=size;
  }
  const clean=Buffer.concat(parts);
  for(let o=1;o<=8;o++) {
    const exif=Buffer.from('45786966000049492a0008000000010012010300010000000100000000000000','hex');exif[24]=o;
    add(`exif-${o}`,Buffer.concat([clean.subarray(0,2),segment(225,exif),clean.subarray(2)]),'ok',o);
  }
  console.log(`Evidence: ${runRoot}`);
  report.unitTests.mac=run('make',['-C','native','-f','v2.mk',...makeVariant,'test','decoder-test']);
  report.macBuild=run('make',['-C','native','-f','v2.mk',...makeVariant,'all']);
  report.macHardware=run('uname',['-a']);
  report.macCompiler=run('clang++',['--version']);
  report.implementationHashes=Object.fromEntries([
    'native/include/lenslabs/canonical_v2.hpp','native/src/canonical_v2/decode.cpp',
    'native/src/canonical_v2/primitives.cpp','native/src/canonical_v2/source.cpp',
    'native/src/canonical_v2/sha256.cpp','native/bootstrap-canonical-v2.sh','native/v2.mk'
  ].map(p=>[p,sha(readFileSync(resolve(root,p)))]));
  const depsPrefix=instrumented?'build-v2/instrumented':'build-v2';
  const buildFiles=[`${probeDirectory}/v2-probe`,`${depsPrefix}/prefix/lib/libjpeg.a`,
    `${depsPrefix}/prefix/lib/liblcms2.a`,`${depsPrefix}/deps/LibRaw-0.22.2/lib/libraw_r.a`];
  report.macBuildHashes=Object.fromEntries(buildFiles.map(p=>[p,sha(readFileSync(resolve(root,'native',p)))]));
  const linuxImage='celinen-v2-isolated:verification';
  report.linuxImage=docker(['image','inspect',linuxImage,'--format','{{.Id}}']);
  container=docker(['run','-d','--rm','--network','none','--read-only','--cap-drop=ALL',
    '--env','UBSAN_OPTIONS=halt_on_error=1','--env','ASAN_OPTIONS=detect_leaks=1',
    '--security-opt=no-new-privileges',instrumented?'--memory=3g':'--memory=1536m','--cpus=2','--pids-limit=96',
    '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=3g','--entrypoint','sleep',linuxImage,'7200']).trim();
  const files=['native/include/lenslabs/canonical_v2.hpp','native/src/canonical_v2',
    'native/tests/canonical_v2_tests.cpp','native/tests/canonical_v2_decoder_tests.cpp','native/tests/canonical_v2_probe.cpp','native/v2.mk',
    'native/canonical-v2.lock.json','native/bootstrap-canonical-v2.sh',
    ...['jpeg','color','raw','profile'].map(k=>'native/build-v2/downloads/'+lock[k].file),
    'native/build-v2/downloads/cmake-linux.tar.gz'];
  const archive=run('tar',['-cf','-',...files],{encoding:null,maxBuffer:100*1024*1024});
  run('docker',['--context',context,'exec','-i',container,'tar','-C','/tmp','-xf','-'],{input:archive});
  const photos=run('tar',['-C',runRoot,'-cf','-','fixtures'],{encoding:null,maxBuffer:160*1024*1024});
  run('docker',['--context',context,'exec','-i',container,'tar','-C','/tmp','-xf','-'],{input:photos});
  const setup=await execute('docker',['--context',context,'exec',container,'sh','-c',
    `tar -xzf /tmp/native/build-v2/downloads/cmake-linux.tar.gz -C /tmp && V2_BUILD_JOBS=1 V2_SANITIZE=${instrumented?1:0} CMAKE=/tmp/cmake-3.31.8-linux-aarch64/bin/cmake sh /tmp/native/bootstrap-canonical-v2.sh && make -C /tmp/native -f v2.mk ${instrumented?`V2_DEPS_ROOT=build-v2/instrumented V2_DIR=build-v2/instrumented FLAGS='${sanitizeFlags}'`:''} all test decoder-test`],{timeout:600000});
  writeFileSync(resolve(runRoot,'linux-build.log'),setup.out+'\n'+setup.err);
  if(setup.status!==0)throw new Error(`Linux build failed: see linux-build.log (${setup.status})`);
  if(/runtime error:|ERROR: AddressSanitizer|LeakSanitizer: detected/.test(setup.out+setup.err))
    throw new Error('Sanitizer finding in Linux setup/tests; see linux-build.log');
  report.unitTests.linux=setup.out.split('build-v2/v2-tests').pop();
  report.linuxHardware=docker(['exec',container,'uname','-a']);
  report.linuxCompiler=docker(['exec',container,'clang++','--version']);
  report.linuxBuildHashes=docker(['exec',container,'sha256sum',...buildFiles.map(p=>'/tmp/native/'+p)]);
  const profile=resolve(root,'native/build-v2/downloads/sRGB2014.icc');
  const macProbe=resolve(root,'native',probeDirectory,'v2-probe');
  for(const f of fixtures) {
    const entry={...f,mac:[],linux:[],mismatches:[]};
    for(let repeat=0;repeat<2;repeat++) {
      const [m,l]=await Promise.all([
        execute(macProbe,['--experimental-v2',resolve(runRoot,'fixtures',f.name),profile]),
        execute('docker',['--context',context,'exec',container,`/tmp/native/${probeDirectory}/v2-probe`,'--experimental-v2',`/tmp/fixtures/${f.name}`,'/tmp/native/build-v2/downloads/sRGB2014.icc'])]);
      if(m.signal||l.signal)throw new Error('Probe timed out or terminated; stop container before admitting another job');
      for(const [target,r] of [['mac',m],['linux',l]]) {
        let data;try{data=JSON.parse(r.out);}catch{data={status:'harness-error',exit:r.status,signal:r.signal,stderr:r.err};}
        entry[target].push(data);
        if(r.err){entry[target+'Stderr']??=[];entry[target+'Stderr'].push(r.err);}
        if(/runtime error:|ERROR: AddressSanitizer|LeakSanitizer: detected/.test(r.err))
          entry.mismatches.push(`${target}: sanitizer finding`);
        if(f.expected==='ok'?(data.status!=='ok'||r.status!==0||data.orientation!==f.orientation):(data.code!==f.expected||r.status!==1))
          entry.mismatches.push(`${target} repeat ${repeat}: expected ${f.expected}, got ${data.code||data.status}`);
      }
    }
    for(let i=0;i<2;i++) {
      const m=entry.mac[i],l=entry.linux[i];
      if(m.status==='ok'&&l.status==='ok') {
        for(const key of ['domain','contract','source','preview','jpeg','input_profile','output_profile','profile_policy','orientation','canonical','tensor','stages'])
          if(JSON.stringify(m[key])!==JSON.stringify(l[key]))entry.mismatches.push(`repeat ${i}: ${key}`);
        if(JSON.stringify(m)!==JSON.stringify(entry.mac[0])||JSON.stringify(l)!==JSON.stringify(entry.linux[0]))entry.mismatches.push('repeat instability');
      }
    }
    entry.sourceUnchanged=sha(readFileSync(resolve(runRoot,'fixtures',f.name)))===f.hash;
    if(f.original)entry.originalUnchanged=sha(readFileSync(f.original))===f.hash;
    if(!entry.sourceUnchanged||entry.originalUnchanged===false)entry.mismatches.push('SOURCE CHANGED');
    report.fixtures.push(entry);record();
    console.log(`${f.id}: ${entry.mismatches.length?'FAIL '+entry.mismatches.join('; '):'PASS'}`);
  }
  report.fixtureSubsetPassed=report.fixtures.every(f=>f.mismatches.length===0);
  report.remainingGates=['Physical Linux x86-64 unavailable','TSan and broader camera/profile/parser mutation coverage outstanding','Ten repeats and concurrency/cold-warm qualification matrix not completed','Sports quality/corpus/performance not evaluated'];
} catch(e) {report.failures.push(e.message);console.error(e.message);process.exitCode=1;}
finally {
  for(const [p,hash]of Object.entries(before))report.sourcePreservation.push({file:p,unchanged:sha(readFileSync(resolve(root,p)))===hash});
  if(report.sourcePreservation.some(x=>!x.unchanged))report.failures.push('Protected source changed');
  if(container)spawnSync('docker',['--context',context,'stop',container],{timeout:10000,stdio:'ignore'});
  record();console.log(`Report: ${runRoot}/run.json; qualified=false; no deployment`);
  // Fail-closed qualification command: 2 means BLOCKED, not successful release.
  process.exitCode=report.fixtureSubsetPassed&&report.failures.length===0?2:1;
}
