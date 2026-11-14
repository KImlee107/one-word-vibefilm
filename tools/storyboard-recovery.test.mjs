import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverSceneClosures} from '../worker/storyboard-json.js';
import {handleAPI,validateScript} from '../worker/api.js';
import {generateScript} from '../dist/api-client.js';
import {createRunDiagnostics,directingBriefForTopic} from '../dist/run-diagnostics.js';
import {shouldPauseSceneQueue} from '../dist/scene-queue.js';
import {shouldPauseVideoBatch} from '../dist/video-jobs.js';

// Same malformed boundary as the user's Pythagoras diagnostic: every complete
// visual is followed directly by the next scene, omitting the outer scene brace.
const scenes=Array.from({length:8},(_,i)=>({title:['直角三角形的疑问','以边为正方形','两个小正方形拆解','面积重排','公式成立','一个具体例子','回到三角形','勾股定理'][i],narration:'观察直角三角形，两条直角边的平方和等于斜边的平方。',caption:'a²+b²=c²',duration:10,kind:'process',visual:{description:'边长3、4、5的直角三角形',formula:'a²+b²=c²',labels:['a','b','c'],values:[3,4,5],emphasis:'公式文字里也可有 ] },{ "title"，但不能视为结构'}}));
const original={title:'勾股定理：直角三角形三边的关系',summary:'两个小正方形的面积和等于斜边大正方形的面积。',sources:[],scenes};
const malformed='{"title":'+JSON.stringify(original.title)+',"summary":'+JSON.stringify(original.summary)+',"sources":[],"scenes":['+scenes.map(s=>JSON.stringify(s).slice(0,-1)).join(',')+']}';
const config={provider:'openai-compatible',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'sk-test-recovery-not-a-real-key'};
const options={topic:'什么是勾股定理',duration:80,ratio:'9:16',style:'noir'};
const request=(path,payload,service=config)=>new Request('https://studio.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:service,payload})});

test('eight omitted scene braces recover every original field and string verbatim',()=>{
  assert.throws(()=>JSON.parse(malformed));
  const result=recoverSceneClosures(malformed);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)),original);
  assert.match(result.normalizations[0],/8 个分镜闭合括号/);
  const actual=validateScript('```json\n'+malformed+'\n```',80,{topic:options.topic});
  assert.deepEqual(actual.scenes,validateScript(original,80).scenes);
  assert.match(actual.normalizations.join(''),/本地恢复/);
});

test('recovery handles mixed valid/broken scenes without repairing truncated, ambiguous or non-JSON content',()=>{
  const mixed='{"title":"勾股定理","scenes":['+JSON.stringify(scenes[0])+','+JSON.stringify(scenes[1]).slice(0,-1)+','+JSON.stringify(scenes[2])+']}';
  assert.equal(validateScript(mixed,30).scenes.length,3);
  for(const bad of [malformed.slice(0,-1),malformed.slice(0,-8),malformed.replace('"duration":10','"duration":"maybe"'),malformed.replace('"emphasis":','emphasis:'),malformed+' extra',malformed.replace('"sources":[]','"sources":[],"sources":[]')])assert.throws(()=>validateScript(bad,80),/JSON/);
});

test('provider malformed storyboard succeeds with a single original request, without paid format repair',async()=>{
  const before=globalThis.fetch;let calls=0;
  globalThis.fetch=async(path,init)=>handleAPI(new Request('https://studio.example'+path,init),{},{fetch:async()=>{calls++;return Response.json({choices:[{message:{content:malformed},finish_reason:'stop'}],usage:{total_tokens:400}});}});
  try{const script=await generateScript(config,options,{onRepair:()=>assert.fail('No model repair needed')});assert.equal(calls,1);assert.equal(script.scenes.length,8);assert.equal(script.apiMeta.requests,1);assert.match(script.normalizations.join(''),/未改写文案/);}finally{globalThis.fetch=before;}
});

test('downloaded failed diagnostic can be restored with no key and no upstream call',async()=>{
  const response=await handleAPI(request('/api/script/restore',{topic:options.topic,draft:malformed},null),{},{fetch:()=>assert.fail('Restore must be free and local')});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.script.scenes.length,8);assert.equal(result.externalCall,false);assert.equal(result.mayBeBillable,false);assert.match(result.script.normalizations[0],/恢复 8/);
});

test('MiniMax HTTP 402 and JSON code 1008 stop later calls with a balance-specific reason',async()=>{
  const service={...config,provider:'minimax',baseURL:'https://api.minimax.cn',model:'MiniMax-H3'};
  for(const upstream of [()=>Response.json({error:{message:'insufficient balance (1008)'}},{status:402}),()=>Response.json({base_resp:{status_code:1008,status_msg:'insufficient balance'}})]){
    let calls=0;const response=await handleAPI(request('/api/video/create',{prompt:'A triangle on dark background',duration:6,ratio:'16:9',resolution:'768P'},service),{},{fetch:async()=>{calls++;return upstream();}});
    assert.equal(calls,1);assert.equal(response.status,402);const data=await response.json();assert.equal(data.error.code,'PROVIDER_BALANCE');assert.match(data.error.message,/余额不足/);
    assert.equal(shouldPauseSceneQueue(data.error),true);assert.equal(shouldPauseVideoBatch(data.error),true);
  }
});

test('current-run errors reset, repeated retries still report, and old project/tasks remain intact',()=>{
  const old={scenes:[{id:'1',title:'旧主题',renderState:'failed',renderError:'语法错误',videoError:'余额不足',videoTask:{id:'retained-task'}}]},next={scenes:[{id:'1',title:'新主题',renderState:'failed',renderError:'排版错误'}]};
  const run=createRunDiagnostics();run.begin(old);assert.deepEqual(run.failures(old),[]);
  run.track(old,'1','code');assert.equal(run.failures(old).length,1);assert.equal(run.failures(old)[0].type,'code');
  run.begin(old);assert.deepEqual(run.failures(old),[]);run.track(old,'1','code');assert.equal(run.failures(old)[0].message,'语法错误');
  run.clear();assert.deepEqual(run.failures(old),[]);assert.equal(old.scenes[0].renderError,'语法错误');assert.equal(old.scenes[0].videoTask.id,'retained-task');
  run.track(old,'1','video');assert.equal(run.failures(old)[0].type,'video');run.begin(next);run.track(old,'1','code');assert.deepEqual(run.failures(old),[]);assert.deepEqual(run.failures(next),[]);
});

test('changed topic excludes untouched old directing script, while edited or explicitly reused briefs are kept',()=>{
  const state={topic:'什么是勾股定理',brief:'生日悖论：23人，253对',boundTopic:'生日悖论',boundBrief:'生日悖论：23人，253对'};
  assert.deepEqual(directingBriefForTopic(state),{brief:'',skipped:true});
  assert.equal(directingBriefForTopic({...state,reuse:true}).brief,state.brief);
  assert.equal(directingBriefForTopic({...state,brief:'请用面积可视化讲勾股定理'}).skipped,false);
  assert.equal(directingBriefForTopic({...state,topic:state.boundTopic}).skipped,false);
});
