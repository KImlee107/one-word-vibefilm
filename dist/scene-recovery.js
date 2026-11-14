import {buildSceneProgram} from './scene-pipeline.js';

const localFailures=new Set(['CODE_FORMAT','CODE_SYNTAX','CODE_DUPLICATE','UNDEFINED_SYMBOL','SCENE_RUNTIME','SCENE_QUALITY','SCENE_STATIC','SCENE_DETERMINISM','REVIEW_UNCHANGED','MODEL_TRUNCATED']);
export function canRedesignAfter(error){
  return error?.name!=='AbortError'&&!/^(?:PROVIDER_|VIDEO_|NETWORK|CANCELLED|RENDER_ENVIRONMENT|CUSTOM_ENDPOINT|PROJECT_CHANGED)/.test(String(error?.code||''))
    &&(localFailures.has(error?.code)||['compile','draw','inspect'].includes(error?.phase));
}
const numericAnchors=scene=>new Set(([(scene.title||''),(scene.narration||''),(scene.caption||''),(scene.visual?.formula||''),...(scene.visual?.values||[])].join(' ').normalize('NFKC').match(/\d+(?:\.\d+)?(?:%|\/\d+(?:\.\d+)?)?/g)||[]));
export function preserveSceneFacts(original,revised){
  if(!revised||typeof revised.title!=='string'||!revised.title.trim()||typeof revised.narration!=='string'||!revised.narration.trim())throw Object.assign(new Error('改写没有返回完整文案，已保留原镜头。'),{code:'SCENE_REWRITE_FORMAT'});
  const before=numericAnchors(original),after=numericAnchors(revised);
  const formula=s=>String(s.visual?.formula||'').normalize('NFKC').replace(/\s/g,'');
  if(before.size!==after.size||[...before].some(n=>!after.has(n))||formula(original)!==formula(revised))throw Object.assign(new Error('改写改变了原有数字或公式，未应用。请先手动核对文案后再生成。'),{code:'SCENE_REWRITE_FACTS'});
  return {...revised,id:original.id,start:original.start,duration:original.duration};
}
export function freshScene(scene){return {...scene,program:undefined,composition:undefined,codeFailure:undefined,draftProgram:undefined,draftMeta:undefined,draftReady:false};}
export function creationSceneIndices(count,mode='all'){
  if(!Number.isInteger(count)||count<1||count>48)throw new Error('分镜数量无效。');
  if(!['all','pilot','storyboard'].includes(mode))throw new Error('请选择有效的生成流程。');
  return mode==='storyboard'?[]:Array.from({length:mode==='pilot'?Math.min(count,2):count},(_,i)=>i);
}

/** One optional escalation after the normal repair budget. Never recursive. */
export async function buildSceneWithRecovery(options,{policy='redesign',onRewrite=()=>{}}={}){
  let firstState;
  try{return {...await buildSceneProgram({...options,onCheckpoint:state=>{firstState=state;options.onCheckpoint?.(state);}}),recovery:null};}
  catch(error){
    if(!['redesign','rewrite'].includes(policy)||options.signal?.aborted||!canRedesignAfter(error))throw error;
    const reason=String(error.message).slice(0,1000);
    let scene=freshScene(options.scene),context={...options.context};
    const recovery={mode:policy,reason,attempt:1,requests:policy==='rewrite'?2:1};
    options.onStage?.(policy==='rewrite'?'原稿仍未通过，正在简化本镜讲解（最多1次），随后重新设计':'原稿仍未通过，保留文案重新设计本镜（最多1次）');
    if(policy==='rewrite'){
      const revised=await options.api.reviseSceneWithAI(options.textConfig,{scene:{...scene,kind:String(scene.kind||'process').replace(/^script:/,'')},instruction:'原画面难以讲清或反复发生排版错误。只简化本镜表述和视觉步骤，一句只对应一个可见动作；保留全部数字、公式、前提、结论及原镜时长，不引入新数据或新例子。',context:JSON.stringify({topic:options.project.topic,reason}),preserveFacts:true},{signal:options.signal});
      if(options.signal?.aborted)throw new DOMException('已取消','AbortError');
      scene=freshScene({...scene,...preserveSceneFacts(scene,revised)});onRewrite(scene,recovery);
    }
    context={...context,scene,preferences:(context.preferences||'')+'\n重新设计：减少同屏标签，分阶段推演；必须使用独立构图，不要继续微调失败布局。',recoveryPlan:{...recovery,qualityReport:error.quality||null}};
    if(context.project?.scenes)context.project={...context.project,scenes:context.project.scenes.map((s,i)=>i===context.index?{title:scene.title,visual:scene.visual}:s)};
    try{
      // The escalation has exactly one new drawing request and local inspection;
      // paid visual rounds and code-repair loops are not restarted here.
      const result=await buildSceneProgram({...options,scene,context,rounds:0,repairLimit:0});
      return {...result,usage:[...(firstState?.usage||[]),...result.usage],recovery:{...recovery,previousReviews:(firstState?.reviews||[]).map(r=>({round:r.round,feedback:r.feedback}))}};
    }catch(last){last.redesignAttempted=true;last.recoveryMode=policy;last.message='本镜已重新设计 1 次，仍未通过：'+last.message;throw last;}
  }
}
