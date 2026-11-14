import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVideoJob,shouldPauseVideoBatch,safeVideoResultURL} from '../dist/video-jobs.js';
import {downloadVideo} from '../dist/api-client.js';
test('resume only never creates a new task, including completed or failed jobs',async()=>{
  for(const status of ['queued','in_progress','completed','failed','cancelled']){const scene={videoTask:{id:'old',status}};const job=await resolveVideoJob({scene,existingOnly:true,api:{createVideoTask:()=>assert.fail('no billable create')}});assert.equal(job.id,'old');}
  await assert.rejects(resolveVideoJob({scene:{},existingOnly:true,api:{createVideoTask:()=>assert.fail('no create')}}),{code:'VIDEO_TASK_REQUIRED'});
});
test('a new retry requires an explicit request; system and download errors pause the batch',async()=>{
  let calls=0;const scene={videoTask:{id:'old',status:'failed'}};const job=await resolveVideoJob({scene,restartFailed:true,options:{duration:10},api:{createVideoTask:async()=>{calls++;return {id:'new',status:'queued'};}}});assert.equal(calls,1);assert.equal(job.id,'new');assert.equal(scene.videoTask.duration,10);
  for(const code of ['PROVIDER_AUTH','MINIMAX_PROVIDER','VIDEO_DOWNLOAD','VIDEO_URL','NETWORK'])assert.equal(shouldPauseVideoBatch({code}),true);assert.equal(shouldPauseVideoBatch({code:'VIDEO_FAILED'}),false);
});
test('download fallback uses the original trusted CDN result with no API key, cookies or new generation',async()=>{
  const previous=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});if(calls.length===1)return Response.json({error:{code:'VIDEO_DOWNLOAD',message:'CDN refused server'},recovery:{job:{id:'old',videoURL:'https://video-product.cdn.minimax.io/fresh.mp4'}}},{status:502});assert.equal(url,'https://video-product.cdn.minimax.io/fresh.mp4');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);return new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'video/mp4'}});};
  try{const result=await downloadVideo({apiKey:'private'}, {id:'old',videoURL:'https://video-product.cdn.minimax.io/old.mp4'});assert.equal(result.size,2);assert.equal(calls.length,2);assert.equal(calls[0].url,'/api/video/content');assert.doesNotMatch(JSON.stringify(calls[1]),/private/);}finally{globalThis.fetch=previous;}
  for(const url of ['http://cdn.hailuoai.com/x','https://cdn.minimax.io.evil.example/x','https://127.0.0.1/x'])assert.equal(safeVideoResultURL(url),null);
});
