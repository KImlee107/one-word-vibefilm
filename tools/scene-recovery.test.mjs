import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneWithRecovery,preserveSceneFacts,creationSceneIndices,freshScene} from '../dist/scene-recovery.js';
import {chipProgram,portraitVectors} from './fixtures/film-code.mjs';
const quality={ok:false,issues:[{code:'TEXT_OVERLAP',message:'分数与标签重叠',examples:[{a:'1',b:'联合'}]}]};
const checked={frames:['a','b','c'],frameTimes:[1.8,4.8,7.8],stats:[],quality:{ok:true,issues:[]}};
function setup(){
  const calls=[],scene={id:'s2',title:'先验与似然',narration:'1/2乘1/6等于1/12。',caption:'联合概率1/12',duration:10,start:10,kind:'process',visual:{formula:'1/2×1/6=1/12',values:[]}},context={scene,index:1,project:{topic:'贝叶斯',scenes:[{title:'之前'},scene,{title:'之后'}]}};
  let drawings=0;
  const api={generateSceneCode:async(c,p)=>{calls.push({type:'generate',payload:p});return {program:++drawings===1?chipProgram:portraitVectors,usage:{tokens:100}};},repairSceneCode:async(c,p)=>{calls.push({type:'repair',payload:p});return {program:chipProgram,usage:{tokens:20}};},reviewSceneCode:async()=>assert.fail('Fallback must not restart visual rounds'),reviseSceneWithAI:async(c,p)=>{calls.push({type:'rewrite',payload:p});return {...scene,narration:'先看1/2，再乘1/6，结果1/12。'};}};
  return {calls,scene,options:{scene,context,project:{topic:'贝叶斯',ratio:'9:16'},rounds:0,api,inspect:async p=>p.source===chipProgram.source?{...checked,quality}:checked}};
}
test('exhausted layout repair escalates to exactly one fresh design, preserving text and facts',async()=>{
  const {calls,scene,options}=setup();const before=structuredClone(scene);let rewritten=false;
  const result=await buildSceneWithRecovery(options,{policy:'redesign',onRewrite:()=>{rewritten=true;}});
  assert.deepEqual(calls.map(c=>c.type),['generate','repair','generate']);assert.equal(result.program.source,portraitVectors.source);assert.equal(rewritten,false);assert.deepEqual(scene,before);assert.equal(result.recovery.mode,'redesign');assert.equal(result.usage.length,3);
  const fresh=calls.at(-1).payload;assert.equal(fresh.scene.codeFailure,undefined);assert.match(fresh.recoveryPlan.reason,/重叠/);assert.equal(fresh.recoveryPlan.qualityReport.issues[0].code,'TEXT_OVERLAP');
});
test('a second failed design stops instead of recursively repairing or generating more pages',async()=>{
  const {calls,options}=setup();options.inspect=async()=>({...checked,quality});
  await assert.rejects(()=>buildSceneWithRecovery(options),e=>e.code==='SCENE_QUALITY'&&e.redesignAttempted===true&&/已重新设计 1 次/.test(e.message));
  assert.deepEqual(calls.map(c=>c.type),['generate','repair','generate']);
});
test('opted-in rewrite preserves facts, updates only this scene context and then draws once',async()=>{
  const {calls,options}=setup();let applied;
  const result=await buildSceneWithRecovery(options,{policy:'rewrite',onRewrite:s=>{applied=s;}});
  assert.deepEqual(calls.map(c=>c.type),['generate','repair','rewrite','generate']);assert.equal(calls[2].payload.preserveFacts,true);assert.equal(applied.id,'s2');assert.equal(applied.start,10);assert.equal(applied.duration,10);assert.equal(result.recovery.requests,2);
  assert.deepEqual(calls.at(-1).payload.project.scenes.map(s=>s.title),['之前','先验与似然','之后']);
});
test('rewrite that alters a probability stops before drawing and leaves the original untouched',async()=>{
  const {calls,scene,options}=setup(),original=structuredClone(scene);options.api.reviseSceneWithAI=async()=>({...scene,narration:'答案是1/5。'});
  await assert.rejects(()=>buildSceneWithRecovery(options,{policy:'rewrite'}),e=>e.code==='SCENE_REWRITE_FACTS');assert.deepEqual(scene,original);assert.deepEqual(calls.map(c=>c.type),['generate','repair']);
});
test('provider errors, environment failures, cancellation and manual-only policy cannot escalate',async()=>{
  for(const code of ['PROVIDER_BALANCE','PROVIDER_AUTH','PROVIDER_TIMEOUT','NETWORK','RENDER_ENVIRONMENT','CANCELLED']){
    const {calls,options}=setup();options.api.generateSceneCode=async()=>{calls.push({type:'first'});throw Object.assign(new Error(code),{code,phase:'request'});};await assert.rejects(()=>buildSceneWithRecovery(options),e=>e.code===code);assert.deepEqual(calls.map(c=>c.type),['first']);
  }
  const {calls,options}=setup();await assert.rejects(()=>buildSceneWithRecovery(options,{policy:'stop'}));assert.deepEqual(calls.map(c=>c.type),['generate','repair']);
  const controller=new AbortController();controller.abort();const cancelled=setup();cancelled.options.signal=controller.signal;await assert.rejects(()=>buildSceneWithRecovery(cancelled.options),e=>e.name==='AbortError');assert.equal(cancelled.calls.length,0);
});
test('storyboard/pilot/full modes select exact ordered ranges, and fresh design clears resumable source',()=>{
  assert.deepEqual(creationSceneIndices(9,'storyboard'),[]);assert.deepEqual(creationSceneIndices(9,'pilot'),[0,1]);assert.deepEqual(creationSceneIndices(3,'all'),[0,1,2]);assert.throws(()=>creationSceneIndices(49));
  const s={title:'当前镜',narration:'1/4',program:chipProgram,codeFailure:{program:chipProgram},draftProgram:chipProgram,draftMeta:{reviews:[1]}};const fresh=freshScene(s);assert.equal(fresh.narration,s.narration);assert.equal(fresh.codeFailure,undefined);assert.equal(fresh.draftProgram,undefined);assert.equal(s.program,chipProgram);
  assert.throws(()=>preserveSceneFacts({...s,visual:{formula:'a²+b²=c²'}},{...s,visual:{formula:'a+b=c'}}),e=>e.code==='SCENE_REWRITE_FACTS');
});
