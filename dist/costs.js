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
  constructor(){this.sessions=[];this.listeners=new Set();this.sequence=0;}
  subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  notify(){for(const fn of this.listeners)fn(this.summary());}
  begin(label){this.current={id:++this.sequence,label:String(label).slice(0,100),started:Date.now(),entries:[]};this.sessions.push(this.current);if(this.sessions.length>20)this.sessions.shift();this.notify();}
  record({path,config,payload={},data={},ok=true,characters}){
    if(path==='/api/video/status'){
      const entry=this.sessions.flatMap(s=>s.entries).find(e=>e.jobId===data.job?.id);if(entry){entry.status=data.job.status;if(Number.isFinite(data.job.outputSeconds)&&data.job.outputSeconds>0&&entry.rate){entry.seconds=data.job.outputSeconds;entry.amount=amount(entry.rate,entry.seconds*entry.rate.unit);}this.notify();}return;
    }
    const type=path==='/api/video/create'?'video':path==='/api/speech'?'speech':/^\/api\/(script(?:\/repair)?|scene-code(?:\/repair)?|review-scene|scene-art|revise|video\/prompt)$/.test(path)?'text':null;
    if(!type)return;
    if(!this.current)this.begin('模型调用');
    const entry={type,path,model:String(config?.model||'').slice(0,160),host:host(config),status:ok?'completed':'unconfirmed',amount:null};
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
    if(this.current.entries.length<1000)this.current.entries.push(entry);this.notify();
  }
  summary(){
    const entries=this.current?.entries||[],settled={},pending={};let unknown=0;
    for(const e of entries){if(!e.amount){unknown++;continue;}const target=e.status==='completed'?settled:pending,k=e.amount.currency;target[k]||={currency:k,low:0,high:0};target[k].low+=e.amount.low;target[k].high+=e.amount.high;}
    return {label:this.current?.label||'',calls:entries.length,settled:Object.values(settled),pending:Object.values(pending),unknown,entries};
  }
  export(){return this.sessions.map(s=>({label:s.label,started:s.started,entries:s.entries}));}
}
export const usageLedger=new UsageLedger();
