/** Normalize model formatting only. Never substitute a built-in story or invent facts. */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>record(value)&&Object.hasOwn(value,key);
function first(value,keys){for(const key of keys)if(own(value,key)&&value[key]!==null&&value[key]!==undefined)return value[key];}
function words(value){
  if(typeof value==='string')return value.trim();
  if(Array.isArray(value))return value.slice(0,80).map(words).filter(Boolean).join(' ');
  if(record(value)){const text=first(value,['text','content','中文','zh','zh-CN']);return typeof text==='string'?text.trim():'';}
  return '';
}
const sceneKeys=['scenes','shots','segments','storyboard','分镜','分镜脚本','分镜列表','镜头','镜头列表','段落','timeline'];
const wrappers=['script','storyboard','data','result','output','video','film','project','response','视频','脚本','作品','项目'];
function unquote(value){if(typeof value==='string'&&/^[\s]*[\[{]/.test(value)){try{return JSON.parse(value);}catch{/* Repair route can handle malformed JSON. */}}return value;}
function locate(input){
  const queue=[{value:input,parents:[],path:'root'}],seen=new Set();
  while(queue.length&&seen.size<32){
    let {value,parents,path}=queue.shift();value=unquote(value);
    if(Array.isArray(value))return {container:{},scenes:value,parents,path};
    if(!record(value)||seen.has(value))continue;seen.add(value);
    for(const key of sceneKeys){const scenes=value[key];if(Array.isArray(scenes))return {container:value,scenes,parents,path:path+'.'+key};}
    if(parents.length<4)for(const key of [...new Set([...wrappers,...sceneKeys])])if(own(value,key))queue.push({value:value[key],parents:[value,...parents],path:path+'.'+key});
  }
  return {container:record(input)?input:{},scenes:undefined,parents:[],path:'root'};
}
function seconds(value){
  if(typeof value==='number')return value;
  if(typeof value!=='string')return NaN;
  const s=value.trim().replace(/\s*(?:seconds?|secs?|秒钟?|s)\s*$/i,'');
  if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);
  if(/^\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s))return s.split(':').reduce((sum,n)=>sum*60+Number(n),0);
  return NaN;
}
function durationOf(value){
  const explicit=first(value,['duration','durationSeconds','duration_seconds','时长','时长秒','持续时间']);
  if(explicit!==undefined)return seconds(explicit);
  const start=first(value,['start','startTime','start_time','开始时间']),end=first(value,['end','endTime','end_time','结束时间']);
  if(start!==undefined&&end!==undefined)return seconds(end)-seconds(start);
  const range=first(value,['time','timeRange','time_range','时间','时间段','时间范围']);
  if(Array.isArray(range)&&range.length===2)return seconds(range[1])-seconds(range[0]);
  if(typeof range==='string'){const parts=range.split(/\s*(?:–|—|~|～|至|-)\s*/);if(parts.length===2)return seconds(parts[1])-seconds(parts[0]);}
  return undefined;
}
const kinds={hook:'process',intro:'process',question:'process',reveal:'process',deduction:'process',formula:'process',equation:'process',animation:'process',code:'process',closing:'process',conclusion:'process',comparison:'compare',chart:'bars',graph:'network','开场':'process','提问':'process','推导':'process','公式':'process','结论':'process','代码动画':'process','对比':'compare','关系网':'network','时间轴':'timeline'};
function normalizeScene(value,index){
  if(!record(value))return value;
  const source=record(value.scene)?value.scene:value;
  const narration=words(first(source,['narration','voiceover','voiceOver','voice_over','voiceoverText','旁白','旁白文案','解说','解说词','文案','script','text','字幕']));
  const caption=words(first(source,['caption','subtitle','subtitles','字幕','字幕文案']))||narration;
  const title=words(first(source,['title','sceneTitle','scene_title','heading','name','标题','镜头标题','分镜标题','镜头名称']))||(narration?'镜头 '+(index+1):'');
  const visualSource=first(source,['visual','visuals','visualDescription','visual_description','画面','画面内容','画面描述','画面设计']);
  const visual=record(visualSource)?{...visualSource}:{description:words(visualSource)};
  if(!visual.description)visual.description=words(first(source,['description','画面说明']));
  if(!visual.action)visual.action=words(first(source,['action','animation','动画','动画说明']));
  let kind=first(source,['kind','type','sceneType','scene_type','类型','镜头类型']);
  if(kind===undefined||kind==='')kind='process';
  else if(typeof kind==='string'){kind=kind.replace(/^script:/,'');kind=kinds[kind]||kind;}
  return {title,narration,caption,duration:durationOf(source),kind,visual};
}
export function normalizeStoryboard(input,{targetDuration=90,topic=''}={}){
  const found=locate(input),containers=[found.container,...found.parents];
  const field=keys=>{for(const value of containers){const s=words(first(value,keys));if(s)return s;}return '';};
  const scenes=found.scenes?.map(normalizeScene);
  const normalizations=[];
  if(found.path!=='root.scenes')normalizations.push('已读取 '+found.path+' 中的分镜数据。');
  if(scenes?.length){
    const missing=scenes.filter(s=>record(s)&&s.duration===undefined);
    if(missing.length){
      const specified=scenes.reduce((sum,s)=>sum+(Number.isFinite(s?.duration)?s.duration:0),0),remaining=Math.max(missing.length,targetDuration-specified);
      const weight=missing.reduce((sum,s)=>sum+Math.max(1,s.narration.length),0);
      for(const scene of missing)scene.duration=Math.max(1,remaining*Math.max(1,scene.narration.length)/weight);
      normalizations.push('未提供时长的镜头按实际文案长度安排时间。');
    }
  }
  const sources=containers.map(v=>first(v,['sources','references','资料','来源'])).find(Array.isArray)||[];
  const visualBible=containers.map(v=>first(v,['visualBible','视觉设定'])).find(record);
  return {object:{title:field(['title','videoTitle','video_title','name','标题','片名','视频标题'])||(scenes?.length?words(topic):''),summary:field(['summary','synopsis','核心结论','概要','摘要']),scenes,sources,visualBible},normalizations};
}

export function describeStoryboardShape(input){
  if(Array.isArray(input))return '顶层为镜头数组（'+input.length+'项）';
  if(record(input))return '顶层字段：'+Object.keys(input).slice(0,12).map(k=>k.slice(0,50)).join('、');
  return '顶层类型：'+typeof input;
}
