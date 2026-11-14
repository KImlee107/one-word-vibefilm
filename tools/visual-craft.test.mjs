import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWorker} from './lib/native-film.mjs';
import {sampleFilmInspection} from '../dist/film-quality.js';
import {visualBible} from '../dist/visual-craft.js';
import {validateFilmProgram} from '../dist/film-program.js';
import {getStyle,DURATION_PRESETS} from '../dist/presets.js';
import {validateScript,handleAPI} from '../worker/api.js';
import {createProjectFromScript} from '../dist/engine.js';
import {DEFAULT_MUSIC} from '../dist/music/we-never-profile.js';
import {buildRhythmPlan} from '../dist/rhythm.js';
const program=source=>({version:1,designIntent:'检查纸面字的对比与全片背景一致性',layout:'readability',heroObjects:['纸张'],source});
async function inspect(source,style='paper'){
  const call=await nativeWorker();return sampleFilmInspection({duration:10,width:576,height:324,sample:async time=>{const r=await call({type:'render',id:1,key:style,program:program(source),scene:{duration:10},palette:getStyle(style).palette,width:576,height:324,time,inspect:true});return {stats:r.stats,frame:r.bitmap.toDataURL('image/jpeg')};}});
}
const paper=`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,0,9);fr.rect(W*.2,H*.25,W*.6,H*.35,{fill:'#fffdf5'});fr.circle(W*(.2+.4*p),H*.7,S*.04,{fill:scene.palette.gold});`;
test('native frames reject pale text on pale props, and readable default ink fixes the same drawing',async()=>{
  const bad=await inspect(paper+`fr.text('关键结论',W*.5,H*.43,{size:S*.06,color:'#fffdf7'});`);assert.ok(bad.quality.issues.some(i=>i.code==='TEXT_CONTRAST'));
  const fixed=await inspect(paper+`fr.text('关键结论',W*.5,H*.43,{size:S*.06});`);assert.equal(fixed.quality.ok,true,JSON.stringify(fixed.quality.issues));assert.ok(fixed.stats[1].texts.find(t=>t.text==='关键结论').contrast>7);
});
test('persistent full-frame white flashes on a dark project are rejected, while a bounded paper prop is allowed',async()=>{
  const bad=await inspect(`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,0,9);fr.rect(0,0,W,H,{fill:'#ffffff'});fr.circle(W*(.2+.4*p),H*.4,S*.12,{fill:scene.palette.gold});fr.text('演示',W*.5,H*.7,{size:S*.06,color:'#222222'});`,'noir');assert.ok(bad.quality.issues.some(i=>i.code==='STYLE_BACKGROUND'));
  const card=await inspect(`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,0,9);fr.rect(W*.3,H*.25,W*.4,H*.4,{fill:'#fffdf5'});fr.circle(W*(.3+.2*p),H*.4,S*.04,{fill:'#805727'});fr.text('纸张',W*.5,H*.7,{size:S*.06});`,'noir');assert.equal(card.quality.ok,true,JSON.stringify(card.quality.issues));
});
test('trusted drawing helpers alone count as drawing and their optional shot plan is safely retained',()=>{
  const source=`const W=fr.w,H=fr.h,S=Math.min(W,H);const progress=VK.ss(t,0,scene.duration);fr.die(W*(.35+.25*progress),H*.45,S*.2,{value:3});`;
  const valid=validateFilmProgram({...program(source),shotPlan:{focalObject:'骰子',visibleChange:'移动到观察位置',framing:'物体特写',material:'象牙白哑光',unsafe:{apiKey:'drop'}}});assert.equal(valid.shotPlan.focalObject,'骰子');assert.equal(valid.shotPlan.unsafe,undefined);
});
test('visual direction survives wrapped storyboards and project creation; changing style changes the visual world',()=>{
  const bible={world:'暗金实验室',heroDesign:'相同杯壁与水位标尺',materials:'哑光玻璃',continuity:'同一个水杯逐镜延续'};
  const scene={title:'观察水位',narration:'水位随着漏水逐步变化。',caption:'看水位',duration:10,kind:'process',visual:{framing:'水杯特写'}};
  const script=validateScript({data:{title:'学习与漏水',visualBible:bible,scenes:[scene,scene,scene]}},30);const p=createProjectFromScript(script,{topic:'学习',duration:30,style:'noir'});assert.equal(p.visualBible.world,bible.world);assert.equal(p.scenes[0].visual.framing,'水杯特写');
  const switched=visualBible(p.visualBible,'paper');assert.notEqual(switched.world,bible.world);assert.match(switched.world,/纸/);assert.equal(switched.heroDesign,bible.heroDesign);assert.ok(DURATION_PRESETS.some(p=>p.seconds===150));
});
test('music cut timing preserves longer mechanism shots instead of flattening all shots to the same length',()=>{
  const plan=buildRhythmPlan(30,DEFAULT_MUSIC.analysis,{count:5,preferredDurations:[3,10,3,9,5]});assert.ok(plan.shots[1].duration>8);assert.ok(plan.shots[3].duration>7);assert.ok(plan.shots[0].duration<4);assert.equal(plan.alignedCuts,4);assert.ok(Math.abs(plan.shots.reduce((s,v)=>s+v.duration,0)-30)<.001);
});
