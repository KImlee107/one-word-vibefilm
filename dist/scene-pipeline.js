import {validateFilmProgram,filmFingerprint} from './film-program.js';
import {filmQualityError} from './film-quality.js';

const unrecoverable=new Set(['RENDER_ENVIRONMENT','PROVIDER_AUTH','PROVIDER_BALANCE','PROVIDER_RATE_LIMIT','PROVIDER_NETWORK','PROVIDER_TIMEOUT','NETWORK','CANCELLED','CUSTOM_ENDPOINT']);
function abort(signal){if(signal?.aborted)throw new DOMException('已取消','AbortError');}
export async function buildSceneProgram({scene,project,context,rounds=2,textConfig,visionConfig,signal,api,inspect,onStage=()=>{},onCheckpoint=()=>{}}){
  let program=scene.codeFailure?.program||scene.draftProgram||null,draft=scene.codeFailure?.draft||'',inspection;
  const reviews=[...(scene.draftMeta?.reviews||[])],usage=[...(scene.draftMeta?.usage||[])];let repairs=0;
  async function obtain(action){
    abort(signal);
    try{return await action();}
    catch(error){if(error.recovery?.program||error.recovery?.draft)return {...error.recovery,generationIssue:error.message};if(!error.phase)error.phase='request';throw error;}
  }
  function checkpoint(extra){onCheckpoint({program,inspection,reviews:[...reviews],usage:[...usage],repairs,...extra});}
  async function repair(error,current,raw=''){
    const failure={program:current,draft:raw,message:error.message,code:error.code||'SCENE_RUNTIME',phase:error.phase||'compile',quality:error.quality,repairs};checkpoint({ready:false,failure});
    if(repairs>=1){error.repairExhausted=true;error.phase=failure.phase;throw error;}
    repairs++;onStage('正在修复本镜代码 / 排版（1 / 1）· '+error.message);checkpoint({ready:false,failure:{...failure,repairs}});
    const fixed=await obtain(()=>api.repairSceneCode(textConfig,{...context,program:current||null,draft:raw,issue:error.message,phase:failure.phase,qualityReport:error.quality},{signal}));
    usage.push(fixed.usage||null);draft=fixed.draft||'';return fixed.program;
  }
  async function executable(candidate){
    let current=candidate;
    while(true){
      abort(signal);program=current;
      try{
        program=validateFilmProgram(current);
        if(context.previousDesigns?.some(other=>other.fingerprint===filmFingerprint(program)))throw Object.assign(new Error('此镜动画结构与已有镜头重复，需要按当前机制重新设计。'),{code:'CODE_DUPLICATE',phase:'compile'});
        // Save valid source BEFORE executing it; failed drawings can be resumed.
        checkpoint({ready:false});
        onStage('正在检查多时刻画面、排版、主体运动与确定性');
        inspection=await inspect(program,scene,project,{signal});checkpoint({ready:true});return;
      }catch(error){
        if(signal?.aborted||error.name==='AbortError'||unrecoverable.has(error.code))throw error;
        current=await repair(error,current,draft);
      }
    }
  }
  if(program||draft)onStage('恢复上次保留的返回内容，先在本地验证');
  else{onStage('正在独立编写动画代码');const generated=await obtain(()=>api.generateSceneCode(textConfig,context,{signal}));usage.push(generated.usage||null);program=generated.program;draft=generated.draft||'';}
  await executable(program);
  for(let round=reviews.length+1;round<=rounds;round++){
    onStage(`第 ${round} / ${rounds} 轮看图返修`);
    const revised=await obtain(()=>api.reviewSceneCode(visionConfig,{...context,program,frames:inspection.frames,frameTimes:inspection.frameTimes,qualityReport:inspection.quality,round},{signal}));usage.push(revised.usage||null);draft=revised.draft||'';
    await executable(revised.program);
    reviews.push({round,feedback:revised.feedback,stats:inspection.stats});checkpoint({ready:true});
  }
  if(inspection.quality&&!inspection.quality.ok){
    // Let the selected visual rounds see the actual flawed frames first. Only
    // then use the shared single repair budget; bad layout is never completion.
    const corrected=await repair(filmQualityError(inspection.quality),program);
    await executable(corrected);
    if(inspection.quality&&!inspection.quality.ok){const error=filmQualityError(inspection.quality);checkpoint({ready:false,failure:{program,quality:inspection.quality,message:error.message,code:error.code,phase:'inspect',repairs}});throw error;}
  }
  abort(signal);return {program,inspection,reviews,usage,repairs};
}
