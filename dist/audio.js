// Original procedural score and browser-only audio mixing. No remote requests.
import {MAX_PROJECT_DURATION} from './presets.js';
const decoded = new WeakMap();
const mixes = new WeakMap();
const AC = () => globalThis.AudioContext || globalThis.webkitAudioContext;

export function createMusicBuffer(context, duration, style = 'ambient') {
  const sampleRate = 24000;
  const buffer = context.createBuffer(2, Math.ceil(duration * sampleRate), sampleRate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  const chords = [[220,261.626,329.628],[174.614,220,261.626],[130.813,164.814,195.998],[195.998,246.942,293.665]];
  const beat = style === 'minimal' ? 0.75 : 0.625;
  for (let i=0;i<left.length;i++) {
    const t=i/sampleRate, phase=t%8, chord=chords[Math.floor(t/8)%4];
    const chordEnvelope=Math.min(1,phase/0.8,(8-phase)/0.8);
    const fade=Math.min(1,t/2,Math.max(0,(duration-t)/3));
    let pad=0;
    for(let n=0;n<3;n++) pad+=Math.sin(2*Math.PI*chord[n]*t+0.025*Math.sin(t*0.7+n))/3;
    const b=t%beat, count=Math.floor(t/beat);
    const kick= count%2===0 ? Math.sin(2*Math.PI*(48*b+28*(1-Math.exp(-b*25))))*Math.exp(-b*24)*0.06 : 0;
    const note=chord[count%3]*2;
    const pluck=Math.sin(2*Math.PI*note*b)*Math.exp(-b*12)*0.025;
    const bass=Math.sin(2*Math.PI*(chord[0]/2)*t)*Math.exp(-b*5)*0.023;
    const value=(pad*0.035*chordEnvelope+kick+pluck+bass)*fade;
    left[i]=value*(0.98+0.02*Math.sin(t*0.8));
    right[i]=value*(0.98-0.02*Math.sin(t*0.8));
  }
  return buffer;
}

async function decode(context, blob) {
  if(!blob || !(blob instanceof Blob)) return null;
  if(!decoded.has(blob)) decoded.set(blob,context.decodeAudioData(await blob.arrayBuffer()));
  return decoded.get(blob);
}

export function invalidateAudio(project) { mixes.delete(project); }

export async function prepareAudioMix(project) {
  if(!AC() || !(globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext)) return null;
  const settings=project.settings||{};
  const voices=settings.voice===false?[]:(project.voiceClips?.length?project.voiceClips:(project.voiceBlob?[{blob:project.voiceBlob,start:0}]:[]));
  const music=settings.music!==false;
  if(!voices.length&&!music) return null;
  const key=[music,settings.voice,settings.musicStyle,project.musicBlob,project.voiceBlob,project.duration,...voices.flatMap(c=>[c.blob,c.start,c.duration,c.sourceOffset])];
  const previous=mixes.get(project);
  if(previous && key.every((v,i)=>v===previous.key[i])) return previous.promise;
  const promise=(async()=>{
    const context=new (AC())();
    try {
      const duration=Math.max(1,Math.min(MAX_PROJECT_DURATION,Number(project.duration)||90));
      const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
      const offline=new Offline(2,Math.ceil(duration*48000),48000);
      const master=offline.createDynamicsCompressor();
      master.threshold.value=-8;master.knee.value=4;master.ratio.value=4;master.connect(offline.destination);
      const clips=[];
      for(const clip of voices){
        const audio=await decode(context,clip.blob);if(!audio)continue;
        const start=Math.max(0,Number(clip.start)||0);
        if(start>=duration)continue;
        const source=offline.createBufferSource();source.buffer=audio;
        const gain=offline.createGain();gain.gain.value=0.9;source.connect(gain);gain.connect(master);
        const sourceOffset=Math.max(0,Number(clip.sourceOffset)||0);
        const maxLength=Math.min(audio.duration-sourceOffset,duration-start,Number(clip.duration)>0?Number(clip.duration):Infinity);
        if(maxLength>0){source.start(start,sourceOffset,maxLength);clips.push({start,end:start+maxLength});}
      }
      if(music){
        const audio=project.musicBlob?await decode(context,project.musicBlob):createMusicBuffer(context,duration,settings.musicStyle);
        if(audio){
          const source=offline.createBufferSource();source.buffer=audio;source.loop=true;
          const gain=offline.createGain();const level=project.musicBlob?0.25:0.9;
          gain.gain.setValueAtTime(level,0);
          for(const clip of clips){
            gain.gain.setValueAtTime(level,Math.max(0,clip.start-0.18));
            gain.gain.linearRampToValueAtTime(level*0.32,clip.start);
            gain.gain.setValueAtTime(level*0.32,Math.max(clip.start,clip.end-0.08));
            gain.gain.linearRampToValueAtTime(level,Math.min(duration,clip.end+0.25));
          }
          gain.gain.setValueAtTime(level,Math.max(0,duration-1.5));gain.gain.linearRampToValueAtTime(0,duration);
          source.connect(gain);gain.connect(master);source.start(0);source.stop(duration);
        }
      }
      return await offline.startRendering();
    } finally { await context.close(); }
  })();
  mixes.set(project,{key,promise});
  return promise;
}

export function createAudioController(){
  let context=null,source=null,project=null,active=false,generation=0;
  function pause(){generation++;active=false;if(source){try{source.stop();}catch{}source.disconnect();source=null;}}
  return {
    async start(next,time=0){
      pause();project=next;const token=generation;active=true;
      if(!AC())return;
      context ||= new (AC())();await context.resume();
      const buffer=await prepareAudioMix(next);
      if(!buffer||token!==generation||!active)return;
      source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
      source.start(0,Math.min(Math.max(0,time),Math.max(0,buffer.duration-0.01)));
    },
    pause,
    async seek(time){if(active&&project)await this.start(project,time);},
    async dispose(){pause();if(context){await context.close();context=null;}}
  };
}
