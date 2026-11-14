/* Safe, deterministic Canvas scene compositions. Interprets data only. */
const TYPES=new Set(['rect','roundRect','circle','ellipse','line','path','text','group','particles','network','plot','bars','fraction','number','arrow','grid']);
const PROPERTIES=new Set(['x','y','scale','rotation','opacity','reveal','value']);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const num=(x,d=0,a=-2,b=3)=>Number.isFinite(Number(x))?clamp(Number(x),a,b):d;
const str=(x,n=200)=>typeof x==='string'?x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').slice(0,n):'';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function color(value,fallback){const s=str(value,80);return /^\$(gold|accent|blue|ink|muted|bg|white|faint)$/.test(s)||/^#[0-9a-f]{3,8}$/i.test(s)||/^rgba?\([\d.,%\s]+\)$/.test(s)||['transparent','none','white','black'].includes(s)?s:fallback;}
function invalid(message){const error=new Error(message);error.code='COMPOSITION_INVALID';throw error;}

export function validateComposition(input){
  if(typeof input==='string'){try{input=JSON.parse(input);}catch{invalid('镜头绘图必须是有效 JSON。');}}
  if(!object(input)||!Array.isArray(input.objects)||input.objects.length<1||input.objects.length>120)invalid('镜头绘图需要 1–120 个可见对象。');
  let count=0;const ids=new Set();
  function clean(raw,depth=0){
    if(!object(raw)||!TYPES.has(raw.type))invalid('镜头包含不支持的绘图对象。');
    if(depth>3||++count>120)invalid('镜头图层数量或分组深度超出限制。');
    const id=str(raw.id,100)||`object-${count}`;if(ids.has(id))invalid('镜头绘图对象 ID 不能重复。');ids.add(id);
    const o={id,type:raw.type,x:num(raw.x,.5),y:num(raw.y,.5),w:num(raw.w,.2,.001,2),h:num(raw.h,.2,.001,2),r:num(raw.r,.04,.001,1),x2:num(raw.x2,.7),y2:num(raw.y2,.5),fill:color(raw.fill,raw.type==='text'||raw.type==='number'||raw.type==='fraction'?'$ink':'none'),stroke:color(raw.stroke,'$accent'),lineWidth:num(raw.lineWidth,1.5,.2,12),opacity:num(raw.opacity,1,0,1),rotation:num(raw.rotation,0,-720,720),scale:num(raw.scale,1,.01,8),reveal:num(raw.reveal,1,0,1),start:num(raw.start,0,0,1),end:num(raw.end,1,0,1),text:str(raw.text,400),fontSize:num(raw.fontSize,.04,.008,.16),fontFamily:['serif','sans','mono'].includes(raw.fontFamily)?raw.fontFamily:null,align:['left','center','right'].includes(raw.align)?raw.align:'center'};
    if(o.end<o.start)invalid('对象结束时间不能早于开始时间。');
    o.animations=(Array.isArray(raw.animations)?raw.animations:[]).slice(0,16).map(a=>{
      if(!object(a)||!PROPERTIES.has(a.property)||!Number.isFinite(Number(a.from))||!Number.isFinite(Number(a.to)))invalid('关键帧需要合法的属性和有限数值。');
      const range=a.property==='value'?[-1e12,1e12]:a.property==='rotation'?[-720,720]:a.property==='scale'?[.01,8]:['opacity','reveal'].includes(a.property)?[0,1]:[-2,3];
      const from=num(a.from,0,...range),to=num(a.to,1,...range),start=num(a.start,0,0,1),end=num(a.end,1,0,1);
      if(end<start)invalid('动画结束时刻不能早于开始时刻。');
      return {property:a.property,from,to,start,end,easing:['linear','easeInOut','easeOut'].includes(a.easing)?a.easing:'easeInOut'};
    });
    if(o.type==='path'){
      o.path=str(raw.path,12000);if(!o.path||!/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(o.path)||!(o.path.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[]).every(x=>Number.isFinite(Number(x))&&Math.abs(Number(x))<=1e6))invalid('矢量路径只能包含有限的 SVG 几何指令。');
    }
    if(o.type==='group'){
      if(!Array.isArray(raw.children)||!raw.children.length)invalid('分组需要至少一个子对象。');o.children=raw.children.map(x=>clean(x,depth+1));
    }
    if(o.type==='network'){
      o.nodes=(Array.isArray(raw.nodes)?raw.nodes:[]).slice(0,80).map(n=>({x:num(n.x,.5,0,1),y:num(n.y,.5,0,1),label:str(n.label,40),r:num(n.r,.015,.002,.1)}));
      if(o.nodes.length<2)invalid('关系图至少需要两个节点。');
      o.edges=(Array.isArray(raw.edges)?raw.edges:[]).slice(0,500).filter(e=>Array.isArray(e)&&e.length===2&&e.every(i=>Number.isInteger(i)&&i>=0&&i<o.nodes.length)).map(e=>[e[0],e[1]]);
    }
    if(o.type==='plot'){
      o.points=(Array.isArray(raw.points)?raw.points:[]).slice(0,300).map(p=>({x:num(p.x,0,0,1),y:num(p.y,0,0,1)}));if(o.points.length<2)invalid('曲线至少需要两个数据点。');o.showAxes=raw.showAxes!==false;
    }
    if(o.type==='bars'){o.values=(Array.isArray(raw.values)?raw.values:[]).slice(0,32).map(x=>{if(!Number.isFinite(Number(x)))invalid('柱状图数据必须是有限数字。');return num(x,0,-1e12,1e12);});if(!o.values.length)invalid('柱状图需要数据。');o.colors=(Array.isArray(raw.colors)?raw.colors:[]).slice(0,32).map(x=>color(x,'$accent'));}
    o.labels=(Array.isArray(raw.labels)?raw.labels:[]).slice(0,32).map(x=>str(x,50));
    if(o.type==='number'){o.value=num(raw.value,0,-1e12,1e12);o.fromValue=num(raw.fromValue,o.value,-1e12,1e12);o.suffix=str(raw.suffix,30);o.decimals=Math.round(num(raw.decimals,0,0,4));}
    if(o.type==='fraction'){o.numerator=str(raw.numerator,60);o.denominator=str(raw.denominator,60);}
    if(o.type==='particles'){o.count=Math.round(num(raw.count,35,1,100));o.speed=num(raw.speed,.1,0,2);o.seed=num(raw.seed,1,0,1e6);}
    if(o.type==='grid'){o.rows=Math.round(num(raw.rows,6,1,20));o.columns=Math.round(num(raw.columns,6,1,20));o.cells=(Array.isArray(raw.cells)?raw.cells:[]).slice(0,400).map(x=>str(x,24));o.highlight=(Array.isArray(raw.highlight)?raw.highlight:[]).slice(0,400).filter(Number.isInteger);}
    return o;
  }
  const camera={};for(const k of ['from','to']){const v=object(input.camera?.[k])?input.camera[k]:{};camera[k]={x:num(v.x,.5,-.5,1.5),y:num(v.y,.5,-.5,1.5),scale:num(v.scale,1,.5,2.5)};}
  return {version:1,designIntent:str(input.designIntent,1000),layout:str(input.layout,100)||'custom',background:color(input.background,'$bg'),camera,objects:input.objects.map(x=>clean(x)),transitions:{enter:['fade','rise','zoom'].includes(input.transitions?.enter)?input.transitions.enter:'fade',exit:input.transitions?.exit==='none'?'none':'fade'}};
}

