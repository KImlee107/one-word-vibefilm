import {renderProjectFrame} from './film-runtime.js';
import {drawFrame,getSceneAt,getCaptionText} from './engine.js';
import {prepareAudioMix} from './audio.js';
import {getDimensions,MAX_PROJECT_DURATION} from './presets.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const abortIf=(signal)=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};

async function prepareClips(project,signal){
  const clips=[];
  try{
    for(const clip of project.videoClips||[]){
      if(!(clip.blob instanceof Blob))continue;
      abortIf(signal);
      const video=document.createElement('video'),url=URL.createObjectURL(clip.blob);
      clips.push({...clip,video,objectURL:url});video.muted=true;video.playsInline=true;video.preload='auto';
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('AI 镜头读取超时，请重新下载该镜头。')),20000);
        video.onloadeddata=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('AI 镜头格式无法解码。'));};video.src=url;
      });
    }
    return clips;
  }catch(error){for(const clip of clips)URL.revokeObjectURL(clip.objectURL);throw error;}
}

async function drawClip(ctx,clip,project,time,width,height,signal){
  const scene=project.scenes.find(s=>s.id===clip.sceneId);
  const start=Number(clip.start??scene?.start)||0,video=clip.video;
  const sourceOffset=Math.max(0,Number(clip.sourceOffset??scene?.sourceOffset)||0);
  const local=Math.max(0,Math.min(time-start+sourceOffset,Math.max(0,video.duration-0.04)));
  if(Math.abs(video.currentTime-local)>0.012){
    await new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);video.removeEventListener('seeked',done);resolve();};
      const timer=setTimeout(()=>{video.removeEventListener('seeked',done);reject(new Error('AI 镜头解码超时。'));},15000);
      video.addEventListener('seeked',done);video.currentTime=local;
    });
  }
  abortIf(signal);
  const scale=Math.max(width/video.videoWidth,height/video.videoHeight);
  const w=video.videoWidth*scale,h=video.videoHeight*scale;
  ctx.drawImage(video,(width-w)/2,(height-h)/2,w,h);
  if(project.settings?.captions!==false){
    const cue=project.subtitles?.find(c=>time>=c.start&&time<c.end);
    const text=getCaptionText(project,time);
    if(text){
      const font=Math.round(width*(width<height?0.043:0.026));ctx.font=`600 ${font}px system-ui,sans-serif`;
      const lines=[];let line='';for(const ch of String(text)){if(ctx.measureText(line+ch).width>width*0.84){lines.push(line);line=ch;}else line+=ch;}if(line)lines.push(line);
      const pages=Math.ceil(lines.length/2),progress=scene?Math.min(0.999,Math.max(0,(time-scene.start)/scene.duration)):0;
      const cueProgress=cue?Math.min(0.999,Math.max(0,(time-cue.start)/Math.max(0.01,cue.end-cue.start))):progress;
      const page=Math.min(pages-1,Math.floor(cueProgress*pages));
      const display=lines.slice(page*2,page*2+2),y=height*0.88-display.length*font*1.3;
      ctx.fillStyle='rgba(0,0,0,0.72)';ctx.fillRect(width*0.05,y-font*0.8,width*0.9,display.length*font*1.4+font);
      ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='top';display.forEach((value,i)=>ctx.fillText(value,width/2,y+i*font*1.4));
    }
  }
}

export function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function getExportSupport(ratio='9:16'){
  if(!globalThis.VideoEncoder)return {mp4:false,webm:false,reason:'当前浏览器不支持 WebCodecs，请使用最新版 Chrome 或 Edge。'};
  const {canEncodeVideo,canEncodeAudio}=await import('./vendor/mediabunny.mjs');
  const options={...getDimensions(ratio),frameRate:30};
  return {mp4:await canEncodeVideo('avc',options),webm:await canEncodeVideo('vp9',options),aac:await canEncodeAudio('aac'),opus:await canEncodeAudio('opus')};
}

