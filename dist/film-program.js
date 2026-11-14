import {parse} from './vendor/acorn.mjs';

const forbidden=new Set('window document self globalThis opener fetch XMLHttpRequest WebSocket WebTransport EventSource importScripts Worker SharedWorker ServiceWorker navigator location indexedDB caches localStorage sessionStorage postMessage close eval Function Reflect Proxy Date performance setTimeout setInterval requestAnimationFrame cancelAnimationFrame Atomics SharedArrayBuffer WebAssembly crypto console process require module exports Image Audio FontFace OffscreenCanvas'.split(' '));
const properties=new Set(['constructor','prototype','__proto__','caller','callee','arguments','canvas','film','ownerDocument','defaultView','getContext','transferToImageBitmap','convertToBlob','toDataURL','getImageData','putImageData','createImageData']);
function programAST(source){
  if(typeof source!=='string'||source.length<120||source.length>60000)throw new Error('动画代码应为 120–60000 字符的独立绘图函数体。');
  let ast;try{ast=parse('function draw(fr,t,scene,VK){"use strict";\n'+source+'\n}',{ecmaVersion:2022});}catch{throw new Error('动画代码语法错误，请重新生成这一镜。');}
  let nodes=0,draws=0,usesTime=false;
  function walk(node){
    if(!node||typeof node!=='object')return;
    if(++nodes>20000)throw new Error('动画代码过于复杂，请简化这一镜。');
    if(['ImportExpression','ImportDeclaration','ExportNamedDeclaration','ExportDefaultDeclaration','AwaitExpression','YieldExpression','WithStatement','ThisExpression','Super','MetaProperty','DebuggerStatement','NewExpression'].includes(node.type)||node.async||node.generator)throw new Error('动画仅允许同步、确定性的 Canvas 绘制。');
    if(node.type==='Identifier'){
      if(forbidden.has(node.name)||properties.has(node.name))throw new Error('动画代码包含不允许的运行环境访问：'+node.name);
      if(node.name==='t')usesTime=true;
    }
    if(node.type==='MemberExpression'){
      const key=node.computed&&node.property.type==='Literal'?node.property.value:!node.computed?node.property.name:null;
      if(typeof key==='string'&&properties.has(key))throw new Error('动画不能访问绘图环境之外的对象。');
      if(node.object.type==='Identifier'&&node.object.name==='Math'&&key==='random')throw new Error('请使用 VK.hash/VK.rng 保证跳转与导出一致。');
      if(node.object.type==='Identifier'&&node.object.name==='fr'&&['text','rect','circle','ellipse','path','line','poly','arc','chars','g','layer'].includes(key))draws++;
      if(node.object.type==='MemberExpression'&&node.object.object.name==='fr'&&node.object.property.name==='x')draws++;
    }
    for(const [key,value]of Object.entries(node)){if(['start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  }
  // Only the generated body is checked; wrapper parameters are fixed.
  ast.body[0].body.body.slice(1).forEach(walk);
  if(!draws||!usesTime)throw new Error('代码必须实际绘制对象并按时间推进，不能只返回静态文案。');
  return ast;
}
export function validateFilmProgram(input){
  if(!input||input.version!==1||typeof input.source!=='string')throw new Error('模型未返回独立动画代码。');
  programAST(input.source);
  const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  const program={version:1,source:input.source,designIntent:clean(input.designIntent,1200),layout:clean(input.layout,160),heroObjects:(Array.isArray(input.heroObjects)?input.heroObjects:[]).slice(0,12).map(x=>clean(x,160))};
  if(!program.designIntent||!program.layout||!program.heroObjects.length)throw new Error('动画缺少具体物件和知识动作说明。');
  return program;
}
export function filmFingerprint(program){
  const ast=programAST(program.source);
  const normalized=JSON.stringify(ast,(key,value)=>['start','end','raw'].includes(key)?undefined:key==='value'&&typeof value==='string'&&!/^[Mm]\s*[-\d.]/.test(value)?'TEXT':value);
  let hash=2166136261;for(let i=0;i<normalized.length;i++){hash^=normalized.charCodeAt(i);hash=Math.imul(hash,16777619);}return 'code-'+(hash>>>0).toString(16);
}
