// Local, bounded onset analysis. No remote requests, synthesis or stem separation.
const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const rounded=(value,digits=3)=>Number(value.toFixed(digits));
const MIN_CONFIDENCE=.6;

function sectionEnergy(energy,frameSeconds,duration){
  if(!energy.length)return [];
  const width=Math.max(1,Math.round(2/frameSeconds));
  const bins=[];
  for(let i=0;i<energy.length;i+=width){let sum=0;const end=Math.min(energy.length,i+width);for(let j=i;j<end;j++)sum+=energy[j]*energy[j];bins.push(Math.sqrt(sum/(end-i)));}
  const maximum=Math.max(...bins,1e-12),boundaries=[0];
  for(let i=2;i<bins.length-2;i++){
    const before=(bins[i-2]+bins[i-1])/2,after=(bins[i]+bins[i+1])/2;
    const difference=Math.abs(Math.log((after+maximum*.04)/(before+maximum*.04)));
    if(difference>.68&&i*2-boundaries.at(-1)>=8&&duration-i*2>=5)boundaries.push(i*2);
  }
  boundaries.push(duration);
  return boundaries.slice(0,-1).map((start,i)=>{
    const end=boundaries[i+1],from=Math.floor(start/frameSeconds),to=Math.min(energy.length,Math.ceil(end/frameSeconds));
    let sum=0;for(let j=from;j<to;j++)sum+=energy[j]*energy[j];
    return {start:rounded(start),end:rounded(end),energy:rounded(Math.sqrt(sum/Math.max(1,to-from))/maximum)};
  });
}

function noBeat(duration,sections,warning){
  return {duration:rounded(duration),bpm:null,confidence:0,beats:[],sections,method:'local-onset',reliable:false,warnings:[warning]};
}