export async function exportVideo(project,{onProgress=()=>{},signal,width:requestedWidth,fps=30}={}){
  if(!project?.scenes?.length)throw new Error('请先生成分镜，再导出视频。');
  if(!Number.isFinite(project.duration)||project.duration<=0||project.duration>MAX_PROJECT_DURATION)throw new Error(`当前导出支持 ${MAX_PROJECT_DURATION} 秒以内的项目。`);
  const unfinished=project.scenes.filter(scene=>scene.renderState&&scene.renderState!=='complete'&&!(project.videoClips||[]).some(c=>c.sceneId===scene.id&&c.duration>=scene.duration&&c.blob instanceof Blob));
  if(unfinished.length)throw new Error(`还有 ${unfinished.length} 个镜头的画面未完成。请先生成或重试这些镜头，再导出成片。`);
  if(!globalThis.VideoEncoder)throw new Error('视频导出需要最新版 Chrome 或 Edge（WebCodecs）。项目 JSON 和字幕仍可下载。');
  abortIf(signal);
  onProgress({progress:0,message:'正在检查浏览器编码能力…'});
  const {Output,Mp4OutputFormat,WebMOutputFormat,BufferTarget,CanvasSource,AudioBufferSource,Quality,canEncodeVideo,canEncodeAudio}=await import('./vendor/mediabunny.mjs');
  const nativeSize=getDimensions(project.ratio);
  const width=requestedWidth?Math.round(requestedWidth/2)*2:nativeSize.width;
  const height=Math.round((width*nativeSize.height/nativeSize.width)/2)*2;
  const landscape=width>height;
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('当前浏览器无法创建画布。');
  const dimensions={width,height,frameRate:fps};
  const mp4=await canEncodeVideo('avc',dimensions);
  const videoCodec=mp4?'avc':await canEncodeVideo('vp9',dimensions)?'vp9':null;
  if(!videoCodec)throw new Error('当前设备不支持此分辨率的视频编码，请换用桌面版 Chrome 或 Edge。');
  onProgress({progress:0.01,message:'正在准备配音与背景音乐…'});
  const audioBuffer=await prepareAudioMix(project);abortIf(signal);
  const audioCodec=mp4?'aac':'opus';
  if(audioBuffer&&!await canEncodeAudio(audioCodec,{sampleRate:48000,numberOfChannels:2}))
    throw new Error('当前浏览器不支持导出所需音频编码。请换用 Chrome/Edge，或关闭声音后导出。');
  const target=new BufferTarget();
  const output=new Output({format:mp4?new Mp4OutputFormat({fastStart:'in-memory'}):new WebMOutputFormat(),target});
  const video=new CanvasSource(canvas,{codec:videoCodec,quality:new Quality({bitrate:landscape?6500000:5500000})});
  output.addVideoTrack(video,{frameRate:fps});
  let audio;
  if(audioBuffer){audio=new AudioBufferSource({codec:audioCodec,quality:new Quality({bitrate:160000})});output.addAudioTrack(audio);}
  output.setMetadataTags({title:project.title,artist:'见知 · Vibe Studio'});
  const duration=project.duration;
  const frames=Math.ceil(duration*fps);
  const clips=await prepareClips(project,signal);
  try{
    await document.fonts.ready;await output.start();
    // Audio and video are fed concurrently to avoid muxer interleaving backpressure.
    const audioPromise=audio?audio.add(audioBuffer).then(()=>audio.close()):Promise.resolve();
    audioPromise.catch(()=>{});
    for(let frame=0;frame<frames;frame++){
      abortIf(signal);const time=frame/fps;
      const current=getSceneAt(project,time);
      const clip=clips.find(c=>c.sceneId===(current?.scene?.id||current?.id)&&time>=Number(c.start||0)&&time<Number(c.start||0)+Number(c.duration||current?.scene?.duration||0));
      if(clip)await drawClip(ctx,clip,project,time,width,height,signal);
      else await renderProjectFrame(ctx,project,time,width,height,{signal});
      await video.add(time,Math.min(1/fps,duration-time),{keyFrame:frame%(fps*2)===0});
      if(frame%10===0){onProgress({progress:0.04+0.93*frame/frames,message:`正在导出 ${Math.floor(time)} / ${Math.round(duration)} 秒${mp4?' · MP4':' · WebM'}`});await tick();}
    }
    video.close();await audioPromise;abortIf(signal);await output.finalize();
    const blob=new Blob([target.buffer],{type:mp4?'video/mp4':'video/webm'});
    onProgress({progress:1,message:`导出完成 · ${mp4?'MP4':'WebM'}`});return blob;
  }catch(error){await output.cancel().catch(()=>{});throw error;}
  finally{for(const clip of clips){clip.video.removeAttribute('src');clip.video.load();URL.revokeObjectURL(clip.objectURL);}}
}
