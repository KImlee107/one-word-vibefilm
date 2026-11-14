import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createCanvas,Path2D} from '@napi-rs/canvas';
import {validateFilmProgram,filmFingerprint} from '../dist/film-program.js';
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

async function nativeWorker(){
  let reply;
  const self={fonts:{add(){}},postMessage(value){reply?.(value);}};
  const context=vm.createContext({self,Path2D,FontFace:class{async load(){return this;}},URLSearchParams,OffscreenCanvas:function(w,h){const canvas=createCanvas(w,h);canvas.transferToImageBitmap=()=>{const copy=createCanvas(canvas.width,canvas.height);copy.getContext('2d').drawImage(canvas,0,0);return copy;};return canvas;}});
  vm.runInContext(await readFile(new URL('../dist/film-worker.js',import.meta.url),'utf8'),context,{timeout:3000});
  const call=message=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('worker test timeout')),8000);reply=value=>{clearTimeout(timer);value.error?reject(new Error(value.error)):resolve(value);};self.onmessage({data:message});});
  await call({type:'init',id:1,engine:await readFile(new URL('../dist/vendor/vibe-knowledge-film/vk.js',import.meta.url),'utf8'),fonts:[]});return call;
}
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
