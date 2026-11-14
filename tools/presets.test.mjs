import test from 'node:test';
import assert from 'node:assert/strict';
import {getDimensions,RATIO_PRESETS} from '../dist/presets.js';
import {exportVideo} from '../dist/exporter.js';

test('preview and final export dimensions preserve every selected common aspect ratio',()=>{
  for(const ratio of RATIO_PRESETS){
    const [a,b]=ratio.id.split(':').map(Number);
    for(const preview of [false,true]){
      const {width,height}=getDimensions(ratio.id,{preview});
      assert.ok(Math.abs(width/height-a/b)<.007,ratio.id);
      assert.equal(width%2,0);assert.equal(height%2,0);
      if(preview)assert.ok(Math.max(width,height)<=960);
    }
  }
});
test('export refuses unfinished drawings instead of exporting generic placeholders as a completed video',async()=>{
  const project={duration:90,scenes:[{id:'a',start:0,duration:90,renderState:'failed'}]};
  await assert.rejects(exportVideo(project),/画面未完成/);
  await assert.rejects(exportVideo({...project,duration:601}),/600 秒以内/);
});