export function compositionFingerprint(input){
  const comp=validateComposition(input);
  function shape(o){const copy={};for(const key of ['type','x','y','x2','y2','w','h','r','scale','rotation','start','end','path','rows','columns','values','points','edges','animations','value','fromValue','numerator','denominator','highlight'])if(o[key]!==undefined)copy[key]=o[key];if(o.nodes)copy.nodes=o.nodes.map(n=>({x:n.x,y:n.y,r:n.r}));if(o.children)copy.children=o.children.map(shape);return copy;}
  const data=JSON.stringify({camera:comp.camera,objects:comp.objects.map(shape)});let hash=2166136261;for(let i=0;i<data.length;i++){hash^=data.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');
}

function ease(t,kind){t=clamp(t);return kind==='linear'?t:kind==='easeOut'?1-(1-t)**3:t*t*(3-2*t);}
const lerp=(a,b,t)=>a+(b-a)*t;
const noise=n=>{const v=Math.sin(n*127.1+311.7)*43758.5453;return v-Math.floor(v);};
function rounded(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
function strokeLine(ctx,x,y,x2,y2,portion=1){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(lerp(x,x2,portion),lerp(y,y2,portion));ctx.stroke();}
function setFont(ctx,size,family,weight=500){const fonts=family==='serif'?'"Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif':family==='mono'?'"SFMono-Regular", Consolas, "Noto Sans Mono CJK SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", monospace':'"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';ctx.font=`${weight} ${size}px ${fonts}`;}
function resolveColor(value,palette){return value?.startsWith('$')?(palette[value.slice(1)]||palette.accent||'#d4b579'):value==='none'?'transparent':value;}

// Path2D is absent from several server Canvas runtimes. Trace a bounded SVG
// geometry path directly instead of depending on a browser global.
function tracePath(ctx,path){
  const tokens=path.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
  let i=0,cmd='',x=0,y=0,sx=0,sy=0,cx=0,cy=0,last='';
  const take=()=>Number(tokens[i++]);const point=(relative)=>{const a=take(),b=take();return relative?[a+x,b+y]:[a,b];};
  ctx.beginPath();let steps=0;
  while(i<tokens.length&&steps++<3000){
    if(/^[a-z]$/i.test(tokens[i]))cmd=tokens[i++];
    if(!cmd)break;const relative=cmd===cmd.toLowerCase(),c=cmd.toUpperCase();
    if(c==='Z'){ctx.closePath();x=sx;y=sy;cmd='';last='Z';continue;}
    const counts={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7};
    if(!counts[c]||i+counts[c]>tokens.length)break;
    if(c==='M'||c==='L'){const p=point(relative);x=p[0];y=p[1];if(c==='M'){ctx.moveTo(x,y);sx=x;sy=y;cmd=relative?'l':'L';}else ctx.lineTo(x,y);}
    else if(c==='H'){x=take()+(relative?x:0);ctx.lineTo(x,y);}
    else if(c==='V'){y=take()+(relative?y:0);ctx.lineTo(x,y);}
    else if(c==='C'){const a=point(relative),b=point(relative),p=point(relative);ctx.bezierCurveTo(...a,...b,...p);cx=b[0];cy=b[1];x=p[0];y=p[1];}
    else if(c==='S'){const a=['C','S'].includes(last)?[2*x-cx,2*y-cy]:[x,y],b=point(relative),p=point(relative);ctx.bezierCurveTo(...a,...b,...p);cx=b[0];cy=b[1];x=p[0];y=p[1];}
    else if(c==='Q'){const a=point(relative),p=point(relative);ctx.quadraticCurveTo(...a,...p);cx=a[0];cy=a[1];x=p[0];y=p[1];}
    else if(c==='T'){const a=['Q','T'].includes(last)?[2*x-cx,2*y-cy]:[x,y],p=point(relative);ctx.quadraticCurveTo(...a,...p);cx=a[0];cy=a[1];x=p[0];y=p[1];}
    else if(c==='A'){
      let rx=Math.abs(take()),ry=Math.abs(take());const phi=take()*Math.PI/180,large=take(),sweep=take(),p=point(relative);
      if(!rx||!ry||(x===p[0]&&y===p[1]))ctx.lineTo(...p);
      else {
        const cs=Math.cos(phi),sn=Math.sin(phi),dx=(x-p[0])/2,dy=(y-p[1])/2,xp=cs*dx+sn*dy,yp=-sn*dx+cs*dy;
        const factor=xp*xp/(rx*rx)+yp*yp/(ry*ry);if(factor>1){rx*=Math.sqrt(factor);ry*=Math.sqrt(factor);}
        const top=Math.max(0,rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp),bottom=rx*rx*yp*yp+ry*ry*xp*xp;
        const sign=large===sweep?-1:1,k=sign*Math.sqrt(top/Math.max(1e-15,bottom)),ccx=k*rx*yp/ry,ccy=-k*ry*xp/rx;
        const centerX=cs*ccx-sn*ccy+(x+p[0])/2,centerY=sn*ccx+cs*ccy+(y+p[1])/2;
        const ux=(xp-ccx)/rx,uy=(yp-ccy)/ry,vx=(-xp-ccx)/rx,vy=(-yp-ccy)/ry;
        const start=Math.atan2(uy,ux);let delta=Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);if(!sweep&&delta>0)delta-=2*Math.PI;if(sweep&&delta<0)delta+=2*Math.PI;
        ctx.ellipse(centerX,centerY,rx,ry,phi,start,start+delta,!sweep);
      }
      x=p[0];y=p[1];
    }
    last=c;
  }
}

export function drawComposition(ctx,composition,{time=0,duration=10,width=1080,height=1920,style={},scene={}}={}){
  const palette={bg:'#0b0a07',ink:'#eee6d7',muted:'#b0a68f',gold:'#d1b36f',accent:'#d1b36f',blue:'#9abfc4',faint:'#3a3428',white:'#fff6e6',...(style.palette||{})};
  if(scene.accent){palette.accent=scene.accent;palette.gold=scene.accent;}
  const progress=clamp(time/Math.max(.01,duration));const motion=Math.pow(progress,clamp(1/(scene.motionSpeed||1),.4,3));const min=Math.min(width,height);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle=resolveColor(composition.background||'$bg',palette);ctx.fillRect(0,0,width,height);
  const glow=ctx.createRadialGradient(width*.52,height*.42,0,width*.52,height*.42,min*.85);glow.addColorStop(0,style.texture==='scanline'?'#332049':style.texture==='stars'?'#17213b':style.texture==='paper'?'#ead9ba':style.texture==='soft'?'#efdce1':style.texture==='grid'?'#23415d':'#342916');glow.addColorStop(1,resolveColor('$bg',palette));ctx.save();ctx.globalAlpha=['none','plain','editorial'].includes(style.texture)?.025:.45;ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);ctx.restore();
  if(['grid','blueprint','scanlines','scanline'].includes(style.texture)){ctx.save();ctx.strokeStyle=palette.faint;ctx.globalAlpha=.32;ctx.lineWidth=.6;const step=min/20;for(let x=0;x<width;x+=step)strokeLine(ctx,x,0,x,height);for(let y=0;y<height;y+=step)strokeLine(ctx,0,y,width,y);ctx.restore();}
  if(!['none','plain','editorial'].includes(style.texture)){ctx.save();ctx.fillStyle=palette.gold;for(let i=0;i<(scene.particleCount??40);i++){ctx.globalAlpha=.08+noise(i+4)*.13;const x=noise(i+21)*width,y=((noise(i+89)*height-time*(2+noise(i)*5))%height+height)%height;ctx.beginPath();ctx.arc(x,y,min*(.0007+noise(i+5)*.0011),0,Math.PI*2);ctx.fill();}ctx.restore();}
  const bounds={x:width*.065,y:height*.12,w:width*.87,h:height*.67};
  const c=composition.camera||{from:{x:.5,y:.5,scale:1},to:{x:.5,y:.5,scale:1}},cp=ease(progress,'easeInOut');const camera={x:lerp(c.from.x,c.to.x,cp),y:lerp(c.from.y,c.to.y,cp),scale:lerp(c.from.scale,c.to.scale,cp)};
  ctx.save();ctx.translate(bounds.x+bounds.w*.5,bounds.y+bounds.h*.5);ctx.scale(camera.scale,camera.scale);ctx.translate(-bounds.w*camera.x,-bounds.h*camera.y);
  const entry=ease(clamp(progress/.08),'easeOut'),exit=composition.transitions?.exit==='none'?1:clamp((1-progress)/.06);
  ctx.globalAlpha*=entry*exit;if(composition.transitions?.enter==='rise')ctx.translate(0,(1-entry)*min*.035);if(composition.transitions?.enter==='zoom'){ctx.translate(bounds.w/2,bounds.h/2);ctx.scale(.94+.06*entry,.94+.06*entry);ctx.translate(-bounds.w/2,-bounds.h/2);}
  function draw(raw,box,depth=0){
    if(progress<raw.start||progress>raw.end)return;
    if(scene.detailLevel===0&&raw.type==='text'&&raw.fontSize<.034)return;
    const o={...raw},animated=new Set();for(const a of [...(o.animations||[])].sort((a,b)=>a.start-b.start)){
      if(motion<a.start&&animated.has(a.property))continue;
      const at=clamp((motion-a.start)/Math.max(.001,a.end-a.start));o[a.property]=lerp(a.from,a.to,ease(at,a.easing));animated.add(a.property);
    }
    const x=o.x*box.w,y=o.y*box.h,w=o.w*box.w,h=o.h*box.h,r=o.r*Math.min(box.w,box.h);const small=Math.min(box.w,box.h);const reveal=clamp(o.reveal??1);
    ctx.save();ctx.translate(x,y);ctx.rotate(o.rotation*Math.PI/180);ctx.scale(o.scale,o.scale);ctx.globalAlpha*=clamp(o.opacity);ctx.fillStyle=resolveColor(o.fill,palette);ctx.strokeStyle=resolveColor(o.stroke,palette);ctx.lineWidth=o.lineWidth*min/1080;ctx.lineCap='round';ctx.lineJoin='round';
    const pathPaint=()=>{if(o.fill!=='none')ctx.fill();if(o.stroke!=='none')ctx.stroke();};
    const label=(value,lx=0,ly=0,size=o.fontSize*min,readable=true)=>{if(readable)size=Math.max(size,min*.019);setFont(ctx,size,o.fontFamily||style.fontFamily||'serif');ctx.textAlign=o.align;ctx.textBaseline='middle';ctx.fillStyle=resolveColor(o.fill==='none'?'$ink':o.fill,palette);ctx.fillText(String(value),lx,ly);};
    if(o.type==='rect'||o.type==='roundRect'){rounded(ctx,-w/2,-h/2,w,h,o.type==='roundRect'?small*.018:0);pathPaint();}
    else if(o.type==='circle'||o.type==='ellipse'){ctx.beginPath();ctx.ellipse(0,0,o.type==='circle'?r:w/2,o.type==='circle'?r:h/2,0,0,Math.PI*2);pathPaint();}
    else if(o.type==='line'||o.type==='arrow'){
      const dx=(o.x2-o.x)*box.w,dy=(o.y2-o.y)*box.h;strokeLine(ctx,0,0,dx,dy,reveal);
      if(o.type==='arrow'&&reveal>.02){const ang=Math.atan2(dy,dx),len=small*.016;ctx.beginPath();ctx.moveTo(dx*reveal,dy*reveal);ctx.lineTo(dx*reveal-len*Math.cos(ang-.5),dy*reveal-len*Math.sin(ang-.5));ctx.moveTo(dx*reveal,dy*reveal);ctx.lineTo(dx*reveal-len*Math.cos(ang+.5),dy*reveal-len*Math.sin(ang+.5));ctx.stroke();}
    }
    else if(o.type==='text'){
      let size=o.fontSize*min,rows=[];
      const wrap=()=>{setFont(ctx,size,o.fontFamily||style.fontFamily||'serif');rows=[];let row='';for(const c of o.text){if(c==='\n'||ctx.measureText(row+c).width>Math.max(w,min*.06)){if(row)rows.push(row);row=c==='\n'?'':c;}else row+=c;}if(row)rows.push(row);};
      wrap();while(rows.length*Math.max(size*1.35,1)>Math.max(h,size)&&size>min*.014){size*=.94;wrap();}
      rows.slice(0,5).forEach((v,i)=>label(v,0,(i-(Math.min(5,rows.length)-1)/2)*size*1.35,size,false));
    }
    else if(o.type==='number'){const value=o.animations.some(a=>a.property==='value')?o.value:lerp(o.fromValue,o.value,reveal);label(Number(value).toFixed(o.decimals)+o.suffix);}
    else if(o.type==='fraction'){
      const size=o.fontSize*min;label(o.numerator,0,-size*.65,size);label(o.denominator,0,size*.72,size);ctx.strokeStyle=resolveColor(o.stroke,palette);strokeLine(ctx,-Math.max(w*.35,size*.8),0,Math.max(w*.35,size*.8),0,reveal);
    }
    else if(o.type==='group'){ctx.translate(-w/2,-h/2);for(const child of o.children||[])draw(child,{w,h},depth+1);}
    else if(o.type==='path'){
      ctx.translate(-w/2,-h/2);ctx.scale(w/1000,h/1000);ctx.lineWidth=o.lineWidth*min/1080*1000/Math.max(1,w);
      tracePath(ctx,o.path);if(reveal<1)ctx.setLineDash([Math.max(1,reveal*2400),2400]);if(o.fill!=='none')ctx.fill();if(o.stroke!=='none')ctx.stroke();
    }
    else if(o.type==='network'){
      ctx.translate(-w/2,-h/2);const total=o.edges.length*reveal,baseAlpha=ctx.globalAlpha;
      for(let i=0;i<Math.ceil(total);i++){const edge=o.edges[i];if(!edge)break;const a=o.nodes[edge[0]],b=o.nodes[edge[1]];ctx.globalAlpha=baseAlpha*(.22+.55*noise(i+3));strokeLine(ctx,a.x*w,a.y*h,b.x*w,b.y*h,clamp(total-i));}
      ctx.globalAlpha=baseAlpha;for(let i=0;i<o.nodes.length;i++){const n=o.nodes[i],fade=clamp((progress-o.start)/.12-i*.018);ctx.save();ctx.globalAlpha*=fade;ctx.fillStyle=resolveColor(o.fill==='none'?'$accent':o.fill,palette);ctx.beginPath();ctx.arc(n.x*w,n.y*h,(n.r||.015)*Math.min(w,h),0,Math.PI*2);ctx.fill();if(n.label)label(n.label,n.x*w,n.y*h+min*.028,min*.020);ctx.restore();}
    }
    else if(o.type==='plot'){
      ctx.translate(-w/2,-h/2);if(o.showAxes){ctx.save();ctx.globalAlpha*=.3;strokeLine(ctx,0,0,0,h);strokeLine(ctx,0,h,w,h);for(let i=1;i<5;i++)strokeLine(ctx,0,h*i/5,w,h*i/5);ctx.restore();}
      const total=(o.points.length-1)*reveal;ctx.beginPath();ctx.moveTo(o.points[0].x*w,(1-o.points[0].y)*h);for(let i=1;i<=Math.ceil(total);i++){const a=o.points[i-1],b=o.points[i];if(!b)break;const q=clamp(total-i+1);ctx.lineTo(lerp(a.x,b.x,q)*w,(1-lerp(a.y,b.y,q))*h);}ctx.stroke();
      const last=o.points[Math.min(o.points.length-1,Math.floor(total))];ctx.beginPath();ctx.arc(last.x*w,(1-last.y)*h,small*.005,0,Math.PI*2);ctx.fillStyle=palette.accent;ctx.fill();
      o.labels?.slice(0,2).forEach((v,i)=>label(v,i?w:0,h+min*.03,min*.021));
    }
    else if(o.type==='bars'){
      ctx.translate(-w/2,-h/2);const max=Math.max(1,...o.values.map(Math.abs)),negative=o.values.some(v=>v<0),base=negative?h/2:h;
      for(let i=0;i<o.values.length;i++){const bw=w/o.values.length,bh=o.values[i]/max*(negative?h/2:h)*reveal;ctx.fillStyle=resolveColor(o.colors[i]||(o.fill==='none'?'$accent':o.fill),palette);rounded(ctx,i*bw+bw*.13,Math.min(base,base-bh),bw*.74,Math.max(.1,Math.abs(bh)),small*.006);ctx.fill();if(o.labels[i])label(o.labels[i],i*bw+bw/2,h+min*.035,min*.02);}
    }
    else if(o.type==='grid'){
      ctx.translate(-w/2,-h/2);const cw=w/o.columns,ch=h/o.rows,total=o.rows*o.columns;
      for(let i=0;i<Math.ceil(total*reveal);i++){const gx=(i%o.columns)*cw,gy=Math.floor(i/o.columns)*ch;const highlighted=o.highlight.includes(i);ctx.save();ctx.fillStyle=resolveColor(highlighted?'$accent':o.fill==='none'?'$faint':o.fill,palette);rounded(ctx,gx+cw*.05,gy+ch*.05,cw*.9,ch*.9,small*.005);ctx.fill();if(o.cells[i]){ctx.fillStyle=highlighted?palette.bg:palette.ink;setFont(ctx,Math.min(cw,ch)*.3,o.fontFamily||style.fontFamily||'serif');ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(o.cells[i],gx+cw/2,gy+ch/2);}ctx.restore();}
    }
    else if(o.type==='particles'){
      for(let i=0;i<o.count;i++){const px=(noise(i+o.seed)-.5)*w,py=((noise(i+o.seed+34)*h-time*o.speed*small*.08)%h+h)%h-h/2;ctx.save();ctx.globalAlpha*=.15+.6*noise(i+77);ctx.beginPath();ctx.arc(px,py,small*(.0008+noise(i+2)*.0017),0,Math.PI*2);ctx.fillStyle=resolveColor(o.fill==='none'?'$gold':o.fill,palette);ctx.fill();ctx.restore();}
    }
    ctx.restore();
  }
  for(const o of composition.objects)draw(o,{w:bounds.w,h:bounds.h});
  ctx.restore();ctx.restore();
}
