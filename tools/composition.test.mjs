import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateComposition,drawComposition,compositionFingerprint} from '../dist/composition.js';
import {RATIO_PRESETS,STYLE_PRESETS,getDimensions,getStyle} from '../dist/presets.js';
const {createCanvas,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
for(const [file,name]of [['NotoSerifCJK-Regular.ttc','Noto Serif CJK SC'],['NotoSansCJK-Regular.ttc','Noto Sans CJK SC']]){
 try{GlobalFonts.registerFromPath('/usr/share/fonts/opentype/noto/'+file,name);}catch{}
}
const fixtures={};for(const name of ['cpu','network','probability','energy'])fixtures[name]=JSON.parse(await readFile(new URL('./fixtures/'+name+'.json',import.meta.url),'utf8'));
function image(raw,time=5,ratio='16:9',style='noir'){
 const native=getDimensions(ratio);const scale=480/Math.max(native.width,native.height),width=Math.round(native.width*scale),height=Math.round(native.height*scale);
 const canvas=createCanvas(width,height);drawComposition(canvas.getContext('2d'),validateComposition(raw),{time,duration:10,width,height,style:getStyle(style),scene:{particleCount:0}});return canvas.toBuffer('image/png');
}
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
test('complex compositions preserve recognizable structures and exact probability data',()=>{
 for(const f of Object.values(fixtures))assert.ok(validateComposition(f).objects.length>=4);
 const n=validateComposition(fixtures.network).objects.find(o=>o.type==='network');assert.equal(n.nodes.length,23);assert.equal(n.edges.length,253);
 const curve=validateComposition(fixtures.probability).objects.find(o=>o.type==='plot');assert.ok(Math.abs(curve.points[22].y-0.5072972343239854)<1e-12);
 assert.ok(fixtures.cpu.objects.some(o=>o.type==='path'));assert.ok(fixtures.energy.objects.some(o=>o.id==='photon'));
});
test('renamed text is detected as the same composition while data or geometry changes are distinct',()=>{
 const original=fixtures.network,renamed=structuredClone(original);renamed.layout='new-name-only';renamed.designIntent='different words';renamed.objects.filter(o=>o.type==='text').forEach(o=>{o.text='只替换文字';o.id='renamed-'+o.id;});
 assert.equal(compositionFingerprint(original),compositionFingerprint(renamed));
 const moved=structuredClone(original);moved.objects.find(o=>o.type==='network').x+=.08;assert.notEqual(compositionFingerprint(original),compositionFingerprint(moved));
 const changedNumber=structuredClone(original);changedNumber.objects.find(o=>o.type==='number').value=254;assert.notEqual(compositionFingerprint(original),compositionFingerprint(changedNumber));
 const changedFraction=structuredClone(fixtures.probability);changedFraction.objects.find(o=>o.type==='fraction').numerator='364';assert.notEqual(compositionFingerprint(fixtures.probability),compositionFingerprint(changedFraction));
});
test('unsupported media, executable path strings, repeated identifiers and invalid animation data fail closed',()=>{
 assert.throws(()=>validateComposition({objects:[{id:'remote',type:'image',src:'https://example.com/x.png'}]}),{code:'COMPOSITION_INVALID'});
 assert.throws(()=>validateComposition({objects:[{id:'path',type:'path',path:'M 0 0 <script>alert(1)</script>'}]}),{code:'COMPOSITION_INVALID'});
 assert.throws(()=>validateComposition({objects:[{id:'x',type:'circle'},{id:'x',type:'text'}]}),{code:'COMPOSITION_INVALID'});
 assert.throws(()=>validateComposition({objects:[{id:'x',type:'circle',animations:[{property:'x',from:0,to:NaN}]}]}),{code:'COMPOSITION_INVALID'});
 assert.throws(()=>validateComposition({objects:[{id:'x',type:'bars',values:[1,Infinity]}]}),{code:'COMPOSITION_INVALID'});
 let nested={id:'leaf',type:'circle'};for(let i=0;i<5;i++)nested={id:'g'+i,type:'group',children:[nested]};assert.throws(()=>validateComposition({objects:[nested]}),{code:'COMPOSITION_INVALID'});
});
test('independent compositions have distinct rendered geometry and deterministic time-based motion',()=>{
 const first=Object.values(fixtures).map(f=>digest(image(f,5,'16:9','minimal')));assert.equal(new Set(first).size,4);
 for(const f of Object.values(fixtures)){assert.equal(digest(image(f,4)),digest(image(f,4)));assert.notEqual(digest(image(f,2.5,'16:9','minimal')),digest(image(f,7.5,'16:9','minimal')));}
});
test('all public aspect ratios and visual styles render the same composition without stretching the canvas dimensions',()=>{
 for(const ratio of RATIO_PRESETS){const d=getDimensions(ratio.id);assert.equal(d.width,ratio.width);assert.equal(d.height,ratio.height);assert.ok(image(fixtures.cpu,5,ratio.id).length>1000);}
 const styles=STYLE_PRESETS.map(style=>digest(image(fixtures.probability,6,'16:9',style.id)));assert.equal(new Set(styles).size,STYLE_PRESETS.length);
});
if(process.env.JIANZHI_STILL_CHECKS==='1'){
 const directory='/workspace/work/quality-v3';await mkdir(directory,{recursive:true});
 for(const [name,fixture]of Object.entries(fixtures))await writeFile(directory+'/'+name+'.png',image(fixture,6.5));
 await writeFile(directory+'/cpu-portrait.png',image(fixtures.cpu,6.5,'9:16','blueprint'));
 console.log('Wrote QA stills only; no audio or video created.');
}

test('the live reference illustration is honest, complete, and uses distinct mathematical scenes',async()=>{
 const {createReferenceDemo}=await import('../dist/demos.js');
 for(const duration of [15,90,120,300]){
  const p=createReferenceDemo({duration,ratio:'1:1',style:'noir'});assert.equal(p.duration,duration);assert.equal(p.ratio,'1:1');assert.equal(p.isDemo,true);assert.equal(p.generatedFromApi,false);
  let end=0;for(const s of p.scenes){assert.equal(s.start,end);end+=s.duration;assert.equal(s.renderState,'complete');validateComposition(s.composition);}assert.equal(end,duration);
  assert.equal(new Set(p.scenes.map(s=>compositionFingerprint(s.composition))).size,p.scenes.length);
 }
});
