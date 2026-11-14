import test from 'node:test';
import assert from 'node:assert/strict';
import {runScenePasses} from '../dist/scene-queue.js';
import {UsageLedger} from '../dist/costs.js';
const error=()=>Object.assign(new Error('文字重叠'),{code:'SCENE_QUALITY',phase:'inspect'});
test('finishes the first ordered pass before retrying only failed scenes',async()=>{
  const calls=[],done=new Set(),counts=new Map();
  const result=await runScenePasses({indices:[3,0,2,1],sceneCount:4,maxPasses:2,isComplete:i=>done.has(i),run:async i=>{calls.push(i);const n=(counts.get(i)||0)+1;counts.set(i,n);if([1,3].includes(i)&&n===1)throw error();done.add(i);}});
  assert.deepEqual(calls,[0,1,2,3,1,3]);assert.equal(result.passes,2);assert.deepEqual(result.pending,[]);assert.equal(result.attempts.length,6);assert.equal(result.outcomes.length,4);
});
test('permanent failures have a strict pass cap and scope boundaries are retained',async()=>{
  const calls=[],done=new Set([0,2]);const result=await runScenePasses({indices:[1,3],sceneCount:4,maxPasses:3,isComplete:i=>done.has(i),run:async i=>{calls.push(i);if(i===1)throw error();done.add(i);}});
  assert.deepEqual(calls,[1,3,1,1]);assert.deepEqual(result.pending,[1]);assert.equal(result.passes,3);assert.ok(done.has(0)&&done.has(2));
});
test('pause, cancellation, provider and environment failures cannot start another automatic pass',async()=>{
  for(const [code,mode]of [['PROVIDER_BALANCE','continue'],['PROVIDER_AUTH','continue'],['PROVIDER_TIMEOUT','continue'],['RENDER_ENVIRONMENT','continue'],['SCENE_QUALITY','pause']]){
    const calls=[];const result=await runScenePasses({indices:[0,1,2],sceneCount:3,maxPasses:3,failureMode:mode,run:async i=>{calls.push(i);throw Object.assign(error(),{code});}});assert.deepEqual(calls,[0]);assert.equal(result.paused,true);
  }
  const controller=new AbortController(),calls=[];let n=0;const result=await runScenePasses({indices:[0,1],sceneCount:2,maxPasses:3,signal:controller.signal,run:async i=>{calls.push(i);if(i===0&&++n===2){controller.abort();throw new DOMException('暂停','AbortError');}if(i===0)throw error();}});assert.deepEqual(calls,[0,1,0]);assert.equal(result.cancelled,true);
});
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),values};}
const config={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'never-persist-this-secret'};
test('retry, pause/resume and reload preserve project costs and active elapsed time',()=>{
  const disk=storage();let now=0;const first=new UsageLedger({storage:disk,now:()=>now});const session=first.begin('一个项目');first.startClock();
  first.record({path:'/api/scene-code',config,data:{usage:{prompt_tokens:2000,completion_tokens:1000}}});now=1500;first.pauseClock();now=9000;first.resume(session.id,'继续');first.startClock();now=11500;first.record({path:'/api/scene-code/repair',config,data:{usage:{prompt_tokens:1000,completion_tokens:500}}});first.pauseClock();
  const before=first.summary();assert.equal(before.calls,2);assert.equal(first.elapsedMs(),4000);now=50000;
  const restored=new UsageLedger({storage:disk,now:()=>now});restored.resume(session.id,'继续');assert.equal(restored.elapsedMs(),4000);assert.deepEqual(restored.summary().settled,before.settled);restored.startClock();now=52000;assert.equal(restored.elapsedMs(),6000);
  assert.doesNotMatch(JSON.stringify([...disk.values.values()]),/never-persist-this-secret|apiKey|narration|promptText/);
});
test('in-flight requests survive an interrupted page as unconfirmed and settle without double counting',()=>{
  const disk=storage(),first=new UsageLedger({storage:disk,now:()=>1000});const s=first.begin('项目');const id=first.startRequest({path:'/api/scene-code',config});assert.equal(first.summary().calls,1);
  const restored=new UsageLedger({storage:disk,now:()=>20000});restored.resume(s.id,'继续');assert.equal(restored.summary().unknown,1);assert.equal(restored.summary().entries[0].status,'unconfirmed');
  restored.record({path:'/api/scene-code',config,requestId:id,data:{usage:{prompt_tokens:1000,completion_tokens:500}}});assert.equal(restored.summary().calls,1);assert.equal(restored.summary().unknown,0);assert.ok(restored.summary().settled[0].low>0);
});
test('new-topic accounting is separate, project export can restore a snapshot, and quota errors do not erase memory',()=>{
  const ledger=new UsageLedger({storage:null,now:()=>100});const original=ledger.begin('旧项目');ledger.record({path:'/api/scene-code',config,data:{usage:{prompt_tokens:1000,completion_tokens:100}}});const snapshot=ledger.snapshot();ledger.begin('新项目');assert.equal(ledger.summary().calls,0);ledger.resume(original.id,'返回');assert.equal(ledger.summary().calls,1);
  snapshot.apiKey='must-drop';snapshot.entries[0].prompt='must-drop';assert.equal(ledger.current.entries[0].prompt,undefined);const imported=new UsageLedger({storage:null,now:()=>1000});imported.resume(original.id,'导入',snapshot);assert.equal(imported.summary().calls,1);assert.doesNotMatch(JSON.stringify(imported.export()),/must-drop|apiKey|prompt/);
  const full=new UsageLedger({storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');}}});full.begin('项目');full.record({path:'/api/scene-code',config,ok:false});assert.equal(full.summary().calls,1);assert.equal(full.persistenceError,true);
});
