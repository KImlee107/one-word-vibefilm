import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createProject,createProjectFromScript,drawFrame,getSceneAt,reviseScene} from '../dist/engine.js';
const {createCanvas}=createRequire(import.meta.url)('@napi-rs/canvas');
function pixels(project,time){const c=createCanvas(270,480);drawFrame(c.getContext('2d'),project,time,270,480);return createHash('sha256').update(c.toBuffer('image/png')).digest('hex');}
test('local knowledge timelines are contiguous and match both selected durations',()=>{
  for(const topic of ['骰子概率','抛硬币','大数定律'])for(const duration of [90,120]){
    const project=createProject({topic,duration});let end=0;
    for(const scene of project.scenes){assert.ok(Math.abs(scene.start-end)<1e-6);end+=scene.duration;}
    assert.ok(Math.abs(end-duration)<1e-6);assert.equal(getSceneAt(project,duration).index,project.scenes.length-1);
  }
});
test('time-based drawing is deterministic and changes during an explanation',()=>{
  const p=createProject();assert.equal(pixels(p,36),pixels(p,36));assert.notEqual(pixels(p,32),pixels(p,40));
});
test('local revision changes selected scene while preserving every other scene',()=>{
  const original=createProject();const result=reviseScene(original,3,'改成蓝色，慢一点，更多粒子');
  assert.notEqual(result.project.scenes[3],original.scenes[3]);
  original.scenes.forEach((scene,i)=>{if(i!==3)assert.equal(result.project.scenes[i],scene);});
  assert.notEqual(pixels(original,36),pixels(result.project,36));assert.equal(pixels(original,5),pixels(result.project,5));
});
test('unknown local topic is rejected instead of relabelling a dice template',()=>{
  assert.throws(()=>createProject({topic:'光合作用的能量转换'}),{code:'UNSUPPORTED_TOPIC'});
});
test('API script produces the requested generic visual mechanisms',()=>{
  const script={title:'光合作用',summary:'能量转换',sources:[],scenes:[
    {title:'光能进入',narration:'叶绿体吸收光。',caption:'光能',duration:10,kind:'process',visual:{labels:['光','叶绿体','化学能']}},
    {title:'比较',narration:'比较两种过程。',caption:'机制对比',duration:10,kind:'compare',visual:{labels:['反应一','反应二'],items:['吸收','释放']}},
    {title:'关系',narration:'物质之间形成关系。',caption:'关系图',duration:10,kind:'network',visual:{labels:['水','二氧化碳','糖']}}
  ]};
  const p=createProjectFromScript(script,{duration:90,topic:'光合作用'});
  assert.equal(p.title,'光合作用');assert.ok(p.scenes.every(s=>s.kind.startsWith('script:')));assert.ok(!JSON.stringify(p.scenes).includes('骰子'));
  for(const scene of p.scenes)assert.match(pixels(p,scene.start+scene.duration/2),/^[a-f0-9]{64}$/);
});
test('caption visibility is reflected in the actual rendered frame',()=>{
  const p=createProject();assert.notEqual(pixels(p,6),pixels({...p,settings:{...p.settings,captions:false}},6));
});
