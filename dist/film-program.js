import {undefinedFilmIdentifiers} from './film-scope.js';
export {FILM_ALIAS_NAMES} from './film-scope.js';
import {parse} from './vendor/acorn.mjs';

const forbidden=new Set('window document self globalThis opener fetch XMLHttpRequest WebSocket WebTransport EventSource importScripts Worker SharedWorker ServiceWorker navigator location indexedDB caches localStorage sessionStorage postMessage close eval Function Reflect Proxy Date performance setTimeout setInterval requestAnimationFrame cancelAnimationFrame Atomics SharedArrayBuffer WebAssembly crypto console process require module exports Image Audio FontFace OffscreenCanvas'.split(' '));
const properties=new Set(['constructor','prototype','__proto__','caller','callee','arguments','canvas','film','ownerDocument','defaultView','getContext','transferToImageBitmap','convertToBlob','toDataURL','getImageData','putImageData','createImageData']);
/** Normalize transport wrappers only; invalid JS is retained for a disclosed repair. */
export function extractFilmProgram(input){
  let value=input;
  for(let depth=0;depth<4;depth++){
    if(typeof value==='string'){try{value=JSON.parse(value);}catch{return {version:1,source:value};}}
    if(!value||typeof value!=='object'||Array.isArray(value))return value;
    if(['source','code','javascript','drawCode'].some(key=>typeof value[key]==='string'))break;
    const nested=['program','animation','data','result','output'].find(key=>value[key]&&typeof value[key]==='object'||typeof value[key]==='string');
    if(!nested)break;value=value[nested];
  }
  if(!value||typeof value!=='object')return value;
  let source=['source','code','javascript','drawCode'].map(key=>value[key]).find(v=>typeof v==='string');
  if(typeof source==='string'){
    const fenced=source.trim().match(/^```(?:javascript|js)?\s*\n?([\s\S]*?)\s*```$/i);if(fenced)source=fenced[1];
    // Only a single complete draw wrapper with the supported parameter names is
    // unwrapped. Arbitrary programs/HTML and malformed code are never executed.
    try{
      const tree=parse(source,{ecmaVersion:2022}),node=tree.body.length===1?tree.body[0]:null;
      const fn=node?.type==='FunctionDeclaration'?node:node?.type==='ExpressionStatement'?node.expression:null;
      if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(fn?.type)&&!fn.async&&!fn.generator&&fn.body.type==='BlockStatement'&&['fr,t,scene','fr,t,scene,VK'].includes(fn.params.map(p=>p.name).join(',')))source=source.slice(fn.body.start+1,fn.body.end-1).trim();
    }catch{/* Report precise syntax errors in validation, not a guessed rewrite. */}
  }
  return {...value,version:value.version===undefined||value.version==='1'?1:value.version,source,designIntent:value.designIntent||value.description,layout:value.layout||value.composition,heroObjects:value.heroObjects||value.objects};
}
function programAST(source){
  if(typeof source!=='string'||source.length<120||source.length>60000)throw new Error('动画代码应为 120–60000 字符的独立绘图函数体。');
  let ast;try{ast=parse('function draw(fr,t,scene,VK){"use strict";\n'+source+'\n}',{ecmaVersion:2022,locations:true});}catch(cause){const line=Math.max(1,(cause.loc?.line||2)-1),column=(cause.loc?.column||0)+1;throw Object.assign(new Error(`动画代码第 ${line} 行、第 ${column} 列语法错误：${String(cause.message).replace(/\s*\(\d+:\d+\)$/,'')}`),{code:'CODE_SYNTAX',phase:'compile',details:{line,column}});}
  let nodes=0,draws=0,usesTime=false;
  function walk(node,parent=null,field=''){
    if(!node||typeof node!=='object')return;
    if(++nodes>20000)throw new Error('动画代码过于复杂，请简化这一镜。');
    if(['ImportExpression','ImportDeclaration','ExportNamedDeclaration','ExportDefaultDeclaration','AwaitExpression','YieldExpression','WithStatement','ThisExpression','Super','MetaProperty','DebuggerStatement','NewExpression'].includes(node.type)||node.async||node.generator)throw new Error('动画仅允许同步、确定性的 Canvas 绘制。');
    if(node.type==='Identifier'){
      const propertyName=(parent?.type==='Property'&&field==='key'&&!parent.computed)||(parent?.type==='MemberExpression'&&field==='property'&&!parent.computed);
      if((forbidden.has(node.name)&&!propertyName)||properties.has(node.name))throw new Error('动画代码包含不允许的运行环境访问：'+node.name);
      if(node.name==='t'&&!propertyName)usesTime=true;
    }
    if(node.type==='MemberExpression'){
      const key=node.computed&&node.property.type==='Literal'?node.property.value:!node.computed?node.property.name:null;
      if(typeof key==='string'&&properties.has(key))throw new Error('动画不能访问绘图环境之外的对象。');
      if(node.object.type==='Identifier'&&node.object.name==='Math'&&key==='random')throw new Error('请使用 VK.hash/VK.rng 保证跳转与导出一致。');
      if(node.object.type==='Identifier'&&node.object.name==='fr'&&['text','label','rect','circle','ellipse','path','line','poly','arc','chars','g','layer'].includes(key))draws++;
      if(node.object.type==='MemberExpression'&&node.object.object.name==='fr'&&node.object.property.name==='x')draws++;
    }
    for(const [key,value]of Object.entries(node)){if(['start','end','loc'].includes(key))continue;if(Array.isArray(value))value.forEach(child=>walk(child,node,key));else if(value&&typeof value==='object')walk(value,node,key);}
  }
  // Only the generated body is checked; wrapper parameters are fixed.
  ast.body[0].body.body.slice(1).forEach(node=>walk(node));
  if(!draws||!usesTime)throw new Error('代码必须实际绘制对象并按时间推进，不能只返回静态文案。');
  const missing=undefinedFilmIdentifiers(ast);if(missing.length){const error=new Error('动画代码使用了未定义的名称：'+missing.join('、')+'。请声明本地变量或使用文档提供的函数。');error.code='UNDEFINED_SYMBOL';error.symbols=missing;throw error;}
  return ast;
}
export function validateFilmProgram(input){
  input=extractFilmProgram(input);
  if(!input||input.version!==1||typeof input.source!=='string')throw new Error('模型未返回独立动画代码。');
  programAST(input.source);
  const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
  const program={version:1,source:input.source,designIntent:clean(input.designIntent,1200),layout:clean(input.layout,160),heroObjects:(Array.isArray(input.heroObjects)?input.heroObjects:[]).slice(0,12).map(x=>clean(x,160))};
  if(!program.designIntent||!program.layout||!program.heroObjects.length)throw new Error('动画缺少具体物件和知识动作说明。');
  return program;
}
export function filmFingerprint(program){
  const ast=programAST(program.source);
  const normalized=JSON.stringify(ast,(key,value)=>['start','end','raw','loc'].includes(key)?undefined:key==='value'&&typeof value==='string'&&!/^[Mm]\s*[-\d.]/.test(value)?'TEXT':value);
  let hash=2166136261;for(let i=0;i<normalized.length;i++){hash^=normalized.charCodeAt(i);hash=Math.imul(hash,16777619);}return 'code-'+(hash>>>0).toString(16);
}
