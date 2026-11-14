import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVisualValues,visualNumber} from '../dist/visual-data.js';
import {validateScript,handleAPI} from '../worker/api.js';
import {createProjectFromScript} from '../dist/engine.js';
import {restoreScript} from '../dist/api-client.js';
import {chipProgram} from './fixtures/film-code.mjs';

// The exact failing quantity supplied in the user's diagnostic, with nine scenes.
function reportedScript(){
  const titles=['大模型会预测下一个词','预训练：读万卷书','预训练：调整参数','预训练：规模巨大','对齐：人类反馈','对齐：奖励模型','对齐：强化学习微调','训练完成：有用回答','总结：预测+对齐'];
  return {title:'大模型是怎么练成的',summary:'预训练与人类反馈',scenes:titles.map((title,index)=>({title,narration:index===3?'这个过程重复数万亿次，需要大量文本和强大算力。':'通过具体物件演示这一步的输入、变化和结果。',caption:title,duration:[8,10,10,10,10,10,10,12,10][index],kind:index===3?'bars':'process',visual:{labels:index===3?['数据量','算力','迭代次数']:['生成','打分','调整'],values:index===3?['数万亿次']:index===5?['8','3']:index===6?['3','8']:[],items:['条形','计数器'],description:'对应步骤中的具体物件与动作',action:'输入、发生变化、展示结果'}}))};
}
const config={provider:'openai-compatible',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'sk-visual-fixture-not-real-12345'};
const req=(path,payload,withKey=true)=>new Request('https://studio.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:withKey?config:null,payload})});
const model=content=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{headers:{'Content-Type':'application/json'}});

test('actual reported 数万亿次 is preserved as wording and never guessed as a numeric count',()=>{
  const script=validateScript(reportedScript(),90),visual=script.scenes[3].visual;
  assert.equal(script.scenes.length,9);assert.deepEqual(visual.values,[]);assert.deepEqual(visual.valueNotes,['数万亿次']);assert.match(visual.dataWarnings[0],/不推算具体计数/);
  assert.deepEqual(script.scenes[5].visual.values,[8,3]);assert.deepEqual(script.scenes[6].visual.values,[3,8]);
  const project=createProjectFromScript(script,{topic:'大模型怎么训练的',duration:90});assert.deepEqual(project.scenes[3].visual.valueNotes,['数万亿次']);assert.ok(project.scenes.every(s=>s.renderState==='pending'));
});
test('numeric strings are accepted; null, booleans, percentages and prose cannot silently become zero',()=>{
  assert.equal(visualNumber('8'),8);assert.equal(visualNumber('-1.25e2'),-125);
  for(const value of [null,false,true,'','数万亿次','50.7%','1/6','NaN','Infinity',Infinity,NaN,{},[]])assert.equal(visualNumber(value),undefined);
  const normalized=normalizeVisualValues({values:[1,'数万亿次',1],labels:['甲','乙','丙']});assert.deepEqual(normalized.values,[]);assert.deepEqual(normalized.valueNotes,['1','数万亿次','1']);assert.deepEqual(normalizeVisualValues(normalized),normalized);
});
test('the original nine-scene response succeeds on the first provider call with no format repair',async()=>{
  let calls=0;const response=await handleAPI(req('/api/script',{topic:'大模型怎么训练的',duration:90}),{},{fetch:async()=>{calls++;return model(reportedScript());}});
  assert.equal(response.status,200);assert.equal(calls,1);assert.equal((await response.json()).script.scenes.length,9);
});
test('diagnostic restore requires no API key and makes no billable provider call',async()=>{
  const response=await handleAPI(req('/api/script/restore',{topic:'大模型怎么训练的',draft:JSON.stringify(reportedScript())},false),{},{fetch:()=>assert.fail('restoring text must not call a model')});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.mayBeBillable,false);assert.equal(result.externalCall,false);assert.equal(result.script.duration,90);assert.equal(result.script.scenes.length,9);
});
test('browser restore and later code generation retain quantity wording across both validators',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(path,init)=>handleAPI(new Request('https://studio.example'+path,init),{},{fetch:()=>assert.fail('restore has no upstream')});
  let restored;try{restored=await restoreScript({topic:'大模型怎么训练的',draft:JSON.stringify(reportedScript())});}finally{globalThis.fetch=original;}
  assert.equal(restored.apiMeta.requests,0);
  const project=createProjectFromScript(restored,{topic:'大模型怎么训练的',duration:90});
  const response=await handleAPI(req('/api/scene-code',{scene:project.scenes[3],project:{topic:project.topic},index:3}),{},{fetch:async(url,init)=>{const messages=JSON.parse(init.body).messages;assert.match(messages[0].content,/不得擅自取2万亿/);assert.match(messages[1].content,/数万亿次/);assert.match(messages[1].content,/valueNotes/);return model(chipProgram);}});assert.equal(response.status,200);
});
test('restoring a malformed, overlong, foreign-origin or invalid-timing diagnostic fails before a provider call',async()=>{
  for(const payload of [{draft:'not JSON'},{draft:JSON.stringify({title:'只有标题'})},{draft:JSON.stringify({...reportedScript(),scenes:reportedScript().scenes.map(s=>({...s,duration:-2}))})}]){
    const response=await handleAPI(req('/api/script/restore',payload,false),{},{fetch:()=>assert.fail('no upstream')});assert.ok(response.status>=400);
  }
  const foreign=req('/api/script/restore',{draft:JSON.stringify(reportedScript())},false);foreign.headers.set('Origin','https://elsewhere.example');assert.equal((await handleAPI(foreign)).status,403);
});
