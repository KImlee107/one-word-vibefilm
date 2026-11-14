import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI,validateScript} from '../worker/api.js';
import {normalizeStoryboard} from '../worker/storyboard.js';
import {generateScript} from '../dist/api-client.js';
import {createProjectFromScript} from '../dist/engine.js';

const config={provider:'openai-compatible',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'sk-format-test-not-real-01357'};
const scene={title:'先看检测结果',narration:'先看检测结果，再看接受检测的人群比例。',caption:'结果还要结合人群比例',duration:10,kind:'process',visual:{description:'两个人群池与检测卡片',action:'检测卡片移入各自的人群池'}};
const script=()=>({title:'理解贝叶斯公式',summary:'新证据需要结合先验比例',scenes:[{...scene},{...scene,title:'区分两种条件概率'},{...scene,title:'更新判断'}],sources:[]});
const options={topic:'贝叶斯公式',duration:30,ratio:'16:9',style:'noir'};
const req=(path,payload)=>new Request('https://studio.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,payload})});
const model=(content,finish_reason='stop')=>new Response(JSON.stringify({choices:[{message:{content:typeof content==='string'||Array.isArray(content)?content:JSON.stringify(content)},finish_reason}],usage:{total_tokens:600}}),{headers:{'Content-Type':'application/json'}});

test('screenshot failure is reproduced by wrapped storyboards; normalization preserves all actual scenes',()=>{
  for(const wrapped of [{script:script()},{storyboard:script()},{data:{result:{video:script()}}},{title:script().title,shots:script().scenes},{title:script().title,storyboard:script().scenes}]){
    const actual=validateScript(wrapped,30,{topic:options.topic});assert.equal(actual.scenes.length,3);assert.equal(actual.scenes[0].narration,scene.narration);assert.equal(actual.scenes[0].visual.action,scene.visual.action);assert.equal(actual.duration,30);
  }
});
test('Chinese fields, voice-over text, seconds and time ranges become canonical fields without changed facts',()=>{
  const s={视频标题:'理解贝叶斯公式',分镜列表:[
    {镜头标题:'先看人群',旁白:'先看人群的实际比例。',字幕:'先看比例',时间段:'00:00–00:10',画面:'两个人群池',动画:'检测卡进入人群池'},
    {sceneTitle:'再看检测',voiceover:{text:'然后考虑检测结果。'},subtitle:'加入新证据',durationSeconds:'10秒',type:'formula',visualDescription:'公式与原有人群池'},
    {name:'更新判断',voice_over:'将新证据与已有比例结合。',duration:'10s',type:'conclusion',visual:{description:'重新归类后的检测卡'}}]};
  const actual=validateScript(s,30);assert.equal(actual.scenes[0].duration,10);assert.equal(actual.scenes[1].kind,'process');assert.match(actual.scenes[0].visual.action,/进入/);assert.equal(actual.scenes[2].narration,s.分镜列表[2].voice_over);
});
test('scene array and wrapped serialized JSON use topic only as the missing title',()=>{
  const source=script();for(const input of [JSON.stringify(source.scenes),{data:JSON.stringify(source)}]){const actual=validateScript(input,30,{topic:options.topic});assert.equal(actual.scenes[0].narration,source.scenes[0].narration);assert.equal(actual.title,input===JSON.stringify(source.scenes)?options.topic:source.title);}
});
test('valid JSON wrapped in prose is read; missing times are scheduled by real narration length',()=>{
  const source=script();delete source.scenes[0].duration;source.scenes[1].duration='00:10';
  const actual=validateScript('以下是分镜：\n```json\n'+JSON.stringify(source)+'\n```\n以上分镜供后续制作。',30,{topic:options.topic});assert.equal(actual.scenes.reduce((n,s)=>n+s.duration,0),30);assert.match(actual.normalizations.join(' '),/文案长度/);
});
test('format compatibility cannot invent missing scenes, narration, valid numbers or playable code',()=>{
  assert.throws(()=>validateScript({title:'只有标题'},30,{topic:options.topic}),/分镜列表/);
  assert.throws(()=>validateScript({title:'只有一个镜头',shots:[scene]},30),/1 个镜头/);
  const blank=script();blank.scenes[0].narration='';blank.scenes[0].caption='';assert.throws(()=>validateScript(blank,30),/缺少标题、旁白/);
  const bad=script();bad.scenes[0].duration=-2;assert.throws(()=>validateScript(bad,30));
  const invalid=script();invalid.scenes[0].visual={values:['not-a-number']};assert.throws(()=>validateScript(invalid,30),/有限数字/);
  assert.throws(()=>validateScript('<script>window.run()</script>',30),/JSON/);
});
test('root arrays from the provider become a valid project, never a relabelled demo',async()=>{
  const response=await handleAPI(req('/api/script',options),{},{fetch:async()=>model(JSON.stringify(script().scenes))});assert.equal(response.status,200);
  const data=await response.json();const project=createProjectFromScript(data.script,options);assert.equal(project.topicKey,'custom');assert.ok(project.scenes.every(s=>s.renderState==='pending'&&!s.composition&&!s.program));assert.equal(project.scenes[0].narration,scene.narration);
});
test('incompatible model output is returned as a bounded, key-redacted recovery, without a server retry',async()=>{
  let calls=0;const raw={title:'理解贝叶斯',outline:'只有大纲 '+config.apiKey};
  const response=await handleAPI(req('/api/script',options),{},{fetch:async()=>{calls++;return model(raw);}});assert.equal(response.status,502);assert.equal(calls,1);
  const data=await response.json();assert.equal(data.recovery.canRepair,true);assert.match(data.recovery.shape,/outline/);assert.ok(!JSON.stringify(data).includes(config.apiKey));assert.match(data.recovery.draft,/REDACTED/);
});
test('client visibly repairs exactly once, retains usage and never starts scene generation on invalid output',async()=>{
  const original=globalThis.fetch;let upstreamCalls=0,repairVisible=false;const routes=[];
  globalThis.fetch=async(path,init)=>{
    routes.push(path);return handleAPI(new Request('https://studio.example'+path,init),{},{fetch:async(url,request)=>{
      upstreamCalls++;if(upstreamCalls===1)return model({title:'理解贝叶斯公式',outline:'格式不匹配'});
      assert.ok(repairVisible);const body=JSON.parse(request.body),payload=JSON.parse(body.messages[1].content);assert.match(payload.previousOutput,/格式不匹配/);assert.match(body.messages[0].content,/本次仅整理/);return model(script());
    }});
  };
  try{const result=await generateScript(config,options,{onRepair:info=>{assert.equal(info.attempt,1);assert.equal(info.maxAttempts,1);repairVisible=true;}});assert.equal(result.scenes.length,3);assert.equal(result.apiMeta.repaired,true);assert.equal(result.apiMeta.requests,2);assert.equal(result.apiMeta.initialUsage.total_tokens,600);assert.deepEqual(routes,['/api/script','/api/script/repair']);}finally{globalThis.fetch=original;}
});
test('a second malformed result stops at two calls and keeps the last response available for diagnosis',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(path,init)=>handleAPI(new Request('https://studio.example'+path,init),{},{fetch:async()=>{calls++;return model({title:'只有标题'});}});
  try{await assert.rejects(()=>generateScript(config,options),error=>error.code==='SCRIPT_FORMAT'&&error.recovery?.canRepair===false&&!!error.recovery?.draft);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
test('authentication and rate-limit failures never trigger a billable format repair',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{for(const code of ['PROVIDER_AUTH','PROVIDER_RATE_LIMIT','NETWORK']){calls=0;globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{code,message:'服务拒绝请求'}}),{status:502});};await assert.rejects(()=>generateScript(config,options),error=>error.code===code);assert.equal(calls,1);}}finally{globalThis.fetch=original;}
});
test('explicitly disabled repair returns the first invalid result without a second call',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(path,init)=>handleAPI(new Request('https://studio.example'+path,init),{},{fetch:async()=>{calls++;return model({title:'只有标题'});}});
  try{await assert.rejects(()=>generateScript(config,{...options,repairFormats:false}));assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('truncation is distinguished from schema errors, and provider text blocks are supported',async()=>{
  const truncated=await handleAPI(req('/api/script',options),{},{fetch:async()=>model('{"title":"未完','length')});assert.equal((await truncated.json()).error.code,'MODEL_TRUNCATED');
  const response=await handleAPI(req('/api/script',options),{},{fetch:async()=>model([{type:'text',text:JSON.stringify(script())}])});assert.equal(response.status,200);
});

test('cancelling between format failure and repair prevents the extra model call',async()=>{
  const original=globalThis.fetch,controller=new AbortController();let calls=0;
  globalThis.fetch=async(path,init)=>handleAPI(new Request('https://studio.example'+path,init),{},{fetch:async()=>{calls++;return model({title:'仅有标题'});}});
  try{await assert.rejects(()=>generateScript(config,options,{signal:controller.signal,onRepair:()=>controller.abort()}),error=>error.name==='AbortError');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
