import test from 'node:test';
import assert from 'node:assert/strict';
import {UsageLedger,billableCharacters,estimateVideoCost,tokenUsage,setPriceOverride} from '../dist/costs.js';
const video={provider:'minimax',baseURL:'https://api.minimax.cn',model:'MiniMax-H3',apiKey:'never-record-this-key'};
const text={baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:'never-record-this-key'};
test('official domestic prices use actual seconds, resolution, cache tokens and Chinese billing characters',()=>{
  assert.equal(estimateVideoCost(video,10).low,5);assert.equal(estimateVideoCost(video,10,'2K').low,8);assert.equal(billableCharacters('你好 A!'),7);
  assert.deepEqual(tokenUsage({prompt_tokens:1000,completion_tokens:200,prompt_cache_hit_tokens:800}),{input:1000,output:200,cache:800});
});
test('generation and failed repairs with returned usage are both counted, unknown charges are never zeroed',()=>{
  const ledger=new UsageLedger();ledger.begin('test');ledger.record({path:'/api/scene-code',config:text,data:{usage:{prompt_tokens:1000,completion_tokens:200}}});ledger.record({path:'/api/scene-code/repair',config:text,ok:false,data:{recovery:{usage:{prompt_tokens:1000,completion_tokens:200}}}});ledger.record({path:'/api/scene-code',config:text,ok:false});
  const summary=ledger.summary();assert.equal(summary.calls,3);assert.equal(summary.unknown,1);assert.ok(summary.settled[0].low>0);assert.equal(summary.settled[0].high,summary.settled[0].low*2);assert.doesNotMatch(JSON.stringify(ledger.export()),/never-record-this-key/);
});
test('video status and downloads do not duplicate generation cost; query of a previous task creates no charge',()=>{
  const ledger=new UsageLedger();ledger.begin('video');ledger.record({path:'/api/video/create',config:video,payload:{duration:10},data:{job:{id:'task-one',status:'queued'}}});assert.equal(ledger.summary().pending[0].low,5);
  ledger.record({path:'/api/video/status',data:{job:{id:'task-one',status:'completed',outputSeconds:9}}});ledger.record({path:'/api/video/content',config:video});assert.equal(ledger.summary().calls,1);assert.equal(ledger.summary().settled[0].low,4.5);
  ledger.begin('resume');ledger.record({path:'/api/video/status',data:{job:{id:'previous-task',status:'completed'}}});assert.equal(ledger.summary().calls,0);
});
test('custom price is optional and bound to exact provider host and model',()=>{
  const config={baseURL:'https://example.com/v1',model:'mine'};assert.equal(estimateVideoCost(config,10),null);setPriceOverride(config,'video',{currency:'CNY',unit:.2});assert.equal(estimateVideoCost(config,10).low,2);assert.equal(estimateVideoCost({...config,model:'other'},10),null);setPriceOverride(config,'video',null);
});
