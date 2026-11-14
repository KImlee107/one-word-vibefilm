/** Resolving a saved job never silently creates another billable generation. */
export async function resolveVideoJob({scene,config,options,api,signal,existingOnly=false,restartFailed=false}){
  const prior=scene.videoTask;
  if(prior?.id&&(!restartFailed||!['failed','cancelled'].includes(prior.status)))return prior;
  if(existingOnly)throw Object.assign(new Error('此镜没有可取回的已提交任务；没有创建新任务。'),{code:'VIDEO_TASK_REQUIRED'});
  const job=await api.createVideoTask(config,options,{signal});
  scene.videoTask={...job,duration:Number(job.duration)||Number(options.duration),resolution:job.resolution||options.resolution||'768P'};
  return scene.videoTask;
}
export function shouldPauseVideoBatch(error){
  return error.name==='AbortError'||error.code!=='VIDEO_FAILED';
}
export function safeVideoResultURL(value){
  try{const u=new URL(value),h=u.hostname;if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443')return null;if(h==='cdn.hailuoai.com'||h==='cdn.minimax.io'||h.endsWith('.cdn.minimax.io'))return u.href;}catch{}return null;
}
