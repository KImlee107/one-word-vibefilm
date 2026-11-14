import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWorker} from './lib/native-film.mjs';
import {readFile} from 'node:fs/promises';
import {validateFilmProgram,filmFingerprint,FILM_ALIAS_NAMES} from '../dist/film-program.js';
import {handleAPI} from '../worker/api.js';
import {chipProgram,birthdayProgram} from './fixtures/film-code.mjs';
const config={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'sk-fixture-never-real-0123456'};
const scene={title:'芯片执行指令',narration:'指令包从引脚进入芯片，经过译码和运算单元。',caption:'指令如何运行',duration:10,kind:'process',visual:{description:'芯片、引脚、总线、运算单元'}};
const payload={scene,project:{title:'芯片',topic:'指令的旅程',duration:60,ratio:'16:9',style:'noir',brief:'每一个动词在屏上发生'},index:0,previousDesigns:[]};
const req=(path,p=payload)=>new Request('https://studio.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,payload:p})});
const model=(object)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(object)}}],usage:{total_tokens:1234}}),{headers:{'Content-Type':'application/json'}});

test('new animation code is parsed, time-driven and rejects environment access and nondeterminism',()=>{
  assert.equal(validateFilmProgram(chipProgram).source,chipProgram.source);
  for(const code of ["fetch('https://x')","fr.x.canvas.toDataURL()","Math.random()","new Function('return 1')()","window.location",'import("x")','await Promise.resolve()',"fr['constructor']('return 1')()"]){assert.throws(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+'\n'+code}));}
  assert.throws(()=>validateFilmProgram({...chipProgram,source:'fr.text("static",10,10,{size:50});'.repeat(5)}));
});
test('label swapping cannot masquerade as a new code composition',()=>{
  assert.equal(filmFingerprint(chipProgram),filmFingerprint({...chipProgram,source:chipProgram.source.replace('FETCH  →  DECODE  →  EXECUTE','NEW WORDS')}));
  assert.notEqual(filmFingerprint(chipProgram),filmFingerprint(birthdayProgram));
});
test('a corrected label or color replaces the actual cached drawing even when its structural fingerprint is unchanged',async()=>{
  const call=await nativeWorker(),changed={...chipProgram,source:chipProgram.source.replace('FETCH  →  DECODE  →  EXECUTE','READABLE  INSTRUCTIONS')};
  assert.equal(filmFingerprint(changed),filmFingerprint(chipProgram));
  const base={type:'render',id:2,key:'same-shot-cache',scene,palette:{bg:'#090b0f',ink:'#fff4df',gold:'#d7ac64',blue:'#7ac3dd'},width:576,height:324,time:8,inspect:true};
  const before=await call({...base,program:chipProgram}),after=await call({...base,program:changed});assert.notEqual(before.stats.signature,after.stats.signature);
});
test('scene-code calls actual chat route with skill methods and precise shot context',async()=>{
  const response=await handleAPI(req('/api/scene-code'),{},{fetch:async(url,options)=>{
    const body=JSON.parse(options.body);assert.equal(url,'https://api.deepseek.com/v1/chat/completions');assert.match(body.messages[0].content,/vibe-knowledge-film/);assert.match(body.messages[0].content,/主体必须是外行能认出/);assert.match(body.messages[1].content,/引脚/);assert.equal(body.thinking.type,'disabled');return model(chipProgram);
  }});
  assert.equal(response.status,200);const data=await response.json();assert.equal(data.skill,'vibe-knowledge-film');assert.equal(data.program.source,chipProgram.source);assert.equal(data.usage.total_tokens,1234);
});
test('visual review sends three actual image inputs and returns changed code, not a fake completion',async()=>{
  const frames=Array(3).fill('data:image/jpeg;base64,/9j/AA==');
  const revised={...chipProgram,source:chipProgram.source.replace('w=W*.6','w=W*.66')};
  const response=await handleAPI(req('/api/review-scene',{...payload,program:chipProgram,frames,round:2}),{},{fetch:async(url,options)=>{
    const body=JSON.parse(options.body);const images=body.messages[1].content.filter(x=>x.type==='image_url');assert.equal(images.length,3);assert.equal(images[0].image_url.url,frames[0]);assert.match(body.messages[1].content[0].text,/"round":2/);return model({program:revised,feedback:'从帧里看到引脚较小，放大封装和引脚间距。'});
  }});
  assert.equal(response.status,200);assert.equal((await response.json()).program.source,revised.source);
  const unchanged=await handleAPI(req('/api/review-scene',{...payload,program:chipProgram,frames}),{},{fetch:async()=>model({program:chipProgram,feedback:'很好'})});
  assert.equal(unchanged.status,502);assert.equal((await unchanged.json()).error.code,'REVIEW_UNCHANGED');
});
test('missing rendered review frames are rejected before billing and duplicate code is refused',async()=>{
  const invalid=await handleAPI(req('/api/review-scene',{...payload,program:chipProgram,frames:[]}),{},{fetch:()=>assert.fail('no provider call')});assert.equal(invalid.status,400);
  const duplicate=await handleAPI(req('/api/scene-code',{...payload,previousDesigns:[{fingerprint:filmFingerprint(chipProgram)}]}),{},{fetch:async()=>model({...chipProgram,source:chipProgram.source.replace('FETCH  →  DECODE  →  EXECUTE','ONLY LABELS')})});assert.equal(duplicate.status,502);assert.equal((await duplicate.json()).error.code,'CODE_DUPLICATE');
});

