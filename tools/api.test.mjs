import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAPI, validateProviderConfig, validateScript,validateSceneArt } from '../worker/api.js';
import { pollVideoTask, generateScript,generateSceneArt, VibeAPIError, PROVIDER_PRESETS } from '../dist/api-client.js';
import {compositionFingerprint} from '../dist/composition.js';

const config = { baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-test-private-key-012345', model: 'deepseek-chat', provider: 'openai-compatible' };
const wan = { baseURL: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'sk-wan-test-private-67890', model: 'wan2.7-t2v', provider: 'dashscope' };
const scene = { title: '先看现象', narration: '观察这个对象如何随时间发生变化。', caption: '变化有规律', duration: 10, kind: 'process', visual: { labels: ['开始', '变化', '结果'], values: [1, 2, 3], items: ['对象'] } };
const script = () => ({ title: '变化中的规律', summary: '通过可视化理解规律', scenes: Array.from({ length: 6 }, (_, i) => ({ ...scene, title: `第${i + 1}步`, duration: 14 })), sources: [{ title: '课堂资料', url: 'https://example.edu/lesson' }] });
const asJSON = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const req = (path, cfg = config, payload = {}, headers = {}) => new Request(`https://studio.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ config: cfg, payload }) });

const art=()=>({version:1,designIntent:'指令包沿芯片总线依次到达寄存器与运算模块，解释一次取指执行。',layout:'chip-cutaway',objects:[
  {id:'body',type:'roundRect',x:.5,y:.5,w:.6,h:.5,stroke:'$accent'},
  {id:'register',type:'rect',x:.35,y:.4,w:.14,h:.12,fill:'$blue'},
  {id:'alu',type:'path',x:.66,y:.5,w:.2,h:.2,path:'M 0 0 L 1000 300 L 1000 700 L 0 1000 L 200 500 Z',stroke:'$gold'},
  {id:'bus',type:'line',x:.2,y:.6,x2:.8,y2:.6,stroke:'$accent'},
  {id:'packet',type:'rect',x:.2,y:.6,w:.04,h:.05,fill:'$gold',animations:[{property:'x',from:.2,to:.8,start:0,end:.6},{property:'y',from:.6,to:.4,start:.6,end:.9}]},
  {id:'label',type:'text',x:.5,y:.1,text:'指令怎样运行',fontSize:.05}
]});

const artPayload=(overrides={})=>({scene,index:1,sceneCount:3,project:{title:'一枚芯片',topic:'CPU执行指令',duration:90,ratio:'16:9',style:'blueprint',scenes:[scene,scene,scene]},previousDesigns:[],...overrides});

test('health performs no external call and exposes no credential', async () => {
  const response = await handleAPI(new Request('https://studio.example/api/health'), {}, { fetch: () => assert.fail('must not call upstream') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.credentials, 'request-only');
  assert.equal(result.externalCall, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('provider URL rejects local, IP, credential-bearing and unapproved destinations', () => {
  for (const baseURL of ['http://api.deepseek.com/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://metadata.google.internal/v1', 'https://x:secret@api.deepseek.com/v1', 'https://provider.example/v1', 'https://api.deepseek.com:8080/v1']) {
    assert.throws(() => validateProviderConfig({ ...config, baseURL }), error => !!error.code);
  }
  assert.equal(validateProviderConfig({ ...config, baseURL: 'https://provider.example/v1' }, { EXTRA_PROVIDER_HOSTS: 'provider.example' }).baseURL, 'https://provider.example/v1');
  assert.equal(validateProviderConfig({ ...wan, baseURL: 'https://workspace-123.cn-beijing.maas.aliyuncs.com/api/v1' }).provider, 'dashscope');
});

test('foreign Origin and oversized requests fail before provider fetch', async () => {
  const foreign = await handleAPI(req('/api/script', config, { topic: '概率' }, { Origin: 'https://attacker.example' }), {}, { fetch: () => assert.fail('must not call') });
  assert.equal(foreign.status, 403);
  const huge = await handleAPI(req('/api/script', config, { topic: 'a'.repeat(270000) }), {}, { fetch: () => assert.fail('must not call') });
  assert.equal(huge.status, 413);
});

test('script route uses JSON chat protocol, carries preferences, validates and normalizes exact duration', async () => {
  let called = false;
  const response = await handleAPI(req('/api/script', config, { topic: '为什么会下雨', duration: 90, preferences: ['先演示后定义'] }), {}, { fetch: async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_object');
    assert.equal(body.stream, false);
    assert.match(body.messages[1].content, /先演示后定义/);
    assert.ok(!body.messages.some(x => x.content.includes(config.apiKey)));
    return asJSON({ choices: [{ message: { content: JSON.stringify(script()) } }], usage: { total_tokens: 500 } });
  } });
  assert.ok(called); assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.script.scenes.reduce((n, s) => n + s.duration, 0), 90);
  assert.equal(result.script.sources[0].verification, 'needs-review');
  assert.equal(result.usage.total_tokens, 500);
});

test('invalid JSON, unsupported kinds and non-finite data are refused', async () => {
  assert.throws(() => validateScript('<script>alert(1)</script>'), /JSON/);
  const bad = script(); bad.scenes[0].kind = 'eval';
  assert.throws(() => validateScript(bad), error => error.code === 'SCRIPT_KIND');
  const numeric = script(); numeric.scenes[0].visual = { values: ['NaN'] };
  assert.throws(() => validateScript(numeric), error => error.code === 'SCRIPT_FORMAT');
  const response = await handleAPI(req('/api/script', config, { topic: '概率' }), {}, { fetch: async () => asJSON({ choices: [{ message: { content: '不是JSON' } }] }) });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'SCRIPT_FORMAT');
});

test('provider error is bounded, structured and redacts key', async () => {
  const response = await handleAPI(req('/api/script', config, { topic: '概率' }), {}, { fetch: async () => asJSON({ error: { message: `Invalid key ${config.apiKey}, Bearer other-secret-token-12345` } }, 401) });
  const raw = await response.text();
  assert.ok(!raw.includes(config.apiKey));
  assert.ok(!raw.includes('other-secret-token-12345'));
  assert.match(raw, /PROVIDER_AUTH/);
});

test('revision returns only one scene and preserves scene duration', async () => {
  const response = await handleAPI(req('/api/revise', config, { scene, instruction: '用蒸发和凝结来解释' }), {}, { fetch: async () => asJSON({ choices: [{ message: { content: JSON.stringify({ ...scene, title: '蒸发与凝结', duration: 23 }) } }] }) });
  const data = await response.json();
  assert.equal(data.scene.title, '蒸发与凝结');
  assert.equal(data.scene.duration, scene.duration);
  assert.equal(data.script, undefined);
});

test('speech route calls actual audio endpoint and streams audio bytes', async () => {
  const response = await handleAPI(req('/api/speech', { ...config, model: 'tts-model' }, { text: '从一个问题开始。', voice: 'voice-name', speed: 1.1 }), {}, { fetch: async (url, options) => {
    assert.match(url, /\/audio\/speech$/);
    const body = JSON.parse(options.body);
    assert.equal(body.voice, 'voice-name');
    assert.equal(body.response_format, 'mp3');
    return new Response(new Uint8Array([73, 68, 51, 4]), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [73, 68, 51, 4]);
});

test('connection test does not submit a billable generation or claim model capability', async () => {
  const response = await handleAPI(req('/api/test', config, { capability: 'speech' }), {}, { fetch: async (url) => {
    assert.match(url, /\/models$/); return asJSON({ data: [{ id: 'another-model' }] });
  } });
  const data = await response.json();
  assert.equal(data.ok, true); assert.equal(data.modelListed, false);
  assert.match(data.message, /未调用配音接口/);
  const video = await handleAPI(req('/api/test', wan, { capability: 'video' }), {}, { fetch: async url => { assert.match(url, /\/tasks\/connection-check$/); return asJSON({ code: 'TaskNotExist' }, 404); } });
  const videoData = await video.json();
  assert.equal(videoData.verified, false); assert.match(videoData.message, /未创建付费任务/);
});

test('Wan2.7 task uses current async protocol and ratio/resolution, no old size field', async () => {
  const response = await handleAPI(req('/api/video/create', wan, { prompt: '两枚骰子在黑色桌面滚动', duration: 7, ratio: '9:16' }), {}, { fetch: async (url, options) => {
    assert.match(url, /\/services\/aigc\/video-generation\/video-synthesis$/);
    assert.equal(options.headers['X-DashScope-Async'], 'enable');
    const data = JSON.parse(options.body);
    assert.equal(data.parameters.ratio, '9:16');
    assert.equal(data.parameters.resolution, '720P');
    assert.equal(data.parameters.duration, 7);
    assert.equal(data.parameters.size, undefined);
    return asJSON({ output: { task_id: 'test-video-task', task_status: 'PENDING' } });
  } });
  const data = await response.json(); assert.equal(data.job.status, 'queued'); assert.equal(data.job.progress, null);
});

test('legacy Wan protocol and compatible Videos multipart are distinct', async () => {
  await handleAPI(req('/api/video/create', { ...wan, model: 'wan2.6-t2v' }, { prompt: '物体运动', duration: 5 }), {}, { fetch: async (_, options) => {
    assert.equal(JSON.parse(options.body).parameters.size, '720*1280');
    return asJSON({ output: { task_id: 'legacy-task', task_status: 'PENDING' } });
  } });
  const thirdParty = { ...config, model: 'video-compatible' };
  const response = await handleAPI(req('/api/video/create', thirdParty, { prompt: '物体运动', duration: 4 }), {}, { fetch: async (_, options) => {
    assert.ok(options.body instanceof FormData); assert.equal(options.body.get('seconds'), '4');
    assert.equal(options.headers['Content-Type'], undefined);
    return asJSON({ id: 'compatible-task', status: 'queued' });
  } });
  assert.equal(response.status, 200);
});

test('retired official Sora endpoint is not offered as a working generation service', async () => {
  const response = await handleAPI(req('/api/video/create', { ...config, baseURL: 'https://api.openai.com/v1', model: 'sora-2' }, { prompt: '骰子', duration: 4 }), {}, { fetch: () => assert.fail('must not call retired API') });
  assert.equal((await response.json()).error.code, 'VIDEO_SERVICE_RETIRED');
});

test('video download uses original task and never sends API key to signed media URL', async () => {
  let count = 0;
  const response = await handleAPI(req('/api/video/content', wan, { id: 'task-one', videoURL: 'https://attacker.example/file' }), {}, { fetch: async (url, options) => {
    count++;
    if (count === 1) { assert.match(url, /\/tasks\/task-one$/); return asJSON({ output: { task_id: 'task-one', task_status: 'SUCCEEDED', video_url: 'https://dashscope-result-sh.oss-accelerate.aliyuncs.com/video.mp4?Expires=123' } }); }
    assert.match(url, /^https:\/\/dashscope-result-sh\.oss-accelerate\.aliyuncs\.com/);
    assert.equal(options.headers, undefined);
    return new Response('mp4-bytes', { headers: { 'Content-Type': 'video/mp4' } });
  } });
  assert.equal(count, 2); assert.equal(await response.text(), 'mp4-bytes');
});

test('malicious media URL and task failure messages are not relayed unsafely', async () => {
  const bad = await handleAPI(req('/api/video/content', wan, { id: 'task-one' }), {}, { fetch: async () => asJSON({ output: { task_id: 'task-one', task_status: 'SUCCEEDED', video_url: 'http://127.0.0.1/admin' } }) });
  assert.equal((await bad.json()).error.code, 'VIDEO_URL');
  const failed = await handleAPI(req('/api/video/status', wan, { id: 'task-one' }), {}, { fetch: async () => asJSON({ output: { task_id: 'task-one', task_status: 'FAILED', message: wan.apiKey } }) });
  assert.ok(!(await failed.text()).includes(wan.apiKey));
});

test('client polling honours cancellation and completed status without extra calls', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pollVideoTask(config, { id: 'task', status: 'queued' }, { signal: controller.signal }), error => error.name === 'AbortError');
  const complete = { id: 'task', status: 'completed' };
  assert.equal(await pollVideoTask(config, complete), complete);
  await assert.rejects(pollVideoTask(config, { id: 'task', status: 'failed', error: '额度不足' }), error => error instanceof VibeAPIError && /额度不足/.test(error.message));
});

test('client uses same-origin route and unwraps validated script', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/script');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    return asJSON({ script: script(), usage: { total_tokens: 20 }, mayBeBillable: true });
  });
  const result = await generateScript(config, { topic: '雨' });
  assert.equal(result.title, '变化中的规律');
  assert.equal(result.apiMeta.usage.total_tokens, 20);
});

test('cancellation interrupts a provider that stalls after response headers', async()=>{
  const controller=new AbortController();
  const request=new Request('https://studio.example/api/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,payload:{topic:'雨',duration:90}}),signal:controller.signal});
  const promise=handleAPI(request,{}, {fetch:async()=>new Response(new ReadableStream({start(stream){stream.enqueue(new TextEncoder().encode('{"choices":'));}}),{headers:{'Content-Type':'application/json'}})});
  setTimeout(()=>controller.abort(),20);
  const response=await promise;assert.equal(response.status,499);assert.equal((await response.json()).error.code,'CANCELLED');
});

const miniSpeech={...PROVIDER_PRESETS.recommendedSpeech,apiKey:'mini-private-speech-123456'};
const miniVideo={...PROVIDER_PRESETS.recommendedVideo,apiKey:'mini-private-video-987654'};

test('recommended presets use the exact DeepSeek Flash and MiniMax models',()=>{
  assert.equal(PROVIDER_PRESETS.recommendedText.model,'deepseek-flash');
  assert.equal(miniSpeech.model,'speech-2.8-hd');assert.equal(miniVideo.model,'MiniMax-H3');
  assert.equal(validateProviderConfig(miniSpeech).provider,'minimax');
  assert.equal(validateProviderConfig({...miniSpeech,baseURL:'https://api.minimax.io'}).provider,'minimax');
});

test('DeepSeek Flash JSON requests explicitly disable default thinking',async()=>{
  const response=await handleAPI(req('/api/script',{...config,model:'deepseek-flash'},{topic:'概率'}),{}, {fetch:async(url,options)=>{
    const body=JSON.parse(options.body);assert.deepEqual(body.thinking,{type:'disabled'});
    return asJSON({choices:[{message:{content:JSON.stringify(script())}}]});
  }});assert.equal(response.status,200);
});

test('MiniMax speech calls native t2a_v2 and decodes bounded hex audio',async()=>{
  const response=await handleAPI(req('/api/speech',miniSpeech,{text:'让知识动起来。',speed:1.1}),{}, {fetch:async(url,options)=>{
    assert.equal(url,'https://api.minimax.cn/v1/t2a_v2');
    const body=JSON.parse(options.body);assert.equal(body.model,'speech-2.8-hd');assert.equal(body.text,'让知识动起来。');
    assert.equal(body.voice_setting.voice_id,'male-qn-qingse');assert.equal(body.voice_setting.speed,1.1);
    assert.equal(body.audio_setting.format,'mp3');assert.equal(body.output_format,'hex');assert.equal(body.stream,false);assert.equal(body.language_boost,'Chinese');
    return asJSON({data:{audio:'49443304',status:2},base_resp:{status_code:0,status_msg:'success'}});
  }});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'audio/mpeg');assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[73,68,51,4]);
  const invalid=await handleAPI(req('/api/speech',miniSpeech,{text:'测试'}),{}, {fetch:async()=>asJSON({data:{audio:'https://untrusted.invalid/audio.mp3'},base_resp:{status_code:0}})});
  assert.equal((await invalid.json()).error.code,'SPEECH_PROTOCOL');
});

test('MiniMax audio permits realistic hex responses above the text JSON limit',async()=>{
  const response=await handleAPI(req('/api/speech',miniSpeech,{text:'测试'}),{}, {fetch:async()=>asJSON({data:{audio:'49'.repeat(600000)},base_resp:{status_code:0}})});
  assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,600000);
});

test('MiniMax HTTP-200 business errors fail safely and redact credentials',async()=>{
  const response=await handleAPI(req('/api/speech',miniSpeech,{text:'测试'}),{}, {fetch:async()=>asJSON({base_resp:{status_code:1004,status_msg:'invalid '+miniSpeech.apiKey}})});
  assert.equal(response.status,502);const raw=await response.text();assert.match(raw,/PROVIDER_AUTH/);assert.ok(!raw.includes(miniSpeech.apiKey));
});

test('MiniMax connection checks only query voices or existing tasks and return no account data',async()=>{
  const voices=await handleAPI(req('/api/test',miniSpeech,{capability:'speech'}),{}, {fetch:async(url,options)=>{
    assert.equal(url,'https://api.minimax.cn/v1/get_voice');assert.equal(JSON.parse(options.body).voice_type,'system');
    return asJSON({system_voice:[{voice_id:'private-voice'}],base_resp:{status_code:0}});
  }});const voiceResult=await voices.json();assert.equal(voiceResult.verified,true);assert.equal(voiceResult.system_voice,undefined);
  const tasks=await handleAPI(req('/api/test',miniVideo,{capability:'video'}),{}, {fetch:async(url,options)=>{
    assert.match(url,/\/v2\/query\/video_generation\?page_num=1&page_size=1$/);assert.equal(options.method,'GET');
    return asJSON({items:[{id:'private-task',content:{url:'https://cdn.hailuoai.com/private.mp4'}}],total:1});
  }});const taskResult=await tasks.json();assert.equal(taskResult.verified,true);assert.equal(taskResult.items,undefined);assert.ok(!JSON.stringify(taskResult).includes('private-task'));
});

test('MiniMax H3 uses V2 content request and normalized V2 task states',async()=>{
  const create=await handleAPI(req('/api/video/create',miniVideo,{prompt:'粒子聚合成星系',duration:9,ratio:'9:16'}),{}, {fetch:async(url,options)=>{
    assert.equal(url,'https://api.minimax.cn/v2/video_generation');assert.equal(options.headers['Content-Type'],'application/json');
    assert.deepEqual(JSON.parse(options.body),{model:'MiniMax-H3',content:[{type:'text',text:'粒子聚合成星系'}],resolution:'768P',duration:9,ratio:'9:16'});
    return asJSON({task_id:'424010985738629'});
  }});const created=(await create.json()).job;assert.equal(created.id,'424010985738629');assert.equal(created.status,'queued');assert.equal(created.progress,null);
  for(const [providerStatus,status]of [['queued','queued'],['running','in_progress'],['succeeded','completed'],['failed','failed'],['cancelled','cancelled']]){
    const r=await handleAPI(req('/api/video/status',miniVideo,{id:created.id}),{}, {fetch:async(url)=>{
      assert.equal(url,'https://api.minimax.cn/v2/query/video_generation/424010985738629');return asJSON({task:{id:created.id,status:providerStatus,content:{url:'https://cdn.hailuoai.com/example.mp4'}}});
    }});assert.equal((await r.json()).job.status,status);
  }
  const invalid=await handleAPI(req('/api/video/create',miniVideo,{prompt:'测试',duration:3}),{}, {fetch:()=>assert.fail('invalid duration must not create task')});
  assert.equal((await invalid.json()).error.code,'VIDEO_DURATION');
});

test('MiniMax V2 download queries original task and keeps keys off trusted media CDN',async()=>{
  const calls=[];
  const response=await handleAPI(req('/api/video/content',miniVideo,{id:'task-123'}),{}, {fetch:async(url,options)=>{
    calls.push(url);
    if(calls.length===1){assert.match(url,/\/v2\/query\/video_generation\/task-123$/);assert.equal(options.headers.Authorization,'Bearer '+miniVideo.apiKey);return asJSON({id:'task-123',status:'succeeded',content:{url:'https://video-product.cdn.minimax.io/result.mp4?signature=example'}});}
    assert.equal(options.headers,undefined);assert.equal(options.redirect,'error');return new Response(new Uint8Array([0,1,2]),{headers:{'Content-Type':'video/mp4'}});
  }});assert.equal(response.status,200);assert.equal(calls.length,2);
  const malicious=await handleAPI(req('/api/video/content',miniVideo,{id:'task-123'}),{}, {fetch:async()=>asJSON({task:{id:'task-123',status:'succeeded',content:{url:'https://api.minimax.cn.evil.example/internal.mp4'}}})});
  assert.equal((await malicious.json()).error.code,'VIDEO_URL');
});

test('scene-art makes one real structured drawing request with full shot context',async()=>{
  let calls=0;
  const response=await handleAPI(req('/api/scene-art',PROVIDER_PRESETS.recommendedText?{...PROVIDER_PRESETS.recommendedText,apiKey:config.apiKey}:config,artPayload({preferences:'不要装饰性漂浮'})),{}, {fetch:async(url,options)=>{
    calls++;assert.match(url,/\/chat\/completions$/);
    const body=JSON.parse(options.body);assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');assert.equal(body.max_tokens,14000);
    assert.match(body.messages[0].content,/几个圆点/);assert.match(body.messages[0].content,/JSON/);
    const input=JSON.parse(body.messages[1].content);assert.equal(input.index,1);assert.equal(input.project.ratio,'16:9');assert.equal(input.styleGuide.name,'工程蓝图');assert.match(input.preferences,/漂浮/);
    assert.ok(!JSON.stringify(body.messages).includes(config.apiKey));
    return asJSON({choices:[{message:{content:JSON.stringify(art())}}],usage:{total_tokens:1200}});
  }});
  const result=await response.json();assert.equal(response.status,200);assert.equal(calls,1);assert.equal(result.composition.objects.length,6);assert.equal(result.fingerprint,compositionFingerprint(result.composition));assert.equal(result.usage.total_tokens,1200);assert.equal(result.mayBeBillable,true);
});

test('scene-art refuses static, token-only and label-swapped circle templates without hidden retries',async()=>{
  const staticArt=art();delete staticArt.objects[4].animations;
  assert.throws(()=>validateSceneArt(staticArt,{index:1,sceneCount:3}),error=>error.code==='ART_STATIC');
  const generic={...art(),objects:[0,1,2,3].map((i)=>({id:'circle-'+i,type:'circle',x:.1+i*.2,y:.5,r:.04,animations:[{property:'x',from:.1,to:.2,start:0,end:.5},{property:'y',from:.5,to:.6,start:.5,end:1}]}))};
  assert.throws(()=>validateSceneArt(generic,{index:1,sceneCount:3}),error=>['ART_TOO_GENERIC','ART_TOO_SIMPLE'].includes(error.code));
  let calls=0;
  const response=await handleAPI(req('/api/scene-art',config,artPayload()),{}, {fetch:async()=>{calls++;return asJSON({choices:[{message:{content:JSON.stringify({version:1,layout:'text-only',designIntent:'换文字',objects:[{id:'title',type:'text',text:'新标题'}]})}}]});}});
  assert.equal(response.status,502);assert.equal(calls,1);assert.equal((await response.json()).error.code,'ART_TOO_SIMPLE');
});

test('scene-art rejects geometrically duplicate shots even if labels and layout names change',()=>{
  const first=art(),changed=art();changed.layout='a-new-layout-name';changed.designIntent='只是换了字';changed.objects[5].text='另一个主题';
  const firstPrint=compositionFingerprint(first);assert.equal(firstPrint,compositionFingerprint(changed));
  assert.throws(()=>validateSceneArt(changed,{index:1,sceneCount:3,previousDesigns:[{fingerprint:firstPrint}]}),error=>error.code==='ART_DUPLICATE');
  changed.objects[4].animations[0].to=.65;
  assert.ok(validateSceneArt(changed,{index:1,sceneCount:3,previousDesigns:[{fingerprint:firstPrint}]}).composition);
});

test('simple question opening is allowed while malformed drawing programs are refused',()=>{
  const opening={version:1,designIntent:'先提出问题，人数逐步出现',layout:'question',objects:[{id:'q',type:'text',text:'需要多少人？',x:.5,y:.3,fontSize:.08},{id:'n',type:'number',x:.5,y:.6,value:23,fromValue:0,fontSize:.12}]};
  assert.ok(validateSceneArt(opening,{index:0,sceneCount:8}).composition);
  assert.throws(()=>validateSceneArt({...art(),objects:[{id:'evil',type:'html',text:'<script>fetch()</script>'}]},{index:1,sceneCount:3}),error=>error.code==='ART_FORMAT');
});

test('all duration and ratio presets reach the storyboard and five-minute outputs have real room',async()=>{
  const long={...script(),scenes:Array.from({length:30},(_,i)=>({...scene,title:'镜头'+i,duration:10,visual:{...scene.visual,heroObjects:['带引脚的芯片'],beats:[{at:.3,meaning:'取指',change:'指令沿路径进入'}],continuity:'沿同一路径继续'}}))};
  const response=await handleAPI(req('/api/script',config,{topic:'CPU是怎样工作的',duration:300,ratio:'21:9',style:'cosmos'}),{}, {fetch:async(_,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    assert.equal(body.max_tokens,24000);assert.equal(input.duration,300);assert.equal(input.ratio,'21:9');assert.equal(input.style,'cosmos');assert.equal(input.styleGuide.name,'宇宙深空');
    return asJSON({choices:[{message:{content:JSON.stringify(long)}}]});
  }});
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.script.duration,300);assert.equal(data.script.scenes.length,30);assert.equal(data.script.scenes[0].visual.heroObjects[0],'带引脚的芯片');assert.equal(data.script.scenes[0].visual.beats[0].meaning,'取指');
});

test('scene-art browser client unwraps the drawing and preserves measured usage',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'/api/scene-art');assert.equal(options.credentials,'same-origin');return asJSON({composition:art(),fingerprint:'1234abcd',usage:{total_tokens:222},mayBeBillable:true});});
  const result=await generateSceneArt(config,artPayload());assert.equal(result.objects.length,6);assert.equal(result.apiMeta.fingerprint,'1234abcd');assert.equal(result.apiMeta.usage.total_tokens,222);
});

test('MiniMax keeps six native ratios and explicitly reports the 4:5 crop adaptation',async()=>{
  const cfg={...PROVIDER_PRESETS.recommendedVideo,apiKey:'sk-minimax-ratio-private'};
  for(const ratio of ['21:9','16:9','4:3','1:1','3:4','9:16','4:5']){
    const response=await handleAPI(req('/api/video/create',cfg,{prompt:'一枚芯片分解为模块',duration:6,ratio}),{}, {fetch:async(_,options)=>{assert.equal(JSON.parse(options.body).ratio,ratio==='4:5'?'3:4':ratio);return asJSON({task_id:'ratio-task'});}});
    const data=await response.json();assert.equal(response.status,200);assert.equal(data.job.requestedRatio,ratio);assert.equal(data.job.generatedRatio,ratio==='4:5'?'3:4':ratio);assert.equal(data.job.cropToFit,ratio==='4:5');
  }
});

test('full directing brief reaches both model phases with birthday facts and web duration preserved',async()=>{
  const brief='生日悖论专业导演说明：一年365天，生日均匀独立；23人至少一对同生日约50.7%，共有253个无序配对。黑金背景、宋体字幕、连线逐步生长、补集分式与曲线同步；参考时长180秒。\n'+'保留具体对象、字幕安全区与三段节奏。'.repeat(1500);
  const chosenDuration=120;
  const scriptResult=await handleAPI(req('/api/script',config,{topic:'23个人的生日悖论',brief,duration:chosenDuration,ratio:'16:9',style:'noir'}),{}, {fetch:async(_,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    assert.equal(input.brief,brief.slice(0,18000).trim());assert.equal(input.brief.length,18000);
    assert.equal(input.duration,120);assert.match(input.durationPriority,/网页duration/);
    assert.match(input.brief,/宋体字幕/);assert.match(input.brief,/补集分式/);
    assert.equal(input.factualAnchors.people,23);assert.equal(input.factualAnchors.pairCount,253);
    assert.equal(input.factualAnchors.displayAtLeastOneSharedBirthday,'50.7%');
    assert.ok(Math.abs(input.factualAnchors.pAtLeastOneSharedBirthday-.5072972343239854)<1e-12);
    assert.match(input.factualAnchors.derivation,/365/);assert.match(input.factualAnchors.dependencyNote,/不能.*相互独立/);
    assert.match(body.messages[0].content,/brief.*完整创作/);assert.match(body.messages[0].content,/安全JSON/);
    return asJSON({choices:[{message:{content:JSON.stringify({...script(),scenes:script().scenes.map(s=>({...s,duration:20}))})}}]});
  }});
  assert.equal(scriptResult.status,200);const storyboard=(await scriptResult.json()).script;assert.equal(storyboard.brief,brief.slice(0,18000).trim());assert.equal(storyboard.duration,chosenDuration);
  const nodes=Array.from({length:23},(_,i)=>({x:.5+.4*Math.cos(i/23*Math.PI*2),y:.5+.4*Math.sin(i/23*Math.PI*2)}));const edges=[];for(let i=0;i<23;i++)for(let j=i+1;j<23;j++)edges.push([i,j]);
  const birthdayDrawing={version:1,designIntent:'配对关系逐步增加，同时用补集推导概率',layout:'network-and-complement',objects:[
    {id:'pairs',type:'network',x:.3,y:.5,w:.45,h:.7,nodes,edges,animations:[{property:'reveal',from:0,to:1,start:0,end:.8}]},
    {id:'factor',type:'fraction',x:.7,y:.3,w:.2,h:.2,numerator:'364',denominator:'365',fontSize:.06},
    {id:'curve',type:'plot',x:.72,y:.6,w:.35,h:.35,points:Array.from({length:23},(_,i)=>({x:i/22,y:i/22*.5072972343})),animations:[{property:'reveal',from:0,to:1,start:.1,end:.9}]},
    {id:'count',type:'number',x:.3,y:.93,value:253,fromValue:0,fontSize:.07}
  ]};
  const second=await handleAPI(req('/api/scene-art',config,artPayload({project:{title:'生日悖论',topic:'23人的生日悖论',brief:storyboard.brief,duration:120,ratio:'16:9',style:'noir',scenes:storyboard.scenes}})),{}, {fetch:async(_,options)=>{
    const body=JSON.parse(options.body),input=JSON.parse(body.messages[1].content);
    assert.equal(input.project.brief,storyboard.brief.slice(0,8000).trim());assert.equal(input.project.brief.length,8000);assert.match(input.project.brief,/宋体字幕/);assert.match(input.project.brief,/三段节奏/);
    assert.equal(input.project.duration,120);assert.equal(input.factualAnchors.people,23);assert.equal(input.factualAnchors.pairCount,253);assert.equal(input.factualAnchors.displayAtLeastOneSharedBirthday,'50.7%');assert.match(body.messages[0].content,/project.brief/);assert.match(body.messages[0].content,/不得暗中拉长/);
    return asJSON({choices:[{message:{content:JSON.stringify(birthdayDrawing)}}]});
  }});
  assert.equal(second.status,200);assert.equal((await second.json()).composition.objects[0].edges.length,253);
});
