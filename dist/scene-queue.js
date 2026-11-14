/** Scene selection and serial execution share the same numbering as the timeline. */
export const sceneArtReady=scene=>!!(scene?.program||scene?.composition)&&scene.renderState==='complete';
function rangeError(message){return Object.assign(new Error(message),{code:'SCENE_RANGE'});}
export function orderedSceneIndices(indices,sceneCount){
  if(!Number.isInteger(sceneCount)||sceneCount<1||!Array.isArray(indices)||indices.some(i=>!Number.isInteger(i)||i<0||i>=sceneCount))throw rangeError('镜头编号超出当前分镜范围。');
  return [...new Set(indices)].sort((a,b)=>a-b);
}
export function selectSceneRange(scenes,{mode='missing',currentIndex=0,start=1,end=scenes?.length,keepCompleted=true}={}){
  if(!Array.isArray(scenes)||!scenes.length)throw rangeError('请先生成分镜。');
  let selected;
  if(mode==='missing'||mode==='all')selected=scenes.map((_,i)=>i);
  else if(mode==='current')selected=[currentIndex];
  else if(mode==='custom'){
    const first=Number(start),last=Number(end);
    if(!String(start).trim()||!String(end).trim()||!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>scenes.length)throw rangeError(`请输入有效起止镜头：1–${scenes.length}，起始编号不能大于结束编号。`);
    selected=Array.from({length:last-first+1},(_,i)=>first-1+i);
  }else throw rangeError('请选择有效的镜头生成范围。');
  selected=orderedSceneIndices(selected,scenes.length);
  const skipReady=mode==='missing'||keepCompleted;
  const indices=selected.filter(i=>!skipReady||!sceneArtReady(scenes[i]));
  return {indices,selected,skipped:selected.filter(i=>!indices.includes(i)),mode};
}
const localRequestErrors=new Set(['CODE_FORMAT','CODE_DUPLICATE','REVIEW_UNCHANGED','MODEL_JSON','MODEL_TRUNCATED','UNDEFINED_SYMBOL']);
export function shouldPauseSceneQueue(error,failureMode='continue'){
  if(failureMode==='pause'||error.name==='AbortError'||error.code==='CANCELLED')return true;
  if(['RENDER_ENVIRONMENT','PROJECT_CHANGED','NETWORK','HTTP_ERROR','INVALID_RESPONSE'].includes(error.code)||String(error.code||'').startsWith('PROVIDER_'))return true;
  // Request/configuration failures are shared by the following scenes. Bad scene
  // output may continue, but authentication, quota and connection errors stop.
  return error.phase==='request'&&!localRequestErrors.has(error.code);
}
export async function runSceneQueue({indices,sceneCount,signal,failureMode='continue',preflight=async()=>{},onStart=()=>{},run,onResult=()=>{}}){
  const ordered=orderedSceneIndices(indices,sceneCount),outcomes=[];
  if(!['continue','pause'].includes(failureMode))throw rangeError('请选择有效的失败处理方式。');
  if(!ordered.length||signal?.aborted)return {indices:ordered,outcomes,pending:ordered,paused:false,cancelled:!!signal?.aborted};
  await preflight();let paused=false;
  for(const index of ordered){
    if(signal?.aborted)break;
    onStart(index);let outcome;
    try{await run(index);outcome={index,status:'complete'};}
    catch(error){outcome={index,status:signal?.aborted||error.name==='AbortError'||error.code==='CANCELLED'?'cancelled':'failed',error};}
    outcomes.push(outcome);onResult(outcome);
    if(outcome.error&&shouldPauseSceneQueue(outcome.error,failureMode)){paused=outcome.status==='failed';break;}
  }
  const done=new Set(outcomes.filter(o=>o.status!=='cancelled').map(o=>o.index));
  return {indices:ordered,outcomes,pending:ordered.filter(i=>!done.has(i)),paused,cancelled:!!signal?.aborted||outcomes.some(o=>o.status==='cancelled')};
}
