// Public list-price estimates; never receives or retains prompts or API keys.
export const PRICE_SOURCES={minimax:'https://platform.minimaxi.com/docs/pricing/overview',deepseek:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',checked:'2026-11-14'};
const storageKey='jianzhi-price-overrides-v1';let overrides={};
try{overrides=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
const safeNumber=v=>(typeof v==='number'||typeof v==='string')&&v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1e8?Number(v):null;
function host(config){try{return new URL(config?.baseURL).hostname;}catch{return '';}}
export function priceKey(config,type){return [type==='vision'?'text':type,host(config),config?.model||''].join('|');}
export function setPriceOverride(config,type,rate){
  const key=priceKey(config,type);
  if(!rate)delete overrides[key];
  else overrides[key]={currency:rate.currency==='USD'?'USD':'CNY',input:safeNumber(rate.input),output:safeNumber(rate.output),cache:safeNumber(rate.cache),unit:safeNumber(rate.unit)};
  try{localStorage.setItem(storageKey,JSON.stringify(overrides));}catch{}
}
export function priceFor(config,type,resolution='768P'){
  const key=priceKey(config,type),custom=overrides[key];if(custom)return {...custom,custom:true};
  const h=host(config),model=config?.model;
  if(h==='api.deepseek.com'&&['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model))return {currency:'CNY',input:1,output:4,cache:.02,multiplier:2,source:PRICE_SOURCES.deepseek,note:'官方峰谷单价区间'};
  const domestic=['api.minimax.cn','api.minimaxi.com','api.minimax.chat'].includes(h),international=h==='api.minimax.io';
  if(config?.provider==='minimax'&&(domestic||international)){
    if(type==='video'&&model==='MiniMax-H3')return {currency:domestic?'CNY':'USD',unit:domestic?(resolution==='2K'?.8:.5):(resolution==='2K'?.13:.08),source:PRICE_SOURCES.minimax,note:'官方按秒刊例价'};
    if(type==='speech'&&model==='speech-2.8-hd')return {currency:domestic?'CNY':'USD',unit:domestic?3.5:1,source:PRICE_SOURCES.minimax,note:'官方每万计费字符刊例价'};
  }
  return null;
}
export function billableCharacters(text){return Array.from(String(text||'')).reduce((sum,c)=>sum+(/\p{Script=Han}/u.test(c)?2:1),0);}
export function tokenUsage(usage){
  if(!usage||typeof usage!=='object')return null;
  const input=safeNumber(usage.prompt_tokens??usage.input_tokens??usage.promptTokenCount),output=safeNumber(usage.completion_tokens??usage.output_tokens??usage.candidatesTokenCount);
  if(input===null||output===null)return null;
  const cache=Math.min(input,safeNumber(usage.prompt_cache_hit_tokens??usage.cache_read_input_tokens??usage.prompt_tokens_details?.cached_tokens??usage.cachedContentTokenCount)||0);
  return {input,output,cache};
}
function amount(rate,low){return !rate||!Number.isFinite(low)?null:{currency:rate.currency,low,high:low*(rate.multiplier||1)};}
export function estimateVideoCost(config,seconds,resolution='768P'){const rate=priceFor(config,'video',resolution);return amount(rate,rate?.unit===null||rate?.unit===undefined?NaN:Math.max(0,Number(seconds)||0)*rate.unit);}
export function formatCost(value){
  if(!value)return '单价 / 用量待确认';
  const symbol=value.currency==='USD'?'US$':'¥',digits=Math.max(value.low,value.high)<.01?4:2;
  return symbol+value.low.toFixed(digits)+(Math.abs(value.high-value.low)>.000001?'–'+value.high.toFixed(digits):'');
}
export class UsageLedger{
  constructor({storage,now=()=>Date.now()}={}){
    this.sessions=[];this.listeners=new Set();this.sequence=0;this.now=now;
    try{this.storage=storage===undefined?globalThis.localStorage:storage;}catch{this.storage=null;}
    try{const saved=JSON.parse(this.storage?.getItem('jianzhi-project-usage-v2')||'null');this.sequence=Number(saved?.sequence)||0;this.sessions=(saved?.sessions||[]).slice(-20).map(s=>this.cleanSession(s)).filter(Boolean);this.current=this.sessions.find(s=>s.id===saved?.currentId);}catch{}
  }
  cleanSession(s){
    if(!s||typeof s.id!=='string'||!s.id||s.id.length>180||!Array.isArray(s.entries))return null;
    const entries=s.entries.slice(-5000).map(e=>{
      if(!e||!['text','video','speech'].includes(e.type))return null;
      const item={};for(const k of ['id','type','path','model','host','status','jobId','resolution'])if(typeof e[k]==='string')item[k]=e[k].slice(0,200);
      for(const k of ['seconds','characters'])if(safeNumber(e[k])!==null)item[k]=Number(e[k]);
      if(e.tokens&&[e.tokens.input,e.tokens.output,e.tokens.cache].every(v=>safeNumber(v)!==null))item.tokens={input:Number(e.tokens.input),output:Number(e.tokens.output),cache:Number(e.tokens.cache)};
      if(e.amount&&['CNY','USD'].includes(e.amount.currency)&&[e.amount.low,e.amount.high].every(v=>safeNumber(v)!==null))item.amount={currency:e.amount.currency,low:Number(e.amount.low),high:Number(e.amount.high)};
      if(e.rate&&['CNY','USD'].includes(e.rate.currency)&&safeNumber(e.rate.unit)!==null)item.rate={currency:e.rate.currency,unit:Number(e.rate.unit)};
      if(item.status==='requesting')item.status='unconfirmed';
      return item;
    }).filter(Boolean);
    return {id:s.id,label:String(s.label||'项目').slice(0,100),started:Number.isFinite(s.started)&&s.started>=0?s.started:this.now(),elapsedMs:Number.isFinite(s.elapsedMs)&&s.elapsedMs>=0?Math.min(s.elapsedMs,1e12):0,runningSince:null,entries};
  }
  persist(){try{this.storage?.setItem('jianzhi-project-usage-v2',JSON.stringify({sequence:this.sequence,currentId:this.current?.id,sessions:this.export()}));this.persistenceError=!this.storage;}catch{this.persistenceError=true;}}
  subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  notify(){this.persist();for(const fn of this.listeners)fn(this.summary());}
  begin(label,{id}={}){this.pauseClock();this.current={id:id||'job-'+this.now().toString(36)+'-'+(++this.sequence),label:String(label).slice(0,100),started:this.now(),elapsedMs:0,runningSince:null,entries:[]};this.sessions.push(this.current);if(this.sessions.length>20)this.sessions.shift();this.notify();return this.current;}
  resume(id,label,snapshot){
    if(this.current?.id!==id)this.pauseClock();
    const known=this.sessions.find(s=>s.id===id);if(known){this.current=known;this.notify();return known;}
    const restored=this.cleanSession(snapshot);if(restored&&restored.id===id){this.sessions.push(restored);this.current=restored;this.notify();return restored;}
    return this.begin(label,{id});
  }
  startClock(){if(this.current&&this.current.runningSince===null){this.current.runningSince=this.now();this.persist();}}
  elapsedMs(session=this.current){return session?(Number(session.elapsedMs)||0)+(session.runningSince===null||session.runningSince===undefined?0:Math.max(0,this.now()-session.runningSince)):0;}
  pauseClock(){if(this.current&&this.current.runningSince!==null){this.current.elapsedMs=this.elapsedMs();this.current.runningSince=null;this.persist();}}
  checkpointClock(){if(!this.lastClockSave||this.now()-this.lastClockSave>=4000){this.lastClockSave=this.now();this.persist();}}
  snapshot(id=this.current?.id){return this.export().find(s=>s.id===id)||null;}
  requestType(path){return path==='/api/video/create'?'video':path==='/api/speech'?'speech':/^\/api\/(script(?:\/repair)?|scene-code(?:\/repair)?|review-scene|scene-art|revise|video\/prompt)$/.test(path)?'text':null;}
  startRequest({path,config}){
    const type=this.requestType(path);if(!type)return null;if(!this.current)this.begin('模型调用');
    const entry={id:'call-'+this.now().toString(36)+'-'+(++this.sequence),type,path,model:String(config?.model||'').slice(0,160),host:host(config),status:'requesting',amount:null};this.current.entries.push(entry);this.notify();return entry.id;
  }
  discardRequest(id){if(!id)return;for(const s of this.sessions)s.entries=s.entries.filter(e=>e.id!==id);this.notify();}
  record({path,config,payload={},data={},ok=true,characters,requestId}){
    if(path==='/api/video/status'){
      const entry=this.sessions.flatMap(s=>s.entries).find(e=>e.jobId===data.job?.id);if(entry){entry.status=data.job.status;if(Number.isFinite(data.job.outputSeconds)&&data.job.outputSeconds>0&&entry.rate){entry.seconds=data.job.outputSeconds;entry.amount=amount(entry.rate,entry.seconds*entry.rate.unit);}this.notify();}return;
    }
    const type=this.requestType(path);
    if(!type)return;
    if(!this.current)this.begin('模型调用');
    const existing=requestId&&this.sessions.flatMap(s=>s.entries).find(e=>e.id===requestId);
    const entry=existing||{id:requestId||'call-'+this.now().toString(36)+'-'+(++this.sequence),type,path,model:String(config?.model||'').slice(0,160),host:host(config)};Object.assign(entry,{status:ok?'completed':'unconfirmed',amount:null});
    const rate=priceFor(config,type,payload.resolution||'768P');
    if(type==='text'){
      entry.tokens=tokenUsage(data.usage||data.recovery?.usage);
      const u=entry.tokens;if(rate&&u&&[rate.input,rate.output].every(Number.isFinite)){const cache=Number.isFinite(rate.cache)?rate.cache:rate.input;entry.amount=amount(rate,((u.input-u.cache)*rate.input+u.cache*cache+u.output*rate.output)/1e6);entry.status='completed';}
    }else if(type==='speech'){
      entry.characters=safeNumber(characters)??billableCharacters(payload.text);if(ok&&Number.isFinite(rate?.unit))entry.amount=amount(rate,entry.characters/10000*rate.unit);
    }else{
      entry.jobId=data.job?.id||null;entry.seconds=Number(payload.duration)||0;entry.resolution=payload.resolution||'768P';entry.status=ok?(data.job?.status||'queued'):'unconfirmed';
      if(ok){entry.amount=estimateVideoCost(config,entry.seconds,entry.resolution);entry.rate=rate;}
    }
    if(!existing&&this.current.entries.length<5000)this.current.entries.push(entry);this.notify();
  }
  summary(){
    const entries=this.current?.entries||[],settled={},pending={};let unknown=0;
    for(const e of entries){if(!e.amount){unknown++;continue;}const target=e.status==='completed'?settled:pending,k=e.amount.currency;target[k]||={currency:k,low:0,high:0};target[k].low+=e.amount.low;target[k].high+=e.amount.high;}
    return {label:this.current?.label||'',calls:entries.length,settled:Object.values(settled),pending:Object.values(pending),unknown,entries};
  }
  export(){return this.sessions.map(s=>{const clean=this.cleanSession({...s,elapsedMs:this.elapsedMs(s)});delete clean.runningSince;return clean;});}
}
export const usageLedger=new UsageLedger();