/** Accepts AudioBuffer or an AudioBuffer-like value, allowing deterministic unit tests. */
export function analyzeAudioBuffer(buffer){
  const sampleRate=Number(buffer?.sampleRate),length=Number(buffer?.length),channels=Number(buffer?.numberOfChannels);
  if(!Number.isFinite(sampleRate)||sampleRate<1000||sampleRate>384000||!Number.isInteger(length)||length<1||!Number.isInteger(channels)||channels<1||typeof buffer.getChannelData!=='function')throw new TypeError('无法读取有效音频。');
  const duration=length/sampleRate;
  if(duration>1800)throw new Error('本地节奏分析支持 30 分钟以内的音频。');
  const inputs=[];for(let i=0;i<Math.min(channels,2);i++){const input=buffer.getChannelData(i);if(!input||input.length<length)throw new TypeError('音频采样数据不完整。');inputs.push(input);}
  // Decimate for analysis only; the original playback audio is never changed.
  const stride=Math.max(1,Math.floor(sampleRate/4000)),analysisRate=sampleRate/stride;
  const frameSize=Math.max(8,Math.round(analysisRate*.02)),frameSeconds=frameSize/analysisRate;
  const totalFrames=Math.ceil(Math.ceil(length/stride)/frameSize);
  const bass=new Float64Array(totalFrames),energy=new Float64Array(totalFrames);
  const highAlpha=1-Math.exp(-2*Math.PI*180/analysisRate),lowAlpha=1-Math.exp(-2*Math.PI*35/analysisRate);
  let high=0,low=0,bassSum=0,fullSum=0,inFrame=0,frame=0;
  for(let index=0;index<length;index+=stride){
    let value=0;for(const input of inputs){const sample=Number(input[index]);if(Number.isFinite(sample))value+=clamp(sample,-1,1)/inputs.length;}
    high+=highAlpha*(value-high);low+=lowAlpha*(value-low);
    bassSum+=(high-low)**2;fullSum+=value*value;inFrame++;
    if(inFrame===frameSize||index+stride>=length){bass[frame]=Math.sqrt(bassSum/inFrame);energy[frame]=Math.sqrt(fullSum/inFrame);frame++;bassSum=0;fullSum=0;inFrame=0;}
  }
  const sections=sectionEnergy(energy,frameSeconds,duration);
  let maximumEnergy=0;for(const value of energy)maximumEnergy=Math.max(maximumEnergy,value);
  if(maximumEnergy<1e-5)return noBeat(duration,sections,'音轨接近静音，保留原动画时序。');
  if(duration<4)return noBeat(duration,sections,'音轨过短，无法可靠估计稳定节奏。');
  const levels=Array.from(bass.subarray(Math.min(15,bass.length-1))).sort((a,b)=>a-b);
  const quiet=levels[Math.floor(levels.length*.1)],loud=levels[Math.floor(levels.length*.9)];
  if((loud-quiet)/Math.max(1e-12,loud)<.12)return noBeat(duration,sections,'音轨以持续声音为主，没有可靠的节拍起伏。');
  const novelty=new Float64Array(totalFrames);let largest=0,total=0;
  for(let i=1;i<totalFrames;i++){
    novelty[i]=Math.max(0,Math.log1p(bass[i]*40)-Math.log1p(bass[i-1]*40))+.25*Math.max(0,Math.log1p(energy[i]*25)-Math.log1p(energy[i-1]*25));
    largest=Math.max(largest,novelty[i]);total+=novelty[i];
  }
  if(largest<1e-5)return noBeat(duration,sections,'没有检测到足够清晰的起音，保留原动画时序。');
  const candidates=[];
  const radius=Math.max(2,Math.round(.4/frameSeconds)),spacing=Math.max(1,Math.round(.22/frameSeconds));
  for(let i=1;i<novelty.length-1;i++){
    if(novelty[i]<novelty[i-1]||novelty[i]<novelty[i+1])continue;
    let local=0;const from=Math.max(0,i-radius),to=Math.min(novelty.length,i+radius+1);
    for(let j=from;j<to;j++)local+=novelty[j];local/=to-from;
    if(novelty[i]<Math.max(largest*.085,local*1.8))continue;
    const last=candidates.at(-1);
    if(last&&i-last.index<spacing){if(novelty[i]>last.strength)candidates[candidates.length-1]={index:i,strength:novelty[i]};}
    else candidates.push({index:i,strength:novelty[i]});
  }
  if(candidates.length<4)return noBeat(duration,sections,'明显起音不足，保留原动画时序。');
  const mean=total/novelty.length;
  let best=null;
  for(let lag=Math.max(1,Math.floor(60/180/frameSeconds));lag<=Math.ceil(60/60/frameSeconds);lag++){
    let product=0,left=0,right=0;
    for(let i=lag;i<novelty.length;i++){const a=novelty[i]-mean,b=novelty[i-lag]-mean;product+=a*b;left+=a*a;right+=b*b;}
    const correlation=product/Math.max(1e-15,Math.sqrt(left*right)),bpm=60/(lag*frameSeconds);
    // This very weak preference only resolves equal half/double-tempo peaks.
    const score=correlation*(.94+.06*Math.exp(-(((bpm-120)/55)**2)));
    if(!best||score>best.score)best={lag,bpm,correlation,score};
  }
  const period=best.lag*frameSeconds;
  let sin=0,cos=0;
  for(const peak of candidates){const phase=2*Math.PI*peak.index*frameSeconds/period;sin+=Math.sin(phase)*peak.strength;cos+=Math.cos(phase)*peak.strength;}
  const phase=((Math.atan2(sin,cos)/(2*Math.PI)*period)%period+period)%period;
  const aligned=candidates.filter(peak=>{const time=peak.index*frameSeconds;return Math.abs(time-(phase+Math.round((time-phase)/period)*period))<=Math.min(.14,period*.2);});
  let regularity=0;
  for(let i=1;i<aligned.length;i++){
    const interval=(aligned[i].index-aligned[i-1].index)*frameSeconds;
    const multiple=Math.max(1,Math.round(interval/period));
    regularity+=clamp(1-Math.abs(interval-multiple*period)/(period*.22));
  }
  regularity/=Math.max(1,aligned.length-1);
  const confidence=clamp(.55*Math.max(0,best.correlation)+.25*(aligned.length/candidates.length)+.2*regularity);
  const reliable=confidence>=MIN_CONFIDENCE&&best.correlation>.22&&aligned.length>=4;
  return {duration:rounded(duration),bpm:reliable?rounded(best.bpm,1):null,confidence:rounded(confidence),beats:reliable?aligned.map(peak=>rounded(peak.index*frameSeconds)):[],sections,method:'local-onset',reliable,warnings:reliable?['拍点来自本地能量起音估计；复杂、变速或有人声的音乐仍需试听核对。']:['没有检测到稳定节奏，保留原动画时序。']};
}

