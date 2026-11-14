import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAudioBuffer,analyzeMusicFile,snapCompositionToBeats} from '../dist/beat.js';

function buffer(samples,sampleRate=8000){return {sampleRate,length:samples.length,numberOfChannels:1,duration:samples.length/sampleRate,getChannelData:()=>samples};}
function kicks(bpm,duration=12){
  const rate=8000,samples=new Float32Array(duration*rate),period=60/bpm;
  for(let start=.2;start<duration;start+=period){for(let i=0;i<rate*.13&&Math.floor(start*rate)+i<samples.length;i++){const t=i/rate;samples[Math.floor(start*rate)+i]+=.9*Math.sin(2*Math.PI*65*t)*Math.exp(-t*42);}}
  return buffer(samples,rate);
}
test('local onset analysis detects actual 120 BPM kick events without writing audio',()=>{
  const analysis=analyzeAudioBuffer(kicks(120));
  assert.equal(analysis.method,'local-onset');assert.equal(analysis.reliable,true);assert.ok(analysis.confidence>=.6);
  assert.ok(Math.abs(analysis.bpm-120)<4);assert.ok(analysis.beats.length>=20&&analysis.beats.length<=25);
  assert.ok(Math.abs(analysis.beats[0]-.2)<.05);assert.ok(analysis.sections.length>=1);
});
test('detected tempo follows the input rather than a fixed default BPM',()=>{
  const analysis=analyzeAudioBuffer(kicks(90,18));assert.equal(analysis.reliable,true);assert.ok(Math.abs(analysis.bpm-90)<4);
});
test('silence, sustained sound and invalid samples do not manufacture a beat grid',()=>{
  const silent=analyzeAudioBuffer(buffer(new Float32Array(8000*6)));assert.equal(silent.bpm,null);assert.equal(silent.reliable,false);assert.deepEqual(silent.beats,[]);
  const tone=new Float32Array(8000*8);for(let i=0;i<tone.length;i++)tone[i]=Math.sin(2*Math.PI*110*i/8000)*.2;
  const steady=analyzeAudioBuffer(buffer(tone));assert.equal(steady.reliable,false);assert.deepEqual(steady.beats,[]);
  assert.throws(()=>analyzeAudioBuffer({sampleRate:NaN}),/有效音频/);
});
test('snapping uses nearby global beats while keeping animation values, particles and scene boundaries intact',()=>{
  const comp={version:1,objects:[{id:'hero',type:'rect',start:.119,end:.9,animations:[{property:'x',from:.1,to:.8,start:.119,end:.241}]},{id:'dust',type:'particles',start:.119,end:.9,animations:[{property:'opacity',from:0,to:1,start:.119,end:.241}]}]};
  const original=structuredClone(comp),analysis={duration:30,confidence:.9,reliable:true,beats:[10,11.25,12.5,15,19,20]};
  const snapped=snapCompositionToBeats(comp,10,10,analysis);
  assert.deepEqual(comp,original);assert.equal(snapped.objects[0].start,.125);assert.equal(snapped.objects[0].animations[0].end,.25);
  assert.equal(snapped.objects[0].animations[0].from,.1);assert.equal(snapped.objects[0].animations[0].to,.8);assert.deepEqual(snapped.objects[1],comp.objects[1]);
  assert.ok(snapped.objects[0].end>snapped.objects[0].start);
  assert.deepEqual(snapCompositionToBeats(comp,10,10,{...analysis,confidence:.3}),original);
  assert.deepEqual(snapCompositionToBeats(comp,10,10,{beats:analysis.beats}),original);
});
test('snapping cannot collapse a short event or move a distant event to a beat',()=>{
  const comp={objects:[{id:'x',type:'number',start:0,end:1,value:23,animations:[{property:'value',from:0,to:23,start:.12,end:.13},{property:'opacity',from:0,to:1,start:.33,end:.6}]}]};
  const out=snapCompositionToBeats(comp,0,10,{duration:20,confidence:.9,beats:[0,1.25,5,10]});
  assert.equal(out.objects[0].start,0);assert.equal(out.objects[0].end,1);
  assert.equal(out.objects[0].animations[0].start,.12);assert.equal(out.objects[0].animations[0].end,.13);
  assert.equal(out.objects[0].animations[1].start,.33);assert.equal(out.objects[0].animations[1].end,.6);
});
test('music-file decoding closes the AudioContext even when decoding fails',async()=>{
  const Previous=globalThis.AudioContext;let closed=false;
  globalThis.AudioContext=class {async decodeAudioData(){throw new Error('bad audio');}async close(){closed=true;}};
  try{await assert.rejects(analyzeMusicFile(new Blob(['not audio'])),/bad audio/);assert.equal(closed,true);}
  finally{if(Previous===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=Previous;}
});
