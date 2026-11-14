import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWorker} from './lib/native-film.mjs';
import {sampleFilmInspection} from '../dist/film-quality.js';
import {getStyle} from '../dist/presets.js';
const palette=getStyle('paper').palette;
const program=source=>({version:1,layout:'math-helper-test',designIntent:'检查分数间距与缩放原点，不作为生成模板',heroObjects:['分数'],source});
async function inspect(source,width,height){const worker=await nativeWorker();return sampleFilmInspection({duration:10,width,height,sample:async time=>{const r=await worker({type:'render',id:1,key:'sample',scene:{duration:10},program:program(source),palette,width,height,time,inspect:true});return {stats:r.stats,frame:r.bitmap.toDataURL('image/jpeg')};}});}
test('the supplied double-translation and tight fraction spacing fail, pivot/fraction helpers pass in both ratios',async()=>{
  const before=`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,3,7),cx=W*.73,cy=H*.55;fr.rect(W*(.15+p*.1),H*.25,W*.2,H*.1,{fill:scene.palette.gold});fr.text('1',W*.3,H*.5-S*.048*.24,{size:S*.048});fr.text('12',W*.3,H*.5+S*.048*.36,{size:S*.048});fr.g({at:[cx,cy],s:.9+.1*p},()=>fr.text('×',cx,cy,{size:S*.055}));`;
  const after=`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,3,7),cx=W*.73,cy=H*.55;fr.rect(W*(.15+p*.1),H*.25,W*.2,H*.1,{fill:scene.palette.gold});fr.fraction('1','12',W*.3,H*.5,{size:S*.048});fr.pivot(cx,cy,{s:.9+.1*p},()=>fr.text('×',cx,cy,{size:S*.055}));`;
  for(const[w,h]of[[324,576],[576,324]]){const bad=await inspect(before,w,h);assert.ok(bad.quality.issues.some(i=>i.code==='TEXT_OVERLAP'));assert.ok(bad.quality.issues.some(i=>i.code==='TEXT_CLIPPED'));const fixed=await inspect(after,w,h);assert.equal(fixed.quality.ok,true,JSON.stringify(fixed.quality.issues));}
});
test('equation rows use measured fraction widths and reject overflow instead of shrinking type',async()=>{
  const source=`const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.ss(t,0,7);fr.equation([{n:'1',d:'12'},'÷',{n:'1',d:'3'},'=',{n:'1',d:'4'}],W*.5,H*.45,{size:S*.065,maxWidth:W*.85,color:scene.palette.ink});fr.line(W*.2,H*.65,W*(.2+.6*p),H*.65,{color:scene.palette.gold,w:3});`;
  const result=await inspect(source,576,324);assert.equal(result.quality.ok,true);assert.ok(result.stats[1].texts.some(t=>t.text==='12'));
  const worker=await nativeWorker();await assert.rejects(()=>worker({type:'render',id:1,key:'too-wide',scene:{duration:10},program:program(source.replace('maxWidth:W*.85','maxWidth:W*.08')),palette,width:576,height:324,time:5}),/公式行过宽/);
});
test('probability bars reject unnormalized data and fraction denominators cannot be zero',async()=>{
  const worker=await nativeWorker();
  for(const source of ["fr.probabilityBar(40,80,220,24,[{value:.25},{value:.25}]);","fr.fraction('1','0',120,140,{size:18});"]){await assert.rejects(()=>worker({type:'render',id:1,key:source,scene:{duration:10},program:program(source),palette,width:324,height:576,time:5}),/合计为1|非零分母/);}
  const result=await worker({type:'render',id:2,key:'bar',scene:{duration:10},program:program("fr.probabilityBar(40,160,220,24,[{value:.25,color:scene.palette.gold},{value:.75,color:scene.palette.blue}]);"),palette,width:324,height:576,time:5,inspect:true});assert.ok(result.stats.coverage>.01);
});
test('dice have exactly the requested number of separated high-contrast front pips',async()=>{
  const worker=await nativeWorker(),size=90,cx=162,cy=230;
  for(let value=1;value<=6;value++){
    const result=await worker({type:'render',id:value,key:'die'+value,scene:{duration:10},program:program(`fr.die(${cx},${cy},${size},{value:${value}});`),palette,width:324,height:576,time:5});
    const x=Math.round(cx-size*.35),y=Math.round(cy-size*.35),width=Math.round(size*.7),pixels=result.bitmap.getContext('2d').getImageData(x,y,width,width).data,seen=new Set();let components=0;
    const dark=i=>pixels[i*4]<105&&pixels[i*4+1]<105&&pixels[i*4+2]<105;
    for(let i=0;i<width*width;i++){if(seen.has(i)||!dark(i))continue;components++;const todo=[i];seen.add(i);while(todo.length){const p=todo.pop(),px=p%width,py=Math.floor(p/width);for(const[nx,ny]of[[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){const n=ny*width+nx;if(nx>=0&&nx<width&&ny>=0&&ny<width&&!seen.has(n)&&dark(n)){seen.add(n);todo.push(n);}}}}
    assert.equal(components,value,'front face '+value);
  }
});
