import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneProgram} from '../dist/scene-pipeline.js';
import {chipProgram} from './fixtures/film-code.mjs';
import {filmFingerprint} from '../dist/film-program.js';

const inspection={frames:['a','b','c'],stats:[{coverage:.3}],thumbnail:'frame'};
const runtimeError=()=>Object.assign(new Error('fr.notAFunction is not a function'),{code:'SCENE_RUNTIME',phase:'draw'});
const broken={...chipProgram,source:chipProgram.source+'\nfr.notAFunction(t);'};

test('a structurally duplicated scene is repaired once before rendering, instead of losing the generated source',async()=>{
  const {options,calls}=setup();
  options.context.previousDesigns=[{fingerprint:filmFingerprint(chipProgram)}];
  const distinct={...chipProgram,source:chipProgram.source+'\nfr.circle(fr.w*.7,fr.h*.4,12+t,{fill:scene.palette.gold});'};
  options.api.generateSceneCode=async()=>{calls.push('generate');return {program:chipProgram};};
  options.api.repairSceneCode=async(config,payload)=>{calls.push('repair');assert.equal(payload.program.source,chipProgram.source);assert.match(payload.issue,/结构.*重复/);return {program:distinct};};
  const result=await buildSceneProgram(options);assert.equal(result.program.source,distinct.source);assert.equal(result.repairs,1);assert.deepEqual(calls,['generate','repair','inspect']);
});
function setup(overrides={}){
  const calls=[],checkpoints=[],scene={title:'芯片',duration:10},project={ratio:'16:9'},context={scene,project};
  const api={generateSceneCode:async()=>{calls.push('generate');return {program:broken,usage:{tokens:100}};},repairSceneCode:async(config,payload)=>{calls.push('repair');assert.equal(payload.program.source,broken.source);assert.match(payload.issue,/notAFunction/);assert.equal(payload.scene.title,'芯片');return {program:chipProgram,usage:{tokens:20}};},reviewSceneCode:async()=>{calls.push('review');return {program:chipProgram,feedback:'放大引脚'};}};
  const options={scene,project,context,rounds:0,api,inspect:async program=>{calls.push('inspect');if(program.source===broken.source)throw runtimeError();return inspection;},onCheckpoint:state=>checkpoints.push(state),...overrides};
  return {options,calls,checkpoints};
}
test('a failed drawing is checkpointed before execution and repaired without regenerating its storyboard',async()=>{
  const {options,calls,checkpoints}=setup();
  const result=await buildSceneProgram(options);
  assert.deepEqual(calls,['generate','inspect','repair','inspect']);assert.equal(result.repairs,1);assert.equal(result.program.source,chipProgram.source);assert.equal(result.usage.length,2);
  assert.equal(checkpoints[0].program.source,broken.source);assert.equal(checkpoints[0].ready,false);assert.equal(checkpoints.at(-1).ready,true);assert.equal(checkpoints.find(x=>x.failure)?.failure.phase,'draw');
});
test('only one automatic repair is billed and the second failure retains the final attempted source',async()=>{
  const {options,calls,checkpoints}=setup();options.api.repairSceneCode=async()=>{calls.push('repair');return {program:broken};};
  await assert.rejects(buildSceneProgram(options),error=>error.repairExhausted===true&&error.phase==='draw');assert.equal(calls.filter(x=>x==='repair').length,1);assert.equal(calls.filter(x=>x==='generate').length,1);assert.equal(checkpoints.at(-1).failure.program.source,broken.source);
});
test('environment failures, cancellation, and provider authorization do not trigger code repair',async()=>{
  for(const error of [Object.assign(new Error('unsupported'),{code:'RENDER_ENVIRONMENT'}),new DOMException('cancel','AbortError'),Object.assign(new Error('key rejected'),{code:'PROVIDER_AUTH'})]){
    const {options,calls}=setup();options.inspect=async()=>{throw error;};await assert.rejects(buildSceneProgram(options),e=>e===error);assert.equal(calls.includes('repair'),false);
  }
  const {options,calls}=setup();options.api.generateSceneCode=async()=>{throw Object.assign(new Error('rate limit'),{code:'PROVIDER_RATE_LIMIT'});};await assert.rejects(buildSceneProgram(options));assert.deepEqual(calls,[]);
});
test('resume chooses the most recent failed source over an older draft and avoids new code generation',async()=>{
  const {options,calls}=setup({scene:{title:'芯片',duration:10,draftProgram:chipProgram,codeFailure:{program:broken}}});
  const result=await buildSceneProgram(options);assert.equal(result.program.source,chipProgram.source);assert.deepEqual(calls,['inspect','repair','inspect']);
});
test('invalid provider source can be repaired before any execution instead of being discarded',async()=>{
  const {options,calls,checkpoints}=setup();const unknown={...chipProgram,source:chipProgram.source+'\nfr.circle(notDeclared,t,10,{});'};
  options.api.generateSceneCode=async()=>{calls.push('generate');throw Object.assign(new Error('invalid source'),{recovery:{program:unknown,usage:{tokens:100}}});};
  options.api.repairSceneCode=async(config,payload)=>{calls.push('repair');assert.equal(payload.program.source,unknown.source);assert.match(payload.issue,/notDeclared/);assert.equal(payload.phase,'compile');return {program:chipProgram};};
  const result=await buildSceneProgram(options);assert.equal(result.repairs,1);assert.deepEqual(calls,['generate','repair','inspect']);assert.equal(checkpoints[0].failure.program.source,unknown.source);
});
test('visual revision errors use the same single repair budget and completed reviews can resume',async()=>{
  const {options,calls}=setup({rounds:2,scene:{title:'芯片',duration:10,draftProgram:chipProgram,draftMeta:{reviews:[{round:1,feedback:'已完成一轮'}]}}});
  options.api.reviewSceneCode=async(config,payload)=>{calls.push('review');assert.equal(payload.round,2);assert.deepEqual(payload.frames,inspection.frames);return {program:broken,feedback:'调整了构图'};};
  const result=await buildSceneProgram(options);assert.deepEqual(calls,['inspect','review','inspect','repair','inspect']);assert.equal(result.reviews.length,2);assert.equal(result.reviews[1].feedback,'调整了构图');
});
test('missing program JSON is retained as a raw draft and repaired exactly once instead of discarded',async()=>{
  const {options,calls,checkpoints}=setup();const draft='```javascript\nfunction draw(fr,t,scene,VK){ incomplete return';
  options.api.generateSceneCode=async()=>{calls.push('generate');throw Object.assign(new Error('format error'),{recovery:{draft,usage:{tokens:99}}});};
  options.api.repairSceneCode=async(config,payload)=>{calls.push('repair');assert.equal(payload.draft,draft);assert.equal(payload.program,null);return {program:chipProgram};};
  const result=await buildSceneProgram(options);assert.equal(result.repairs,1);assert.deepEqual(calls,['generate','repair','inspect']);assert.equal(checkpoints.find(c=>c.failure)?.failure.draft,draft);
});
test('real-frame quality failures reach the visual round before using any extra repair budget',async()=>{
  const {options,calls}=setup({rounds:1,scene:{title:'芯片',duration:10,draftProgram:chipProgram}});
  options.inspect=async()=>({...inspection,frameTimes:[1.8,4.8,7.8],quality:{version:2,ok:calls.includes('review'),issues:calls.includes('review')?[]:[{code:'TEXT_OVERLAP',message:'labels collide'}]}});
  options.api.reviewSceneCode=async(config,payload)=>{calls.push('review');assert.equal(payload.qualityReport.issues[0].code,'TEXT_OVERLAP');assert.deepEqual(payload.frameTimes,[1.8,4.8,7.8]);return {program:chipProgram,feedback:'已重新分区'};};
  const result=await buildSceneProgram(options);assert.equal(result.inspection.quality.ok,true);assert.equal(result.repairs,0);assert.deepEqual(calls,['review']);
});
test('layout still failing after a single targeted correction stays incomplete with measured issues',async()=>{
  const {options,calls,checkpoints}=setup({scene:{title:'芯片',duration:10,draftProgram:chipProgram}});
  options.inspect=async()=>({...inspection,quality:{ok:false,issues:[{code:'TEXT_SMALL',message:'labels too small'}]}});
  options.api.repairSceneCode=async(config,payload)=>{calls.push('repair');assert.equal(payload.qualityReport.issues[0].code,'TEXT_SMALL');return {program:chipProgram};};
  await assert.rejects(buildSceneProgram(options),{code:'SCENE_QUALITY'});assert.deepEqual(calls,['repair']);assert.equal(checkpoints.at(-1).failure.quality.ok,false);
});
