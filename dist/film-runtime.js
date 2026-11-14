import {validateFilmProgram,filmFingerprint,FILM_ALIAS_NAMES} from './film-program.js';
import {drawFrame,getSceneAt,drawDesignedOverlay} from './engine.js';
import {getStyle} from './presets.js';
import {sampleFilmInspection} from './film-quality.js';

let bridge=null,sequence=0,probe=null;
const checkedPrograms=new WeakMap();
export const FILM_SKILL={name:'vibe-knowledge-film',repository:'https://github.com/HeyChengC/vibe-knowledge-film',commit:'62d51508aad00003dc6209afa80c4b5dc540de59'};
function abortError(){return new DOMException('已取消','AbortError');}
async function createBridge(){
  if(!globalThis.OffscreenCanvas||!globalThis.Worker)throw Object.assign(new Error('逐镜代码动画需要最新版 Chrome 或 Edge（OffscreenCanvas + Worker）。'),{code:'RENDER_ENVIRONMENT',phase:'setup'});
  const [engine,workerSource,sans,serif]=await Promise.all([
    fetch('./vendor/vibe-knowledge-film/vk.js').then(r=>{if(!r.ok)throw new Error('动画引擎文件读取失败');return r.text();}),fetch('./film-worker.js').then(r=>{if(!r.ok)throw new Error('动画运行器文件读取失败');return r.text();}),
    fetch('./fonts/knowledge-sans.woff').then(r=>{if(!r.ok)throw new Error('动画字体读取失败');return r.arrayBuffer();}),fetch('./fonts/knowledge-serif.woff').then(r=>{if(!r.ok)throw new Error('动画字体读取失败');return r.arrayBuffer();})]);
  const iframe=document.createElement('iframe');iframe.hidden=true;iframe.setAttribute('sandbox','allow-scripts');iframe.src='./code-sandbox.html';iframe.title='动画代码隔离运行区';
  const channel=crypto.randomUUID(),pending=new Map();
  const receive=event=>{if(event.source!==iframe.contentWindow||event.data?.channel!==channel)return;const m=event.data,p=pending.get(m.id);if(!p){m.bitmap?.close();return;}pending.delete(m.id);clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);if(m.error){p.reject(Object.assign(new Error(m.error),{code:m.code||'SCENE_RUNTIME',phase:m.phase||'draw',details:m.details}));if(m.fatal)destroy();}else p.resolve(m);};
  window.addEventListener('message',receive);
  const destroy=(reason)=>{iframe.remove();window.removeEventListener('message',receive);for(const p of pending.values()){clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.reject(reason||Object.assign(new Error('动画运行已停止，可重试此镜。'),{code:'SCENE_RUNTIME',phase:'draw'}));}pending.clear();bridge=null;probe=null;};
  function request(payload,{signal}={}){
    if(signal?.aborted)return Promise.reject(abortError());
    return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{const error=Object.assign(new Error('动画渲染超时，已停止代码。'),{code:'RENDER_TIMEOUT',phase:'draw'});destroy(error);},payload.type==='init'?23000:9000);
      const abort=()=>destroy(abortError());pending.set(id,{resolve,reject,timer,signal,abort});signal?.addEventListener('abort',abort,{once:true});iframe.contentWindow.postMessage({...payload,id,channel},'*');});
  }
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{destroy();reject(Object.assign(new Error('动画隔离区加载超时。'),{code:'RENDER_ENVIRONMENT',phase:'setup'}));},15000);iframe.onload=()=>{clearTimeout(timer);resolve();};document.body.append(iframe);});
  await request({type:'init',workerSource,engine,aliases:FILM_ALIAS_NAMES,fonts:[['VK Sans',sans],['VK Serif',serif],['VK Latin',serif],['VK Mono',sans]]});
  return {request,destroy};
}
async function renderer(){if(!bridge)bridge=createBridge().catch(error=>{bridge=null;throw error;});return bridge;}
export async function renderFilmFrame(program,scene,style,time,width,height,{signal,inspect=false}={}){
  let saved=checkedPrograms.get(program);if(!saved){const valid=validateFilmProgram(program);saved={valid,fingerprint:filmFingerprint(valid)};checkedPrograms.set(program,saved);}
  const palette={...getStyle(style).palette};if(scene.accent){palette.accent=scene.accent;palette.gold=scene.accent;}
  const publicScene={duration:Number(scene.renderDuration)||scene.duration,title:scene.title,caption:scene.caption,narration:scene.narration,visual:scene.visual||{},beatTimes:scene.beatTimes||[],motionSpeed:scene.motionSpeed||1};
  const key=saved.fingerprint+'|'+width+'x'+height+'|'+style+'|'+JSON.stringify(publicScene)+'|'+(scene.accent||'');
  return (await renderer()).request({type:'render',key,program:saved.valid,scene:publicScene,palette,time,width,height,inspect},{signal});
}
export async function renderProjectFrame(ctx,project,time,width,height,{signal}={}){
  const at=getSceneAt(project,time);if(!at)return;
  const {scene,index,localTime,progress}=at;
  const program=scene.renderState==='complete'?scene.program:scene.renderState==='generating'&&scene.draftReady?scene.draftProgram:null;
  if(!program){drawFrame(ctx,project,time,width,height);return;}
  const d=Number(scene.renderDuration)||scene.duration,rawTime=localTime+(Number(scene.sourceOffset)||0),timeInCode=Math.pow(Math.max(0,Math.min(1,rawTime/d)),1/(scene.motionSpeed||1))*d;
  const result=await renderFilmFrame(program,scene,project.style,timeInCode,width,height,{signal});
  try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.drawImage(result.bitmap,0,0,width,height);drawDesignedOverlay(ctx,project,scene,index,time,progress,width,height);}finally{result.bitmap.close();}
}
export async function inspectFilmProgram(program,scene,project,{signal}={}){
  const w=project.ratio==='9:16'?324:project.ratio==='16:9'?576:480;
  const ratios={'9:16':16/9,'16:9':9/16,'1:1':1,'4:5':5/4,'3:4':4/3,'4:3':3/4,'21:9':9/21};const h=Math.round(w*(ratios[project.ratio]||9/16));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');
  return sampleFilmInspection({duration:scene.duration,width:w,height:h,allowTextMotion:!!scene.visual?.formula||/开场|结尾|总结|结论|片尾/.test(scene.title||''),sample:async time=>{
    const result=await renderFilmFrame(program,scene,project.style,time,w,h,{signal,inspect:true});
    try{ctx.drawImage(result.bitmap,0,0);return {frame:canvas.toDataURL('image/jpeg',.72),stats:result.stats};}finally{result.bitmap.close();}
  }});
}

const probeProgram={version:1,designIntent:'检查本地绘图环境和函数接口',layout:'runtime-preflight',heroObjects:['测试图形'],source:'const p=ss(t,0,scene.duration); const x=lerp(fr.w*.2,fr.w*.8,p); fr.circle(x,fr.h*.5,Math.min(fr.w,fr.h)*.12,{fill:scene.palette.gold});'};
export async function ensureFilmRenderer({signal}={}){
  if(!probe)probe=(async()=>{const result=await renderFilmFrame(probeProgram,{duration:2},'noir',1,48,48,{signal});result.bitmap.close();return true;})().catch(error=>{probe=null;if(error.name==='AbortError')throw error;throw Object.assign(new Error('本地动画运行环境检查失败：'+error.message),{code:'RENDER_ENVIRONMENT',phase:'setup'});});
  return probe;
}
