export const FILM_QUALITY_VERSION=2;
const area=b=>Math.max(0,b[2])*Math.max(0,b[3]);
function overlap(a,b){const w=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])),h=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return w*h/Math.max(.000001,Math.min(area(a),area(b)));}
/** Measurable layout checks; semantic and aesthetic review remains a model task. */
export function auditFilmSamples(samples,{width,height,allowTextMotion=false}={}){
  const problems=new Map(),warnings=[];
  function add(code,message,phase,examples){let p=problems.get(code);if(!p){p={code,message,phases:[],examples:[]};problems.set(code,p);}p.phases.push(phase);p.examples.push(...examples.slice(0,3));}
  for(const {phase,stats} of samples){
    if(phase<.15||phase>.85)continue; // entrance/exit frames may intentionally cross an edge
    const texts=(stats?.texts||[]).filter(t=>t.alpha>.25&&t.text.trim());
    const tiny=texts.filter(t=>t.sizeRatio<.03&&t.text.length>1);
    if(tiny.length)add('TEXT_SMALL','主要文字过小；请减少标签和向量维数，放大字号，不要继续塞小字。',phase,tiny.map(t=>({text:t.text,sizeRatio:t.sizeRatio})));
    const clipped=texts.filter(t=>t.box[0]<.018||t.box[0]+t.box[2]>.982||t.box[1]<.14||t.box[1]+t.box[3]>.82);
    if(clipped.length)add('TEXT_CLIPPED','文字越过画布安全边距或进入字幕区域；请移动到横向3%–97%、纵向14%–80%。',phase,clipped.map(t=>({text:t.text,box:t.box})));
    const collisions=[];
    for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
      const a=texts[i],b=texts[j];
      if(a.text===b.text&&a.box.every((v,k)=>Math.abs(v-b.box[k])<.004))continue;
      if(overlap(a.box,b.box)>.28)collisions.push({a:a.text,b:b.text,boxes:[a.box,b.box]});
    }
    if(collisions.length)add('TEXT_OVERLAP','可见文字发生重叠；请分层分阶段展示，给每个标签独立空间。',phase,collisions);
    if(texts.length>(height>width?36:55))add('TEXT_DENSITY','同屏文字过密；请用3个词、3维向量或少量明确示例逐步演算。',phase,[{count:texts.length}]);
    const bounds=stats?.bounds;
    if(bounds&&bounds[2]>.2&&bounds[3]<.24)warnings.push({code:'SHORT_CONTENT',phase,message:'主体只使用了很窄的横向条带；竖屏应改为上下分区，扩大机制演示区域。',bounds});
  }
  // Do not reject a deliberate transition or a single frame of a crossfade.
  const issues=[...problems.values()].filter(p=>new Set(p.phases).size>=2).map(p=>({...p,examples:p.examples.slice(0,5)}));
  const nonempty=samples.some(s=>(s.stats?.coverage||0)>=.004);
  const moving=new Set(samples.map(s=>allowTextMotion?s.stats?.signature:s.stats?.geometrySignature||s.stats?.signature).filter(Boolean)).size>=2;
  if(!nonempty)issues.push({code:'SCENE_EMPTY',message:'多个时刻均没有足够大的可见主体。',examples:[]});
  if(!moving)issues.push({code:'SCENE_STATIC',message:'包括开头和结尾在内，图形主体都没有可见推进；仅文字淡入或换标签不能代替机制动画。',examples:[]});
  return {version:FILM_QUALITY_VERSION,ok:issues.length===0,issues,warnings:warnings.slice(0,3),sampledPhases:samples.map(s=>s.phase)};
}
export function filmQualityError(quality){
  return Object.assign(new Error(quality.issues.map(i=>i.message).join(' ').slice(0,900)),{code:'SCENE_QUALITY',phase:'inspect',quality});
}
/** Shared by the browser renderer and native regression harness. */
export async function sampleFilmInspection({duration,width,height,sample,allowTextMotion=false}){
  const samples=[];
  for(const phase of [.18,.48,.78])samples.push({phase,...await sample(phase*duration)});
  const repeat=await sample(.48*duration);
  if(samples[1].stats.signature!==repeat.stats.signature)throw Object.assign(new Error('同一时刻画面不一致，请按时间计算确定性动画。'),{code:'SCENE_DETERMINISM',phase:'inspect'});
  // A meaningful entrance followed by a reading hold used to look "static" to
  // the three middle-frame test. Probe the boundaries before rejecting it.
  if(new Set(samples.map(s=>allowTextMotion?s.stats.signature:s.stats.geometrySignature||s.stats.signature)).size<2)for(const phase of [0,.04,.10,.92])samples.push({phase,...await sample(phase*duration)});
  const quality=auditFilmSamples(samples,{width,height,allowTextMotion});
  let chosen=samples.slice(0,3);
  if(samples.length>3){const seen=new Set();chosen=[];for(const s of samples){if(!seen.has(s.stats.signature)){seen.add(s.stats.signature);chosen.push(s);}}for(const s of samples){if(chosen.length>=3)break;if(!chosen.includes(s))chosen.push(s);}chosen=chosen.slice(0,3).sort((a,b)=>a.phase-b.phase);}
  return {frames:chosen.map(s=>s.frame),frameTimes:chosen.map(s=>+(s.phase*duration).toFixed(3)),stats:samples.map(s=>s.stats),thumbnail:samples[1].frame,quality};
}
