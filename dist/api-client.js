/** Browser API client. Pass configuration from memory; no storage side effects. */
import {usageLedger} from './costs.js';
import {safeVideoResultURL} from './video-jobs.js';
export class VibeAPIError extends Error {
  constructor(code, message, status = 0, recovery = null) { super(message); this.name = 'VibeAPIError'; this.code = code; this.status = status; this.recovery=recovery; }
}

async function request(path, config, payload, { signal, binary = false, method = 'POST' } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', signal, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config, payload }) }) });
  } catch (error) {
    usageLedger.record({path,config,payload,ok:false});
    if (error.name === 'AbortError') throw error;
    throw new VibeAPIError('NETWORK', '无法连接网站 API，请检查网络后重试。');
  }
  if (!response.ok) {
    let data; try { data = await response.json(); } catch { /* A platform login or timeout page is not a successful API result. */ }
    if(data?.mayBeBillable||response.status>=500)usageLedger.record({path,config,payload,data,ok:false});
    throw new VibeAPIError(data?.error?.code || 'HTTP_ERROR', data?.error?.message || `网站接口返回 HTTP ${response.status}，请确认已登录且后端已部署。`, response.status,data?.recovery||null);
  }
  if (binary){usageLedger.record({path,config,payload,characters:response.headers.get('X-Vibe-Usage-Characters')});return response.blob();}
  try {const data=await response.json();usageLedger.record({path,config,payload,data});return data;} catch { throw new VibeAPIError('INVALID_RESPONSE', '网站接口未返回 JSON；请确认后端已部署并已登录。'); }
}

export const health = (options = {}) => request('/api/health', null, null, { ...options, method: 'GET' });
export const testConnection = (config, { capability = 'text', signal } = {}) => request('/api/test', config, { capability }, { signal });
// options.brief carries the optional full directing brief; the API bounds it to 18,000 characters.
export async function generateScript(config, options, { signal,onRepair=()=>{} } = {}) {
  let data,initialUsage=null,repaired=false;
  try{data=await request('/api/script',config,options,{signal});}
  catch(error){
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    if(!error.recovery?.canRepair||!error.recovery.draft||options.repairFormats===false)throw error;
    // Exactly one disclosed repair request; never restart the entire generation.
    initialUsage=error.recovery.usage;onRepair({reason:error.message,shape:error.recovery.shape,attempt:1,maxAttempts:1});
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    data=await request('/api/script/repair',config,{...options,draft:error.recovery.draft,issue:error.message},{signal});repaired=true;
  }
  return {...data.script,apiMeta:{usage:data.usage,initialUsage,repaired,requests:repaired?2:1,mayBeBillable:data.mayBeBillable}};
}
export async function generateSceneArt(config, options, {signal}={}) {const data=await request('/api/scene-art',config,options,{signal});return {...data.composition,apiMeta:{usage:data.usage,mayBeBillable:data.mayBeBillable,fingerprint:data.fingerprint}};}
export async function reviseSceneWithAI(config, options, { signal } = {}) { const data = await request('/api/revise', config, options, { signal }); return data.scene; }
export const generateSpeech = (config, options, { signal } = {}) => request('/api/speech', config, options, { signal, binary: true });
export async function createVideoTask(config, options, { signal } = {}) { return (await request('/api/video/create', config, options, { signal })).job; }
export async function getVideoTask(config, job, { signal } = {}) { return (await request('/api/video/status', config, { id: typeof job === 'string' ? job : job.id }, { signal })).job; }
export async function downloadVideo(config,job,{signal}={}){
  try{return await request('/api/video/content',config,{id:typeof job==='string'?job:job.id},{signal,binary:true});}
  catch(error){
    const url=safeVideoResultURL(error.recovery?.job?.videoURL||job?.videoURL);
    if(signal?.aborted||error.name==='AbortError'||!url||!['VIDEO_DOWNLOAD','VIDEO_DOWNLOAD_NETWORK'].includes(error.code))throw error;
    // Some signed CDNs allow the user's browser but reject server-side pulls.
    // This downloads the SAME result, omits credentials, and never creates a job.
    try{const media=await fetch(url,{signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!media.ok||!/video|octet-stream/i.test(media.headers.get('Content-Type')||'')||Number(media.headers.get('Content-Length'))>256*1024*1024)throw error;return await media.blob();}
    catch{throw error;}
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('已取消', 'AbortError'));
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('已取消', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function pollVideoTask(config, initialJob, { signal, onProgress, intervalMs = 15000, timeoutMs = 900000 } = {}) {
  const started = Date.now(); let job = initialJob;
  const interval = Math.max(2000, Number(intervalMs) || 15000);
  while (true) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    onProgress?.(job);
    if (job.status === 'completed') return job;
    if (job.status === 'failed' || job.status === 'cancelled') throw new VibeAPIError('VIDEO_FAILED', job.error || '视频任务未完成，请检查服务商任务记录。');
    if (Date.now() - started > timeoutMs) throw new VibeAPIError('VIDEO_POLL_TIMEOUT', `等待已超时，任务 ${job.id} 仍可在服务商查询；请勿重复提交以免重复计费。`);
    await delay(interval, signal);
    job = await getVideoTask(config, job, { signal });
  }
}

export const PROVIDER_PRESETS = {
  recommendedText: { provider: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  recommendedSpeech: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'speech-2.8-hd' },
  recommendedVideo: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'MiniMax-H3' },
  deepseek: { provider: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  minimaxSpeech: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'speech-2.8-hd' },
  minimaxVideo: { provider: 'minimax', baseURL: 'https://api.minimax.cn', model: 'MiniMax-H3' },
  qwen: { provider: 'openai-compatible', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  openaiText: { provider: 'openai-compatible', baseURL: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  openaiSpeech: { provider: 'openai-compatible', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
  wan: { provider: 'dashscope', baseURL: 'https://dashscope.aliyuncs.com/api/v1', model: 'wan2.7-t2v' }
};

export const generateSceneCode=(config,options,{signal}={})=>request("/api/scene-code",config,options,{signal});
export const reviewSceneCode=(config,options,{signal}={})=>request("/api/review-scene",config,options,{signal});

export async function restoreScript(options,{signal}={}){const data=await request("/api/script/restore",null,options,{signal});return {...data.script,apiMeta:{requests:0,restored:true,mayBeBillable:false}};}

export const optimizeH3Prompt=(config,options,{signal}={})=>request("/api/video/prompt",config,options,{signal});

export const repairSceneCode=(config,options,{signal}={})=>request("/api/scene-code/repair",config,options,{signal});
