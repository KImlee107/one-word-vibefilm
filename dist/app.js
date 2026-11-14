import {buildSceneWithRecovery,creationSceneIndices} from './scene-recovery.js';
import {createRunDiagnostics,directingBriefForTopic} from './run-diagnostics.js';
import {sceneArtReady,selectSceneRange,orderedSceneIndices,runSceneQueue} from './scene-queue.js';
import {initializeAppearance} from './appearance.js';
import {FILM_QUALITY_VERSION,filmQualityError} from './film-quality.js';
import {usageLedger,priceFor,priceKey,setPriceOverride,estimateVideoCost,formatCost,PRICE_SOURCES} from './costs.js';
import {resolveVideoJob,shouldPauseVideoBatch,safeVideoResultURL} from './video-jobs.js';
import {SERVICE_PROVIDERS,endpointMetadata,effectiveVision} from './providers.js';
import * as engine from './engine.js';
import * as api from './api-client.js';
import {validateFilmProgram,filmFingerprint} from './film-program.js';
import {renderProjectFrame,inspectFilmProgram,ensureFilmRenderer,FILM_SKILL} from './film-runtime.js';
import {DURATION_PRESETS,RATIO_PRESETS,STYLE_PRESETS,MAX_PROJECT_DURATION,getDimensions,getStyle,normalizeRatio,normalizeStyle} from './presets.js';
import {validateComposition,compositionFingerprint} from './composition.js';
import {createReferenceDemo} from './demos.js';
import {BIRTHDAY_BRIEF} from './briefs.js';
import {analyzeMusicFile} from './beat.js';
import {DEFAULT_MUSIC,musicAnalysis,musicSource} from './music.js';
import {buildRhythmPlan,sceneMusicBeats,timelineRhythmStats,validRhythm,musicTimeAt} from './rhythm.js';

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
defaultConfigs.vision={...defaultConfigs.text,inherit:true};
let configs = clone(defaultConfigs);
const MODEL_METADATA='jianzhi-model-endpoints-v1';
try{const saved=JSON.parse(localStorage.getItem(MODEL_METADATA)||'null');if(saved&&typeof saved==='object')for(const type of ['text','speech','video','vision']){const c=saved[type];if(!c||typeof c!=='object')continue;for(const key of ['provider','baseURL','model'])if(typeof c[key]==='string')configs[type][key]=c[key].slice(0,key==='baseURL'?2000:160);configs[type].inherit=c.inherit===true;configs[type].jsonMode=c.jsonMode!==false;configs[type].customEndpoint=true;}}catch{}
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
let lastScriptFailure=null;
const runDiagnostics=createRunDiagnostics();
const sceneFramePreviews=new WeakMap();
let displayedFrameInspection=null;
let briefBinding={topic:'',brief:''};
let rangeProject=null,rangeSceneCount=0;

try {
  const savedRules = JSON.parse(localStorage.getItem(PREFS) || '[]');
  if (Array.isArray(savedRules)) rules = savedRules.filter((r) => typeof r === 'string').slice(0, 30);
} catch {}