export async function analyzeMusicFile(blob){
  if(!(blob instanceof Blob))throw new TypeError('请先选择音频文件。');
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Audio)throw new Error('当前浏览器不支持本地音频分析。');
  const context=new Audio();
  try{return analyzeAudioBuffer(await context.decodeAudioData(await blob.arrayBuffer()));}
  finally{await context.close();}
}

/** Snap nearby event times, never the scene duration or animation values. */
export function snapCompositionToBeats(composition,sceneStart,sceneDuration,analysis){
  const result=typeof structuredClone==='function'?structuredClone(composition):JSON.parse(JSON.stringify(composition));
  if(!result||!Array.isArray(result.objects)||!Number.isFinite(sceneStart)||sceneStart<0||!Number.isFinite(sceneDuration)||sceneDuration<=0)return result;
  const beats=(Array.isArray(analysis?.beats)?analysis.beats:[]).filter(t=>Number.isFinite(t)&&t>=0).sort((a,b)=>a-b);
  const confidence=Number(analysis?.confidence);
  if(analysis?.reliable===false||!Number.isFinite(confidence)||confidence<MIN_CONFIDENCE||beats.length<4)return result;
  const trackDuration=Number.isFinite(Number(analysis.duration))&&Number(analysis.duration)>0?Number(analysis.duration):0;
  function nearest(time){
    let best=time,distance=.18000001;
    // Uploaded BGM loops in the existing mixer, so repeat only its detected events.
    const cycle=trackDuration?Math.floor(time/trackDuration):0;
    for(const offset of trackDuration?[Math.max(0,cycle-1),cycle,cycle+1]:[0]){
      const shift=trackDuration?offset*trackDuration:0,target=time-shift;
      let left=0,right=beats.length;
      while(left<right){const mid=(left+right)>>1;if(beats[mid]<target)left=mid+1;else right=mid;}
      for(const index of [left-1,left]){
        const candidate=beats[index]+shift;
        if(!Number.isFinite(candidate)||candidate<sceneStart||candidate>sceneStart+sceneDuration)continue;
        const delta=Math.abs(candidate-time);if(delta<distance){distance=delta;best=candidate;}
      }
    }
    return best;
  }
  const snap=t=>!Number.isFinite(t)||t<=0||t>=1?t:clamp((nearest(sceneStart+t*sceneDuration)-sceneStart)/sceneDuration);
  function pair(value){
    const originalStart=value.start,originalEnd=value.end,start=snap(originalStart),end=snap(originalEnd);
    if(Number.isFinite(start)&&Number.isFinite(end)&&end-start>=Math.min(.01,.04/sceneDuration)){value.start=start;value.end=end;}
  }
  function walk(objects){
    for(const object of objects){
      if(object.type==='particles')continue;
      pair(object);for(const animation of object.animations||[])pair(animation);
      if(Array.isArray(object.children))walk(object.children);
    }
  }
  walk(result.objects);return result;
}
