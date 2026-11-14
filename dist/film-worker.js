/* Trusted bridge. Executed only inside an opaque sandbox's disposable Worker. */
let engineSource='',fontSources=[],active=null,aliasNames=[];
const cachedFilms=new Map();
let queue=Promise.resolve();
async function loadFonts(){
  if(typeof FontFace==='undefined'||!self.fonts)throw new Error('当前浏览器不支持动画字体，请使用最新版 Chrome 或 Edge。');
  for(const [name,bytes]of fontSources){const face=new FontFace(name,bytes);await face.load();self.fonts.add(face);}
}
function makeFilm(message){
  const {width,height,scene,program,palette}=message;
  const trace={active:false,texts:[],skipText:false},contexts=new WeakSet();
  function canvas(w,h){
    const cv=new OffscreenCanvas(w,h),ctx=cv.getContext('2d');
    if(!contexts.has(ctx)){
      contexts.add(ctx);const fillText=ctx.fillText.bind(ctx);
      ctx.fillText=function(value,x,y,maxWidth){
        if(trace.skipText)return;
        if(trace.active&&trace.texts.length<160&&ctx.globalAlpha>.02&&String(value).trim()){
          const text=String(value),metrics=ctx.measureText(text),size=Number(/([\d.]+)px/.exec(ctx.font)?.[1])||12,m=ctx.getTransform();
          const left=x-(Number.isFinite(metrics.actualBoundingBoxLeft)?metrics.actualBoundingBoxLeft:0),right=x+(Number.isFinite(metrics.actualBoundingBoxRight)?metrics.actualBoundingBoxRight:metrics.width);
          const top=y-(Number.isFinite(metrics.actualBoundingBoxAscent)?metrics.actualBoundingBoxAscent:size*.7),bottom=y+(Number.isFinite(metrics.actualBoundingBoxDescent)?metrics.actualBoundingBoxDescent:size*.3);
          const corners=[[left,top],[right,top],[right,bottom],[left,bottom]].map(([px,py])=>[m.a*px+m.c*py+m.e,m.b*px+m.d*py+m.f]);
          const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
          const fill=String(ctx.fillStyle),rgba=fill.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/),colorAlpha=rgba?Number(rgba[1]):/^#[0-9a-f]{8}$/i.test(fill)?parseInt(fill.slice(-2),16)/255:1;
          trace.texts.push({text:text.slice(0,100),box:[Math.min(...xs)/width,Math.min(...ys)/height,(Math.max(...xs)-Math.min(...xs))/width,(Math.max(...ys)-Math.min(...ys))/height],sizeRatio:size*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d))/Math.min(width,height),alpha:ctx.globalAlpha*colorAlpha});
        }
        return maxWidth===undefined?fillText(value,x,y):fillText(value,x,y,maxWidth);
      };
      const strokeText=ctx.strokeText.bind(ctx);ctx.strokeText=(...args)=>{if(!trace.skipText)return strokeText(...args);};
    }
    return cv;
  }
  const output=canvas(width,height),G={};
  const document={getElementById:()=>output,createElement:()=>canvas(1,1),fonts:{ready:new Promise(()=>{}),load:()=>Promise.resolve([])}};
  const code=engineSource.replace('const W = 1920, H = 1080;',`const W = ${width}, H = ${height};`);
  // This Function runs in the isolated worker, never in the application page.
  new Function('window','document','location','URLSearchParams',code)(G,document,{search:''},URLSearchParams);
  // An outer scope supplies documented helpers; source-local declarations may shadow them.
  const drawingAPI=Object.freeze({...G.VK,PI:Math.PI,TAU:Math.PI*2});
  const names=aliasNames.length?aliasNames:Object.keys(drawingAPI).filter(name=>!['film','scene','BG','FONTS','vignette'].includes(name));
  if(names.some(name=>!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)))throw new Error('动画函数接口配置无效。');
  let draw;try{draw=new Function('VK','"use strict"; const {'+names.join(',')+'}=VK; return function(fr,t,scene){\n'+program.source+'\n};')(drawingAPI);}
  catch(error){error.phase='compile';throw error;}
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  const parameters=freeze({...scene,palette});
  const film=G.VK.film({dur:Number(scene.renderDuration)||scene.duration,theme:'flat',bloom:.20,grain:.025,draw(fr,t){
    fr.look.bgo={color:palette.bg};fr.look.bg='flat';draw(fr,t,parameters);
  }});
  // A reusable typesetter, not a scene template. Long labels must be rewritten
  // rather than silently shrinking facts into unreadable text.
  film.fr.label=function(value,x,y,o={}){
    const s=Math.min(width,height),size=Math.max(s*.035,Number(o.size)||s*.048),maxWidth=Number(o.maxWidth)||width*.8,lines=[''];
    for(const char of String(value)){const last=lines.length-1;if(char==='\n'){lines.push('');continue;}if(this.measure(lines[last]+char,{...o,size})>maxWidth&&lines[last])lines.push(char);else lines[last]+=char;}
    if(lines.length>(Number(o.maxLines)||2))throw new Error('标签超过两行，请缩短标注或扩大标注区域。');
    const lineHeight=size*1.3;lines.forEach((line,i)=>this.text(line,x,y+(i-(lines.length-1)/2)*lineHeight,{...o,size}));
  };
  const layer=film.fr.layer;
  film.fr.layer=function(o,fn){
    const first=trace.texts.length,m=this.x.getTransform(),alpha=this.x.globalAlpha;
    const result=layer.call(this,o,fn);if(!trace.active)return result;
    const cx=o.cx??width/2,cy=o.cy??height/2,scale=o.s??1,angle=o.rot||0,cos=Math.cos(angle),sin=Math.sin(angle),dx=o.at?.[0]||0,dy=o.at?.[1]||0;
    for(const text of trace.texts.slice(first)){
      const [x,y,w,h]=text.box,corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([u,v])=>{
        const a=(u*width-cx)*scale,b=(v*height-cy)*scale,px=cos*a-sin*b+cx+dx,py=sin*a+cos*b+cy+dy;return [m.a*px+m.c*py+m.e,m.b*px+m.d*py+m.f];
      }),xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);
      text.box=[Math.min(...xs)/width,Math.min(...ys)/height,(Math.max(...xs)-Math.min(...xs))/width,(Math.max(...ys)-Math.min(...ys))/height];text.alpha*=alpha*(o.a??1);text.sizeRatio*=Math.abs(scale)*Math.min(Math.hypot(m.a,m.b),Math.hypot(m.c,m.d));
    }
    return result;
  };
  return {output,G,film,trace,source:program.source,key:message.key};
}
function sampleForeground(film,geometry=false){
  // Include solid objects drawn below the glow layer, exclude moving background/grain.
  const mini=new OffscreenCanvas(96,96),ctx=mini.getContext('2d',{willReadFrequently:true});
  if(film.fr.look.under){const under=new OffscreenCanvas(film.fr.w,film.fr.h),ux=under.getContext('2d');if(geometry){ux.fillText=()=>{};ux.strokeText=()=>{};}film.fr.look.under(ux,film.fr.t);ctx.drawImage(under,0,0,96,96);}
  ctx.drawImage(film.L,0,0,96,96);
  const d=ctx.getImageData(0,0,96,96).data;let count=0,minX=96,maxX=-1,minY=96,maxY=-1,hash=2166136261;
  for(let i=0;i<d.length;i+=4){if(d[i+3]>20){count++;const p=i/4,x=p%96,y=Math.floor(p/96);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}for(let j=0;j<4;j++){hash^=d[i+j];hash=Math.imul(hash,16777619);}}
  return {coverage:count/9216,bounds:maxX<0?[0,0,0,0]:[minX/96,minY/96,(maxX-minX+1)/96,(maxY-minY+1)/96],signature:(hash>>>0).toString(16)};
}
async function handle(event){
  const m=event.data;
  try{
    if(m.type==='init'){engineSource=m.engine; fontSources=m.fonts;aliasNames=Array.isArray(m.aliases)?m.aliases:[];await loadFonts();self.postMessage({id:m.id,ready:true});return;}
    if(m.type!=='render')return;
    active=cachedFilms.get(m.key);if(!active||active.source!==m.program.source){active=makeFilm(m);cachedFilms.set(m.key,active);while(cachedFilms.size>2)cachedFilms.delete(cachedFilms.keys().next().value);}
    // Fonts were loaded at init. The app alone controls seeks; no unsolicited draw(0).
    active.trace.texts=[];active.trace.active=!!m.inspect;
    active.G.seek(m.time);active.trace.active=false;
    const stats=m.inspect?sampleForeground(active.film):null;
    if(stats)stats.texts=active.trace.texts;
    const bitmap=active.output.transferToImageBitmap();
    if(stats){try{active.trace.skipText=true;active.G.seek(m.time);const shapes=sampleForeground(active.film,true);stats.geometrySignature=shapes.signature;stats.geometryCoverage=shapes.coverage;}finally{active.trace.skipText=false;}}
    self.postMessage({id:m.id,bitmap,stats},[bitmap]);
  }catch(error){self.postMessage({id:m.id,error:String(error.message||'动画运行失败').slice(0,600),code:m.type==='init'?'RENDER_ENVIRONMENT':'SCENE_RUNTIME',phase:error.phase||'draw',details:{name:error.name||'Error',stack:String(error.stack||'').slice(0,1200)}});}
}
self.onmessage=event=>{queue=queue.then(()=>handle(event)).catch(()=>{});};
