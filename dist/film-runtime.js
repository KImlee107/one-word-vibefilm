import {validateFilmProgram,filmFingerprint} from './film-program.js';
import {drawFrame,getSceneAt,drawDesignedOverlay} from './engine.js';
import {getStyle} from './presets.js';

let bridge=null,sequence=0;
const checkedPrograms=new WeakMap();
export const FILM_SKILL={name:'vibe-knowledge-film',repository:'https://github.com/HeyChengC/vibe-knowledge-film',commit:'62d51508aad00003dc6209afa80c4b5dc540de59'};
function abortError(){return new DOMException('已取消','AbortError');}
async function createBridge(){
  if(!globalThis.OffscreenCanvas||!globalThis.Worker)throw new Error('逐镜代码动画需要最新版 Chrome 或 Edge（OffscreenCanvas + Worker）。');
  const [engine,workerSource,sans,serif]=await Promise.all([
    fetch('./vendor/vibe-knowledge-film/vk.js').then(r=>r.text()),fetch('./film-worker.js').then(r=>r.text()),
    fetch('./fonts/knowledge-sans.woff').then(r=>r.arrayBuffer()),fetch('./fonts/knowledge-serif.woff').then(r=>r.arrayBuffer())]);
  const iframe=document.createElement('iframe');iframe.hidden=true;iframe.setAttribute('sandbox','allow-scripts');iframe.src='./code-sandbox.html';iframe.title='动画代码隔离运行区';
  const channel=crypto.randomUUID(),pending=new Map();
  const receive=event=>{if(event.source!==iframe.contentWindow||event.data?.channel!==channel)return;const m=event.data,p=pending.get(m.id);if(!p){m.bitmap?.close();return;}pending.delete(m.id);clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);if(m.error){p.reject(new Error(m.error));if(m.fatal)destroy();}else p.resolve(m);};
  window.addEventListener('message',receive);
  const destroy=()=>{iframe.remove();window.removeEventListener('message',receive);for(const p of pending.values()){clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.reject(new Error('动画运行已停止，可重试此镜。'));}pending.clear();bridge=null;};
  function request(payload,{signal}={}){
    if(signal?.aborted)return Promise.reject(abortError());
    return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{destroy();reject(new Error('动画渲染超时，已停止代码。'));},payload.type==='init'?23000:9000);
      const abort=()=>{destroy();reject(abortError());};pending.set(id,{resolve,reject,timer,signal,abort});signal?.addEventListener('abort',abort,{once:true});iframe.contentWindow.postMessage({...payload,id,channel},'*');});
  }
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{destroy();reject(new Error('动画隔离区加载超时。'));},15000);iframe.onload=()=>{clearTimeout(timer);resolve();};document.body.append(iframe);});
  await request({type:'init',workerSource,engine,fonts:[['VK Sans',sans],['VK Serif',serif],['VK Latin',serif],['VK Mono',sans]]});
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
  const program=scene.renderState==='complete'?scene.program:scene.renderState==='generating'?scene.draftProgram:null;
  if(!program){drawFrame(ctx,project,time,width,height);return;}
  const d=Number(scene.renderDuration)||scene.duration,rawTime=localTime+(Number(scene.sourceOffset)||0),timeInCode=Math.pow(Math.max(0,Math.min(1,rawTime/d)),1/(scene.motionSpeed||1))*d;
  const result=await renderFilmFrame(program,scene,project.style,timeInCode,width,height,{signal});
  try{ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.drawImage(result.bitmap,0,0,width,height);drawDesignedOverlay(ctx,project,scene,index,time,progress,width,height);}finally{result.bitmap.close();}
}
export async function inspectFilmProgram(program,scene,project,{signal}={}){
  const w=project.ratio==='9:16'?324:project.ratio==='16:9'?576:480;
  const ratios={'9:16':16/9,'16:9':9/16,'1:1':1,'4:5':5/4,'3:4':4/3,'4:3':3/4,'21:9':9/21};const h=Math.round(w*(ratios[project.ratio]||9/16));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),frames=[],stats=[];
  for(const phase of [.18,.48,.78,.48]){
    const result=await renderFilmFrame(program,scene,project.style,scene.duration*phase,w,h,{signal,inspect:true});
    ctx.drawImage(result.bitmap,0,0);result.bitmap.close();frames.push(canvas.toDataURL('image/jpeg',.68));stats.push(result.stats);
  }
  if(stats[1].signature!==stats[3].signature)throw new Error('同一时刻画面不一致，请改为根据时间计算的确定性动画。');
  if(Math.max(...stats.map(s=>s.coverage))<.004)throw new Error('静帧检查发现主体过小或为空，请重新设计。');
  if(new Set(stats.slice(0,3).map(s=>s.signature)).size<2)throw new Error('检查发现主体未随时间变化，不能只替换静态文案。');
  return {frames:frames.slice(0,3),stats:stats.slice(0,3),thumbnail:frames[1]};
}
