/* Trusted bridge. Executed only inside an opaque sandbox's disposable Worker. */
let engineSource='',fontSources=[],active=null;
const cachedFilms=new Map();
let queue=Promise.resolve();
async function loadFonts(){
  if(typeof FontFace==='undefined'||!self.fonts)throw new Error('当前浏览器不支持动画字体，请使用最新版 Chrome 或 Edge。');
  for(const [name,bytes]of fontSources){const face=new FontFace(name,bytes);await face.load();self.fonts.add(face);}
}
function makeFilm(message){
  const {width,height,scene,program,palette}=message;
  const output=new OffscreenCanvas(width,height),G={};
  const document={getElementById:()=>output,createElement:()=>new OffscreenCanvas(1,1),fonts:{ready:Promise.resolve(),load:()=>Promise.resolve([])}};
  const code=engineSource.replace('const W = 1920, H = 1080;',`const W = ${width}, H = ${height};`);
  // This Function runs in the isolated worker, never in the application page.
  new Function('window','document','location','URLSearchParams',code)(G,document,{search:''},URLSearchParams);
  const draw=new Function('fr','t','scene','VK','"use strict";\n'+program.source);
  function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  const parameters=freeze({...scene,palette});
  const film=G.VK.film({dur:Number(scene.renderDuration)||scene.duration,theme:'flat',bloom:.20,grain:.025,draw(fr,t){
    fr.look.bgo={color:palette.bg};fr.look.bg='flat';draw(fr,t,parameters,G.VK);
  }});
  return {output,G,film,key:message.key};
}
function sampleForeground(film){
  // Include solid objects drawn below the glow layer, exclude moving background/grain.
  const mini=new OffscreenCanvas(96,96),ctx=mini.getContext('2d',{willReadFrequently:true});
  if(film.fr.look.under){const under=new OffscreenCanvas(film.fr.w,film.fr.h);film.fr.look.under(under.getContext('2d'),film.fr.t);ctx.drawImage(under,0,0,96,96);}
  ctx.drawImage(film.L,0,0,96,96);
  const d=ctx.getImageData(0,0,96,96).data;let count=0,minX=96,maxX=-1,minY=96,maxY=-1,hash=2166136261;
  for(let i=0;i<d.length;i+=4){if(d[i+3]>20){count++;const p=i/4,x=p%96,y=Math.floor(p/96);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}for(let j=0;j<4;j++){hash^=d[i+j];hash=Math.imul(hash,16777619);}}
  return {coverage:count/9216,bounds:maxX<0?[0,0,0,0]:[minX/96,minY/96,(maxX-minX+1)/96,(maxY-minY+1)/96],signature:(hash>>>0).toString(16)};
}
async function handle(event){
  const m=event.data;
  try{
    if(m.type==='init'){engineSource=m.engine; fontSources=m.fonts;await loadFonts();self.postMessage({id:m.id,ready:true});return;}
    if(m.type!=='render')return;
    active=cachedFilms.get(m.key);if(!active){active=makeFilm(m);cachedFilms.set(m.key,active);while(cachedFilms.size>2)cachedFilms.delete(cachedFilms.keys().next().value);}
    // Engine's font-ready callback seeks once. Let that run before explicit time.
    await Promise.resolve();await Promise.resolve();
    active.G.seek(m.time);
    const stats=m.inspect?sampleForeground(active.film):null;
    const bitmap=active.output.transferToImageBitmap();self.postMessage({id:m.id,bitmap,stats},[bitmap]);
  }catch(error){self.postMessage({id:m.id,error:String(error.message||'动画运行失败').slice(0,400)});}
}
self.onmessage=event=>{queue=queue.then(()=>handle(event)).catch(()=>{});};
