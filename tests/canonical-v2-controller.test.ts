import {test,expect} from 'bun:test';
test('private V2 controller ownership, admission, restart, cancellation, durable privacy and kill switch',()=>{
  const result=Bun.spawnSync([process.execPath,new URL('./canonical-v2-controller.scenarios.ts',import.meta.url).pathname],
    {stdout:'pipe',stderr:'pipe'});
  if(result.exitCode!==0) throw Error(result.stderr.toString());
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain('"controller_assertions":37,"failed":0');
});
