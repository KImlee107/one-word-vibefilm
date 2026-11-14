import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildRhythmPlan,musicEvents,sceneMusicBeats,musicTimeAt,recommendedSceneCount} from '../dist/rhythm.js';
import {DEFAULT_MUSIC,musicSource,musicAnalysis} from '../dist/music.js';
import {handleAPI} from '../worker/api.js';
import {nativeWorker} from './lib/native-film.mjs';
import {prepareAudioMix} from '../dist/audio.js';
const a=DEFAULT_MUSIC.analysis;
test('the supplied audio asset matches its measured profile, without a guessed BPM or synthesized substitute',async()=>{
  const audio=await readFile(new URL('../dist/music/we-never-vibe.m4a',import.meta.url));assert.equal(createHash('sha256').update(audio).digest('hex'),DEFAULT_MUSIC.sha256);
  assert.ok(audio.length>1e6&&audio.length<2e6);assert.equal(a.bpm,112.8);assert.ok(a.duration>184&&a.duration<185);assert.ok(a.confidence>=.6);assert.ok(a.evidence.subdivisionCoherence>.95);assert.ok(a.evidence.meanAlignmentErrorMs<15);
  assert.equal(a.beats.length,a.beatStrengths.length);assert.ok(a.beats.length>300);assert.ok(a.beats.every((v,i)=>Number.isFinite(v)&&v>=0&&v<a.duration&&(i===0||v>a.beats[i-1])));assert.ok(a.loopStart<a.loopEnd&&a.loopEnd<a.duration);
});
test('each duration preset gets more readable shots with real onset-aligned internal cuts',()=>{
  for(const duration of[15,30,45,60,90,120,180,300]){
    const plan=buildRhythmPlan(duration,a),events=musicEvents(a,0,duration);assert.equal(plan.sceneCount,recommendedSceneCount(duration));assert.equal(plan.shots.length,plan.sceneCount);assert.equal(plan.cuts[0],0);assert.equal(plan.cuts.at(-1),duration);
    assert.ok(Math.abs(plan.shots.reduce((s,v)=>s+v.duration,0)-duration)<.001);assert.ok(plan.shots.every(s=>s.duration>=1.8&&s.duration<=8));assert.equal(plan.alignedCuts,plan.totalCuts);
    assert.ok(plan.cuts.slice(1,-1).every(c=>events.some(e=>Math.abs(e.time-c)<.001)));assert.ok(new Set(plan.shots.map(s=>s.duration)).size>1);
  }
  assert.equal(recommendedSceneCount(90),20);assert.equal(recommendedSceneCount(120),27);assert.equal(recommendedSceneCount(300),48);
});
test('long-video beat mapping matches the exact native audio loop start and end',()=>{
  assert.equal(musicTimeAt(a.loopEnd,a),a.loopStart);
  const first=musicEvents(a,0,a.loopEnd),second=musicEvents(a,a.loopEnd,40);assert.ok(first.length>250&&second.length>50);
  for(const event of second){const local=musicTimeAt(event.time,a);assert.ok(a.beats.some(t=>Math.abs(t-local)<.002));}
  const local=sceneMusicBeats(a,220,6);assert.ok(local.length>6&&local.every(t=>t>=0&&t<=6));
});
test('unreliable tracks do not receive fake synced cuts, while default/custom/original sources stay distinct',()=>{
  const no=buildRhythmPlan(60,{...a,confidence:.1});assert.equal(no.alignedCuts,0);assert.equal(no.bpm,null);
  assert.equal(musicSource({settings:{}}),'default');assert.equal(musicAnalysis({settings:{}}),a);
  assert.equal(musicAnalysis({settings:{musicSource:'custom'}}),null);
  const original=musicAnalysis({settings:{musicSource:'original'},duration:90});assert.equal(original.method,'known-original-score');assert.notEqual(original.bpm,a.bpm);
});
const cfg={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',provider:'openai-compatible',apiKey:'sk-test-rhythm-not-real-1234'};
const request=()=>new Request('https://studio.example/api/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:cfg,payload:{topic:'骰子的概率',duration:60,rhythmEnabled:true,musicSource:'default'}})});
const story=count=>({title:'骰子的概率',summary:'概率需要明确前提',scenes:Array.from({length:count},(_,i)=>({title:'第'+(i+1)+'次观察',narration:'公平骰子有6个可能结果。',caption:'6个结果',duration:60/count,kind:'process',visual:{description:'可数的6个结果',action:'依次计数'}}))});
test('the storyboard API asks for the measured music plan and applies real cut durations before drawing',async()=>{
  let calls=0;const response=await handleAPI(request(),{},{fetch:async(url,init)=>{calls++;const body=JSON.parse(init.body),user=JSON.parse(body.messages[1].content);assert.equal(user.rhythmPlan.sceneCount,13);assert.equal(user.rhythmPlan.bpm,112.8);assert.ok(user.rhythmPlan.shots.every(s=>s.duration>3));return Response.json({choices:[{message:{content:JSON.stringify(story(13))},finish_reason:'stop'}]});}});
  assert.equal(response.status,200);const {script}=await response.json();assert.equal(calls,1);assert.equal(script.rhythmPlan.alignedCuts,12);assert.deepEqual(script.scenes.map(s=>s.duration),script.rhythmPlan.shots.map(s=>s.duration));assert.ok(script.scenes.every(s=>s.narration==='公平骰子有6个可能结果。'));
});
test('too few returned shots remain a visible format failure, never duplicated into fake extra scenes',async()=>{
  const response=await handleAPI(request(),{},{fetch:async()=>Response.json({choices:[{message:{content:JSON.stringify(story(6))},finish_reason:'stop'}]})});
  const body=await response.json();assert.equal(response.status,502);assert.equal(body.error.code,'SCRIPT_FORMAT');assert.match(body.error.message,/仅返回 6 镜/);assert.equal(body.recovery.canRepair,true);
});
test('scene animation cues snap to supplied local beats and preserve the scene edges',async()=>{
  const call=await nativeWorker();const r=await call({type:'render',id:1,key:'beat-cue',scene:{duration:5,beatTimes:[.2,1.1,2.45,3.7,4.8]},program:{source:"const W=fr.w,H=fr.h;fr.text('cue '+fr.cue(.5),W*.5,H*.4,{size:24});fr.text('edges '+fr.cue(0)+' '+fr.cue(1),W*.5,H*.6,{size:24});fr.circle(W*(.2+t*.02),H*.3,18,{fill:scene.palette.gold});"},palette:{bg:'#111111',ink:'#ffffff',gold:'#d9b96e'},width:576,height:324,time:2,inspect:true});assert.ok(r.stats.texts.some(t=>t.text==='cue 2.45'));assert.ok(r.stats.texts.some(t=>t.text==='edges 0 5'));
});

test('default playback decodes the provided recording and uses exactly the loop boundaries used by the planner',async()=>{
  const oldFetch=globalThis.fetch,oldAC=globalThis.AudioContext,oldOffline=globalThis.OfflineAudioContext,sources=[];
  class AC{async decodeAudioData(){return{duration:a.duration};}async close(){}createBuffer(){assert.fail('Must not synthesize substitute music');}}
  class Offline{constructor(){this.destination={};}createDynamicsCompressor(){return{threshold:{},knee:{},ratio:{},connect(){}};}createBufferSource(){const s={connect(){},start(){},stop(){}};sources.push(s);return s;}createGain(){return{gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}async startRendering(){return{duration:300};}}
  globalThis.fetch=async url=>{assert.match(String(url),/music\/we-never-vibe\.m4a$/);return new Response(new Uint8Array(2000),{headers:{'Content-Type':'audio/mp4'}});};globalThis.AudioContext=AC;globalThis.OfflineAudioContext=Offline;
  try{await prepareAudioMix({duration:300,settings:{music:true,voice:false}});assert.equal(sources.length,1);assert.equal(sources[0].loopStart,a.loopStart);assert.equal(sources[0].loopEnd,a.loopEnd);assert.equal(sources[0].loop,true);}finally{globalThis.fetch=oldFetch;globalThis.AudioContext=oldAC;globalThis.OfflineAudioContext=oldOffline;}
});
