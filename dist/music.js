import {DEFAULT_MUSIC} from './music/we-never-profile.js';
export {DEFAULT_MUSIC};
let defaultBlob;
export function musicSource(project){return project.settings?.musicSource||(project.musicBlob instanceof Blob?'custom':'default');}
export function musicAnalysis(project){
  const source=musicSource(project);
  if(source==='default')return DEFAULT_MUSIC.analysis;
  if(source==='custom')return project.musicBlob instanceof Blob?project.musicAnalysis:null;
  const duration=Math.max(15,Number(project.duration)||90),period=project.settings?.musicStyle==='minimal' ? .75 : .625;
  return {duration,bpm:60/period,confidence:1,reliable:true,method:'known-original-score',beats:Array.from({length:Math.ceil(duration/period)},(_,i)=>+(i*period).toFixed(3)),sections:[]};
}
export async function musicBlob(project){
  if(musicSource(project)==='custom'){if(!(project.musicBlob instanceof Blob))throw new Error('自选配乐尚未载入，请重新上传音频，或选择默认 We Never。');return project.musicBlob;}
  if(musicSource(project)==='original')return null;
  defaultBlob??=fetch(new URL(DEFAULT_MUSIC.file,import.meta.url),{cache:'force-cache'}).then(async response=>{if(!response.ok)throw new Error('默认 We Never 音频未能载入，请重试。');const blob=await response.blob();if(blob.size<1000||blob.size>5e6)throw new Error('默认配乐文件不完整。');return blob;}).catch(error=>{defaultBlob=undefined;throw error;});
  return defaultBlob;
}
