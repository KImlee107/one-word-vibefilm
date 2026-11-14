import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleFilmInspection} from '../dist/film-quality.js';
import {validateFilmProgram} from '../dist/film-program.js';
import {nativeWorker} from './lib/native-film.mjs';
import {chipProgram,portraitVectors} from './fixtures/film-code.mjs';
const palette={bg:'#f3efdf',ink:'#282c2a',gold:'#b67d3b',blue:'#417e89'};
async function inspect(program,width=324,height=576){
  const worker=await nativeWorker();return sampleFilmInspection({duration:10,width,height,sample:async time=>{
    const r=await worker({type:'render',id:2,key:program.layout,scene:{duration:10},program,palette,width,height,time,inspect:true});return {stats:r.stats,frame:r.bitmap.toDataURL('image/jpeg')};
  }});
}
test('documented close:true is allowed while closing the Worker or fetching remains prohibited',()=>{
  assert.doesNotThrow(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+'\nfr.poly([[0,t],[20,30],[40,10]],{close:true,color:scene.palette.gold});'}));
  for(const source of ['close();','fr.x.canvas.toDataURL();','fetch("https://example.com");'])assert.throws(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+source}));
});
test('wrapper, field aliases and complete draw bodies are normalized without executing them',()=>{
  const input={program:{version:'1',description:chipProgram.designIntent,composition:chipProgram.layout,objects:chipProgram.heroObjects,code:'function draw(fr,t,scene,VK){'+chipProgram.source+'}'}};
  const result=validateFilmProgram(input);assert.match(result.source,/const W=fr.w/);assert.doesNotMatch(result.source,/function draw/);
  assert.throws(()=>validateFilmProgram({...chipProgram,source:chipProgram.source+'const broken = ;'}),e=>e.code==='CODE_SYNTAX'&&e.details.line>1&&e.details.column>0);
});
test('native rendering measures and rejects repeated tiny overlapping and clipped labels',async()=>{
  const program={...chipProgram,layout:'bad-position-labels',source:`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.clamp(t/scene.duration);fr.rect(W*.1+p*W*.2,H*.3,W*.3,H*.2,{fill:scene.palette.gold});for(let i=0;i<7;i++){fr.text('位置编码标签',i*W*.07-W*.03,H*.45,{size:S*.019,color:scene.palette.ink});}`};
  const result=await inspect(program);assert.equal(result.quality.ok,false);const codes=result.quality.issues.map(i=>i.code);assert.ok(codes.includes('TEXT_SMALL'));assert.ok(codes.includes('TEXT_OVERLAP'));assert.ok(codes.includes('TEXT_CLIPPED'));
});
test('a readable portrait vector sum passes measured layout and varies with the explanation',async()=>{
  validateFilmProgram(portraitVectors);const result=await inspect(portraitVectors);assert.equal(result.quality.ok,true,JSON.stringify(result.quality.issues));assert.equal(result.frames.length,3);assert.ok(result.stats.some(s=>s.texts.length>5));
});
test('an early meaningful entrance plus a reading hold is sampled adaptively, a truly static scene still fails',async()=>{
  const moving={...chipProgram,layout:'early-entrance',source:`const W=fr.w,H=fr.h,p=VK.ss(t,0,.8);fr.rect(W*(.15+.3*p),H*.3,W*.25,H*.28,{fill:scene.palette.gold});fr.label('进入后留时间阅读',W*.5,H*.7,{size:W*.045,color:scene.palette.ink});`};
  const result=await inspect(moving);assert.equal(result.quality.ok,true);assert.ok(result.quality.sampledPhases.includes(.04));
  const staticScene={...moving,layout:'truly-static',source:moving.source.replace('W*(.15+.3*p)','W*.45')};const still=await inspect(staticScene);assert.ok(still.quality.issues.some(i=>i.code==='SCENE_STATIC'));
});
test('moving text over an unchanged diagram cannot pass as a moving knowledge mechanism',async()=>{
  const program={...chipProgram,layout:'text-only-motion',source:`const W=fr.w,H=fr.h,p=VK.clamp(t/scene.duration);fr.rect(W*.2,H*.25,W*.6,H*.35,{fill:scene.palette.gold});fr.text('只有标签在移动',W*(.4+.15*p),H*.7,{size:W*.045,color:scene.palette.ink});`};
  const result=await inspect(program);assert.ok(result.quality.issues.some(i=>i.code==='SCENE_STATIC'));
});