function initialProject() {
  return createReferenceDemo({duration:90,ratio:'16:9',style:'noir',settings:{voice:false}});
}
function quarantineInvalidPrograms(value){
  if(!Array.isArray(value?.scenes)||value.scenes.length>60)return value;
  for(const scene of value.scenes){
    if(!scene||typeof scene!=='object')continue;
    for(const key of ['program','draftProgram']){
      const candidate=scene[key];if(!candidate)continue;
      try{validateFilmProgram(candidate);}catch(error){
        if(typeof candidate.source!=='string'||candidate.source.length>60000)continue;
        scene.codeFailure={program:candidate,message:error.message,phase:'compile',code:error.code||'CODE_FORMAT',repairs:0};
        delete scene[key];scene.renderState='failed';scene.draftReady=false;scene.renderError='已保留旧代码，需修复：'+error.message;
      }
    }
  }
  return value;
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
    if(s.codeFailure?.program&&(typeof s.codeFailure.program.source!=='string'||s.codeFailure.program.source.length>60000))return false;
    if(s.codeFailure?.draft!==undefined&&(typeof s.codeFailure.draft!=='string'||s.codeFailure.draft.length>70000))return false;
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
  const saved = quarantineInvalidPrograms(JSON.parse(localStorage.getItem(STORAGE) || 'null'));
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
const artReady=sceneArtReady;
function artMissing(p=project){return p.scenes.filter(scene=>!artReady(scene));}
function selectedSceneRange(){
  return selectSceneRange(project.scenes,{mode:$('sceneRangeMode').value,currentIndex:selectedIndex,start:$('sceneRangeStart').value,end:$('sceneRangeEnd').value,keepCompleted:$('sceneKeepCompleted').checked});
}
function updateSceneRangeControls(){
  const count=project.scenes.length;
  if(rangeProject!==project){rangeProject=project;rangeSceneCount=count;$('sceneRangeStart').value='1';$('sceneRangeEnd').value=String(count);$('sceneRangeMode').value='missing';$('sceneKeepCompleted').checked=true;}
  if(count!==rangeSceneCount){
    if(Number($('sceneRangeEnd').value)===rangeSceneCount||Number($('sceneRangeEnd').value)>count)$('sceneRangeEnd').value=String(count);
    if(Number($('sceneRangeStart').value)>count)$('sceneRangeStart').value=String(count);
    rangeSceneCount=count;
  }
  const mode=$('sceneRangeMode').value,missing=mode==='missing';
  $('sceneCustomRange').hidden=mode!=='custom';
  for(const id of ['sceneRangeStart','sceneRangeEnd']){$(id).max=String(count);$(id).disabled=busy||mode!=='custom';}
  for(const id of ['sceneRangeMode','sceneFailureMode'])$(id).disabled=busy;
  $('sceneKeepCompleted').disabled=busy||missing;if(missing)$('sceneKeepCompleted').checked=true;
  try{
    const plan=selectedSceneRange(),first=plan.selected[0]+1,last=plan.selected.at(-1)+1;
    const label=first===last?`第 ${first} 镜`:`第 ${first}–${last} 镜`;
    const order=plan.indices.map(i=>i+1).join(' → ');
    $('sceneRangeSummary').textContent=project.isDemo?'当前为内置示意。生成或打开自己的分镜后，可按范围制作画面。':`${label} · 待生成 ${plan.indices.length} 镜 · 保留 ${plan.skipped.length} 镜已完成画面。`+(order?'执行顺序：'+order:'此范围无需补齐；取消“保留已完成画面”可重做。');
    $('sceneRangeSummary').dataset.error='false';
    $('generateRangeButton').textContent=busy?'正在按顺序处理…':`按顺序生成 ${plan.indices.length} 镜`;
    $('generateRangeButton').disabled=busy||project.isDemo||!plan.indices.length;
    $('checkRangeButton').disabled=busy||project.isDemo||!plan.selected.some(i=>project.scenes[i].program||project.scenes[i].draftProgram||project.scenes[i].codeFailure?.program);
  }catch(error){$('sceneRangeSummary').textContent=error.message;$('sceneRangeSummary').dataset.error='true';$('generateRangeButton').textContent='请检查镜头范围';$('generateRangeButton').disabled=true;$('checkRangeButton').disabled=true;}
}
function showSceneRange(){
  if(busy)return toast('请等当前任务完成。');
  updateSceneRangeControls();$('sceneRangePanel').scrollIntoView({behavior:'smooth',block:'center'});$('sceneRangeMode').focus({preventScroll:true});
}
async function generateSelectedRange(){
  if(busy)return;
  try{
    const plan=selectedSceneRange();
    if(!plan.indices.length)return toast('所选范围没有待生成镜头。');
    await retrySceneArt(plan.indices,{failureMode:$('sceneFailureMode').value});
  }catch(error){toast(error.message,true);}
}
function renderSceneFailures(){
  const list=$('generationFailures');list.replaceChildren();
  for(const {index,type,title,message} of runDiagnostics.failures(project)){
    const row=el('button','scene-failure-row');row.type='button';row.dataset.failedScene=String(index);row.dataset.failedType=type;
    row.append(el('strong','',`${type==='video'?'AI 视频':'代码画面'} · 第 ${index+1} 镜 · ${title}`),el('span','',message),el('small','',type==='video'?'查看 / 取回原 AI 任务 →':'查看本镜详情 →'));list.append(row);
  }
  list.hidden=!list.childElementCount;
  $('generationFailureTools').hidden=list.hidden;
}
async function checkSelectedRange(){
  if(busy)return;
  let indices;try{indices=selectedSceneRange().selected.filter(i=>project.scenes[i].program||project.scenes[i].draftProgram||project.scenes[i].codeFailure?.program);}catch(error){return toast(error.message,true);}
  if(!indices.length)return toast('所选范围尚无可检查代码。');
  pause();pushUndo();const target=project;activeAbort=new AbortController();const signal=activeAbort.signal;setBusy(true,'正在本地检查已有画面…');let checked=0,flagged=0;
  setGenerationProgress({stage:'本地检查已有画面',newRun:true,total:indices.length,measurable:true,detail:'测量文字、越界与运动；不调用任何模型，不新增API费用。'});
  try{
    await ensureFilmRenderer({signal});
    for(const index of indices){
      if(signal.aborted)throw new DOMException('已取消','AbortError');const scene=target.scenes[index],program=scene.program||scene.draftProgram||scene.codeFailure.program;
      try{
        const valid=validateFilmProgram(program),inspection=await inspectFilmProgram(valid,scene,target,{signal});
        sceneFramePreviews.set(scene,inspection);
        if(!inspection.quality.ok)throw filmQualityError(inspection.quality);
        scene.artMeta={...scene.artMeta,quality:inspection.quality,qualityVersion:FILM_QUALITY_VERSION};
        if(scene.renderState!=='complete'){scene.draftProgram=valid;scene.draftThumbnail=inspection.thumbnail;scene.renderState='pending';delete scene.codeFailure;scene.renderError='本地检查已通过，可继续所选视觉返修或以0轮完成检查。';}
      }catch(error){
        if(signal.aborted||error.name==='AbortError'||error.code==='RENDER_ENVIRONMENT')throw error;
        flagged++;scene.renderState='failed';scene.renderError=error.message;runDiagnostics.track(target,scene.id,'code');scene.codeFailure={program,message:error.message,code:error.code||'SCENE_RUNTIME',phase:error.phase||'compile',quality:error.quality,repairs:0};scene.draftMeta={reviews:[],usage:[]};scene.draftReady=false;
      }
      checked++;saveLocal();updateProjectUI();setGenerationProgress({stage:'本地检查已有画面',total:indices.length,completed:checked-flagged,failed:flagged,measurable:true,detail:`已检查 ${checked} / ${indices.length} 镜，${flagged} 镜需返修。检查过程没有模型请求。`});
    }
    finishGeneration(flagged?`${flagged} 镜需返修，已保留原代码与问题详情`:'所选画面通过本地排版与运动检查');
  }catch(error){finishGeneration(error.message,{cancelled:error.name==='AbortError'});toast(error.message,true);}
  finally{setBusy(false);activeAbort=null;updateProjectUI();}
}
function fullVideo(scene,p=project){return (p.videoClips||[]).some(clip=>clip.sceneId===scene.id&&clip.blob instanceof Blob&&Number(clip.start)<=scene.start+.05&&Number(clip.start)+Number(clip.duration)>=scene.start+scene.duration-.05);}
function missingFrames(p=project){return p.scenes.filter(scene=>!artReady(scene)&&!fullVideo(scene,p));}
function setGenerationProgress({stage,total=0,completed=0,failed=0,detail='',measurable=false,newRun=false}){
  if(newRun||!generation.started){generation.started=Date.now();$('generationElapsed').textContent='已用时 00:00';}
  generation={...generation,stage,total,completed,failed,detail,measurable};
  if(newRun){runDiagnostics.begin(project);renderSceneFailures();lastScriptFailure=null;$('scriptFailureActions').hidden=true;usageLedger.begin(stage);$('videoTaskProgress').hidden=true;}
  $('generationPanel').hidden=false;
  $('generationTitle').textContent=stage;
  $('generationDetail').textContent=detail;
  const bar=$('generationBar'),processed=Math.min(total,completed+failed),percent=total?Math.floor(processed/total*100):0;
  bar.classList.toggle('indeterminate',!measurable);bar.classList.toggle('failed',failed>0);
  if(measurable){bar.setAttribute('aria-valuenow',String(percent));bar.setAttribute('aria-valuetext',`已处理 ${processed} / ${total} 镜，完成 ${completed} 镜，失败 ${failed} 镜`);$('generationFill').style.width=percent+'%';$('generationPercent').textContent=failed?`已处理 ${processed} / ${total} · 完成 ${completed} · 失败 ${failed}`:`${completed} / ${total} 镜 · ${percent}%`;}
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
  $('videoTaskProgress').setAttribute('aria-busy','false');
  const missing=artMissing();
  if(project.isDemo){$('generationNext').hidden=true;$('generationDetail').textContent='尚未完成新的分镜生成，原内置示意保留。';if(!generation.measurable)$('generationPercent').textContent='未完成';return;}
  $('generationNext').hidden=false;
  $('resumeArtButton').hidden=missing.length===0;
  $('resumeArtButton').textContent=`选择范围 / 补齐 ${missing.length} 镜`;
  $('batchAIButton').hidden=project.mode==='code';
  $('resumeVideoTasksButton').hidden=!project.scenes.some(s=>s.videoTask?.id&&!fullVideo(s));
  const aiDone=new Set((project.videoClips||[]).map(clip=>clip.sceneId)).size;
  $('generationNextText').textContent=missingFrames().length?`${missingFrames().length} 镜仍缺少完整画面，未使用重复模板代替。可查看原因并重试，也可生成覆盖该镜的 AI 视频。`:missing.length?'当前画面已齐，可导出。部分镜头使用真实 AI 视频，代码画面可按需补齐。':project.mode==='code'?'代码画面已就绪；配音可按需生成，点击导出后才会生成视频文件。':`代码预览已就绪，已有 ${aiDone} 个 AI 视频镜头。选择下方动作才会调用 MiniMax-H3；代码预览不代表 AI 视频已经生成。`;
}
function sceneArtPayload(target,index){
  const source=target.scenes[index];
  return {scene:{title:source.title,narration:source.narration,caption:source.caption,duration:source.duration,kind:source.kind,visual:source.visual},index,sceneCount:target.scenes.length,project:{title:target.title,topic:target.topic,summary:target.summary||'',duration:target.duration,ratio:target.ratio,style:target.style,brief:target.brief||'',scenes:target.scenes.map(scene=>({title:scene.title,kind:String(scene.kind||'process').replace(/^script:/,''),visual:scene.visual}))},previousDesigns:target.scenes.filter((scene,i)=>i!==index&&artReady(scene)).map(scene=>({layout:(scene.program||scene.composition).layout,designIntent:(scene.program||scene.composition).designIntent,fingerprint:scene.program?filmFingerprint(scene.program):compositionFingerprint(scene.composition)})),preferences:(source.artInstruction?'当前镜头修改要求：'+source.artInstruction+'\n':'')+rules.join('\n'),beatTimes:canApplyMusicBeat(target)?sceneMusicBeats(musicAnalysis(target),source.start,source.duration):[],referenceStyle:'独立构图、真实物件结构、关系与数量随推演变化；黑金参考采用衬线字、细线、暖光与克制尘点。禁止重复圆点仅换标签。'};
}
function canApplyMusicBeat(p=project){return validRhythm(musicAnalysis(p));}
function refreshMusicAnalysisStatus(){
  const status=$('musicAnalysisStatus'),button=$('alignMusicButton');if(!status||!button)return;
  const source=musicSource(project),analysis=musicAnalysis(project),name=source==='default'?DEFAULT_MUSIC.title:source==='custom'?'自选配乐':'原创氛围配乐';
  $('musicSourceSelect').value=source;
  $('beatSyncToggle').checked=project.settings.rhythmEnabled!==false;
  const plan=buildRhythmPlan(Number($('durationSelect').value)||90,analysis),stats=timelineRhythmStats(project,analysis);
  $('rhythmPlanHint').textContent=$('beatSyncToggle').checked?`${$('durationSelect').value} 秒建议约 ${plan.sceneCount} 镜；镜头越多，模型调用越多，可先做前2镜样片。`:'已关闭密集卡点，按讲解需要安排镜头。';
  $('musicTrackLabel').textContent=name+(canApplyMusicBeat()?` · ${Number(analysis.bpm||0).toFixed(1)} BPM · ${stats.aligned}/${stats.total} 次切换贴近拍点`:' · 节拍未可靠识别');
  if(!analysis){status.textContent='自选配乐未在本页载入，请上传音频或选择默认 We Never。';button.hidden=true;return;}
  const score=Math.round(Math.max(0,Math.min(1,Number(analysis.confidence)||0))*100),bpm=Number.isFinite(Number(analysis.bpm))&&Number(analysis.bpm)>0?'估计约 '+Math.round(Number(analysis.bpm))+' BPM · ':'';
  status.textContent=source==='default'?`默认配乐已换为 ${DEFAULT_MUSIC.title}（用户视频提取版）。约 ${analysis.bpm} BPM，按实测起音安排切换；长视频循环主体段落，片尾淡出。已有旧镜头不会自动重新分镜。`:source==='original'?'原创配乐使用已知合成节奏；未冒充实测音源。':canApplyMusicBeat()?bpm+'节拍评分 '+score+'/100，后续切换会优先落在检测到的拍点。':bpm+'节拍评分 '+score+'/100，未能可靠识别，保留必要阅读时长。';
  button.textContent='查看按配乐重新分镜的计划';button.hidden=!canApplyMusicBeat();button.disabled=busy;
}
function applyMusicBeatToCurrentScenes(){
  showRhythmPlan();
}
function showRhythmPlan(){
  const analysis=musicAnalysis(project),duration=Number($('durationSelect').value)||90,plan=buildRhythmPlan(duration,analysis),fragment=el('div');
  fragment.append(el('p','modal-copy',`${plan.sceneCount} 镜 · ${plan.alignedCuts}/${plan.totalCuts} 次切换可落在检测拍点。每镜保留讲解和阅读时间；不按每一拍机械切换。生成这些镜头会增加模型调用，可先选择前2镜样片。`));
  if(analysis?.waveform?.length){const wave=el('div','rhythm-wave');wave.setAttribute('role','img');wave.setAttribute('aria-label','实际音轨波形概览，竖线为建议切换点');for(let i=0;i<120;i++){const t=musicTimeAt((i+.5)/120*duration,analysis),value=analysis.waveform[Math.min(analysis.waveform.length-1,Math.floor(t/analysis.duration*analysis.waveform.length))],bar=el('span');bar.style.height=Math.max(3,Math.min(100,value*90))+'%';wave.append(bar);}for(const shot of plan.shots.slice(1)){const marker=el('i');marker.style.left=shot.start/duration*100+'%';marker.title=`第 ${shot.index} 镜 · ${shot.start.toFixed(2)} 秒`;wave.append(marker);}fragment.append(wave,el('p','review-note','实际音轨波形概览；竖线是建议切换点，长视频按相同主体段落循环。'));}
  const list=el('div','rhythm-cut-list');for(const shot of plan.shots){const row=el('div');row.append(el('strong','',String(shot.index).padStart(2,'0')),el('span','',`${shot.start.toFixed(2)}–${shot.end.toFixed(2)} 秒`),el('small','',shot.index===1?'开场':shot.cutOnBeat?'实测拍点切换':'保留阅读停顿'));list.append(row);}fragment.append(list);
  fragment.append(el('p','modal-copy','这是切换时间预案，不代表画面已生成。应用会重新请求当前主题的分镜，再制作所选流程的画面；分镜成功前保留原项目，其他已提交任务仍可在原项目查询。'));
  const button=el('button','button primary','使用卡点计划生成');button.type='button';button.disabled=busy;button.addEventListener('click',()=>{project.settings.rhythmEnabled=true;$('beatSyncToggle').checked=true;closeModal();generateProject({preventDefault(){}});});fragment.append(button);openModal('跟着音乐，让知识推进',fragment,'MUSIC CUT PLAN');
}
function applyBirthdayBrief(){
  if(busy)return toast('请等当前任务完成后再套用方案。');
  $('topicInput').value='23个人中，至少两个人生日相同的概率为什么超过50%？';$('durationSelect').value='120';selectedRatio='16:9';selectedStyle='noir';selectedMode='code';$('ratioSelect').value=selectedRatio;
  all('[data-style]').forEach(button=>{button.classList.toggle('selected',button.dataset.style===selectedStyle);button.setAttribute('aria-pressed',String(button.dataset.style===selectedStyle));});
  $('styleDescription').textContent=getStyle(selectedStyle).description;setMode(selectedMode);
  $('briefInput').value=String(BIRTHDAY_BRIEF).slice(0,18000);briefBinding={topic:$('topicInput').value,brief:$('briefInput').value};$('reuseBriefToggle').checked=false;$('creativeBriefDetails').open=true;$('topicHint').textContent='生日悖论方案已填入 · 点击生成才替换当前项目';toast('方案已填入：120 秒、16:9、黑金叙事。当前项目和媒体尚未改变。');
}
function checkSceneFrame(target,index,composition){
  const size=getDimensions(target.ratio,{preview:true}),scale=Math.min(1,360/Math.max(size.width,size.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(2,Math.round(size.width*scale));canvas.height=Math.max(2,Math.round(size.height*scale));
  const candidate={...target,scenes:target.scenes.map((scene,i)=>i===index?{...scene,composition,renderState:'complete'}:scene)};
  for(const phase of [.28,.72])engine.drawFrame(canvas.getContext('2d'),candidate,target.scenes[index].start+target.scenes[index].duration*phase,canvas.width,canvas.height);
}
async function renderSceneArts(target,indices,{signal,stage='正在按顺序设计代码画面',failureMode=$('sceneFailureMode').value}={}){
  indices=orderedSceneIndices(indices,target.scenes.length);
  const reviewRounds=Math.max(0,Math.min(2,Number($('reviewRoundsSelect').value)||0));
  const recoveryPolicy=$('sceneRecoveryPolicy').value;
  const states=new Map(indices.map(index=>[index,'pending']));
  const counts=()=>({completed:[...states.values()].filter(v=>v==='complete').length,failed:[...states.values()].filter(v=>v==='failed').length});
  const update=detail=>setGenerationProgress({stage,total:indices.length,...counts(),detail,measurable:true});
  const numbered=indices.map(i=>i+1).join(' → ');
  update('生成顺序：'+numbered+'。正在检查本地绘图环境，此步骤不调用模型。');
  const result=await runSceneQueue({indices,sceneCount:target.scenes.length,signal,failureMode,
    preflight:()=>ensureFilmRenderer({signal}),
    onStart:index=>{
      const scene=target.scenes[index];scene.renderState='generating';delete scene.renderError;states.set(index,'generating');
      update(`按顺序处理第 ${index+1} 镜「${scene.title}」 · 本次第 ${indices.indexOf(index)+1} / ${indices.length} 镜`);updateProjectUI();
    },
    run:async index=>{
      const scene=target.scenes[index],context=sceneArtPayload(target,index);
      const renderScene={...scene,renderDuration:undefined,sourceOffset:0,beatTimes:context.beatTimes};
      const result=await buildSceneWithRecovery({scene:renderScene,project:target,context,rounds:reviewRounds,textConfig:configs.text,visionConfig:effectiveVision(configs),signal,api,inspect:inspectFilmProgram,
        onStage:message=>update(`第 ${index+1} 镜 · 本次第 ${indices.indexOf(index)+1} / ${indices.length} 镜 · ${message}`),
        onCheckpoint:state=>{
          if(state.inspection)sceneFramePreviews.set(scene,state.inspection);
          scene.draftMeta={reviews:state.reviews,usage:state.usage,codeRepairs:state.repairs};scene.draftReady=state.ready;
          if(state.failure)scene.codeFailure=state.failure;
          else{scene.draftProgram=state.program;if(state.ready)delete scene.codeFailure;if(state.inspection)scene.draftThumbnail=state.inspection.thumbnail;}
          saveLocal();updateProjectUI();
        }
      },{policy:recoveryPolicy,onRewrite:(rewritten,recovery)=>{
        if(project!==target)throw Object.assign(new Error('项目已切换，未应用旧任务改写。'),{code:'PROJECT_CHANGED'});
        const originalNarration=scene.narration;if(rewritten.narration!==originalNarration)detachMedia([scene.id]);
        Object.assign(scene,{title:rewritten.title,narration:rewritten.narration,caption:rewritten.caption,visual:rewritten.visual,kind:'script:'+String(rewritten.kind||'process').replace(/^script:/,''),revision:(scene.revision||0)+1,recoveryMeta:{...recovery,originalNarration}});saveLocal();updateProjectUI();
      }});
      const {program,inspection,reviews,usage,repairs}=result;
      if(project!==target)throw Object.assign(new Error('项目已切换，未应用旧任务结果。'),{code:'PROJECT_CHANGED'});
      const fingerprint=filmFingerprint(program);
      if(target.scenes.some((other,i)=>i!==index&&artReady(other)&&other.program&&filmFingerprint(other.program)===fingerprint))throw Object.assign(new Error('此镜画面代码与已有镜头重复，已拒绝仅换标签。'),{code:'CODE_DUPLICATE',phase:'inspect'});
      scene.program=program;delete scene.composition;delete scene.renderDuration;scene.sourceOffset=0;scene.beatTimes=context.beatTimes;scene.thumbnail=inspection.thumbnail;
      scene.renderState='complete';target.isDemo=false;target.generatedFromApi=true;hasGenerated=true;
      scene.artMeta={fingerprint,usage,reviews,codeRepairs:repairs,reviewRounds,skill:FILM_SKILL,recovery:result.recovery,quality:inspection.quality,qualityVersion:FILM_QUALITY_VERSION,frameStats:inspection.stats.map(({coverage,bounds,signature,texts})=>({coverage,bounds,signature,textCount:texts?.length||0}))};
      delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;delete scene.codeFailure;delete scene.draftReady;delete scene.renderError;
      if(!playing&&selectedIndex===index&&currentTime<=scene.start+.02)currentTime=scene.start+Math.min(1,scene.duration*.12);
    },
    onResult:({index,status,error})=>{
      const scene=target.scenes[index];
      if(error){
        if(status!=='cancelled')runDiagnostics.track(target,scene.id,'code');
        scene.renderState=status==='cancelled'?'pending':'failed';scene.renderError=status==='cancelled'?'生成已取消，可继续生成。':error.message;scene.draftReady=false;
        if(status!=='cancelled')scene.codeFailure={...(scene.codeFailure||{}),message:error.message,code:error.code||'SCENE_RUNTIME',phase:error.phase||scene.codeFailure?.phase||'request'};
      }
      states.set(index,status==='cancelled'?'pending':status);saveLocal();updateProjectUI();
      const {completed,failed}=counts();update(`本次按顺序处理 ${completed+failed} / ${indices.length} 镜：完成 ${completed} 镜，失败 ${failed} 镜。失败原因保留在下方列表，范围外的镜头保持不变。`);
    }
  });
  updateProjectUI();saveLocal();
  const {completed,failed}=counts();
  const stopped=result.outcomes.at(-1);
  finishGeneration(result.paused?`第 ${stopped.index+1} 镜未完成，后续调用已暂停`:`所选范围已处理：完成 ${completed} 镜${failed?'，失败 '+failed+' 镜':''}`,{cancelled:result.cancelled});
  return result;
}
async function retrySceneArt(indices,{instruction='',fresh=false,failureMode=$('sceneFailureMode').value}={}){
  if(busy)return;
  indices=orderedSceneIndices(indices,project.scenes.length);
  if(!indices.length)return toast('所有镜头的代码画面都已完成。');
  if(!canUse('text'))return showServiceConfig('text','逐镜画面设计需要填写文本模型 API Key。');
  if(Number($('reviewRoundsSelect').value)>0&&!(effectiveVision(configs)?.apiKey&&effectiveVision(configs)?.baseURL&&effectiveVision(configs)?.model))return showServiceConfig('vision','请为视觉返修填写模型密钥，或将返修轮数改为0。');
  const target=project;pause();pushUndo();if(instruction||fresh)indices.forEach(index=>{const scene=target.scenes[index];scene.artInstruction=instruction||'保留原文案和全部事实，重新规划构图与演示步骤，减少同时显示的标签，使用分数排版和准确绘图工具，不能只微调失败旧布局。';delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;delete scene.codeFailure;scene.draftReady=false;sceneFramePreviews.delete(scene);});activeAbort=new AbortController();setBusy(true,'正在设计镜头画面…');
  setGenerationProgress({stage:'准备逐镜画面设计',newRun:true,detail:'保留其他已完成镜头，不重复请求它们。'});
  try{await renderSceneArts(target,indices,{signal:activeAbort.signal,failureMode,stage:indices.length===1?'正在设计当前镜头':'正在按顺序生成所选镜头'});}
  catch(error){finishGeneration(error.message,{cancelled:activeAbort?.signal.aborted});toast(error.message,true);}
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
  $('creationWorkflow').disabled=value;$('sceneRecoveryPolicy').disabled=value;
  $('musicSourceSelect').disabled=value;$('beatSyncToggle').disabled=value;$('viewRhythmPlanButton').disabled=value;
  $('redesignSceneButton').disabled=value;$('rewriteSceneButton').disabled=value;
  $('reviseButton').disabled = value;
  $('sceneVideoButton').disabled = value;
  $('speechButton').disabled = value;
  $('retrySceneButton').disabled=value;
  $('resumeArtButton').disabled=value;
  $('batchAIButton').disabled=value;
  $('resumeVideoTasksButton').disabled=value;
  updateSceneRangeControls();
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
  $('seekSlider').style.background = 'linear-gradient(to right,var(--accent) ' + (currentTime / project.duration * 100) + '%,var(--stroke) ' + (currentTime / project.duration * 100) + '%)';
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
    button.dataset.renderState=scene.renderState||'legacy';button.title=scene.renderError||scene.title;
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
  updateSceneRangeControls();
}
function renderInspector() {
  const scene = getScene();
  if (!scene) return;
  $('sceneNumber').textContent = '镜头 ' + String(selectedIndex + 1).padStart(2, '0');
  $('sceneRange').textContent = formatTime(scene.start) + ' – ' + formatTime(scene.start + scene.duration);
  $('sceneTitle').value = scene.title;
  $('sceneDuration').value = String(Number(scene.duration.toFixed(2)));
  const program=scene.codeFailure?.program||scene.draftProgram||scene.program;
  const frameInspection=sceneFramePreviews.get(scene);$('sceneFrameDetails').hidden=!frameInspection;
  if(frameInspection){
    $('sceneFrameReport').textContent=frameInspection.quality?.ok?'通过本地排版、边界与运动检查。':(frameInspection.quality?.issues||[]).map(i=>i.message).join(' ');
    if(frameInspection!==displayedFrameInspection){
      displayedFrameInspection=frameInspection;$('sceneFrameGrid').replaceChildren();
      frameInspection.frames.forEach((src,i)=>{const b=el('button','scene-frame-thumb');b.type='button';b.dataset.frameIndex=String(i);const img=el('img');img.src=src;img.alt=`第 ${selectedIndex+1} 镜实际渲染 · ${frameInspection.frameTimes?.[i]??i} 秒`;b.append(img,el('span','',`${frameInspection.frameTimes?.[i]??i} 秒 · 放大`));$('sceneFrameGrid').append(b);});
    }
  }
  $('sceneCodeDetails').hidden=!program&&!scene.codeFailure?.draft;
  $('sceneCodeSource').textContent=program?.source||scene.codeFailure?.draft||'';
  $('downloadCodeFailure').hidden=!scene.codeFailure&&!scene.renderError;
  const checks=scene.artMeta?.reviews||scene.draftMeta?.reviews||[];
  $('sceneCodeChecks').textContent=program?(scene.renderState==='complete'?'已完成':'草稿 · 尚在制作')+' · '+checks.length+' 轮看图返修\n'+checks.map(r=>'第 '+r.round+' 轮：'+r.feedback).join('\n'):'';

  $('sceneNarration').value = scene.narration || scene.caption || '';
  $('sceneVersion').textContent = scene.revision ? '修改版本 ' + scene.revision : project.isDemo ? '交互示意' : '原始版本';
  $('undoButton').disabled = undoStack.length === 0;
  $('revisionResult').hidden = true;
  const clips = (project.videoClips || []).filter((c) => c.sceneId === scene.id);
  const voices = (project.voiceClips || []).filter((c) => c.sceneId === scene.id);
  $('mediaStatus').textContent = (scene.renderError?'画面在'+({compile:'代码检查',draw:'执行绘图',inspect:'静帧检查',request:'模型请求'}[scene.codeFailure?.phase]||'执行')+'阶段未完成：'+scene.renderError+' ':artReady(scene)?'独立代码画面已完成。 ':'代码画面尚未完成。 ') + (clips.length?'此镜已有 AI 视频。 ':'此镜尚无 AI 视频。 ')+(voices.length?'已有配音。':'旁白可按需生成。');
  if(scene.videoError)$('mediaStatus').textContent+=' AI 视频未取回：'+scene.videoError;
  $('mediaStatus').dataset.error=String(!!scene.renderError||!!scene.videoError);
  $('retrySceneButton').hidden=artReady(scene);$('retrySceneButton').textContent='修复 / 继续此镜代码';
  $('sceneVideoButton').disabled = busy;
}
function updateProjectUI(renderShots = true) {
  selectedIndex = Math.min(selectedIndex, project.scenes.length - 1);
  const size=getDimensions(project.ratio,{preview:true}),full=getDimensions(project.ratio);
  const canvas=$('previewCanvas');if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;}
  $('canvasWrap').style.setProperty('--preview-ratio',String(full.width/full.height));$('canvasWrap').style.aspectRatio=full.width+' / '+full.height;$('canvasWrap').classList.toggle('landscape-preview',full.width>full.height);
  $('stageLabel').textContent=full.width+' × '+full.height;
  const missing=missingFrames(),modeName={code:'代码动画',ai:'AI 影像',mixed:'混合制作'}[project.mode]||'代码动画',aiCount=new Set((project.videoClips||[]).map(c=>c.sceneId)).size;
  $('previewBadge').textContent=project.isDemo?'内置示意 · 未生成':missing.length?`${modeName} · ${missing.length} 镜待完成`:project.mode==='code'&&!artMissing().length?'独立代码画面':`代码 / AI 画面 · ${aiCount} 镜 AI 视频`;
  $('previewNote').lastChild.textContent=lastScriptFailure?`当前预览来自本机保存的《${project.title}》；本次新请求未应用，可恢复下载的分镜或继续已有画面制作。`:project.isDemo?'当前是内置示意。新创作按 vibe-knowledge-film 流程逐镜写代码，并根据实际画面返修。':missing.length?'分镜已生成，画面仍在逐镜制作；未完成的镜头不会用旧模板冒充。':project.mode==='code'&&!artMissing().length?'独立代码画面已就绪；导出时逐帧渲染并合成配音、配乐和字幕。':`当前已有 ${aiCount} 镜真实 AI 视频，其余使用已完成代码画面；可按需继续生成。`;
  if(!busy)$('projectStatus').textContent=project.isDemo?'当前为内置示意，尚未调用 API':missing.length?`${project.scenes.length-missing.length} / ${project.scenes.length} 镜画面完成`:`画面已就绪 · ${project.scenes.length} 镜`;
  refreshMusicAnalysisStatus();
  $('voiceToggle').checked=!!project.settings.voice;$('captionsToggle').checked=!!project.settings.captions;$('musicToggle').checked=!!project.settings.music;
  updateTransport();renderInspector();if(renderShots)renderTimeline();updateSceneRangeControls();renderSceneFailures();renderNeeded=true;
}

function syncForm() {
  $('topicInput').value=project.topic||project.title;
  $('briefInput').value=typeof project.brief==='string'?project.brief:'';
  $('reuseBriefToggle').checked=false;
  briefBinding={topic:$('topicInput').value,brief:$('briefInput').value};
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
function refreshUsage(){
  const s=usageLedger.summary(),done=s.settled.map(formatCost).join(' + '),pending=s.pending.map(formatCost).join(' + ');
  $('usageSummary').textContent=s.calls?(done?'已返回用量约 '+done:'费用待确认')+(pending?' · 已提交预算 '+pending:'')+(s.unknown?` · ${s.unknown} 次请求单价 / 用量待确认`:''):'本次尚无新增生成请求';
  $('usageNote').textContent=`本次记录 ${s.calls} 次生成 / 返修请求。按官方刊例价估算，处理中及失败任务不视为免费；套餐、优惠、峰谷时段与实际扣费以官方账单为准。单价核对：${PRICE_SOURCES.checked}。`;
}
function showUsageDetails(){
  const frag=document.createDocumentFragment();frag.append(el('p','modal-copy','仅记录本页的用量和任务编号，不含密钥、旁白或提示词。历史页面产生的费用需在官方控制台查看；取回原任务不重新提交生成。'));
  const sessions=usageLedger.export();
  for(const session of sessions.slice().reverse()){
    frag.append(el('h3','',session.label));
    for(const e of session.entries){const row=el('div','usage-row');row.append(el('strong','',e.model+' · '+e.type),el('span','',e.tokens?`输入 ${e.tokens.input} / 输出 ${e.tokens.output} tokens（缓存 ${e.tokens.cache}）`:e.type==='video'?`${e.seconds} 秒 · ${e.resolution} · ${e.jobId||'未返回任务编号'}`:`${e.characters||0} 个计费字符`),el('small','',formatCost(e.amount)+' · '+({completed:'已返回用量估算',queued:'已提交预算',in_progress:'生成中预算',failed:'任务失败，扣费待核实',unconfirmed:'请求费用待核实'}[e.status]||e.status)));frag.append(row);}
    if(!session.entries.length)frag.append(el('p','modal-copy','未记录新的生成调用。'));
  }
  const link=el('a','text-button','打开 MiniMax 官方用量与费用记录 ↗');link.href='https://platform.minimax.cn/console/consumption-detail';link.target='_blank';link.rel='noopener noreferrer';frag.append(link);
  const exportButton=el('button','button secondary','导出用量记录');exportButton.addEventListener('click',()=>saveDownload(new Blob([JSON.stringify(sessions,null,2)],{type:'application/json'}),'用量估算记录.json').catch(e=>toast(e.message,true)));frag.append(exportButton);openModal('用量与费用估算',frag,'USAGE');
}
function showPricingSettings(){
  if(busy)return toast('请等当前任务完成后修改估算单价。');
  const frag=document.createDocumentFragment(),forms=[],seen=new Set();
  frag.append(el('p','modal-copy','已内置 MiniMax 官方国内 H3 768P ¥0.50/秒、2K ¥0.80/秒、Speech 2.8 HD ¥3.50/万计费字符，以及 DeepSeek Flash 官方峰谷区间。这里可按你的合同/套餐覆盖单价；只影响估算。'));
  for(const [type,label]of [['text','文本模型'],['vision','视觉模型'],['speech','配音'],['video','视频']]){
    const c=type==='vision'?effectiveVision(configs):configs[type],key=priceKey(c,type);if(seen.has(key))continue;seen.add(key);
    const rate=priceFor(c,type),section=el('div','pricing-card');section.append(el('h3','',label+' · '+c.model));
    const custom=el('input');custom.type='checkbox';custom.checked=!!rate?.custom;const customLabel=el('label','scene-range-keep');customLabel.append(custom,el('span','','使用自定义单价'));section.append(customLabel);
    const currency=el('select');currency.append(new Option('人民币 CNY','CNY'),new Option('美元 USD','USD'));currency.value=rate?.currency||'CNY';section.append(currency);
    const fields={};for(const [name,title]of type==='text'||type==='vision'?[['input','输入 / 百万 tokens'],['output','输出 / 百万 tokens'],['cache','缓存输入 / 百万 tokens']]:[['unit',type==='video'?'每秒视频（当前规格）':'每万计费字符']]){const wrap=el('label','provider-field',title),input=el('input');input.type='number';input.min='0';input.step='any';input.placeholder='未设置';input.value=Number.isFinite(rate?.[name])?String(rate[name]):'';wrap.append(input);section.append(wrap);fields[name]=input;}
    forms.push({type,c,custom,currency,fields});frag.append(section);
  }
  const save=el('button','button primary','保存估算单价');save.addEventListener('click',()=>{
    for(const f of forms){if(f.custom.checked&&Object.values(f.fields).some(i=>i.value!==''&&(!Number.isFinite(Number(i.value))||Number(i.value)<0)))return toast('请输入非负单价。',true);}
    for(const f of forms)setPriceOverride(f.c,f.type,f.custom.checked?{currency:f.currency.value,...Object.fromEntries(Object.entries(f.fields).map(([k,input])=>[k,input.value]))}:null);refreshUsage();closeModal();toast('估算单价已保存，后续请求使用新单价。');
  });frag.append(save);openModal('费用估算单价',frag,'PRICE SETTINGS');
}
function showVideoTaskProgress(job,label=''){
  const text={queued:'排队中',in_progress:'正在生成',completed:'生成完成，正在取回片段',failed:'任务失败',cancelled:'任务已取消'}[job.status]||job.status;
  const box=$('videoTaskProgress');box.hidden=false;box.setAttribute('aria-busy',String(!['completed','failed','cancelled'].includes(job.status)));
  const checked=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
  $('videoTaskState').textContent=`${label}${text}${Number.isFinite(job.progress)?' · '+Math.round(job.progress)+'%':' · 服务商未提供百分比'} · 最近查询 ${checked} · ${job.id}`;
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
function showServiceConfig(initialTab='text',note=''){
  if(busy)return toast('当前任务执行中，请完成后再更换模型接口。');
  const fragment=document.createDocumentFragment();
  if(note)fragment.append(el('div','modal-callout',note));
  fragment.append(el('p','modal-copy','分别配置供应商、API Base URL、模型 ID 和密钥。URL 与模型保存在本机；密钥只保留在当前页面，刷新后清除。'));
  const tabs=el('div','provider-tabs'),cards=el('div','provider-cards'),forms={};
  const names={text:'文本 / 脚本',vision:'视觉返修',speech:'配音',video:'视频镜头'};
  const status=el('div','model-status','连接测试只读取服务信息，不提交视频或配音生成。');
  function activate(type){for(const [key,f]of Object.entries(forms)){f.card.hidden=key!==type;f.tab.classList.toggle('active',key===type);f.tab.setAttribute('aria-selected',String(key===type));}}
  function labelled(label,node){const wrap=el('label','provider-field',label);wrap.append(node);return wrap;}
  for(const type of Object.keys(names)){
    const c=configs[type]||defaultConfigs[type],tab=el('button','button secondary',names[type]);tab.type='button';tab.setAttribute('role','tab');tab.addEventListener('click',()=>activate(type));tabs.append(tab);
    const card=el('section','provider-card');card.hidden=true;
    const preset=el('select');preset.setAttribute('aria-label',names[type]+'供应商');preset.append(...SERVICE_PROVIDERS[type].map(p=>new Option(p.label,p.id)));
    preset.value=SERVICE_PROVIDERS[type].find(p=>p.baseURL===c.baseURL&&p.provider===c.provider)?.id||'custom';
    const protocol=el('select');protocol.setAttribute('aria-label',names[type]+'接口协议');
    const protocols=type==='text'||type==='vision'?[['openai-compatible','OpenAI Chat Completions'],['anthropic','Anthropic Messages'],['gemini','Gemini GenerateContent']]:type==='speech'?[['minimax','MiniMax 原生语音'],['openai-compatible','OpenAI 兼容语音']]:[['minimax','MiniMax H3 / V2'],['dashscope','DashScope / Wan'],['openai-compatible','Videos 兼容协议']];
    protocol.append(...protocols.map(([id,label])=>new Option(label,id)));protocol.value=c.provider;
    const url=el('input');url.type='url';url.value=c.baseURL||'';url.placeholder='https://your-provider.example/v1';url.autocomplete='off';url.spellcheck=false;url.maxLength=2000;url.setAttribute('aria-label',names[type]+' API URL');
    const model=el('input');model.value=c.model||'';model.placeholder='填写服务商提供的模型 ID';model.spellcheck=false;model.maxLength=160;model.setAttribute('aria-label',names[type]+'模型');
    const key=el('input');key.type='password';key.value=c.apiKey||'';key.placeholder='填写这个接口的 API Key';key.autocomplete='off';key.spellcheck=false;key.maxLength=4096;key.setAttribute('aria-label',names[type]+' API Key');
    const jsonMode=el('input');jsonMode.type='checkbox';jsonMode.checked=c.jsonMode!==false;
    const inherit=el('input');inherit.type='checkbox';inherit.checked=c.inherit!==false;
    if(type==='vision'){card.append(labelled('沿用文本模型的 URL、模型和密钥',inherit),el('p','modal-copy','视觉返修需要支持图片输入的模型；可单独选择多模态模型，或将返修轮数设为0。'));}
    card.append(labelled('供应商预设',preset),labelled('接口协议',protocol),labelled('API Base URL',url),labelled('模型 ID',model),labelled('API Key',key));
    if(type==='text'||type==='vision')card.append(labelled('请求 JSON 输出格式（兼容服务不支持时可关闭）',jsonMode));
    const test=el('button','button secondary','测试此接口');test.type='button';card.append(test);
    if(type==='video'){
      const reuse=el('button','button quiet','使用配音接口的密钥');reuse.type='button';reuse.addEventListener('click',()=>{try{if(new URL(url.value).hostname!==new URL(forms.speech.url.value).hostname)throw Error();key.value=forms.speech.key.value;status.textContent='已在本页复用配音接口密钥。';}catch{status.textContent='配音与视频接口域名不同，请分别填写对应的密钥。';}});card.append(reuse);
    }
    const toggleInherited=()=>{if(type==='vision')for(const input of [preset,protocol,url,model,key,jsonMode,test])input.disabled=inherit.checked;};inherit.addEventListener('change',toggleInherited);toggleInherited();
    preset.addEventListener('change',()=>{const p=SERVICE_PROVIDERS[type].find(p=>p.id===preset.value);if(!p)return;let oldHost='',newHost='';try{oldHost=new URL(url.value).hostname;}catch{}try{newHost=new URL(p.baseURL).hostname;}catch{}if(newHost!==oldHost)key.value='';protocol.value=p.provider;url.value=p.baseURL;model.value=p.model;status.textContent='请确认 URL、模型 ID 和该供应商对应的密钥。';});
    test.addEventListener('click',async()=>{readForms();const selected=type==='vision'?effectiveVision(configs):configs[type];if(!selected.apiKey||!selected.baseURL||!selected.model){status.textContent='请填写 API URL、模型 ID 和 API Key。';return;}test.disabled=true;status.textContent='正在查询接口…';try{const r=await api.testConnection(selected,{capability:type==='vision'?'text':type});status.textContent=r.message;}catch(e){status.textContent=e.message;}finally{test.disabled=false;toggleInherited();}});
    forms[type]={card,tab,preset,protocol,url,model,key,jsonMode,inherit};cards.append(card);
  }
  function readForms(){for(const [type,f]of Object.entries(forms))configs[type]={provider:f.protocol.value,baseURL:f.url.value.trim(),model:f.model.value.trim(),apiKey:f.key.value.trim(),jsonMode:f.jsonMode.checked,customEndpoint:true,...(type==='vision'?{inherit:f.inherit.checked}:{})};}
  const actions=el('div','modal-actions'),save=el('button','button primary','应用模型配置');
  save.addEventListener('click',()=>{for(const [type,f]of Object.entries(forms)){if(type==='vision'&&f.inherit.checked)continue;if(!f.url.value.trim())continue;try{const u=new URL(f.url.value.trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}catch{activate(type);status.textContent='API Base URL 请使用 HTTPS，且不要包含账号、密码、查询参数或密钥；密钥单独填在 API Key 中。';f.url.focus();return;}}readForms();try{localStorage.setItem(MODEL_METADATA,JSON.stringify(endpointMetadata(configs)));}catch{}closeModal();$('costNote').firstChild.textContent=canUse('text')?configs.text.model+' · 按实际用量付费':'填写模型接口后开始创作';toast('模型配置已应用；密钥仅在本页有效。');});actions.append(save);
  fragment.append(tabs,cards,status,el('p','modal-copy','Base URL 填接口基础地址。自定义服务须为公开 HTTPS 域名；密钥会发往你填写的地址。模型权限与余额以服务商实际返回为准。'),actions);
  openModal('选择你的模型与接口',fragment,'MODEL CONNECTIONS');activate(forms[initialTab]?initialTab:'text');
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
  if(!canUse('text'))return showServiceConfig('text','先填写文本模型 API Key。生成将依次请求分镜和每镜独立画面，不会把通用模板替换文字后当作完成。');
  lastScriptFailure=null;$('scriptFailureActions').hidden=true;
  if($('creationWorkflow').value!=='storyboard'&&Number($('reviewRoundsSelect').value)>0&&!(effectiveVision(configs)?.apiKey&&effectiveVision(configs)?.baseURL&&effectiveVision(configs)?.model))return showServiceConfig('vision','请先配置视觉返修模型，或将返修轮数改为0。');
  pause();activeAbort=new AbortController();setBusy(true,'正在构思分镜…');
  setGenerationProgress({stage:'第一步 · 构思分镜',detail:'正在等待文本模型编排知识推演。此阶段没有可验证的百分比。',newRun:true});
  $('generateButton').querySelector('span').textContent='正在创作…';
  let storyboardApplied=false;
  try{
    const sourceMusic=project.musicBlob,sourceMusicAnalysis=project.musicAnalysis;
    const directing=directingBriefForTopic({topic,brief:$('briefInput').value,boundTopic:briefBinding.topic,boundBrief:briefBinding.brief,reuse:$('reuseBriefToggle').checked});
    if(directing.skipped){$('topicHint').textContent='新主题：本次未沿用旧主题的导演脚本；个人偏好与画面风格继续使用。';}
    const options={topic,brief:directing.brief.slice(0,18000),duration:Number($('durationSelect').value),ratio:selectedRatio,style:selectedStyle,mode:selectedMode,audience:'普通成年人',preferences:rules.join('\n'),rhythmEnabled:$('beatSyncToggle').checked,musicSource:musicSource(project),musicStyle:project.settings.musicStyle||'ambient',musicAnalysis:musicSource(project)==='custom'?musicAnalysis(project):null};
    const script=await api.generateScript(configs.text,options,{signal:activeAbort.signal,onRepair:info=>setGenerationProgress({stage:'第一步 · 正在整理返回的分镜（1 / 1）',detail:info.reason+' 正在保留原内容并修正格式；此次会追加一次文本模型请求。'})});
    const next=engine.createProjectFromScript(script,options);if(!validProject(next))throw new Error('模型返回的分镜结构不完整，原项目保留。');
    pushUndo();project=next;storyboardApplied=true;project.mode=selectedMode;project.brief=options.brief;project.scriptMeta=script.apiMeta;if(sourceMusic instanceof Blob){project.musicBlob=sourceMusic;if(sourceMusicAnalysis)project.musicAnalysis=sourceMusicAnalysis;}project.isDemo=false;project.generatedFromApi=true;hasGenerated=true;
    runDiagnostics.begin(project);$('briefInput').value=options.brief;briefBinding={topic,brief:options.brief};
    if(script.normalizations?.length)toast(script.normalizations.join(' '));
    project.settings={music:$('musicToggle').checked,voice:$('voiceToggle').checked,captions:$('captionsToggle').checked,musicSource:options.musicSource,musicStyle:options.musicStyle,rhythmEnabled:options.rhythmEnabled};project.rhythmPlan=script.rhythmPlan||null;
    project.scenes.forEach(scene=>{scene.renderState='pending';delete scene.composition;delete scene.program;});selectedIndex=0;currentTime=0;releaseClipURL();updateProjectUI();saveLocal();
    const workflow=$('creationWorkflow').value,indices=creationSceneIndices(project.scenes.length,workflow);
    if(indices.length)await renderSceneArts(project,indices,{signal:activeAbort.signal,stage:workflow==='pilot'?'第二步 · 前两镜样片制作':'第二步 · 逐镜独立设计画面'});
    else{setGenerationProgress({stage:'分镜已完成，等待按范围制作画面',total:project.scenes.length,completed:0,measurable:true,detail:'本次仅生成分镜，未调用任何镜头绘制。可先编辑文案，再选择镜头范围。'});finishGeneration('分镜已完成，画面尚未生成');}
    toast(workflow==='storyboard'?'分镜已生成，可先编辑后按范围制作画面。':workflow==='pilot'?'前两镜样片已处理，其余镜头尚未调用。预览后可按范围继续。':artMissing().length?'部分镜头尚未完成，可单独重试。':'代码画面已就绪；配音、AI 视频镜头和导出由你按需继续。');
  }catch(error){
    if(!storyboardApplied&&error.recovery?.draft){lastScriptFailure={topic,code:error.code,message:error.message,shape:error.recovery.shape,finishReason:error.recovery.finishReason,draft:error.recovery.draft};$('scriptFailureActions').hidden=false;const canContinue=!project.isDemo&&project.topic?.trim()===topic&&artMissing().length>0;$('continueSavedStoryboard').hidden=!canContinue;$('continueSavedStoryboard').textContent=`继续已有 ${project.scenes.length} 镜画面制作`;}
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
async function revise({preserveFacts=false}={}) {
  const instruction = $('revisionInput').value.trim();
  if (!instruction) return toast('说说你希望这一镜怎么改');
  if (busy) return;
  const codeNeedsDesign=!!getScene().program&&/粒子|光点|精简|简洁|详细|标注|体积|材质|布局|构图|立体|路径|物体/.test(instruction);
  const needsSemantic=preserveFacts||codeNeedsDesign||/(解释|旁白|文案|内容|例子|类比|物件|场景|改写|讲清|通俗|易懂|准确|错误|举例|替换|换成(?!(?:深|浅)?(?:蓝|金|橙|青|暖|冷)))/i.test(instruction);
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
    if(Number($('reviewRoundsSelect').value)>0&&!(effectiveVision(configs)?.apiKey&&effectiveVision(configs)?.baseURL&&effectiveVision(configs)?.model))return showServiceConfig('vision','请先配置视觉返修模型，或将返修轮数改为0。');
    setBusy(true, '正在请求模型修改当前镜头…');activeAbort=new AbortController();
    setGenerationProgress({stage:'正在改写当前镜头',detail:'先修改讲解，再为这一镜重新设计画面；其他镜头不重新请求。',newRun:true});
    const index = selectedIndex;
    const targetProject = project;
    const sourceScene = getScene();
    const apiScene = Object.assign({}, sourceScene, { kind: String(sourceScene.kind || 'process').replace(/^script:/, '') });
    if (!engine.SCRIPT_KINDS.includes(apiScene.kind)) apiScene.kind = 'process';
    const revised = await api.reviseSceneWithAI(configs.text, { scene: apiScene, instruction, preserveFacts, context: JSON.stringify({ topic: project.topic, title: project.title, previousScene: project.scenes[index - 1]?.title, nextScene: project.scenes[index + 1]?.title }) },{signal:activeAbort.signal});
    if (project !== targetProject) throw new Error('项目已切换，未把旧任务写入新项目。');
    const old = project.scenes[index];
    const candidate = Object.assign({}, old, revised, { id: old.id, start: old.start, duration: old.duration, kind: 'script:' + String(revised.kind || 'process').replace(/^script:/, ''), revision: (old.revision || 0) + 1 });
    if (typeof candidate.narration !== 'string' || typeof candidate.title !== 'string') throw new Error('模型返回的镜头文案不完整，已保留原版本。');
    pushUndo(); const removed = detachMedia([old.id]); delete candidate.composition;delete candidate.program;delete candidate.draftProgram;delete candidate.draftThumbnail;delete candidate.draftMeta;delete candidate.codeFailure;delete candidate.draftReady;candidate.renderState='pending';candidate.artInstruction=instruction;project.scenes[index] = candidate;
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
  if(contentChanged&&!project.isDemo){delete scene.composition;delete scene.program;delete scene.draftProgram;delete scene.draftThumbnail;delete scene.draftMeta;delete scene.codeFailure;delete scene.draftReady;scene.renderState='pending';scene.renderError='文案已修改，请重新设计这一镜画面。';}
  markChanged(); toast('镜头文案已更新。'+(contentChanged&&!project.isDemo?'此镜画面需要重新设计。':'') + (removed ? '此镜原有媒体需重新生成。' : ''));
}
function videoDurations(){if(configs.video.provider==='minimax')return Array.from({length:12},(_,i)=>i+4);if(configs.video.provider==='dashscope')return /^wan2\.[7-9]|^wan[3-9]/.test(configs.video.model)?Array.from({length:14},(_,i)=>i+2):[5,10,15];return [4,8,12];}
function clipDuration(scene){const options=videoDurations();return options.find(v=>v>=scene.duration)||options.at(-1);}
function aiPrompt(scene){return '为知识科普短片制作精致且连续运动的画面。主题：'+project.topic+'。镜头：'+scene.title+'。具体物件：'+(scene.visual?.description||scene.narration)+'。动作与推演：'+(scene.visual?.action||scene.program?.designIntent||scene.composition?.designIntent||'建立对象、发生变化、显示结果')+'。风格：'+getStyle(project.style).description+'。画面不生成字幕、文字或数字，文字由后期准确合成。';}
function showBatchAI({existingOnly=false}={}){
  if(busy)return toast('请等当前任务完成。');
  if(!canUse('video'))return showServiceConfig('video','请配置视频接口的 URL、模型和 API Key。');
  const fragment=document.createDocumentFragment();fragment.append(el('p','modal-copy',existingOnly?'只查询和下载保存的原任务，不创建新的生成任务。原任务已经发生的费用以官方账单为准。':'按编号逐镜提交。默认继续已有任务；选择重新生成失败任务才会新建并重新计费。'+(project.ratio==='4:5'?'4:5 将由3:4素材裁切。':'')));
  const checks=[],list=el('div','batch-shot-list');
  project.scenes.forEach((scene,index)=>{
    const row=el('label','batch-shot-row'),check=el('input');check.type='checkbox';check.checked=!(project.videoClips||[]).some(c=>c.sceneId===scene.id)&&(!existingOnly||!!scene.videoTask?.id);check.disabled=existingOnly&&!scene.videoTask?.id;check.dataset.id=scene.id;checks.push(check);
    const copy=el('span','',`${String(index+1).padStart(2,'0')} · ${scene.title}`);copy.append(el('small','',scene.videoTask?.id?'原任务 '+scene.videoTask.id+' · '+scene.videoTask.status:`${clipDuration(scene)} 秒新 AI 片段`));if(scene.videoError)copy.append(el('small','',scene.videoError));row.append(check,copy);list.append(row);
  });
  const restart=el('input');restart.type='checkbox';restart.disabled=existingOnly;const restartLabel=el('label','scene-range-keep');restartLabel.append(restart,el('span','','为已失败 / 取消任务重新提交生成（会新计费）'));
  const resolution=el('select');resolution.append(new Option('768P · 较低费用','768P'),new Option('2K · 较高画质','2K'));resolution.disabled=existingOnly;
  const quote=el('div','model-status'),status=el('div','model-status','尚未提交。'),submit=el('button','button primary'),cancel=el('button','button secondary','关闭');let controller;
  const updateLabel=()=>{
    const selected=checks.filter(c=>c.checked).map(c=>project.scenes.find(s=>s.id===c.dataset.id)),fresh=selected.filter(s=>!existingOnly&&(!s.videoTask?.id||restart.checked&&['failed','cancelled'].includes(s.videoTask.status)));
    const seconds=fresh.reduce((sum,s)=>sum+clipDuration(s),0);submit.textContent=(existingOnly?'只取回':'生成 / 继续')+`所选 ${selected.length} 镜`;
    quote.textContent=fresh.length?`预计新增 ${fresh.length} 个任务、${seconds} 秒：约 ${formatCost(estimateVideoCost(configs.video,seconds,resolution.value))}。不含可能的提示词优化与配音。`:'只查询已有任务，不新增生成预算；历史任务费用不会因此退回。';
  };
  checks.forEach(c=>c.addEventListener('change',updateLabel));restart.addEventListener('change',updateLabel);resolution.addEventListener('change',updateLabel);updateLabel();
  cancel.addEventListener('click',()=>{if(controller)controller.abort();else closeModal();});
  submit.addEventListener('click',async()=>{
    if(busy)return;const ids=checks.filter(c=>c.checked).map(c=>c.dataset.id);if(!ids.length){status.textContent='请至少选择一个已有任务或待生成镜头。';return;}
    pause();pushUndo();const target=project;controller=new AbortController();activeAbort=controller;setBusy(true,'正在处理所选 AI 任务…');submit.disabled=true;cancel.textContent='停止后续任务';let completedCount=0,failedCount=0,paused=false;
    setGenerationProgress({stage:existingOnly?'正在取回原 AI 任务':'正在生成所选 AI 视频镜头',total:ids.length,completed:0,detail:'按编号处理，任务状态与完成数分别显示。',measurable:true,newRun:true});
    try{
      for(const id of ids){
        if(controller.signal.aborted)throw new DOMException('已停止后续任务','AbortError');const scene=target.scenes.find(s=>s.id===id);if(!scene)continue;
        const index=target.scenes.indexOf(scene);let phase='提交';
        try{
          const length=clipDuration(scene),job=await resolveVideoJob({scene,config:configs.video,options:{prompt:aiPrompt(scene),duration:length,ratio:target.ratio,resolution:resolution.value},api,signal:controller.signal,existingOnly,restartFailed:restart.checked});
          saveLocal();phase='查询';
          const ready=await api.pollVideoTask(configs.video,job,{signal:controller.signal,onProgress:jobState=>{scene.videoTask={...scene.videoTask,...jobState};saveLocal();showVideoTaskProgress(jobState,`第 ${index+1} 镜 · `);status.textContent=$('videoTaskState').textContent;$('generationDetail').textContent=`第 ${index+1} 镜「${scene.title}」：服务商任务 ${jobState.status}；已取回 ${completedCount} / ${ids.length} 镜。`;}});
          scene.videoTask={...scene.videoTask,...ready};saveLocal();phase='下载';status.textContent='第 '+(index+1)+' 镜生成已完成，正在下载原结果。';
          const blob=await api.downloadVideo(configs.video,ready,{signal:controller.signal});if(project!==target)throw new Error('项目已切换，未写入旧任务。');
          target.videoClips=[...(target.videoClips||[]).filter(c=>c.sceneId!==scene.id),{sceneId:scene.id,blob,start:scene.start,duration:Math.min(scene.videoTask.duration||length,scene.duration),jobId:ready.id}];delete scene.videoError;completedCount++;releaseClipURL();saveLocal();updateProjectUI();
        }catch(error){
          if(controller.signal.aborted||error.name==='AbortError')throw error;failedCount++;scene.videoError=`${phase}阶段：${error.message}`;scene.videoErrorCode=error.code||'VIDEO_ERROR';runDiagnostics.track(target,scene.id,'video');saveLocal();updateProjectUI();status.textContent='第 '+(index+1)+' 镜 · '+scene.videoError;
          if(shouldPauseVideoBatch(error))paused=true;
        }
        setGenerationProgress({stage:existingOnly?'正在取回原 AI 任务':'正在生成所选 AI 视频镜头',total:ids.length,completed:completedCount,failed:failedCount,detail:`已取回 ${completedCount} 镜，失败 ${failedCount} 镜，${ids.length-completedCount-failedCount} 镜尚未处理。具体错误保存在下方。`,measurable:true});
        if(paused)break;
      }
      finishGeneration(paused?'AI 任务处理已暂停，原任务编号已保留':failedCount?'部分 AI 镜头未完成':'所选 AI 视频镜头已取回');
      status.textContent+=` 已加入 ${completedCount} 个片段，${failedCount} 镜未完成。${paused?'后续任务未继续提交。':''}`;
    }catch(error){finishGeneration('AI 任务处理已停止',{cancelled:controller.signal.aborted});status.textContent=error.name==='AbortError'?'已停止后续操作，已提交任务可稍后继续取回。':error.message;}
    finally{setBusy(false);submit.disabled=false;controller=null;activeAbort=null;cancel.textContent='关闭';updateProjectUI(false);}
  });
  const actions=el('div','modal-actions');actions.append(cancel,submit);fragment.append(list,resolution,restartLabel,quote,status,actions);openModal(existingOnly?'只取回已提交 AI 结果':'选择 AI 视频镜头',fragment,'AI VIDEO TASKS');
}

function showVideoGeneration() {
  if (!canUse('video')) return showServiceConfig('video', '请配置视频接口的 URL、模型和 API Key；提交新任务按服务商用量计费。');
  const scene = getScene();
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', '只生成当前镜头的动态影像，字幕继续由本站叠加。MiniMax-H3 每镜支持 4–15 秒，较长成片由多个镜头组合。'+(project.ratio==='4:5'?'4:5 画面将使用 3:4 素材裁切。':'')));
  const promptLabel = el('label', 'field-label', '镜头画面提示词');
  const prompt = el('textarea'); prompt.rows = 7; prompt.maxLength = 7000;
  prompt.value = typeof scene.visual?.prompt === 'string' ? scene.visual.prompt : '为知识科普短片制作精致、连续运动的画面。主题：' + project.topic + '。镜头：' + scene.title + '。表现内容：' + (scene.visual?.description || scene.narration) + '。动作：' + (scene.visual?.action || '连续推进核心机制') + '。具有体积光影、明确视觉主体与镜头运动。画面中不要生成字幕、文字或数字，字幕另行合成。';
  const durationLabel = el('label', 'field-label', 'AI 片段时长');
  const duration = el('select');
  const allowedDurations = videoDurations();
  allowedDurations.forEach((v) => duration.append(new Option(v + ' 秒', String(v))));
  duration.value = String(allowedDurations.find((v) => v >= scene.duration) || allowedDurations.at(-1));
  const status = el('div', 'model-status', scene.videoError||'尚未提交任务。调用费用以你的服务商账户为准。');
  const resultLink=el('a','button secondary','打开官方已生成片段 ↗');resultLink.target='_blank';resultLink.rel='noopener noreferrer';
  const updateResultLink=()=>{const url=safeVideoResultURL(scene.videoTask?.videoURL);resultLink.hidden=!url;if(url)resultLink.href=url;};updateResultLink();
  const restart=el('input');restart.type='checkbox';const restartLabel=el('label','scene-range-keep');restartLabel.append(restart,el('span','','重做失败 / 取消任务（创建新任务并计费）'));restartLabel.hidden=!scene.videoTask?.id;
  const quote=el('p','modal-copy');const updateQuote=()=>{quote.textContent=scene.videoTask?.id&&!restart.checked?'将继续查询 / 取回原任务，不提交新的生成。':`新任务预计 ${formatCost(estimateVideoCost(configs.video,Number(duration.value)))}（768P，${duration.value} 秒）；实际以官方账单为准。`;};duration.addEventListener('change',updateQuote);restart.addEventListener('change',updateQuote);updateQuote();
  const note = el('div', 'modal-callout', '片段短于镜头时，剩余时间回到代码图解。你也可以调整镜头时长。生成后建议核对人物、数量和运动是否符合知识内容。');
  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'button secondary', '关闭');
  let controller;
  cancel.addEventListener('click', () => { if (controller) controller.abort(); closeModal(); });
  const generate = el('button', 'button primary', scene.videoTask?.id?'继续查询 / 下载原任务':'提交生成此镜画面');
  generate.addEventListener('click', async () => {
    if (busy) return;
    controller = new AbortController();activeAbort=controller; generate.disabled = true; setBusy(true, '正在生成当前 AI 镜头…');setGenerationProgress({stage:'正在生成当前 AI 视频镜头',total:1,completed:0,detail:'正在向 MiniMax-H3 提交短片任务。',measurable:true,newRun:true});
    status.textContent = '正在向视频服务提交任务…';
    try {
      const capturedSceneId = scene.id;
      const targetProject = project;
      const job=await resolveVideoJob({scene,config:configs.video,options:{prompt:prompt.value,duration:Number(duration.value),ratio:project.ratio},api,signal:controller.signal,restartFailed:restart.checked});saveLocal();
      status.textContent = '任务已提交，等待服务商生成。任务 ID：' + job.id;
      const completed = await api.pollVideoTask(configs.video, job, { signal: controller.signal, onProgress: (progress) => {scene.videoTask={...scene.videoTask,...progress};saveLocal();showVideoTaskProgress(progress);updateResultLink();$('generationDetail').textContent=$('videoTaskState').textContent;status.textContent=$('videoTaskState').textContent;} });
      status.textContent = '生成完成，正在下载片段…';
      const blob = await api.downloadVideo(configs.video, completed, { signal: controller.signal });
      if (project !== targetProject) throw new Error('项目已切换，旧任务片段未加入新项目。');
      const target = project.scenes.find((s) => s.id === capturedSceneId);
      if (!target) throw new Error('原镜头已被删除，已下载片段未添加到项目。');
      pushUndo(); project.videoClips = (project.videoClips || []).filter((c) => c.sceneId !== target.id); project.videoClips.push({ sceneId: target.id, blob, start: target.start, duration: Math.min(scene.videoTask.duration||Number(duration.value), target.duration), jobId: completed.id });
      project.isDemo = false;scene.videoTask={...completed,duration:scene.videoTask.duration||Number(duration.value)};delete scene.videoError;updateResultLink();releaseClipURL(); markChanged();setGenerationProgress({stage:'当前 AI 视频镜头已完成',total:1,completed:1,detail:'实际片段已下载并加入时间线。',measurable:true});finishGeneration('当前 AI 视频镜头已完成');
      status.textContent = '片段已加入当前镜头，可在预览中检查。媒体仅保留在本页内存，刷新前请导出视频。'; toast('AI 画面已加入当前镜头。'); generate.textContent = '继续查询 / 下载原任务';
    } catch (error) { status.textContent = error.name === 'AbortError' ? '已停止等待。已提交任务可继续取回，费用以账户记录为准。' : error.message;if(error.name!=='AbortError'){scene.videoError=error.message;scene.videoErrorCode=error.code;runDiagnostics.track(targetProject,scene.id,'video');saveLocal();updateResultLink();}finishGeneration(error.name==='AbortError'?'已停止等待 AI 视频':'AI 镜头未取回，已保留原任务',{cancelled:error.name==='AbortError'});}
    finally { setBusy(false); generate.disabled = false; controller = null;activeAbort=null;updateProjectUI(false); }
  });
  const optimize=el('button','button secondary','按 H3 工作流优化提示词');optimize.type='button';
  optimize.addEventListener('click',async()=>{
    if(busy)return;if(!canUse('text'))return showServiceConfig('text','优化提示词需要文本模型接口。');
    optimize.disabled=true;generate.disabled=true;setBusy(true,'正在优化 H3 画面提示词…');controller=new AbortController();const optimization=controller;activeAbort=optimization;
    status.textContent='正在调用一次文本模型，整理主体、动作、镜头时间与声景；尚未提交视频任务。';
    try{const result=await api.optimizeH3Prompt(configs.text,{scene,duration:Number(duration.value),ratio:project.ratio,style:project.style,topic:project.topic},{signal:optimization.signal});prompt.value=result.prompt;status.textContent='H3 三段式提示词已生成，可以继续编辑，再提交视频任务。';}
    catch(error){status.textContent=error.message;}finally{optimize.disabled=false;generate.disabled=false;setBusy(false);activeAbort=null;controller=null;}
  });
  actions.append(cancel,generate);frag.append(promptLabel,prompt,durationLabel,duration,quote,restartLabel,optimize,el('p','modal-copy','优化会调用1次所选文本模型。配音、字幕与配乐由后期统一合成。'),status,resultLink,note,actions); openModal('生成这一镜的 AI 画面', frag, 'SINGLE SHOT GENERATION');
}
async function audioDuration(blob) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try { const buffer = await context.decodeAudioData(await blob.arrayBuffer()); return buffer.duration; }
  finally { context.close(); }
}
function showSpeechGeneration() {
  if (!canUse('speech')) return showServiceConfig('speech', '请配置配音接口的 URL、模型和 API Key。');
  const frag = document.createDocumentFragment();
  frag.append(el('p', 'modal-copy', '逐镜生成旁白并对齐到镜头起点。字幕按镜头时长分页显示，当前不是逐字对齐。修改文案后，只需重做受影响的旁白。'));
  const fields = el('div', 'model-form');
  const defaultVoice=configs.speech.provider==='minimax'?'male-qn-qingse':'alloy';
  const voiceLabel=el('label','','音色 ID');const voice=el('input');voice.value=defaultVoice;voice.placeholder='服务商提供的 voice / voice_id';voice.maxLength=120;voiceLabel.append(voice);
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
        const blob = await api.generateSpeech(configs.speech, { text: scene.narration, voice: voice.value || defaultVoice, speed: Number(speed.value) },{signal:speechAbort.signal});
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
$('downloadCodeFailure').addEventListener('click',()=>{const scene=getScene();const failure=scene.codeFailure||{};const diagnostic={type:'scene-code-failure',scene:{title:scene.title,narration:scene.narration,duration:scene.duration,visual:scene.visual},phase:failure.phase,message:scene.renderError||failure.message,program:failure.program||scene.draftProgram||scene.program,draft:failure.draft,quality:failure.quality,repairs:failure.repairs||scene.draftMeta?.codeRepairs||0};saveDownload(new Blob([JSON.stringify(diagnostic,null,2)],{type:'application/json;charset=utf-8'}),safeFileName(scene.title)+'-代码诊断.json').catch(e=>toast(e.message,true));});
$('downloadScriptFailure').addEventListener('click',()=>{if(!lastScriptFailure)return;saveDownload(new Blob([JSON.stringify(lastScriptFailure,null,2)],{type:'application/json;charset=utf-8'}),'分镜返回诊断.json').catch(e=>toast(e.message,true));});
$('birthdayBriefButton').addEventListener('click',applyBirthdayBrief);
$('clearGenerationFailures').addEventListener('click',()=>{runDiagnostics.clear();renderSceneFailures();});
$('alignMusicButton').addEventListener('click',applyMusicBeatToCurrentScenes);
$('viewRhythmPlanButton').addEventListener('click',showRhythmPlan);
$('durationSelect').addEventListener('change',refreshMusicAnalysisStatus);
$('beatSyncToggle').addEventListener('change',()=>{project.settings.rhythmEnabled=$('beatSyncToggle').checked;saveLocal();refreshMusicAnalysisStatus();});
$('musicSourceSelect').addEventListener('change',()=>{if(busy)return;pause();pushUndo();project.settings.musicSource=$('musicSourceSelect').value;project.settings.music=true;markChanged();if(project.settings.musicSource==='custom'&&!(project.musicBlob instanceof Blob))$('musicFile').click();});
$('cancelGenerationButton').addEventListener('click',()=>{if(activeAbort){activeAbort.abort();$('generationDetail').textContent='正在取消尚未完成的请求，保留已完成的画面。';}});
$('retrySceneButton').addEventListener('click',()=>retrySceneArt([selectedIndex]));
$('workflowHelpButton').addEventListener('click',()=>openModal('先试两镜，再铺全片','<p class="modal-copy">选择“先生成前 2 镜样片”，先检查风格、文字大小和讲解是否清楚。满意后在时间线按范围补齐其余镜头；其余镜头不会自动提交。也可以只生成分镜，先编辑文案再制作画面。</p><p class="modal-copy">画面出错时，可以继续修复旧代码，也可以保留文案重新设计；需要简化讲解时，再选择“简化本镜文案并重做”。重做范围只包含当前镜头，可撤销。</p><p class="modal-copy">“真实关键帧”来自本页实际渲染，可点击放大。机器检查能发现重叠、越界和部分运动问题，仍需你判断画面是否好看、知识是否讲清。AI 视频和配音按需单独提交，费用以服务商账单为准。</p>','CREATION WORKFLOW'));
$('redesignSceneButton').addEventListener('click',()=>retrySceneArt([selectedIndex],{fresh:true}));
$('rewriteSceneButton').addEventListener('click',()=>{
  if(busy)return;
  $('revisionInput').value='只简化本镜讲解与画面步骤，保留全部数字、公式、前提、结论和时长，一句话只对应一个可见动作。'+$('revisionInput').value.trim();
  revise({preserveFacts:true});
});
$('sceneFrameGrid').addEventListener('click',event=>{
  const button=event.target.closest('[data-frame-index]');if(!button)return;
  const inspection=sceneFramePreviews.get(getScene()),i=Number(button.dataset.frameIndex);if(!inspection?.frames?.[i])return;
  const fragment=el('div'),img=el('img','keyframe-full');img.src=inspection.frames[i];img.alt=`镜头 ${selectedIndex+1} · ${inspection.frameTimes?.[i]??i} 秒的实际画面`;fragment.append(img,el('p','modal-copy',$('sceneFrameReport').textContent));openModal(img.alt,fragment,'ACTUAL RENDER');
});
$('continueSavedStoryboard').addEventListener('click',()=>retrySceneArt(project.scenes.map((scene,index)=>!artReady(scene)?index:-1).filter(index=>index>=0)));
$('resumeArtButton').addEventListener('click',showSceneRange);
$('generateRangeButton').addEventListener('click',generateSelectedRange);
$('checkRangeButton').addEventListener('click',checkSelectedRange);
for(const id of ['sceneRangeMode','sceneRangeStart','sceneRangeEnd','sceneKeepCompleted'])$(id).addEventListener(id==='sceneRangeStart'||id==='sceneRangeEnd'?'input':'change',updateSceneRangeControls);
$('generationFailures').addEventListener('click',event=>{
  const button=event.target.closest('[data-failed-scene]');if(!button)return;
  const index=Number(button.dataset.failedScene);if(!Number.isInteger(index)||!project.scenes[index])return;
  pause();selectedIndex=index;seek(project.scenes[index].start,false);renderInspector();updateTimelineSelection();if(button.dataset.failedType==='video'){showVideoGeneration();return;}$('sceneCodeDetails').open=true;$('mediaStatus').scrollIntoView({behavior:'smooth',block:'center'});
});
$('batchAIButton').addEventListener('click',()=>showBatchAI());
$('resumeVideoTasksButton').addEventListener('click',()=>showBatchAI({existingOnly:true}));
$('pricingButton').addEventListener('click',showPricingSettings);
$('usageDetailsButton').addEventListener('click',showUsageDetails);
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
$('restoreStoryboardButton').addEventListener('click',()=>{if(busy)return toast('请等当前任务完成后再恢复分镜。');$('projectFile').click();});
$('importButton').addEventListener('click', () => { if (busy) return toast('请等当前任务完成后再打开项目。'); $('projectFile').click(); });
$('projectFile').addEventListener('change', async (event) => {
  const file=event.target.files?.[0];if(!file)return;let locked=false,restored=false;
  try{
    if(busy)throw new Error('当前任务执行中，请完成后再导入项目。');
    if(file.size>12*1024*1024)throw new Error('项目文件超过12 MB，请选择本站导出的JSON。');
    setBusy(true,'正在读取项目…');locked=true;
    let imported=JSON.parse(await file.text());
    if(typeof imported?.draft==='string'){
      if(imported.draft.length>50000)throw new Error('分镜返回内容过长，暂时无法恢复。');
      const diagnostic=imported;
      const script=await api.restoreScript({draft:diagnostic.draft,topic:diagnostic.topic||$('topicInput').value.trim()});
      imported=engine.createProjectFromScript(script,{topic:diagnostic.topic||script.title,duration:script.duration,ratio:selectedRatio,style:selectedStyle,mode:selectedMode,settings:{voice:$('voiceToggle').checked,music:$('musicToggle').checked,captions:$('captionsToggle').checked}});
      imported.isDemo=false;imported.generatedFromApi=true;imported.scriptMeta=script.apiMeta;restored=true;
    }
    quarantineInvalidPrograms(imported);
    if(!validProject(imported))throw new Error('项目结构不完整或时长超出范围，原项目已保留。');
    for(const key of ['voiceBlob','voiceClips','videoClips','musicBlob','musicAnalysis','apiKey','apiConfig','config'])delete imported[key];
    pause();pushUndo();project=imported;recoverRenderStates(project);project.settings=Object.assign({voice:true,music:true,captions:true},project.settings||{});selectedIndex=0;currentTime=0;selectedRatio=normalizeRatio(project.ratio);selectedStyle=normalizeStyle(project.style);selectedMode=project.mode||'code';hasGenerated=project.generatedFromApi===true;releaseClipURL();syncForm();lastScriptFailure=null;$('scriptFailureActions').hidden=true;markChanged();
    if(restored){
      setGenerationProgress({stage:'分镜已恢复，等待制作画面',total:project.scenes.length,completed:0,measurable:true,newRun:true,detail:'已读取原有模型返回内容，恢复过程未调用付费模型。'});
      finishGeneration(`已恢复 ${project.scenes.length} 个分镜`);
      $('generationNextText').textContent='分镜内容已恢复。填写文本模型 API Key 后，点击下方按钮继续逐镜写代码和看图返修。';
      $('resumeArtButton').textContent=`制作这 ${project.scenes.length} 镜的动画画面`;
      toast(`已恢复 ${project.scenes.length} 个分镜；无需重新生成脚本。`);
    }else toast('项目已打开；媒体文件需要重新添加。');
  }catch(error){toast(error.message,true);}
  finally{if(locked){setBusy(false);updateProjectUI(false);}event.target.value='';}
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
    pushUndo();project.musicBlob=file;project.musicAnalysis=analysis;project.settings.music=true;project.settings.musicSource='custom';markChanged();toast(canApplyMusicBeat()?'配乐已载入，后续分镜将根据检测拍点安排切换。':'配乐已载入，但未找到足够稳定的节拍，保留原画面时序。');
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
usageLedger.subscribe(refreshUsage);refreshUsage();initializeAppearance();syncForm(); updateProjectUI(); renderRules();if(!project.isDemo&&(missingFrames().length||project.scenes.some(s=>s.videoTask?.id||s.videoError))){$('generationPanel').hidden=false;finishGeneration('项目已保留，可补齐或升级逐镜画面');}requestAnimationFrame(animate);

const entryPanel=new URLSearchParams(location.search).get("panel");if(entryPanel==="library")showLibrary();else if(entryPanel==="about")$("navAbout").click();
