/** Current-run view only. Scene records remain the durable source of history. */
export function createRunDiagnostics(){
  let currentProject=null;
  const attempts=new Set();
  return {
    begin(project){currentProject=project;attempts.clear();},
    track(project,sceneId,type){if(currentProject===project)attempts.add(type+':'+sceneId);},
    clear(){attempts.clear();},
    failures(project){
      if(project!==currentProject)return [];
      return project.scenes.flatMap((scene,index)=>{
        const rows=[];
        if(attempts.has('code:'+scene.id)&&scene.renderState==='failed'&&scene.renderError)rows.push({index,type:'code',title:scene.title,message:scene.renderError});
        if(attempts.has('video:'+scene.id)&&scene.videoError)rows.push({index,type:'video',title:scene.title,message:scene.videoError});
        return rows;
      });
    }
  };
}

export function directingBriefForTopic({topic,brief,boundTopic,boundBrief,reuse=false}){
  const inherited=typeof boundBrief==='string'&&boundBrief.trim()&&String(brief).trim()===boundBrief.trim();
  return !reuse&&inherited&&String(topic).trim()!==String(boundTopic).trim()?{brief:'',skipped:true}:{brief:String(brief||'').trim(),skipped:false};
}
