import test from 'node:test';
import assert from 'node:assert/strict';
import {selectSceneRange,orderedSceneIndices,runSceneQueue,shouldPauseSceneQueue} from '../dist/scene-queue.js';

const scenes=()=>[
  {id:'one',program:{source:'saved-1'},renderState:'complete'},
  {id:'two',renderState:'pending'},
  {id:'three',renderState:'failed',renderError:'old error',visual:{heroObjects:Array(9).fill('complex object')}},
  {id:'four',composition:{nodes:['saved-4']},renderState:'complete'},
  {id:'five',renderState:'pending'}
];
const localError=()=>Object.assign(new Error('this scene cannot draw'),{code:'SCENE_RUNTIME',phase:'draw'});
test('range presets select exact timeline numbers and keep completed drawings by default',()=>{
  const shots=scenes();
  assert.deepEqual(selectSceneRange(shots).indices,[1,2,4]);
  assert.deepEqual(selectSceneRange(shots,{mode:'all'}).indices,[1,2,4]);
  assert.deepEqual(selectSceneRange(shots,{mode:'all',keepCompleted:false}).indices,[0,1,2,3,4]);
  assert.deepEqual(selectSceneRange(shots,{mode:'current',currentIndex:2}).indices,[2]);
  assert.deepEqual(selectSceneRange(shots,{mode:'current',currentIndex:0}).indices,[]);
  assert.deepEqual(selectSceneRange(shots,{mode:'current',currentIndex:0,keepCompleted:false}).indices,[0]);
  const range=selectSceneRange(shots,{mode:'custom',start:'2',end:'4'});
  assert.deepEqual(range.selected,[1,2,3]);assert.deepEqual(range.indices,[1,2]);assert.deepEqual(range.skipped,[3]);
  assert.deepEqual(selectSceneRange(shots,{mode:'missing',keepCompleted:false}).indices,[1,2,4]);
});
test('empty, fractional, reversed or out-of-bounds ranges fail before any generation call',async()=>{
  for(const [start,end]of [['',4],[1,''],[0,3],[3,2],[1,6],[1.5,3],['NaN',3],[1,Infinity]])assert.throws(()=>selectSceneRange(scenes(),{mode:'custom',start,end}),{code:'SCENE_RANGE'});
  assert.throws(()=>selectSceneRange(scenes(),{mode:'current',currentIndex:5}),{code:'SCENE_RANGE'});
  let calls=0;await assert.rejects(runSceneQueue({indices:[0,5],sceneCount:5,preflight:async()=>calls++,run:async()=>calls++}),{code:'SCENE_RANGE'});assert.equal(calls,0);
});
test('every caller runs sequentially in numeric order, regardless of input order or complexity',async()=>{
  const calls=[];let active=0,maxActive=0;
  const result=await runSceneQueue({indices:[3,2,0,1,2],sceneCount:5,run:async index=>{
    active++;maxActive=Math.max(maxActive,active);calls.push(index);await new Promise(resolve=>setTimeout(resolve,2));active--;
  }});
  assert.deepEqual(calls,[0,1,2,3]);assert.equal(maxActive,1);assert.deepEqual(result.pending,[]);assert.equal(result.outcomes.length,4);
  assert.deepEqual(orderedSceneIndices([4,1,2,1],5),[1,2,4]);
});
test('range execution preserves completed and out-of-range scenes without requesting them',async()=>{
  const shots=scenes(),before=structuredClone(shots),calls=[];
  const plan=selectSceneRange(shots,{mode:'custom',start:2,end:4});
  await runSceneQueue({indices:plan.indices,sceneCount:shots.length,run:async index=>{calls.push(index);shots[index].program={source:'new-'+index};shots[index].renderState='complete';}});
  assert.deepEqual(calls,[1,2]);for(const index of [0,3,4])assert.deepEqual(shots[index],before[index]);
});
test('scene-specific failure can continue to the next number and leaves failed output incomplete',async()=>{
  const calls=[],results=[];
  const result=await runSceneQueue({indices:[0,1,2,3],sceneCount:4,failureMode:'continue',run:async index=>{calls.push(index);if(index===1)throw localError();},onResult:result=>results.push(result)});
  assert.deepEqual(calls,[0,1,2,3]);assert.deepEqual(results.map(r=>r.status),['complete','failed','complete','complete']);assert.equal(result.paused,false);assert.deepEqual(result.pending,[]);
  assert.equal(result.outcomes.filter(r=>r.status==='complete').length,3);assert.equal(result.outcomes.filter(r=>r.status==='failed').length,1);
});
test('pause option stops at the failing scene and retains the remaining queue for later selection',async()=>{
  const calls=[];
  const result=await runSceneQueue({indices:[0,1,2],sceneCount:3,failureMode:'pause',run:async index=>{calls.push(index);if(index===1)throw localError();}});
  assert.deepEqual(calls,[0,1]);assert.equal(result.paused,true);assert.deepEqual(result.pending,[2]);
});
test('authentication, quota, network, environment and configuration errors always pause the batch',async()=>{
  for(const error of [
    {code:'PROVIDER_AUTH',message:'bad key'},
    {code:'PROVIDER_RATE_LIMIT',message:'rate limit'},
    {code:'PROVIDER_ERROR',message:'insufficient balance'},
    {code:'PROVIDER_NETWORK',message:'connection failed'},
    {code:'RENDER_ENVIRONMENT',message:'no worker'},
    {code:'MODEL_REQUIRED',phase:'request',message:'missing model'}
  ]){
    const calls=[];const result=await runSceneQueue({indices:[0,1,2],sceneCount:3,failureMode:'continue',run:async index=>{calls.push(index);throw Object.assign(new Error(error.message),error);}});
    assert.deepEqual(calls,[0]);assert.equal(result.paused,true);
  }
  assert.equal(shouldPauseSceneQueue({code:'CODE_FORMAT',phase:'request'},'continue'),false);
});
test('cancel preserves earlier results and submits no later scenes; failed preflight makes no model calls',async()=>{
  const controller=new AbortController(),calls=[];
  const result=await runSceneQueue({indices:[0,1,2,3],sceneCount:4,signal:controller.signal,run:async index=>{calls.push(index);if(index===1){controller.abort();throw new DOMException('cancel','AbortError');}}});
  assert.deepEqual(calls,[0,1]);assert.deepEqual(result.pending,[1,2,3]);assert.equal(result.cancelled,true);assert.equal(result.outcomes[0].status,'complete');
  let requested=false;await assert.rejects(runSceneQueue({indices:[0,1],sceneCount:2,preflight:async()=>{throw Object.assign(new Error('unsupported'),{code:'RENDER_ENVIRONMENT'});},run:async()=>{requested=true;}}));assert.equal(requested,false);
});
