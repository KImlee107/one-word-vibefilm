const round=x=>Math.round(x*1000)/1000;
export const recommendedSceneCount=duration=>Math.max(4,Math.min(48,Math.round(Number(duration)/4.5)));
export function validRhythm(analysis){return analysis?.reliable===true&&Number(analysis.confidence)>=.6&&Array.isArray(analysis.beats)&&analysis.beats.filter(Number.isFinite).length>=4;}
/** Same loop mapping as AudioBufferSource.loopStart/loopEnd in audio.js. */
export function musicTimeAt(time,analysis){
  const end=Number(analysis?.loopEnd)||Number(analysis?.duration)||Infinity,start=Number(analysis?.loopStart)||0;
  return time<end||end<=start?time:start+(time-end)%(end-start);
}
export function musicEvents(analysis,start=0,duration=300){
  if(!validRhythm(analysis))return [];
  const stop=start+duration,end=Number(analysis.loopEnd)||Number(analysis.duration)||Infinity,loopStart=Number(analysis.loopStart)||0,period=end-loopStart;
  const accents=new Set((analysis.accentBeats||[]).map(round)),events=[];
  const beats=analysis.beats.slice(0,6000).map((time,i)=>({time:Number(time),strength:Number(analysis.beatStrengths?.[i])||.5})).filter(b=>Number.isFinite(b.time)&&b.time>=0&&b.time<end).sort((a,b)=>a.time-b.time).filter((b,i,a)=>i===0||b.time-a[i-1].time>=.04);
  for(let cycle=0;cycle<2000;cycle++){
    const offset=cycle?end-loopStart+(cycle-1)*period:0;
    if(cycle&&(!Number.isFinite(period)||period<=0||offset+loopStart>stop))break;
    for(const beat of beats){if(cycle&&beat.time<loopStart)continue;const time=round(beat.time+offset);if(time>=start-.0001&&time<=stop+.0001)events.push({time,strength:beat.strength,accent:accents.has(round(beat.time))});}
    if(!Number.isFinite(end)||end>stop)break;
  }
  return events.sort((a,b)=>a.time-b.time).filter((e,i,a)=>i===0||e.time-a[i-1].time>.015);
}
export function sceneMusicBeats(analysis,start,duration){return musicEvents(analysis,start,duration).map(b=>round(b.time-start));}

/** Content-sized shots, snapped to detected onsets. No fabricated scene content. */
export function buildRhythmPlan(duration,analysis,{count=recommendedSceneCount(duration)}={}){
  duration=Number(duration);count=Number(count);
  if(!Number.isFinite(duration)||duration<15||duration>600||!Number.isInteger(count)||count<3||count>48)throw new Error('卡点计划的时长或镜头数无效。');
  const events=musicEvents(analysis,0,duration),sections=Array.isArray(analysis?.sections)?analysis.sections.slice(0,300).filter(s=>s&&Number.isFinite(s.start)&&Number.isFinite(s.end)):[],steps=Math.ceil(duration*4),weights=[];let total=0;
  for(let i=0;i<steps;i++){const t=musicTimeAt(i*duration/steps,analysis),section=sections.find(s=>t>=s.start&&t<s.end),weight=.7+.3*Math.max(0,Math.min(1,section?.energy??.8));total+=weight;weights.push(total);}
  const min=Math.max(1.8,Math.min(3,duration/count*.6)),max=Math.max(8,duration/count*1.8),cuts=[0],aligned=[];
  for(let i=1;i<count;i++){
    const quantile=total*i/count,j=weights.findIndex(v=>v>=quantile),target=j*duration/steps,lo=cuts.at(-1)+min,hi=Math.min(duration-(count-i)*min,cuts.at(-1)+max);
    let best=null;
    for(const e of events){if(e.time<lo||e.time>hi)continue;const score=Math.abs(e.time-target)-e.strength*.16-(e.accent ? .08 : 0);if(!best||score<best.score)best={...e,score};}
    const time=round(best?.time??Math.max(lo,Math.min(hi,target)));cuts.push(time);aligned.push(!!best);
  }
  cuts.push(round(duration));
  return {version:1,sceneCount:count,bpm:validRhythm(analysis)?analysis.bpm:null,confidence:analysis?.confidence||0,method:analysis?.method||'no-reliable-audio',cuts,shots:cuts.slice(0,-1).map((start,i)=>({index:i+1,start,end:cuts[i+1],duration:round(cuts[i+1]-start),cutOnBeat:i===0?false:aligned[i-1],maxNarrationChars:Math.max(6,Math.floor((cuts[i+1]-start)*4))})),alignedCuts:aligned.filter(Boolean).length,totalCuts:count-1};
}
export function timelineRhythmStats(project,analysis){const events=musicEvents(analysis,0,project.duration);const cuts=project.scenes.slice(1).map(s=>s.start);return {total:cuts.length,aligned:cuts.filter(t=>events.some(e=>Math.abs(e.time-t)<=.05)).length};}