test('ss/lerp free helpers reproduce the former failure and now render with local shadowing',async()=>{
  const source=chipProgram.source.replaceAll('VK.ss','ss').replaceAll('VK.lerp','lerp');
  assert.throws(()=>new Function('fr','t','scene','VK',source)({w:400,h:240,rect(){},line(){},poly(){}},1,{duration:10,palette:{}},{clamp:x=>x}),/ss is not defined/);
  const call=await nativeWorker();
  const base={type:'render',id:2,scene,program:{...chipProgram,source},palette:{bg:'#090b0f',ink:'#fff4df',gold:'#d7ac64',blue:'#7ac3dd'},width:400,height:240,inspect:true};
  validateFilmProgram(base.program);
  const a=await call({...base,key:'aliases',time:2}),b=await call({...base,key:'aliases',time:7}),again=await call({...base,key:'aliases',time:2});
  assert.ok(a.stats.coverage>.04);assert.notEqual(a.stats.signature,b.stats.signature);assert.equal(a.stats.signature,again.stats.signature);
  const shadow={...base.program,source:'const {ss,lerp}=VK;\n'+source};validateFilmProgram(shadow);
  const local=await call({...base,key:'shadow',program:shadow,time:2});assert.equal(a.stats.signature,local.stats.signature);
});
test('undefined names are caught before execution with lexical scopes, destructuring and callbacks',()=>{
  for(const suffix of ['fr.circle(madeUp,t,10,{});','[1].map(x=>missingHelper(x,t));','{let inner=t;} fr.text(String(inner),0,0,{});','const named=function onlyInside(){return t;}; onlyInside();']){
    assert.throws(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+suffix}),{code:'UNDEFINED_SYMBOL'});
  }
  const scoped='const obj={x:t,label:"safe"}; const {x:pos=ss(t,0,1),...rest}=obj; function sum(a=t){return a+pos;} for(let step=0;step<3;step++){fr.circle(sum(step),t,2,{fill:rest.label});} try{sum();}catch(error){fr.text(error.message,0,0,{});}';
  assert.doesNotThrow(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+scoped}));
});
test('invalid returned code is retained and a targeted repair receives the actual error and source',async()=>{
  const broken={...chipProgram,source:chipProgram.source+'\nfr.circle(unknownPosition,t,10,{});'};
  const failed=await handleAPI(req('/api/scene-code'),{},{fetch:async()=>model(broken)});
  assert.equal(failed.status,502);const diagnostic=await failed.json();assert.equal(diagnostic.error.code,'CODE_FORMAT');assert.equal(diagnostic.recovery.program.source,broken.source);assert.equal(diagnostic.recovery.causeCode,'UNDEFINED_SYMBOL');
  const repaired=await handleAPI(req('/api/scene-code/repair',{...payload,program:diagnostic.recovery.program,issue:diagnostic.error.message,phase:'compile'}),{},{fetch:async(url,options)=>{
    const messages=JSON.parse(options.body).messages;assert.match(messages[0].content,/本次只修复/);const input=JSON.parse(messages[1].content);assert.equal(input.program.source,broken.source);assert.match(input.issue,/unknownPosition/);assert.equal(input.scene.title,scene.title);return model(chipProgram);
  }});
  assert.equal(repaired.status,200);assert.equal((await repaired.json()).program.source,chipProgram.source);
});
test('nested program transport succeeds and non-JSON code returns a bounded repair draft',async()=>{
  const wrapped=await handleAPI(req('/api/scene-code'),{},{fetch:async()=>model({program:chipProgram})});assert.equal(wrapped.status,200);
  const raw='```javascript\nfunction draw(fr,t,scene,VK){ not complete';
  const response=await handleAPI(req('/api/scene-code'),{},{fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:raw},finish_reason:'stop'}],usage:{total_tokens:123}}),{headers:{'Content-Type':'application/json'}})});
  assert.equal(response.status,502);const data=await response.json();assert.equal(data.recovery.draft,raw);assert.equal(data.recovery.program,null);
  const fixed=await handleAPI(req('/api/scene-code/repair',{...payload,draft:raw,issue:'missing program'}),{},{fetch:async(url,options)=>{assert.equal(JSON.parse(JSON.parse(options.body).messages[1].content).draft,raw);return model(chipProgram);}});assert.equal(fixed.status,200);
});
test('actual upstream engine and web Worker bridge draw distinct objects, deterministic motion and seven ratios',async()=>{
  const call=await nativeWorker(),palette={bg:'#090b0f',ink:'#fff4df',gold:'#d7ac64',blue:'#7ac3dd'};
  const base={type:'render',id:2,key:'chip',scene,program:chipProgram,palette,width:576,height:324,inspect:true};
  const a=await call({...base,time:2}),b=await call({...base,time:7}),again=await call({...base,time:2});
  assert.ok(a.stats.coverage>.04);assert.notEqual(a.stats.signature,b.stats.signature);assert.equal(a.stats.signature,again.stats.signature);
  const network=await call({...base,key:'birthday',program:birthdayProgram,time:7});assert.notEqual(a.stats.signature,network.stats.signature);
  for(const [width,height]of [[180,320],[320,180],[240,240],[192,240],[180,240],[240,180],[336,144]]){const r=await call({...base,key:width+'x'+height,width,height,time:5});assert.equal(r.bitmap.width,width);assert.equal(r.bitmap.height,height);assert.ok(r.stats.coverage>.01);}
});
test('opaque sandbox has no same-origin privilege and Worker has a cancellable watchdog',async()=>{
  const runtime=await readFile(new URL('../dist/film-runtime.js',import.meta.url),'utf8'),sandbox=await readFile(new URL('../dist/code-sandbox.html',import.meta.url),'utf8'),worker=await readFile(new URL('../worker/index.js',import.meta.url),'utf8');
  assert.match(runtime,/setAttribute\('sandbox','allow-scripts'\)/);assert.doesNotMatch(runtime,/allow-same-origin/);assert.match(sandbox,/worker\.terminate\(\)/);assert.match(sandbox,/6000/);assert.match(worker,/connect-src 'none'/);assert.match(runtime,/event.source!==iframe.contentWindow/);assert.doesNotMatch(runtime,/apiKey|configs\.text/);
});
