import * as engine from './engine.js';
import * as api from './api-client.js';
import {validateFilmProgram,filmFingerprint} from './film-program.js';
import {renderProjectFrame,inspectFilmProgram,FILM_SKILL} from './film-runtime.js';
import {DURATION_PRESETS,RATIO_PRESETS,STYLE_PRESETS,MAX_PROJECT_DURATION,getDimensions,getStyle,normalizeRatio,normalizeStyle} from './presets.js';
import {validateComposition,compositionFingerprint} from './composition.js';
import {createReferenceDemo} from './demos.js';
import {BIRTHDAY_BRIEF} from './briefs.js';
import {analyzeMusicFile,snapCompositionToBeats} from './beat.js';

const $ = (id) => document.getElementById(id);
const all = (selector) => Array.from(document.querySelectorAll(selector));
const clone = (value) => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const STORAGE = 'jianzhi-project-v1';
const PREFS = 'jianzhi-preferences-v1';
const defaultConfigs = {
  text: { provider: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: '' },
  speech: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'speech-2.8-hd', apiKey: '' },
  video: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'MiniMax-H3', apiKey: '' }
};
let configs = clone(defaultConfigs);
let rules = [];
let undoStack = [];
let project;
let selectedIndex = 0;
let currentTime = 0;
let playing = false;
let playStarted = 0;
let lastFrame = -1;
let selectedMode = 'code';
let selectedRatio = '9:16';
let selectedStyle = 'noir';
let muted = false;
let busy = false;
let renderNeeded = true;
let audioController = null;
let toastTimer;
let sceneVideoURL = '';
let objectURLs = new Set();
let currentVideoClip = null;
let activeAbort = null;
let hasGenerated = false;
let playbackToken = 0;
let preparingPlayback = false;
let generation = {stage:'idle',started:0,total:0,completed:0,failed:0,detail:'',measurable:false};
let generationTimer = null;

try {
  const savedRules = JSON.parse(localStorage.getItem(PREFS) || '[]');
  if (Array.isArray(savedRules)) rules = savedRules.filter((r) => typeof r === 'string').slice(0, 30);
} catch {}

function initialProject() {
  return createReferenceDemo({duration:90,ratio:'16:9',style:'noir',settings:{voice:false}});
}
function validProject(value) {
  const builtinKinds = new Set(['intro','fair','grid','seven','twelve','simulation','independence','outro','coinIntro','coinToss','coinTree','coinPaths','coinTwo','coinFreq','coinMemory','coinOutro','lawSmall','lawGap']);
  if(value?.brief!==undefined&&(typeof value.brief!=='string'||value.brief.length>18000))return false;
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.scenes) || !value.scenes.length || value.scenes.length > 60 || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_PROJECT_DURATION) return false;
  const ids = new Set();
  let total = 0;
  for (const s of value.scenes) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.title !== 'string' || typeof s.narration !== 'string' || typeof s.kind !== 'string' || !Number.isFinite(s.start) || s.start < 0 || !Number.isFinite(s.duration) || s.duration < 0.25 || s.duration > 180) return false;
    if (!builtinKinds.has(s.kind) && !(s.kind.startsWith('script:') && engine.SCRIPT_KINDS.includes(s.kind.slice(7)))) return false;
    if (Math.abs(s.start - total) > 0.15) return false;
    if(s.composition){try{validateComposition(s.composition);}catch{return false;}}
    if(s.program){try{validateFilmProgram(s.program);}catch{return false;}}
    if(s.draftProgram){try{validateFilmProgram(s.draftProgram);}catch{return false;}}
    if(s.thumbnail!==undefined&&(typeof s.thumbnail!=='string'||s.thumbnail.length>350000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.thumbnail)))return false;
    ids.add(s.id); total += s.duration;
  }
  return Math.abs(total - value.duration) < 0.15;
}
function recoverRenderStates(p){
  if(p.isDemo)return;
  for(const scene of p.scenes){
    if(scene.renderState==='generating'){
      scene.renderState='pending';scene.renderError='上次生成已中断，填写 API Key 后可继续补齐。';
    }else if(!scene.composition&&!scene.program&&(!scene.renderState||scene.renderState==='complete')){
      scene.renderState='pending';scene.renderError='此镜尚无独立画面，点击逐镜设计升级。';
    }else if((scene.composition||scene.program)&&!scene.renderState)scene.renderState='complete';
  }
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
  project = validProject(saved) ? saved : initialProject();
} catch { project = initialProject(); }
project.settings = Object.assign({ voice: true, captions: true, music: true }, project.settings || {});
project.history = Array.isArray(project.history) ? project.history : [];
if(project.isDemo&&project.topic==='生日悖论')currentTime=1;
recoverRenderStates(project);
if(!(project.musicBlob instanceof Blob))delete project.musicAnalysis;
hasGenerated = project.generatedFromApi === true;
selectedRatio = normalizeRatio(project.ratio);
selectedStyle = normalizeStyle(project.style);
selectedMode = ['code', 'ai', 'mixed'].includes(project.mode) ? project.mode : 'code';

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function initializePresets(){
  $('durationSelect').replaceChildren(...DURATION_PRESETS.map(item=>new Option(item.label,String(item.seconds))));
  $('ratioSelect').replaceChildren(...RATIO_PRESETS.map(item=>new Option(item.label,item.id)));
  const container=$('stylePresets');container.replaceChildren();
  STYLE_PRESETS.forEach((style,index)=>{
    const button=el('button','style-card');button.type='button';button.dataset.style=style.id;button.title=style.description;
    const art=el('span','style-art');art.style.background=style.palette.bg;art.style.color=style.palette.gold||style.palette.accent;art.style.border='1px solid '+(style.palette.faint||'#ccc');
    const glyph=el('b','',['1 / 6','∞','⟨/⟩','↗','Aa','✦','○','01'][index]||'Aa');glyph.style.fontFamily=style.fontFamily==='mono'?'monospace':style.fontFamily==='serif'?'Georgia,serif':'system-ui,sans-serif';
    const tiny=el('em','',style.texture||'VISUAL STORY');art.append(glyph,tiny);
    const label=el('span','style-name',style.label);label.append(el('span','','✓'));button.append(art,label);container.append(button);
  });
}
function artReady(scene){return !!(scene.program||scene.composition)&&scene.renderState==='complete';}
function artMissing(p=project){return p.scenes.filter(scene=>!artReady(scene));}
function fullVideo(scene,p=project){return (p.videoClips||[]).some(clip=>clip.sceneId===scene.id&&clip.blob instanceof Blob&&Number(clip.start)<=scene.start+.05&&Number(clip.start)+Number(clip.duration)>=scene.start+scene.duration-.05);}
function missingFrames(p=project){return p.scenes.filter(scene=>!artReady(scene)&&!fullVideo(scene,p));}
function setGenerationProgress({stage,total=0,completed=0,failed=0,detail='',measurable=false,newRun=false}){
  if(newRun||!generation.started){generation.started=Date.now();$('generationElapsed').textContent='已用时 00:00';}
  generation={...generation,stage,total,completed,failed,detail,measurable};
  $('generationPanel').hidden=false;
  $('generationTitle').textContent=stage;
  $('generationDetail').textContent=detail;
  const bar=$('generationBar'),percent=total?Math.floor(completed/total*100):0;
  bar.classList.toggle('indeterminate',!measurable);bar.classList.toggle('failed',failed>0);
  if(measurable){bar.setAttribute('aria-valuenow',String(percent));bar.setAttribute('aria-valuetext',`${completed} / ${total} 镜完成`);$('generationFill').style.width=percent+'%';$('generationPercent').textContent=`${completed} / ${total} 镜 · ${percent}%`;}
  else{bar.removeAttribute('aria-valuenow');bar.setAttribute('aria-valuetext','等待模型实际响应');$('generationFill').style.width='';$('generationPercent').textContent='等待模型响应';}
  if(!generationTimer)generationTimer=setInterval(()=>{$('generationElapsed').textContent='已用时 '+formatTime((Date.now()-generation.started)/1000);},1000);
  $('cancelGenerationButton').hidden=false;$('generationNext').hidden=true;
}
function finishGeneration(message,{cancelled=false}={}){
  if(!generation.started)generation.started=Date.now();
  clearInterval(generationTimer);generationTimer=null;
  $('generationElapsed').textContent='已用时 '+formatTime((Date.now()-generation.started)/1000);
  if(!generation.measurable)$('generationPercent').textContent=generation.stage==='idle'?'尚未开始':'未完成';
  $('generationTitle').textContent=cancelled?'生成已取消，已完成画面已保留':message;
  $('cancelGenerationButton').hidden=true;$('generationBar').classList.remove('indeterminate');
  const missing=artMissing();
  if(project.isDemo){$('generationNext').hidden=true;$('generationDetail').textContent='尚未完成新的分镜生成，原内置示意保留。';if(!generation.measurable)$('generationPercent').textContent='未完成';return;}
  $('generationNext').hidden=false;
  $('resumeArtButton').hidden=missing.length===0;
  $('resumeArtButton').textContent=`补齐 ${missing.length} 镜代码画面`;
  $('batchAIButton').hidden=project.mode==='code';
  const aiDone=new Set((project.videoClips||[]).map(clip=>clip.sceneId)).size;
  $('generationNextText').textContent=missingFrames().length?`${missingFrames().length} 镜仍缺少完整画面，未使用重复模板代替。可查看原因并重试，也可生成覆盖该镜的 AI 视频。`:missing.length?'当前画面已齐，可导出。部分镜头使用真实 AI 视频，代码画面可按需补齐。':project.mode==='code'?'代码画面已就绪；配音可按需生成，点击导出后才会生成视频文件。':`代码预览已就绪，已有 ${aiDone} 个 AI 视频镜头。选择下方动作才会调用 MiniMax-H3；代码预览不代表 AI 视频已经生成。`;
}
function sceneArtPayload(target,index){
  const source=target.scenes[index];
  return {scene:{title:source.title,narration:source.narration,caption:source.caption,duration:source.duration,kind:source.kind,visual:source.visual},index,sceneCount:target.scenes.length,project:{title:target.title,topic:target.topic,summary:target.summary||'',duration:target.duration,ratio:target.ratio,style:target.style,brief:target.brief||'',scenes:target.scenes.map(scene=>({title:scene.title,kind:String(scene.kind||'process').replace(/^script:/,''),visual:scene.visual}))},previousDesigns:target.scenes.filter((scene,i)=>i!==index&&artReady(scene)).map(scene=>({layout:(scene.program||scene.composition).layout,designIntent:(scene.program||scene.composition).designIntent,fingerprint:scene.program?filmFingerprint(scene.program):compositionFingerprint(scene.composition)})),preferences:(source.artInstruction?'当前镜头修改要求：'+source.artInstruction+'\n':'')+rules.join('\n'),beatTimes:canApplyMusicBeat(target)?target.musicAnalysis.beats.filter(t=>t>=source.start&&t<source.start+source.duration).map(t=>t-source.start):[],referenceStyle:'独立构图、真实物件结构、关系与数量随推演变化；黑金参考采用衬线字、细线、暖光与克制尘点。禁止重复圆点仅换标签。'};
}
function canApplyMusicBeat(p=project){return p.musicBlob instanceof Blob&&p.musicAnalysis?.reliable===true&&Number(p.musicAnalysis.confidence)>=.6&&Array.isArray(p.musicAnalysis.beats)&&p.musicAnalysis.beats.length>=4;}
function refreshMusicAnalysisStatus(){
  const status=$('musicAnalysisStatus'),button=$('alignMusicButton');if(!status||!button)return;
  if(!(project.musicBlob instanceof Blob)){status.textContent='未上传配乐，尚未分析音乐节拍。默认程序配乐不冒充已分析的音乐。';button.hidden=true;return;}
  const analysis=project.musicAnalysis;
  if(!analysis){status.textContent='已上传配乐，节拍尚未完成分析；不会强制卡点。';button.hidden=true;return;}
  const score=Math.round(Math.max(0,Math.min(1,Number(analysis.confidence)||0))*100),bpm=Number.isFinite(Number(analysis.bpm))&&Number(analysis.bpm)>0?'估计约 '+Math.round(Number(analysis.bpm))+' BPM · ':'';
  status.textContent=canApplyMusicBeat()?bpm+'节拍评分 '+score+'/100，节拍较清晰；后续绘制会轻度对齐，保留原有推演。':bpm+'节拍评分 '+score+'/100，当前节拍不够稳定；保留原时序，不强制卡点。';
  button.hidden=!canApplyMusicBeat()||!project.scenes.some(artReady);button.disabled=busy;
}
function applyMusicBeatToCurrentScenes(){
  if(busy)return toast('请等当前任务完成。');
  if(!canApplyMusicBeat())return toast('当前没有可靠的已上传音乐节拍，保留原画面时序。');
  pause();pushUndo();let count=0;
  for(const scene of project.scenes){if(!artReady(scene)||!scene.composition)continue;const candidate=snapCompositionToBeats(scene.composition,scene.start,scene.duration,project.musicAnalysis);scene.composition=validateComposition(candidate);count++;}
  markChanged();toast('已在本地轻度对齐 '+count+' 镜声明式画面的邻近节拍；新代码镜头在生成时读取节拍，可选重做当前镜头。');
}
function applyBirthdayBrief(){
  if(busy)return toast('请等当前任务完成后再套用方案。');
  $('topicInput').value='23个人中，至少两个人生日相同的概率为什么超过50%？';$('durationSelect').value='120';selectedRatio='16:9';selectedStyle='noir';selectedMode='code';$('ratioSelect').value=selectedRatio;
  all('[data-style]').forEach(button=>{button.classList.toggle('selected',button.dataset.style===selectedStyle);button.setAttribute('aria-pressed',String(button.dataset.style===selectedStyle));});
  $('styleDescription').textContent=getStyle(selectedStyle).description;setMode(selectedMode);
  $('briefInput').value=String(BIRTHDAY_BRIEF).slice(0,18000);$('creativeBriefDetails').open=true;$('topicHint').textContent='生日悖论方案已填入 · 点击生成才替换当前项目';toast('方案已填入：120 秒、16:9、黑金叙事。当前项目和媒体尚未改变。');
}
function checkSceneFrame(target,index,composition){
  const size=getDimensions(target.ratio,{preview:true}),scale=Math.min(1,360/Math.max(size.width,size.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(size.width*scale));canvas.height=Math.max(2,Math.round(size.height*scale));
  const candidate={...target,scenes:target.scenes.map((scene,i)=>i===index?{...scene,composition,renderState:'complete'}:scene)};
  for(const phase of [.28,.72])engine.drawFrame(canvas.getContext('2d'),candidate,target.scenes[index].start+target.scenes[index].duration*phase,canvas.width,canvas.height);
}
async function renderSceneArts(target,indices,{signal,stage='正在逐镜设计代码画面'}={}){
  if(indices.length>3){const difficulty=i=>(target.scenes[i].visual?.heroObjects?.length||0)*3+(target.scenes[i].visual?.beats?.length||0)+String(target.scenes[i].visual?.action||'').length/100;const hardest=[...indices].sort((a,b)=>difficulty(b)-difficulty(a))[0];indices=[hardest,...indices.filter(i=>i!==hardest)];}
  let cursor=0;
  const reviewRounds=Math.max(0,Math.min(2,Number($('reviewRoundsSelect').value)||0));
  const states=new Map(indices.map(index=>[index,'pending']));
  const update=detail=>setGenerationProgress({stage,total:indices.length,completed:[...states.values()].filter(v=>v==='complete').length,failed:[...states.values()].filter(v=>v==='failed').length,detail,measurable:true});
  indices.forEach(index=>{target.scenes[index].renderState='pending';delete target.scenes[index].renderError;});
  update('vibe-knowledge-film：为每镜现写代码，再渲染检查和看图返修。完成一镜即可预览。');
  async function worker(){
    while(cursor<indices.length&&!signal?.aborted){
      const index=indices[cursor++],scene=target.scenes[index];scene.renderState='generating';states.set(index,'generating');update(`正在绘制镜头 ${index+1}「${scene.title}」`);updateProjectUI();
      try{
        const context=sceneArtPayload(target,index);
        const rounds=reviewRounds;
        const renderScene={...scene,renderDuration:undefined,sourceOffset:0,beatTimes:context.beatTimes};
        update(`镜头 ${index+1}「${scene.title}」· 正在独立编写动画代码`);
        let program,inspection,reviews=[],usage=[];
        if(scene.draftProgram&&scene.draftMeta){
          program=validateFilmProgram(scene.draftProgram);reviews=scene.draftMeta.reviews||[];usage=scene.draftMeta.usage||[];
          update(`镜头 ${index+1} · 恢复已完成代码，继续剩余视觉返修`);
        }else{
          const raw=await api.generateSceneCode(configs.text,context,{signal});
          program=validateFilmProgram(raw.program);usage=[raw.usage];
        }
        update(`镜头 ${index+1} · 正在渲染三个时刻并检查确定性`);
        inspection=await inspectFilmProgram(program,renderScene,target,{signal});
        scene.draftProgram=program;scene.draftThumbnail=inspection.thumbnail;scene.draftMeta={reviews,usage};saveLocal();
        updateProjectUI();
        for(let round=reviews.length+1;round<=rounds;round++){
          update(`镜头 ${index+1} · 第 ${round} / ${rounds} 轮看图返修（真实模型请求）`);
          const revised=await api.reviewSceneCode(configs.text,{...context,program,frames:inspection.frames,round},{signal});
          program=validateFilmProgram(revised.program);usage.push(revised.usage);
          update(`镜头 ${index+1} · 验证第 ${round} 轮返修后的实际画面`);
          inspection=await inspectFilmProgram(program,renderScene,target,{signal});
          reviews.push({round,feedback:revised.feedback,stats:inspection.stats});
          scene.draftProgram=program;scene.draftThumbnail=inspection.thumbnail;scene.draftMeta={reviews,usage};saveLocal();updateProjectUI();
        }
        if(project!==target)throw new Error('项目已切换，未应用旧任务结果。');
        const fingerprint=filmFingerprint(program);
        if(target.scenes.some((other,i)=>i!==index&&artReady(other)&&other.program&&filmFingerprint(other.program)===fingerprint))throw new Error('此镜画面代码与已有镜头重复，已拒绝仅换标签。');
        scene.program=program;delete scene.composition;delete scene.renderDuration;scene.sourceOffset=0;scene.beatTimes=context.beatTimes;scene.thumbnail=inspection.thumbnail;
        scene.renderState='complete';target.isDemo=false;target.generatedFromApi=true;hasGenerated=true;
        scene.artMeta={fingerprint,usage,reviews,reviewRounds:rounds,skill:FILM_SKILL,frameStats:inspection.stats};
        delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;delete scene.renderError;states.set(index,'complete');
        if(!playing&&selectedIndex===index&&currentTime<=scene.start+.02)currentTime=scene.start+Math.min(1,scene.duration*.12);
      }catch(error){
        scene.renderState=signal?.aborted||error.name==='AbortError'?'pending':'failed';scene.renderError=signal?.aborted?'生成已取消，可继续生成。':error.message;states.set(index,scene.renderState);
      }
      saveLocal();updateProjectUI();update(`已完成 ${[...states.values()].filter(v=>v==='complete').length} / ${indices.length} 镜。${[...states.values()].some(v=>v==='failed')?'失败镜头保留原因，可单独重试。':'每镜完成后均经过实际静帧、运动和所选轮数的视觉返修。'}`);
    }
  }
  await Promise.all(Array.from({length:Math.min(1,indices.length)},worker));
  if(signal?.aborted)indices.forEach(index=>{if(!artReady(target.scenes[index])&&target.scenes[index].renderState!=='failed'){target.scenes[index].renderState='pending';target.scenes[index].renderError='生成已取消，可继续生成。';}});
  updateProjectUI();saveLocal();
  finishGeneration(artMissing(target).length?'部分画面未完成，可逐镜重试':'代码画面已就绪',{cancelled:!!signal?.aborted});
}
async function retrySceneArt(indices,{instruction=''}={}){
  if(busy)return;
  if(!indices.length)return toast('所有镜头的代码画面都已完成。');
  if(!canUse('text'))return showServiceConfig('text','逐镜画面设计需要填写 DeepSeek API Key。');
  const target=project;pause();pushUndo();if(instruction)indices.forEach(index=>{const scene=target.scenes[index];scene.artInstruction=instruction;delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;});activeAbort=new AbortController();setBusy(true,'正在设计镜头画面…');
  setGenerationProgress({stage:'准备逐镜画面设计',newRun:true,detail:'保留其他已完成镜头，不重复请求它们。'});
  try{await renderSceneArts(target,indices,{signal:activeAbort.signal,stage:indices.length===1?'正在重新设计当前镜头':'正在补齐未完成画面'});}
  finally{setBusy(false);activeAbort=null;updateProjectUI(false);}
}

function formatTime(t) {
  t = Math.max(0, Number(t) || 0);
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0');
}
function toast(message, error = false) {
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 4200);
}
function serializable(p) {
  return JSON.parse(JSON.stringify(p, (key, value) => {
    if (['voiceBlob', 'musicBlob', 'voiceClips', 'videoClips'].includes(key) || value instanceof Blob) return undefined;
    return value;
  }));
}
function saveLocal() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(serializable(project)));
    $('saveState').lastChild.textContent = '已保存到本机';
  } catch {
    $('saveState').lastChild.textContent = '本机储存不可用';
  }
}
function pushUndo() {
  undoStack.push({ project: clone(project), selectedIndex, currentTime });
  if (undoStack.length > 20) undoStack.shift();
  $('undoButton').disabled = false;
}
function getScene() {
  return project.scenes[Math.min(selectedIndex, project.scenes.length - 1)];
}
function locateScene(t) {
  const result = engine.getSceneAt(project, t);
  if (typeof result === 'number') return { scene: project.scenes[result], index: result };
  if (result && result.scene) return result;
  const index = project.scenes.findIndex((s) => s.id === result?.id);
  return { scene: result || project.scenes[0], index: Math.max(0, index) };
}
function reflow() {
  let start = 0;
  project.scenes.forEach((scene) => { scene.start = start; start += scene.duration; });
  project.duration = Number(start.toFixed(3));
}
function markChanged() {
  renderNeeded = true;
  saveLocal();
  updateProjectUI();
}
function setBusy(value, message) {
  busy = value;
  $('generateButton').disabled = value;
  $('reviewRoundsSelect').disabled=value;
  $('reviseButton').disabled = value;
  $('sceneVideoButton').disabled = value;
  $('speechButton').disabled = value;
  $('retrySceneButton').disabled=value;
  $('resumeArtButton').disabled=value;
  $('batchAIButton').disabled=value;
  if (message) $('projectStatus').textContent = message;
}
function canUse(type) {
  return !!(configs[type]?.baseURL && configs[type]?.model && configs[type]?.apiKey);
}
async function getAudio() {
  if (!audioController) {
    const module = await import('./audio.js');
    audioController = module.createAudioController();
  }
  return audioController;
}
async function stopAudio() {
  if (audioController) audioController.pause();
}
async function syncAudio() {
  if (!playing || muted) return stopAudio();
  try { await (await getAudio()).start(project, currentTime); }
  catch (error) { toast('音轨未能播放：' + error.message, true); }
}
async function refreshPlayingAudio() {
  const wasPlaying = playing;
  if (!wasPlaying) return;
  pause();
  await togglePlay();
}
function setPlayIcon() {
  $('playButton').replaceChildren(icon(playing ? 'pause' : 'play'));
  $('playButton').classList.toggle('playing', playing);
  $('playButton').setAttribute('aria-label', playing ? '暂停' : '播放');
  $('canvasWrap').classList.toggle('playing', playing);
}
function pause() {
  playbackToken++;
  preparingPlayback = false;
  playing = false;
  stopAudio();
  $('clipPreview').pause();
  setPlayIcon();
}
async function togglePlay() {
  if (preparingPlayback) return pause();
  if (playing) return pause();
  if (currentTime >= project.duration - 0.05) currentTime = 0;
  const token = ++playbackToken;
  const targetProject = project;
  preparingPlayback = true;
  $('playButton').setAttribute('aria-label', '正在准备音轨，点击可取消');
  try {
    if (!muted) await (await getAudio()).start(project, currentTime);
  } catch (error) { toast('音轨暂不可用，将继续播放画面：' + error.message, true); }
  if (token !== playbackToken || project !== targetProject) { stopAudio(); preparingPlayback = false; return; }
  preparingPlayback = false;
  playing = true;
  playStarted = performance.now() - currentTime * 1000;
  setPlayIcon();
}
function seek(t, select = true) {
  currentTime = Math.max(0, Math.min(project.duration, Number(t) || 0));
  if (playing) playStarted = performance.now() - currentTime * 1000;
  if (select) {
    const index = locateScene(Math.min(currentTime, project.duration - 0.001)).index;
    if (index !== selectedIndex) { selectedIndex = index; renderInspector(); updateTimelineSelection(); }
  }
  if (audioController && playing && !muted) audioController.seek(currentTime).catch(() => {});
  renderNeeded = true;
  updateTransport();
}
function updateTransport() {
  $('currentTime').textContent = formatTime(currentTime);
  $('durationTime').textContent = formatTime(project.duration);
  $('seekSlider').max = String(project.duration);
  $('seekSlider').value = String(currentTime);
  $('seekSlider').style.background = 'linear-gradient(to right,#d88a68 ' + (currentTime / project.duration * 100) + '%,#dcdfd1 ' + (currentTime / project.duration * 100) + '%)';
}
function releaseClipURL() {
  if (sceneVideoURL) { URL.revokeObjectURL(sceneVideoURL); objectURLs.delete(sceneVideoURL); sceneVideoURL = ''; }
  currentVideoClip = null;
  $('clipPreview').removeAttribute('src');
  $('clipPreview').hidden = true;
}
function drawVideoCaption(ctx) {
  if (project.settings?.captions === false) return;
  const scene = locateScene(currentTime).scene;
  const cue = project.subtitles?.find((c) => currentTime >= c.start && currentTime < c.end);
  const text = engine.getCaptionText(project,currentTime);
  if (!text) return;
  const width = ctx.canvas.width, height = ctx.canvas.height;
  const fontSize = Math.round(width * (width < height ? 0.043 : 0.026));
  ctx.save(); ctx.font = '600 ' + fontSize + 'px system-ui,sans-serif';
  const lines = []; let line = '';
  for (const ch of String(text)) { if (ctx.measureText(line + ch).width > width * 0.84) { lines.push(line); line = ch; } else line += ch; }
  if (line) lines.push(line);
  const pages = Math.ceil(lines.length / 2);
  const progress = cue ? Math.min(0.999, Math.max(0, (currentTime - cue.start) / Math.max(0.01, cue.end - cue.start))) : Math.min(0.999, Math.max(0, (currentTime - scene.start) / scene.duration));
  const display = lines.slice(Math.floor(progress * pages) * 2, Math.floor(progress * pages) * 2 + 2);
  const y = height * 0.88 - display.length * fontSize * 1.3;
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(width * 0.05, y - fontSize * 0.8, width * 0.9, display.length * fontSize * 1.4 + fontSize);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; display.forEach((value, i) => ctx.fillText(value, width / 2, y + i * fontSize * 1.4)); ctx.restore();
}
function renderVideoPreview(ctx) {
  const clip = (project.videoClips || []).find((c) => c.blob instanceof Blob && currentTime >= c.start && currentTime < c.start + c.duration);
  const video = $('clipPreview');
  if (!clip) { if (currentVideoClip) releaseClipURL(); return; }
  if (clip !== currentVideoClip) {
    releaseClipURL();
    currentVideoClip = clip;
    sceneVideoURL = URL.createObjectURL(clip.blob);
    objectURLs.add(sceneVideoURL);
    video.src = sceneVideoURL;
  }
  video.hidden = true;
  const target = Math.max(0, currentTime - clip.start + (Number(clip.sourceOffset) || 0));
  if (Number.isFinite(video.duration) && target > video.duration - 0.05) return;
  if (Math.abs(video.currentTime - target) > 0.2) { try { video.currentTime = target; } catch {} }
  if (playing && video.paused) video.play().catch(() => {});
  if (!playing && !video.paused) video.pause();
  if (video.readyState >= 2 && video.videoWidth) {
    const scale = Math.max(ctx.canvas.width / video.videoWidth, ctx.canvas.height / video.videoHeight);
    const width = video.videoWidth * scale, height = video.videoHeight * scale;
    ctx.drawImage(video, (ctx.canvas.width - width) / 2, (ctx.canvas.height - height) / 2, width, height);
    drawVideoCaption(ctx);
  }
}
let previewRendering=false;
function animate(now) {
  requestAnimationFrame(animate);
  if (playing) {
    currentTime = (now - playStarted) / 1000;
    if (currentTime >= project.duration) { currentTime = project.duration; pause(); }
    const found = locateScene(Math.min(currentTime, project.duration - 0.001));
    if (found.index !== selectedIndex) { selectedIndex = found.index; renderInspector(); updateTimelineSelection(); }
    updateTransport();
  }
  const frame = Math.floor(currentTime * 30);
  if (!previewRendering&&(playing || renderNeeded || frame !== lastFrame)) {
    const canvas=$('previewCanvas'),time=currentTime,target=project,w=canvas.width,h=canvas.height;
    const staging=document.createElement('canvas');staging.width=w;staging.height=h;
    previewRendering=true;renderNeeded=false;lastFrame=frame;
    const current=engine.getSceneAt(target,time),hasClip=(target.videoClips||[]).some(c=>c.sceneId===current.scene.id&&c.blob instanceof Blob&&time>=c.start&&time<c.start+c.duration);
    const draw=hasClip?Promise.resolve(engine.drawFrame(staging.getContext('2d'),target,time,w,h)):renderProjectFrame(staging.getContext('2d'),target,time,w,h);
    draw.then(()=>{
      if(project!==target||canvas.width!==w||canvas.height!==h||Math.abs(currentTime-time)>(playing?.7:.04)){renderNeeded=true;return;}
      const ctx=canvas.getContext('2d');ctx.drawImage(staging,0,0);renderVideoPreview(ctx);
    }).catch(error=>{
      if(project!==target)return;
      if(playing)pause();
      $('previewNote').lastChild.textContent='代码预览失败：'+error.message+' 可重新设计当前镜头。';
    }).finally(()=>{previewRendering=false;});
  }
}
function renderTimeline() {
  const track = $('timelineTrack');
  track.replaceChildren();
  project.scenes.forEach((scene, index) => {
    const button = el('button', 'shot-card');
    button.setAttribute('aria-label', '镜头 ' + (index + 1) + '：' + scene.title);
    button.dataset.index = String(index);
    button.dataset.renderState=scene.renderState||'legacy';
    const number = el('span', 'shot-number', String(index + 1).padStart(2, '0'));
    const canvas = el('canvas', 'shot-thumb');
    canvas.width = 192; canvas.height = 108;
    try { const size=getDimensions(project.ratio);const mini=document.createElement('canvas');const scale=Math.min(192/size.width,108/size.height);mini.width=Math.max(2,Math.round(size.width*scale));mini.height=Math.max(2,Math.round(size.height*scale));engine.drawFrame(mini.getContext('2d'),{...project,settings:{...project.settings,captions:false}},scene.start+scene.duration*.45,mini.width,mini.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#161b1b';ctx.fillRect(0,0,192,108);ctx.drawImage(mini,(192-mini.width)/2,(108-mini.height)/2); } catch {}
    const thumb=scene.thumbnail||scene.draftThumbnail;
    if(thumb&&/^data:image\/jpeg;base64,/.test(thumb)){const image=new Image();image.onload=()=>{const ctx=canvas.getContext('2d'),scale=Math.min(192/image.width,108/image.height);ctx.fillStyle='#111';ctx.fillRect(0,0,192,108);ctx.drawImage(image,(192-image.width*scale)/2,(108-image.height*scale)/2,image.width*scale,image.height*scale);};image.src=thumb;}
    const meta = el('div', 'shot-meta');
    meta.append(el('strong', '', scene.title), el('span', '', Math.round(scene.duration) + 's'));
    const stateNames={pending:'待独立设计',generating:'画面设计中…',complete:'独立画面已完成',failed:'画面失败 · 可重试',legacy:'旧版通用示意'};const shotState=el('span','shot-state',project.isDemo?'内置动画示意':stateNames[scene.renderState]||'旧版通用示意');button.append(number, canvas, meta,shotState);
    button.addEventListener('click', () => { selectedIndex = index; seek(scene.start + Math.min(.8,scene.duration*.1), false); renderInspector(); updateTimelineSelection(); });
    track.append(button);
  });
  $('sceneCount').textContent = project.scenes.length + ' 个镜头';
  updateTimelineSelection();
}
function updateTimelineSelection() {
  all('.shot-card').forEach((card) => {
    const selected = Number(card.dataset.index) === selectedIndex;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
}
function renderInspector() {
  const scene = getScene();
  if (!scene) return;
  $('sceneNumber').textContent = '镜头 ' + String(selectedIndex + 1).padStart(2, '0');
  $('sceneRange').textContent = formatTime(scene.start) + ' – ' + formatTime(scene.start + scene.duration);
  $('sceneTitle').value = scene.title;
  $('sceneDuration').value = String(Number(scene.duration.toFixed(2)));
  const program=scene.program||scene.draftProgram;
  $('sceneCodeDetails').hidden=!program;
  $('sceneCodeSource').textContent=program?.source||'';
  const checks=scene.artMeta?.reviews||scene.draftMeta?.reviews||[];
  $('sceneCodeChecks').textContent=program?(scene.renderState==='complete'?'已完成':'草稿 · 尚在制作')+' · '+checks.length+' 轮看图返修\n'+checks.map(r=>'第 '+r.round+' 轮：'+r.feedback).join('\n'):'';

  $('sceneNarration').value = scene.narration || scene.caption || '';
  $('sceneVersion').textContent = scene.revision ? '修改版本 ' + scene.revision : project.isDemo ? '交互示意' : '原始版本';
  $('undoButton').disabled = undoStack.length === 0;
  $('revisionResult').hidden = true;
  const clips = (project.videoClips || []).filter((c) => c.sceneId === scene.id);
  const voices = (project.voiceClips || []).filter((c) => c.sceneId === scene.id);
  $('mediaStatus').textContent = (scene.renderError?'代码画面：'+scene.renderError+' ':artReady(scene)?'独立代码画面已完成。 ':'代码画面尚未完成。 ') + (clips.length?'此镜已有 AI 视频。 ':'此镜尚无 AI 视频。 ')+(voices.length?'已有配音。':'旁白可按需生成。');
  $('retrySceneButton').textContent=artReady(scene)?'重新设计此镜代码画面':'生成 / 重试此镜代码画面';
  $('sceneVideoButton').disabled = busy;
}
function updateProjectUI(renderShots = true) {
  selectedIndex = Math.min(selectedIndex, project.scenes.length - 1);
  const size=getDimensions(project.ratio,{preview:true}),full=getDimensions(project.ratio);
  const canvas=$('previewCanvas');if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;}
  $('canvasWrap').style.aspectRatio=full.width+' / '+full.height;$('canvasWrap').classList.toggle('landscape-preview',full.width>full.height);
  $('stageLabel').textContent=full.width+' × '+full.height;
  const missing=missingFrames(),modeName={code:'代码动画',ai:'AI 影像',mixed:'混合制作'}[project.mode]||'代码动画',aiCount=new Set((project.videoClips||[]).map(c=>c.sceneId)).size;
  $('previewBadge').textContent=project.isDemo?'内置示意 · 未生成':missing.length?`${modeName} · ${missing.length} 镜待完成`:project.mode==='code'&&!artMissing().length?'独立代码画面':`代码 / AI 画面 · ${aiCount} 镜 AI 视频`;
  $('previewNote').lastChild.textContent=project.isDemo?'当前是内置示意。新创作按 vibe-knowledge-film 流程逐镜写代码，并根据实际画面返修。':missing.length?'分镜已生成，画面仍在逐镜制作；未完成的镜头不会用旧模板冒充。':project.mode==='code'&&!artMissing().length?'独立代码画面已就绪；导出时逐帧渲染并合成配音、配乐和字幕。':`当前已有 ${aiCount} 镜真实 AI 视频，其余使用已完成代码画面；可按需继续生成。`;
  if(!busy)$('projectStatus').textContent=project.isDemo?'当前为内置示意，尚未调用 API':missing.length?`${project.scenes.length-missing.length} / ${project.scenes.length} 镜画面完成`:`画面已就绪 · ${project.scenes.length} 镜`;
  refreshMusicAnalysisStatus();
  $('voiceToggle').checked=!!project.settings.voice;$('captionsToggle').checked=!!project.settings.captions;$('musicToggle').checked=!!project.settings.music;
  updateTransport();renderInspector();if(renderShots)renderTimeline();renderNeeded=true;
}

function syncForm() {
  $('topicInput').value=project.topic||project.title;
  $('briefInput').value=typeof project.brief==='string'?project.brief:'';
  $('durationSelect').value=String(DURATION_PRESETS.reduce((a,b)=>Math.abs(b.seconds-project.duration)<Math.abs(a.seconds-project.duration)?b:a).seconds);
  $('ratioSelect').value=selectedRatio;
  all('[data-style]').forEach(b=>{b.classList.toggle('selected',b.dataset.style===selectedStyle);b.setAttribute('aria-pressed',String(b.dataset.style===selectedStyle));});
  $('styleDescription').textContent=getStyle(selectedStyle).description;
  setMode(selectedMode);
}

function setMode(mode) {
  selectedMode = mode;
  all('[data-mode]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  const descriptions = {
    code: 'vibe-knowledge-film：每镜现写动画代码，渲染后看图返修。适合精确推演、公式与数量关系，成本主要是文本模型调用。',
    ai: '先生成脚本，再按镜头调用视频模型。字幕独立合成，避免画面文字出错。',
    mixed: '代码演示知识，AI 镜头补充氛围。先出脚本，再选择需要 AI 的镜头。'
  };
  $('modeDescription').textContent = descriptions[mode];
  $('generateButton').querySelector('span').textContent = '生成分镜与代码画面';
}
function openModal(title, content, eyebrow = 'VIBE STUDIO') {
  $('modalTitle').textContent = title;
  $('modalEyebrow').textContent = eyebrow;
  $('modalContent').replaceChildren();
  if (typeof content === 'string') $('modalContent').innerHTML = content;
  else if (content) $('modalContent').append(content);
  if (!$('modal').open) $('modal').showModal();
}
function closeModal() { $('modal').close(); }
function showModes() {
  openModal('选择画面如何产生', '<p class="modal-copy">三种方式都可以由 AI 辅助。差别在于画面如何制作，用户都不需要写代码。</p><div class="mode-explanation"><svg><use href="#i-code"/></svg><div><h3>代码动画 · 精确地演示知识</h3><p>先编排分镜，再为每镜重新编写动画 JavaScript。使用 vibe-knowledge-film 引擎实际渲染，并将静帧送回视觉模型检查、修改；数字和关系可以精确演示。</p><em>需要文本 API；本地渲染不调用视频模型。</em></div></div><div class="mode-explanation"><svg><use href="#i-image"/></svg><div><h3>AI 影像 · 表现人物和场景</h3><p>视频模型按描述生成短镜头。适合历史氛围、自然场景和想象画面，细节、数量和运动较难精确控制。</p><em>需要视频 API；按镜头付费，失败或重试也可能计费。</em></div></div><div class="mode-explanation"><svg><use href="#i-layers"/></svg><div><h3>混合制作 · 图解与影像配合</h3><p>代码负责核心推演，AI 画面负责氛围。你可以选中单个镜头生成影像，并保留其余代码动画。</p><em>需要文本 API；使用 AI 镜头时另需视频 API。</em></div></div><div class="modal-callout">所有模式都支持中文字幕、配音和配乐。代码动画的精美程度来自动画设计，连续推演比文字翻页更有解释力。</div>');
}
function showLibrary() {
  if (busy) return toast('请等当前任务完成后再更换项目。');
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', 'modal-copy', '先用内置示意体验动画节奏。选择选题只会载入交互示意；点击生成才会调用你配置的文本 API。'));
  const grid = el('div', 'library-grid');
  const reference=el('button','library-card reference-demo-card');reference.append(el('span','library-art','23 → 253'),el('strong','','生日悖论 · 参考风格示意'),el('small','','独立实时绘制：衬线排版、逐步连线、分式与概率曲线。非模型生成结果，不含上传视频素材。'));
  reference.addEventListener('click',()=>{pause();pushUndo();project=createReferenceDemo({duration:Number($('durationSelect').value)||90,ratio:selectedRatio,style:selectedStyle});selectedIndex=0;currentTime=1;hasGenerated=false;releaseClipURL();syncForm();updateProjectUI();saveLocal();closeModal();toast('已载入新引擎的参考风格示意，未调用 API。');});grid.append(reference);
  [{ topic: '为什么两个骰子，7 最容易出现？', key: '骰子与概率', art: '⚄', desc: '36 种组合，展开一眼看懂的概率' }, { topic: '抛硬币真的一半一半吗？', key: '抛硬币', art: '½', desc: '让随机试验逐步显现长期规律' }, { topic: '为什么次数越多，频率越稳定？', key: '大数定律', art: '∞', desc: '从少量偶然走向大量试验' }].forEach((item) => {
    const card = el('button', 'library-card');
    card.append(el('span', 'library-art', item.art), el('strong', '', item.topic), el('small', '', item.desc));
    card.addEventListener('click', () => {
      pause(); project = engine.createProject({ topic: item.key, duration: Number($('durationSelect').value), ratio: selectedRatio, style: selectedStyle });
      project.isDemo = true; project.generatedFromApi = false; hasGenerated = false; selectedIndex = 0; currentTime = 0; undoStack = [];
      $('topicInput').value = item.topic;
      updateProjectUI(); saveLocal(); closeModal(); toast('已载入交互示意，尚未调用 API');
    });
    grid.append(card);
  });
  fragment.append(grid);
  openModal('每个好奇，都值得看见', fragment, 'TOPIC EXPLORER');
}
function showServiceConfig(initialTab = 'text', note = '') {
  if (busy) return toast('当前任务执行中，请完成后再更换 API Key。');
  const fragment = document.createDocumentFragment();
  if (note) fragment.append(el('div', 'modal-callout', note));
  fragment.append(el('p', 'modal-copy', '模型与接口已配好，只需填写两个 API Key。MiniMax 的同一份密钥同时用于旁白和视频。密钥只保留在当前页面内存，刷新后清除。'));
  const fields = {};
  const forms = el('div', 'model-form');
  for (const item of [
    { id: 'deepseek', label: 'DeepSeek API Key', description: '文本与脚本 · DeepSeek V4.1 Flash', value: configs.text.apiKey },
    { id: 'minimax', label: 'MiniMax API Key', description: '配音 · speech-2.8-hd　视频 · MiniMax-H3', value: configs.speech.apiKey || configs.video.apiKey }
  ]) {
    const card = el('div', 'fixed-model-card');
    const label = el('label', '', item.label);
    const input = el('input'); input.type = 'password'; input.placeholder = '粘贴你的 ' + item.label; input.value = item.value; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 4096; input.setAttribute('aria-label', item.label);
    label.append(input); card.append(label, el('p', 'modal-copy', item.description)); forms.append(card); fields[item.id] = input;
  }
  const status = el('div', 'model-status', '尚未测试连接。测试不会提交视频或配音生成。');
  const readKeys = () => {
    configs.text = { ...defaultConfigs.text, apiKey: fields.deepseek.value.trim() };
    configs.speech = { ...defaultConfigs.speech, apiKey: fields.minimax.value.trim() };
    configs.video = { ...defaultConfigs.video, apiKey: fields.minimax.value.trim() };
  };
  const tests = el('div', 'modal-actions');
  for (const item of [{ id: 'deepseek', label: '测试 DeepSeek', type: 'text' }, { id: 'minimax', label: '测试 MiniMax', type: 'speech' }]) {
    const button = el('button', 'button secondary', item.label);
    button.addEventListener('click', async () => {
      readKeys();
      if (!configs[item.type].apiKey) { status.textContent = '请先填写 ' + (item.id === 'deepseek' ? 'DeepSeek' : 'MiniMax') + ' API Key。'; return fields[item.id].focus(); }
      button.disabled = true; status.textContent = '正在检查 ' + (item.id === 'deepseek' ? 'DeepSeek' : 'MiniMax') + ' 连接…';
      try { const result = await api.testConnection(configs[item.type], { capability: item.type }); status.textContent = result.message; }
      catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
    tests.append(button);
  }
  const actions = el('div', 'modal-actions');
  const save = el('button', 'button primary', '应用 API Key');
  save.addEventListener('click', () => {
    readKeys(); closeModal(); toast('API Key 已在本页生效，刷新后清除。');
    $('costNote').firstChild.textContent = canUse('text') ? 'DeepSeek V4.1 Flash 已配置 · 按实际用量付费' : '填写 API Key，即可生成你的知识短片';
  });
  actions.append(save);
  fragment.append(forms, status, tests, el('p', 'modal-copy', '请求由本站转发至对应官方服务。测试连接不代表余额和所有模型权限均已验证；费用由服务商按实际生成用量收取。'), actions);
  openModal('填写 API Key，就可以开始', fragment, 'YOUR MODELS, READY');
  queueMicrotask(() => fields[initialTab === 'text' ? 'deepseek' : 'minimax'].focus());
}
function getPrompt() {
  return '你是一位擅长视觉叙事的知识视频导演。\n\n主题：' + $('topicInput').value.trim() + '\n受众：普通成年人，无需专业背景\n目标时长：' + $('durationSelect').value + ' 秒\n画幅：' + selectedRatio + '\n风格：' + (getStyle(selectedStyle).label+'；'+getStyle(selectedStyle).description) + '\n制作方式：' + ({ code: '代码动画', ai: 'AI影像分镜', mixed: '代码推演与AI影像混合' }[selectedMode]) + '\n\n创作要求：\n1. 开头用一个问题或反直觉现象引发好奇。整片围绕一个主要结论。\n2. 每个知识点用物体运动、关系变化、模拟或数据累积来解释，避免整页文字翻页。\n3. 一镜一个主要视觉对象，镜头之间用形变、运动方向或视觉母题衔接。\n4. 旁白通俗，字幕简洁、最多两行；配乐不压过人声，重点动作配适量音效。\n5. 明确数学前提，核实事实和来源；模拟结果不能冒充精确理论值。\n6. 先输出结构化分镜，再为每镜独立设计具体物件、构图和关键帧；不以几个圆点换标签冒充新画面，按 vibe-knowledge-film 为每镜现写 Canvas 动画；隔离渲染并看图返修。\n\n导演说明：\n' + $('briefInput').value.trim() + '\n\n个人偏好：\n' + (rules.length ? rules.map((r, i) => (i + 1) + '. ' + r).join('\n') : '暂无；采用清晰、克制、有连续运动的视觉叙事。');
}
function showPrompt() {
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', '一句话已经整理成可编辑的专业创作要求。真正生成时，后端还会附加安全的分镜结构规范。'));
  const pre = el('pre', 'prompt-output', getPrompt()); frag.append(pre);
  const actions = el('div', 'modal-actions');
  const button = el('button', 'button primary', '复制提示词');
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(getPrompt()); toast('提示词已复制'); } catch { toast('浏览器未允许复制，可在文本区域手动选择复制', true); } });
  actions.append(button); frag.append(actions); openModal('把好奇整理成创作方案', frag, 'CREATIVE BRIEF');
}
async function generateProject(event) {
  event.preventDefault();if(busy)return;
  const topic=$('topicInput').value.trim();if(topic.length<2)return toast('先输入你想讲清楚的主题',true);
  if(!canUse('text'))return showServiceConfig('text','先填写 DeepSeek API Key。生成将依次请求分镜和每镜独立画面，不会把通用模板替换文字后当作完成。');
  pause();activeAbort=new AbortController();setBusy(true,'正在构思分镜…');
  setGenerationProgress({stage:'第一步 · 构思分镜',detail:'正在等待文本模型编排知识推演。此阶段没有可验证的百分比。',newRun:true});
  $('generateButton').querySelector('span').textContent='正在创作…';
  let storyboardApplied=false;
  try{
    const sourceMusic=project.musicBlob,sourceMusicAnalysis=project.musicAnalysis;
    const options={topic,brief:$('briefInput').value.trim().slice(0,18000),duration:Number($('durationSelect').value),ratio:selectedRatio,style:selectedStyle,mode:selectedMode,audience:'普通成年人',preferences:rules.join('\n')};
    const script=await api.generateScript(configs.text,options,{signal:activeAbort.signal});
    const next=engine.createProjectFromScript(script,options);if(!validProject(next))throw new Error('模型返回的分镜结构不完整，原项目保留。');
    pushUndo();project=next;storyboardApplied=true;project.mode=selectedMode;project.brief=options.brief;if(sourceMusic instanceof Blob){project.musicBlob=sourceMusic;if(sourceMusicAnalysis)project.musicAnalysis=sourceMusicAnalysis;}project.isDemo=false;project.generatedFromApi=true;hasGenerated=true;
    project.settings={music:$('musicToggle').checked,voice:$('voiceToggle').checked,captions:$('captionsToggle').checked};
    project.scenes.forEach(scene=>{scene.renderState='pending';delete scene.composition;delete scene.program;});selectedIndex=0;currentTime=0;releaseClipURL();updateProjectUI();saveLocal();
    await renderSceneArts(project,project.scenes.map((_,index)=>index),{signal:activeAbort.signal,stage:'第二步 · 逐镜独立设计画面'});
    toast(artMissing().length?'部分镜头尚未完成，可单独重试。':'代码画面已就绪；配音、AI 视频镜头和导出由你按需继续。');
  }catch(error){
    if(storyboardApplied)finishGeneration(error.name==='AbortError'?'生成已取消':'生成未完成：'+error.message,{cancelled:error.name==='AbortError'});else{clearInterval(generationTimer);generationTimer=null;$('generationTitle').textContent=error.name==='AbortError'?'分镜请求已取消，原项目保留':'分镜生成未完成，原项目保留';$('generationDetail').textContent=error.name==='AbortError'?'尚未替换项目，也没有为新主题生成画面。':error.message;$('generationBar').classList.remove('indeterminate');$('generationPercent').textContent='未完成';$('generationNext').hidden=true;$('cancelGenerationButton').hidden=true;}toast(error.name==='AbortError'?'已取消，已有项目与完成画面保留。':error.message,true);
  }finally{setBusy(false);$('generateButton').querySelector('span').textContent='生成分镜与代码画面';activeAbort=null;updateProjectUI(false);}
}

function detachMedia(sceneIds) {
  const ids = new Set(sceneIds);
  const oldVideos = project.videoClips || [];
  const oldVoices = project.voiceClips || [];
  const removed = oldVideos.some((c) => ids.has(c.sceneId)) || oldVoices.some((c) => ids.has(c.sceneId));
  project.videoClips = oldVideos.filter((c) => !ids.has(c.sceneId));
  project.voiceClips = oldVoices.filter((c) => !ids.has(c.sceneId));
  if (project.voiceBlob) { delete project.voiceBlob; return true; }
  releaseClipURL();
  return removed;
}
function alignMedia() {
  for (const group of [project.videoClips || [], project.voiceClips || []]) for (const clip of group) { const scene = project.scenes.find((s) => s.id === clip.sceneId); if (scene) clip.start = scene.start; }
}
async function revise() {
  const instruction = $('revisionInput').value.trim();
  if (!instruction) return toast('说说你希望这一镜怎么改');
  if (busy) return;
  const codeNeedsDesign=!!getScene().program&&/粒子|光点|精简|简洁|详细|标注|体积|材质|布局|构图|立体|路径|物体/.test(instruction);
  const needsSemantic=codeNeedsDesign||/(解释|旁白|文案|内容|例子|类比|物件|场景|改写|讲清|通俗|易懂|准确|错误|举例|替换|换成(?!(?:深|浅)?(?:蓝|金|橙|青|暖|冷)))/i.test(instruction);
  if(!needsSemantic&&/重做|再来|换一版|重新生成|重绘|regenerat/i.test(instruction)){$('revisionInput').value='';if($('rememberRule').checked)rememberPreference(instruction);return retrySceneArt([selectedIndex],{instruction});}
  pause();
  try {
    const local = needsSemantic?{project,changes:[],summary:'内容与解释的修改需要文本 API，随后重新设计当前镜头画面。'}:engine.reviseScene(project, selectedIndex, instruction);
    if (Array.isArray(local.changes) && local.changes.length) {
      pushUndo(); project = local.project; alignMedia();
      if ($('rememberRule').checked) rememberPreference(instruction);
      markChanged(); $('revisionResult').textContent = local.summary; $('revisionResult').hidden = false; $('revisionInput').value = '';
      return toast('已调整当前镜头，其他镜头保留。');
    }
    if (!canUse('text')) {
      $('revisionResult').textContent = local.summary || '本地支持节奏、配色、粒子、精简和重做。语义改写需要文本 API。'; $('revisionResult').hidden = false;
      return;
    }
    setBusy(true, '正在请求模型修改当前镜头…');activeAbort=new AbortController();
    setGenerationProgress({stage:'正在改写当前镜头',detail:'先修改讲解，再为这一镜重新设计画面；其他镜头不重新请求。',newRun:true});
    const index = selectedIndex;
    const targetProject = project;
    const sourceScene = getScene();
    const apiScene = Object.assign({}, sourceScene, { kind: String(sourceScene.kind || 'process').replace(/^script:/, '') });
    if (!engine.SCRIPT_KINDS.includes(apiScene.kind)) apiScene.kind = 'process';
    const revised = await api.reviseSceneWithAI(configs.text, { scene: apiScene, instruction, context: JSON.stringify({ topic: project.topic, title: project.title, previousScene: project.scenes[index - 1]?.title, nextScene: project.scenes[index + 1]?.title }) },{signal:activeAbort.signal});
    if (project !== targetProject) throw new Error('项目已切换，未把旧任务写入新项目。');
    const old = project.scenes[index];
    const candidate = Object.assign({}, old, revised, { id: old.id, start: old.start, duration: old.duration, kind: 'script:' + String(revised.kind || 'process').replace(/^script:/, ''), revision: (old.revision || 0) + 1 });
    if (typeof candidate.narration !== 'string' || typeof candidate.title !== 'string') throw new Error('模型返回的镜头文案不完整，已保留原版本。');
    pushUndo(); const removed = detachMedia([old.id]); delete candidate.composition;delete candidate.program;delete candidate.draftProgram;delete candidate.draftThumbnail;delete candidate.draftMeta;candidate.renderState='pending';candidate.artInstruction=instruction;project.scenes[index] = candidate;
    if ($('rememberRule').checked) rememberPreference(instruction);
    markChanged();await renderSceneArts(targetProject,[index],{signal:activeAbort.signal,stage:'正在重新设计当前镜头画面'}); $('revisionResult').textContent = (artReady(project.scenes[index])?'已重写并独立绘制当前镜头。':'文案已修改，画面尚未完成，可重试。') + (removed ? '此镜原有配音或 AI 画面已断开，请重新生成。' : ''); $('revisionResult').hidden = false; $('revisionInput').value = '';
    toast('只处理当前镜头，其他镜头保留，可随时撤销。');
  } catch (error) {if(activeAbort)finishGeneration('当前镜头修改未完成：'+error.message,{cancelled:activeAbort.signal.aborted});toast(error.message, true); }
  finally { setBusy(false);activeAbort=null;updateProjectUI(false); }
}
function rememberPreference(instruction) {
  if (!rules.includes(instruction)) rules.push(instruction.slice(0, 200));
  if (rules.length > 30) rules.shift();
  try { localStorage.setItem(PREFS, JSON.stringify(rules)); } catch {}
  renderRules();
}
function renderRules() {
  $('rulesCount').textContent = String(rules.length);
  $('rulesList').replaceChildren();
  if (!rules.length) $('rulesList').append(el('p', 'rules-empty', '还没有保存的偏好。\n修改镜头时，勾选“也保存为我的创作偏好”。'));
  rules.forEach((rule, index) => {
    const row = el('div', 'rule-item'); const remove = el('button', '', '×'); remove.setAttribute('aria-label', '删除偏好：' + rule);
    remove.addEventListener('click', () => { rules.splice(index, 1); try { localStorage.setItem(PREFS, JSON.stringify(rules)); } catch {} renderRules(); });
    row.append(el('span', '', rule), remove); $('rulesList').append(row);
  });
}
async function saveDownload(blob, name) {
  const exporter = await import('./exporter.js');
  exporter.downloadBlob(blob, name);
}
function safeFileName(name) { return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').slice(0, 60) || '见知项目'; }
function exportSkill() {
  const markdown = '---\nname: my-jianzhi-style\ndescription: 用户确认保存的知识视频创作偏好，仅适用于内容与视觉表达。\n---\n\n# 我的见知创作偏好\n\n' + (rules.length ? rules.map((rule, i) => (i + 1) + '. ' + rule).join('\n') : '暂无个人偏好。采用清晰、通俗、连续可视化推演的默认风格。') + '\n\n## 使用范围\n\n- 用于知识视频的脚本、分镜和视觉风格。\n- 单次事实或文案修改不自动成为永久规则。\n- 本偏好不授予外部发布、付费调用或账户操作权限。\n- 事实与数据需要独立核验。\n';
  saveDownload(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), '我的知识视频风格-SKILL.md').catch((e) => toast(e.message, true));
}
function splitScene() {
  if (busy) return toast('请等当前任务完成后再拆分。');
  const scene = getScene();
  const point = currentTime - scene.start;
  if (point < 0.6 || point > scene.duration - 0.6) return toast('把播放头移到当前镜头中间，两侧至少保留 0.6 秒。', true);
  pause(); pushUndo();
  const splitAt = Math.max(1, Math.min((scene.narration || '').length - 1, Math.round((scene.narration || '').length * point / scene.duration)));
  const originalDuration = scene.renderDuration || scene.duration;
  const originalOffset = scene.sourceOffset || 0;
  const first = Object.assign({}, scene, { duration: point, narration: (scene.narration || '').slice(0, splitAt), caption: (scene.caption || scene.narration || '').slice(0, splitAt), renderDuration: originalDuration, sourceOffset: originalOffset, revision: (scene.revision || 0) + 1 });
  const second = Object.assign({}, scene, { id: scene.id + '-split-' + Date.now().toString(36), title: scene.title + ' · 后半', start: currentTime, duration: scene.duration - point, narration: (scene.narration || '').slice(splitAt), caption: (scene.caption || scene.narration || '').slice(splitAt), renderDuration: originalDuration, sourceOffset: originalOffset + point, revision: (scene.revision || 0) + 1 });
  for (const key of ['voiceClips', 'videoClips']) {
    const result = [];
    for (const clip of project[key] || []) {
      if (clip.sceneId !== scene.id) { result.push(clip); continue; }
      const length = Number(clip.duration) || scene.duration;
      result.push(Object.assign({}, clip, { sceneId: first.id, duration: Math.min(length, point) }));
      if (length > point) result.push(Object.assign({}, clip, { sceneId: second.id, start: currentTime, duration: Math.min(length - point, second.duration), sourceOffset: (Number(clip.sourceOffset) || 0) + point }));
    }
    project[key] = result;
  }
  releaseClipURL();
  project.scenes.splice(selectedIndex, 1, first, second); selectedIndex++; reflow(); alignMedia(); markChanged();
  toast('已在播放头拆分，总时长与已有媒体保留。修改后半段即可局部重做。');
}
function applyCopy() {
  if (busy) return toast('请等当前任务完成后再修改文案。');
  const text = $('sceneNarration').value.trim();
  const title = $('sceneTitle').value.trim();
  if (!text || !title) return toast('镜头标题和文案不能为空', true);
  const scene = getScene();
  if (text === scene.narration && title === scene.title) return;
  pushUndo(); const removed = detachMedia([scene.id]);
  const contentChanged=text!==scene.narration;Object.assign(scene, { title, narration: text, caption: text, revision: (scene.revision || 0) + 1 });
  if(contentChanged&&!project.isDemo){delete scene.composition;delete scene.program;delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;scene.renderState='pending';scene.renderError='文案已修改，请重新设计这一镜画面。';}
  markChanged(); toast('镜头文案已更新。'+(contentChanged&&!project.isDemo?'此镜画面需要重新设计。':'') + (removed ? '此镜原有媒体需重新生成。' : ''));
}
function aiPrompt(scene){return '为知识科普短片制作精致且连续运动的画面。主题：'+project.topic+'。镜头：'+scene.title+'。具体物件：'+(scene.visual?.description||scene.narration)+'。动作与推演：'+(scene.visual?.action||scene.program?.designIntent||scene.composition?.designIntent||'建立对象、发生变化、显示结果')+'。风格：'+getStyle(project.style).description+'。画面不生成字幕、文字或数字，文字由后期准确合成。';}
function showBatchAI(){
  if(busy)return toast('请等当前任务完成。');
  if(!canUse('video'))return showServiceConfig('video','填写 MiniMax API Key 后，才会开始生成真实 AI 镜头。');
  const fragment=document.createDocumentFragment();fragment.append(el('p','modal-copy','代码预览不会自动变成 AI 视频。请选择需要 MiniMax-H3 生成的镜头；每个新任务分别计费。已有未完成任务将继续查询，避免重复提交。'+(project.ratio==='4:5'?'4:5 将由 3:4 素材裁切。':'')));
  const list=el('div','batch-shot-list'),checks=[];
  project.scenes.forEach((scene,index)=>{const row=el('label','batch-shot-row'),check=el('input');check.type='checkbox';check.checked=!(project.videoClips||[]).some(c=>c.sceneId===scene.id);check.dataset.id=scene.id;checks.push(check);const copy=el('span','',`${String(index+1).padStart(2,'0')} · ${scene.title}`);copy.append(el('small','',`${Math.max(4,Math.min(15,Math.ceil(scene.duration)))} 秒 AI 片段${scene.videoTask&&!['failed','cancelled'].includes(scene.videoTask.status)?' · 继续原任务':''}`));row.append(check,copy);list.append(row);});
  const status=el('div','model-status','尚未提交；请确认所选镜头数量与服务商费用。');
  const submit=el('button','button primary'),cancel=el('button','button secondary','关闭');let controller;
  const updateLabel=()=>{submit.textContent=`生成 / 继续所选 ${checks.filter(c=>c.checked).length} 镜 AI 短片`;};checks.forEach(c=>c.addEventListener('change',updateLabel));updateLabel();
  cancel.addEventListener('click',()=>{if(controller)controller.abort();else closeModal();});
  submit.addEventListener('click',async()=>{
    if(busy)return;const ids=checks.filter(c=>c.checked).map(c=>c.dataset.id);if(!ids.length){status.textContent='请至少选择一个镜头。';return;}
    pause();pushUndo();const target=project;controller=new AbortController();activeAbort=controller;setBusy(true,'正在生成所选 AI 镜头…');submit.disabled=true;cancel.textContent='停止后续任务';let completedCount=0,failedCount=0;
    setGenerationProgress({stage:'正在生成所选 AI 视频镜头',total:ids.length,completed:0,detail:'逐镜提交，显示服务商真实任务状态。',measurable:true,newRun:true});
    try{
      for(const id of ids){
        if(controller.signal.aborted)throw new DOMException('已停止后续任务','AbortError');const scene=target.scenes.find(s=>s.id===id);if(!scene)continue;
        status.textContent='正在处理「'+scene.title+'」';
        try{
          const length=Math.max(4,Math.min(15,Math.ceil(scene.duration)));
          const existing=scene.videoTask&&!['failed','cancelled'].includes(scene.videoTask.status)?scene.videoTask:null;
          const job=existing||await api.createVideoTask(configs.video,{prompt:aiPrompt(scene),duration:length,ratio:target.ratio},{signal:controller.signal});scene.videoTask={...job,duration:existing?.duration||length};saveLocal();
          const ready=await api.pollVideoTask(configs.video,job,{signal:controller.signal,onProgress:jobState=>{scene.videoTask={...scene.videoTask,...jobState};saveLocal();const detail=`「${scene.title}」· 服务商状态 ${jobState.status}${Number.isFinite(jobState.progress)?' · '+Math.round(jobState.progress)+'%':''} · ${job.id}`;status.textContent=detail;$('generationDetail').textContent=detail;}});
          const blob=await api.downloadVideo(configs.video,ready,{signal:controller.signal});if(project!==target)throw new Error('项目已切换，未把旧任务写入新项目。');
          target.videoClips=[...(target.videoClips||[]).filter(c=>c.sceneId!==scene.id),{sceneId:scene.id,blob,start:scene.start,duration:Math.min(scene.videoTask.duration||length,scene.duration),jobId:ready.id}];scene.videoTask={...scene.videoTask,...ready};completedCount++;releaseClipURL();saveLocal();updateProjectUI();
        }catch(error){if(controller.signal.aborted||error.name==='AbortError')throw error;failedCount++;scene.videoError=error.message;status.textContent='「'+scene.title+'」未完成：'+error.message;}
        setGenerationProgress({stage:'正在生成所选 AI 视频镜头',total:ids.length,completed:completedCount,failed:failedCount,detail:`已下载 ${completedCount} / ${ids.length} 镜，${failedCount} 镜未完成。`,measurable:true});
      }
      finishGeneration(failedCount?'部分 AI 镜头未完成':'所选 AI 视频镜头已完成');status.textContent=`已加入 ${completedCount} 个 AI 片段，${failedCount} 个镜头未完成。现有代码画面与成功片段已保留。`;
    }catch(error){finishGeneration('AI 镜头生成已停止',{cancelled:controller.signal.aborted});status.textContent=error.name==='AbortError'?'已停止后续提交；已提交任务可能继续执行并计费，可继续查询原任务。':error.message;}
    finally{setBusy(false);submit.disabled=false;controller=null;activeAbort=null;cancel.textContent='关闭';updateProjectUI(false);}
  });
  const actions=el('div','modal-actions');actions.append(cancel,submit);fragment.append(list,status,actions);openModal('选择要真正生成的 AI 镜头',fragment,'GENERATE SELECTED SHOTS');
}

function showVideoGeneration() {
  if (!canUse('video')) return showServiceConfig('video', '填写 MiniMax API Key，即可使用 MiniMax-H3 生成当前镜头。每次提交可能产生服务商费用。');
  const scene = getScene();
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', '只生成当前镜头的动态影像，字幕继续由本站叠加。MiniMax-H3 每镜支持 4–15 秒，较长成片由多个镜头组合。'+(project.ratio==='4:5'?'4:5 画面将使用 3:4 素材裁切。':'')));
  const promptLabel = el('label', 'field-label', '镜头画面提示词');
  const prompt = el('textarea'); prompt.rows = 5; prompt.maxLength = 2000;
  prompt.value = typeof scene.visual?.prompt === 'string' ? scene.visual.prompt : '为知识科普短片制作精致、连续运动的画面。主题：' + project.topic + '。镜头：' + scene.title + '。表现内容：' + (scene.visual?.description || scene.narration) + '。动作：' + (scene.visual?.action || '连续推进核心机制') + '。具有体积光影、明确视觉主体与镜头运动。画面中不要生成字幕、文字或数字，字幕另行合成。';
  const durationLabel = el('label', 'field-label', 'AI 片段时长');
  const duration = el('select');
  const allowedDurations = Array.from({ length: 12 }, (_, i) => i + 4);
  allowedDurations.forEach((v) => duration.append(new Option(v + ' 秒', String(v))));
  duration.value = String(allowedDurations.find((v) => v >= scene.duration) || allowedDurations.at(-1));
  const status = el('div', 'model-status', '尚未提交任务。调用费用以你的服务商账户为准。');
  const note = el('div', 'modal-callout', '片段短于镜头时，剩余时间回到代码图解。你也可以调整镜头时长。生成后建议核对人物、数量和运动是否符合知识内容。');
  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'button secondary', '关闭');
  let controller;
  cancel.addEventListener('click', () => { if (controller) controller.abort(); closeModal(); });
  const generate = el('button', 'button primary', scene.videoTask&&!['failed','cancelled'].includes(scene.videoTask.status)?'继续查询 / 下载原任务':'提交生成此镜画面');
  generate.addEventListener('click', async () => {
    if (busy) return;
    controller = new AbortController();activeAbort=controller; generate.disabled = true; setBusy(true, '正在生成当前 AI 镜头…');setGenerationProgress({stage:'正在生成当前 AI 视频镜头',total:1,completed:0,detail:'正在向 MiniMax-H3 提交短片任务。',measurable:true,newRun:true});
    status.textContent = '正在向视频服务提交任务…';
    try {
      const capturedSceneId = scene.id;
      const targetProject = project;
      const job = scene.videoTask&&!['failed','cancelled'].includes(scene.videoTask.status)?scene.videoTask:await api.createVideoTask(configs.video, { prompt: prompt.value, duration: Number(duration.value), ratio: project.ratio }, { signal: controller.signal });scene.videoTask={...job,duration:Number(job.duration)||Number(duration.value)};saveLocal();
      status.textContent = '任务已提交，等待服务商生成。任务 ID：' + job.id;
      const completed = await api.pollVideoTask(configs.video, job, { signal: controller.signal, onProgress: (progress) => {scene.videoTask={...scene.videoTask,...progress};saveLocal();$('generationDetail').textContent='MiniMax-H3 实际任务状态：'+progress.status+' · '+job.id; status.textContent = '服务商任务状态：' + (progress.status || '处理中') + (Number.isFinite(progress.progress) ? ' · ' + Math.round(progress.progress * (progress.progress <= 1 ? 100 : 1)) + '%' : ''); } });
      status.textContent = '生成完成，正在下载片段…';
      const blob = await api.downloadVideo(configs.video, completed, { signal: controller.signal });
      if (project !== targetProject) throw new Error('项目已切换，旧任务片段未加入新项目。');
      const target = project.scenes.find((s) => s.id === capturedSceneId);
      if (!target) throw new Error('原镜头已被删除，已下载片段未添加到项目。');
      pushUndo(); project.videoClips = (project.videoClips || []).filter((c) => c.sceneId !== target.id); project.videoClips.push({ sceneId: target.id, blob, start: target.start, duration: Math.min(scene.videoTask.duration||Number(duration.value), target.duration), jobId: completed.id });
      project.isDemo = false;scene.videoTask={...completed,duration:scene.videoTask.duration||Number(duration.value)};releaseClipURL(); markChanged();setGenerationProgress({stage:'当前 AI 视频镜头已完成',total:1,completed:1,detail:'实际片段已下载并加入时间线。',measurable:true});finishGeneration('当前 AI 视频镜头已完成');
      status.textContent = '片段已加入当前镜头，可在预览中检查。媒体仅保留在本页内存，刷新前请导出视频。'; toast('AI 画面已加入当前镜头。'); generate.textContent = '继续查询 / 下载原任务';
    } catch (error) { status.textContent = error.name === 'AbortError' ? '已停止等待。服务商可能仍在执行已提交的任务，费用以账户记录为准。' : error.message;finishGeneration(error.name==='AbortError'?'已停止等待 AI 视频':'AI 镜头生成未完成',{cancelled:error.name==='AbortError'});}
    finally { setBusy(false); generate.disabled = false; controller = null;activeAbort=null;updateProjectUI(false); }
  });
  actions.append(cancel, generate); frag.append(promptLabel, prompt, durationLabel, duration, status, note, actions); openModal('生成这一镜的 AI 画面', frag, 'SINGLE SHOT GENERATION');
}
async function audioDuration(blob) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try { const buffer = await context.decodeAudioData(await blob.arrayBuffer()); return buffer.duration; }
  finally { context.close(); }
}
function showSpeechGeneration() {
  if (!canUse('speech')) return showServiceConfig('speech', '填写 MiniMax API Key，即可使用 speech-2.8-hd 生成可导出的旁白。');
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', '逐镜生成旁白并对齐到镜头起点。字幕按镜头时长分页显示，当前不是逐字对齐。修改文案后，只需重做受影响的旁白。'));
  const fields = el('div', 'model-form');
  const voiceLabel = el('label', '', '旁白音色'); const voice = el('select'); voice.append(new Option('中文青年男声 · 清晰自然', 'male-qn-qingse')); voice.value = 'male-qn-qingse'; voiceLabel.append(voice);
  const speedLabel = el('label', '', '语速'); const speed = el('select'); speed.append(new Option('舒缓 · 0.9 倍', '0.9'), new Option('自然 · 1.0 倍', '1'), new Option('轻快 · 1.1 倍', '1.1')); speed.value = '1'; speedLabel.append(speed);
  fields.append(voiceLabel, speedLabel);
  const extendLabel = el('label', 'remember-rule'); const extend = el('input'); extend.type = 'checkbox'; extend.checked = true; extendLabel.append(extend, el('span', '', '音频较长时延长镜头，总时长可能增加'));
  const scopeLabel=el('label','field-label','生成范围');const scope=el('select');
  scope.append(new Option('补齐缺失旁白 · 保留已有音轨','missing'),new Option('只生成选中镜头','selected'),new Option('重新生成整片旁白','all'));scopeLabel.append(scope);
  const status = el('div', 'model-status', '尚未请求配音。每个镜头将分别提交一次语音合成。');
  const actions = el('div', 'modal-actions');
  const button = el('button', 'button primary', '生成所选范围旁白');
  const cancel=el('button','button secondary','关闭');let speechAbort=null;
  cancel.addEventListener('click',()=>{if(speechAbort)speechAbort.abort();else closeModal();});
  button.addEventListener('click', async () => {
    if (busy) return;
    const selectedId=getScene().id;
    const targets=project.scenes.filter(s=>scope.value==='all'||scope.value==='selected'&&s.id===selectedId||scope.value==='missing'&&!(project.voiceClips||[]).some(c=>c.sceneId===s.id));
    if(!targets.length){status.textContent='所有镜头已有旁白，没有提交新的付费请求。可选择重做当前镜头。';return;}
    pause(); pushUndo(); setBusy(true, '正在生成旁白…'); button.disabled = true;
    speechAbort=new AbortController();activeAbort=speechAbort;cancel.textContent='停止后续配音';setGenerationProgress({stage:'正在逐镜生成旁白',total:targets.length,completed:0,detail:'只请求所选范围的旁白，保留其他有效音轨。',measurable:true,newRun:true});
    const targetProject = project;
    let generated = 0; let extended = false;
    try {
      for (let i = 0; i < targets.length; i++) {
        if(speechAbort.signal.aborted)throw new DOMException('已停止后续配音','AbortError');
        const scene = targets[i]; status.textContent = '正在生成所选镜头 ' + (i + 1) + ' / ' + targets.length + ' 的旁白…';
        const blob = await api.generateSpeech(configs.speech, { text: scene.narration, voice: voice.value || 'male-qn-qingse', speed: Number(speed.value) },{signal:speechAbort.signal});
        if (project !== targetProject) throw new Error('项目已切换，配音任务已停止。');
        const length = await audioDuration(blob);
        if (length > scene.duration) {
          if (!extend.checked) throw new Error('镜头 ' + (i + 1) + ' 的旁白长于画面。请延长镜头、缩短文案或勾选自动延长。');
          if (project.duration - scene.duration + length + 0.25 > MAX_PROJECT_DURATION) throw new Error('旁白将使成片超过当前 600 秒上限，请缩短文案后重试。');
          scene.duration = Math.ceil((length + 0.25) * 10) / 10; extended = true; reflow();
        }
        const others=(project.voiceClips||[]).filter(c=>c.sceneId!==scene.id);
        project.voiceClips=[...others,{ sceneId: scene.id, blob, start: scene.start, duration: length,text:scene.narration }];generated++;setGenerationProgress({stage:'正在逐镜生成旁白',total:targets.length,completed:generated,detail:`已生成并对齐 ${generated} / ${targets.length} 段旁白。`,measurable:true});
      }
      alignMedia(); project.settings.voice = true; project.isDemo = false; markChanged();
      status.textContent = '已生成 ' + generated + ' 段可导出的旁白。' + (extended ? '部分镜头已延长，总时长为 ' + formatTime(project.duration) + '。' : '') + '媒体保留在本页内存，刷新前请导出。';
      finishGeneration('所选旁白已完成');toast('所选旁白已生成，其他有效音轨已保留。');
    } catch (error) { alignMedia(); markChanged();finishGeneration(error.name==='AbortError'?'旁白生成已停止':'部分旁白未完成',{cancelled:error.name==='AbortError'}); status.textContent = (error.name==='AbortError'?'已停止后续配音；已提交的请求仍可能计费。':error.message) + (generated ? ' 已生成的 ' + generated + ' 段旁白已保留。' : ''); }
    finally { setBusy(false); button.disabled = false;speechAbort=null;activeAbort=null;cancel.textContent='关闭';updateProjectUI(false); }
  });
  actions.append(cancel,button); frag.append(fields,scopeLabel,extendLabel,status,actions); openModal('给知识配一个声音', frag, 'NARRATION');
}
async function exportVideo() {
  if (busy) return toast('请等当前任务完成后再导出。');
  if(!project.isDemo&&missingFrames().length){toast(`还有 ${missingFrames().length} 镜缺少完整画面。请补齐代码画面，或用 AI 视频覆盖整镜；较短片段不能补齐余下时段。`,true);$('generationPanel').hidden=false;finishGeneration('请先补齐缺少的画面');return;}
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', project.isDemo ? '当前为内置交互示意，不是模型生成结果。你可以选择导出这份示意，或先连接 API 生成自己的主题。' : '视频由当前分镜、字幕与已生成的音轨合成。导出期间请保持页面打开。'));
  if(project.mode!=='code'){const count=new Set((project.videoClips||[]).map(c=>c.sceneId)).size;frag.append(el('div','modal-callout',`当前已有 ${count} 个 AI 视频片段；其他镜头会使用已完成的代码画面。确认当前预览符合预期后再导出。`));}
  if (project.settings.voice && !(project.voiceClips || []).length && !project.voiceBlob) frag.append(el('div', 'modal-callout', '当前没有已生成的配音，将导出启用的配乐与字幕。需要旁白时，请先点击“生成 / 补齐旁白”。'));
  const percent = el('strong', 'export-percent', '准备就绪'); const bar = el('div', 'export-progress'); const fill = el('span'); bar.append(fill);
  const status = el('p', 'modal-copy', '优先导出 MP4；浏览器不支持时会说明可用格式。当前未产生导出文件。');
  const actions = el('div', 'modal-actions'); const cancel = el('button', 'button secondary', '关闭'); const start = el('button', 'button primary', project.isDemo ? '导出这份示意' : '开始导出视频');
  let controller;
  cancel.addEventListener('click', () => { if (controller) controller.abort(); else closeModal(); });
  start.addEventListener('click', async () => {
    pause(); start.disabled = true; controller = new AbortController(); setBusy(true, '正在导出视频…'); cancel.textContent = '取消导出'; percent.textContent = '0%';
    try {
      const module = await import('./exporter.js');
      const blob = await module.exportVideo(project, { signal: controller.signal, onProgress: (value) => {
        const p = typeof value === 'number' ? value : value.progress ?? 0; const number = Math.min(100, Math.max(0, p <= 1 ? p * 100 : p)); percent.textContent = Math.round(number) + '%'; fill.style.width = number + '%'; status.textContent = typeof value === 'object' && value.message ? value.message : '正在按真实渲染进度合成视频…';
      } });
      const extension = blob.type.includes('mp4') ? 'mp4' : 'webm'; module.downloadBlob(blob, safeFileName(project.title) + '.' + extension); percent.textContent = '已完成'; fill.style.width = '100%'; status.textContent = '已导出 ' + extension.toUpperCase() + '，包含当前启用的字幕和可用音轨。'; toast('视频已导出');
    } catch (error) { status.textContent = error.name === 'AbortError' ? '导出已取消，项目仍保留。' : error.message; percent.textContent = '未完成'; }
    finally { setBusy(false); start.disabled = false; controller = null; cancel.textContent = '关闭'; }
  });
  actions.append(cancel, start); frag.append(percent, bar, status, actions); openModal('把知识，带到更多人面前', frag, 'EXPORT');
}
function showSources() {
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', project.isDemo ? '以下资料用于内置概率示意。正式发布自己的脚本前，仍建议逐项核对事实和数据。' : '模型建议来源，待核查。请核对链接内容是否支持对应说法，尤其是历史细节、实验结论与统计数据。'));
  const sources = Array.isArray(project.sources) ? project.sources : [];
  if (!sources.length) frag.append(el('div', 'modal-callout', '当前脚本没有附带来源。建议补充可信的一手资料后再发布。'));
  for (const source of sources) {
    try {
      const url = new URL(source.url); if (!['https:', 'http:'].includes(url.protocol)) continue;
      const link = el('a', 'source-item'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.append(el('strong', '', source.title || url.hostname), el('small', '', (project.isDemo ? '' : '待核查 · ') + url.href)); frag.append(link);
    } catch {}
  }
  openModal('让知识，经得起追问', frag, 'REFERENCES');
}
function showAbout() {
  openModal('见知 · Vibe Studio', '<p class="modal-copy">一个面向知识视频创作的可用原型：你提供主题，文本 API 先编排脚本，再为每镜独立设计物件、构图和运动。按 vibe-knowledge-film 为每镜现写代码，隔离渲染后看图返修，AI 视频接口按需生成真正短片。配音和导出都由你在站内主动触发。</p><div class="modal-callout">当前初始画面是交互示意。本站没有替你预生成视频或提交付费任务；每次调用的状态都来自实际接口。</div><p class="modal-copy">密钥只在页面内存中使用，刷新后清除。项目 JSON 保存分镜与设定，不包含密钥和媒体文件。已生成的旁白、上传音乐与 AI 片段仅保留在本页，刷新前请导出成片。</p><p class="modal-copy">视频模型、文本模型与语音服务费用由相应服务商收取。本站不根据未经验证的单价承诺费用；请在你的服务账户设置预算。</p>');
}

initializePresets();
$('createForm').addEventListener('submit', generateProject);
$('birthdayBriefButton').addEventListener('click',applyBirthdayBrief);
$('alignMusicButton').addEventListener('click',applyMusicBeatToCurrentScenes);
$('cancelGenerationButton').addEventListener('click',()=>{if(activeAbort){activeAbort.abort();$('generationDetail').textContent='正在取消尚未完成的请求，保留已完成的画面。';}});
$('retrySceneButton').addEventListener('click',()=>retrySceneArt([selectedIndex]));
$('resumeArtButton').addEventListener('click',()=>retrySceneArt(project.scenes.map((scene,index)=>!artReady(scene)?index:-1).filter(index=>index>=0)));
$('batchAIButton').addEventListener('click',showBatchAI);
$('ratioSelect').addEventListener('change',()=>{if(busy){$('ratioSelect').value=selectedRatio;return toast('请等当前任务完成后再调整比例。');}selectedRatio=normalizeRatio($('ratioSelect').value);project.ratio=selectedRatio;markChanged();});
$('playButton').addEventListener('click', togglePlay);
$('canvasPlay').addEventListener('click', togglePlay);
$('restartButton').addEventListener('click', () => seek(0));
$('seekSlider').addEventListener('input', (event) => seek(event.target.value));
$('muteButton').addEventListener('click', () => { muted = !muted; $('muteButton').setAttribute('aria-pressed', String(muted)); $('muteButton').style.opacity = muted ? '.35' : '1'; if (muted) stopAudio(); else refreshPlayingAudio(); });
$('fullscreenButton').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else $('previewStage').requestFullscreen?.().catch(() => toast('浏览器未允许全屏预览')); });
all('[data-mode]').forEach((button) => button.addEventListener('click', () => {if(busy)return toast('当前任务执行中，请稍后切换制作方式。');setMode(button.dataset.mode);project.mode=selectedMode;markChanged();if(!project.isDemo){$('generationPanel').hidden=false;finishGeneration('制作方式已切换');}}));
all('[data-ratio]').forEach((button) => button.addEventListener('click', () => { if (busy) return toast('当前任务执行中，请稍后调整画幅。'); selectedRatio = button.dataset.ratio; all('[data-ratio]').forEach((b) => b.classList.toggle('selected', b === button)); project.ratio = selectedRatio; markChanged(); }));
all('[data-style]').forEach((button) => button.addEventListener('click', () => { if (busy) return toast('当前任务执行中，请稍后调整风格。'); selectedStyle = normalizeStyle(button.dataset.style); all('[data-style]').forEach((b) => b.classList.toggle('selected', b === button)); project.style = selectedStyle; $('styleDescription').textContent=getStyle(selectedStyle).description;markChanged(); }));
for (const [id, setting] of [['voiceToggle', 'voice'], ['musicToggle', 'music'], ['captionsToggle', 'captions']]) $(id).addEventListener('change', () => { project.settings[setting] = $(id).checked; renderNeeded = true; saveLocal(); if (setting !== 'captions') refreshPlayingAudio(); if (setting === 'voice' && $(id).checked && !(project.voiceClips || []).length && !project.voiceBlob) toast('旁白已启用，生成配音后可播放和导出。'); });
$('modeHelp').addEventListener('click', showModes);
$('topicExamples').addEventListener('click', showLibrary);
$('navLibrary').addEventListener('click', showLibrary);
$('navSettings').addEventListener('click', () => showServiceConfig());
$('configureAPI').addEventListener('click', () => showServiceConfig());
$('navAbout').addEventListener('click', showAbout);
$('aboutButton').addEventListener('click', showAbout);
$('navStudio').addEventListener('click', () => { $('topicInput').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('sampleButton').addEventListener('click', () => { if (!project.isDemo) showLibrary(); else { togglePlay(); $('previewStage').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
$('promptButton').addEventListener('click', showPrompt);
$('sourcesButton').addEventListener('click', showSources);
$('closeModal').addEventListener('click', closeModal);
$('modal').addEventListener('click', (event) => { if (event.target === $('modal')) { const bounds = $('modal').getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal(); } });
$('reviseButton').addEventListener('click', revise);
all('[data-revision]').forEach((button) => button.addEventListener('click', () => { $('revisionInput').value = button.dataset.revision; revise(); }));
$('revisionInput').addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') revise(); });
$('applyCopyButton').addEventListener('click', applyCopy);
$('sceneTitle').addEventListener('change', applyCopy);
$('sceneDuration').addEventListener('change', () => {
  if (busy) { toast('请等当前任务完成后再调整时长。'); return renderInspector(); }
  const duration = Number($('sceneDuration').value);
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) { toast('镜头时长需要在 1–120 秒之间', true); return renderInspector(); }
  if (project.duration - getScene().duration + duration > MAX_PROJECT_DURATION) { toast('当前支持总时长不超过 600 秒。', true); return renderInspector(); }
  pushUndo(); getScene().duration = duration; reflow(); alignMedia(); currentTime = Math.min(currentTime, project.duration); markChanged(); toast('已调整镜头时长，后续镜头起点同步移动。');
});
$('splitButton').addEventListener('click', splitScene);
$('undoButton').addEventListener('click', () => { if (busy) return toast('请等当前任务完成后再撤销。'); const saved = undoStack.pop(); if (!saved) return; pause(); project = saved.project; selectedIndex = saved.selectedIndex; currentTime = saved.currentTime; hasGenerated = project.generatedFromApi === true; releaseClipURL(); markChanged(); toast('已恢复上一版本'); });
all('[data-inspector]').forEach((button) => button.addEventListener('click', () => { all('[data-inspector]').forEach((b) => b.classList.toggle('active', b === button)); $('sceneInspector').hidden = button.dataset.inspector !== 'scene'; $('rulesInspector').hidden = button.dataset.inspector !== 'rules'; }));
$('navSkills').addEventListener('click', () => { document.querySelector('[data-inspector="rules"]').click(); document.querySelector('.inspector-panel')?.scrollIntoView({ behavior: 'smooth' }); });
$('exportSkillButton').addEventListener('click', exportSkill);
$('saveButton').addEventListener('click', () => {
  saveDownload(new Blob([JSON.stringify(serializable(project), null, 2)], { type: 'application/json' }), safeFileName(project.title) + '.json').catch((e) => toast(e.message, true));
  if ((project.voiceClips || []).length || (project.videoClips || []).length || project.musicBlob) toast('项目 JSON 只保存分镜与设定。媒体仍在本页内存，请另行导出成片。');
});
$('importButton').addEventListener('click', () => { if (busy) return toast('请等当前任务完成后再打开项目。'); $('projectFile').click(); });
$('projectFile').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (busy) throw new Error('当前任务执行中，请完成后再导入项目。');
    if (file.size > 12 * 1024 * 1024) throw new Error('项目文件超过 12 MB，请选择本站导出的项目 JSON。');
    const imported = JSON.parse(await file.text()); if (!validProject(imported)) throw new Error('项目结构不完整或时长超出范围，原项目已保留。');
    for (const key of ['voiceBlob','voiceClips','videoClips','musicBlob','musicAnalysis','apiKey','apiConfig','config']) delete imported[key];
    pause(); pushUndo(); project = imported;recoverRenderStates(project); project.settings = Object.assign({ voice: true, music: true, captions: true }, project.settings || {}); selectedIndex = 0; currentTime = 0; selectedRatio = normalizeRatio(project.ratio); selectedStyle = normalizeStyle(project.style); selectedMode = project.mode || 'code'; hasGenerated = project.generatedFromApi === true; releaseClipURL(); syncForm(); markChanged(); toast('项目已打开；媒体文件需要重新添加。');
  } catch (error) { toast(error.message, true); }
  event.target.value = '';
});
$('sceneVideoButton').addEventListener('click', showVideoGeneration);
$('speechButton').addEventListener('click', showSpeechGeneration);
$('musicFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;if(busy){event.target.value='';return toast('当前任务执行中，请完成后再上传音轨。');}
  const target=project;pause();setBusy(true,'正在本地分析上传配乐…');$('musicAnalysisStatus').textContent='正在本地读取音频并分析节拍，不向外部服务上传文件。';
  try{
    if(file.size>50*1024*1024)throw new Error('请选择 50 MB 以内的音频。');
    let analysis;try{analysis=await analyzeMusicFile(file);}catch(error){await audioDuration(file);analysis={duration:0,bpm:null,confidence:0,beats:[],sections:[],reliable:false,method:'analysis-unavailable',warnings:[error.message]};}
    if(project!==target)throw new Error('项目已切换，没有把音轨写入其他项目。');
    pushUndo();project.musicBlob=file;project.musicAnalysis=analysis;project.settings.music=true;markChanged();toast(canApplyMusicBeat()?'配乐已载入，节拍较清晰。可本地对齐现有画面，后续绘制也会轻度贴合节拍。':'配乐已载入，但未找到足够稳定的节拍，保留原画面时序。');
  }catch(error){toast('无法使用这份音频：'+error.message,true);}
  finally{setBusy(false);refreshMusicAnalysisStatus();updateProjectUI(false);event.target.value='';}
});
$('exportButton').addEventListener('click', exportVideo);
$('clipPreview').addEventListener('loadeddata', () => { renderNeeded = true; });
$('clipPreview').addEventListener('seeked', () => { renderNeeded = true; });
$('topicInput').addEventListener('input', () => { $('topicHint').textContent = '按主题生成 · 需要文本 API'; });
document.addEventListener('keydown', (event) => { const editable = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName); if (event.code === 'Space' && !editable && !$('modal').open) { event.preventDefault(); togglePlay(); } if (event.key === 'ArrowRight' && !editable && !$('modal').open) { event.preventDefault(); seek(currentTime + 5); } if (event.key === 'ArrowLeft' && !editable && !$('modal').open) { event.preventDefault(); seek(currentTime - 5); } });
window.addEventListener('beforeunload', (event) => {
  saveLocal();
  if (busy || project.voiceBlob || project.musicBlob || (project.voiceClips || []).length || (project.videoClips || []).length) { event.preventDefault(); event.returnValue = ''; }
});
syncForm(); updateProjectUI(); renderRules();if(!project.isDemo&&missingFrames().length){$('generationPanel').hidden=false;finishGeneration('项目已保留，可补齐或升级逐镜画面');}requestAnimationFrame(animate);
