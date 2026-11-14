import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAPI,validateProviderConfig} from '../worker/api.js';
import {isPublicAddress} from '../worker/endpoint.js';
import {endpointMetadata,effectiveVision,SERVICE_PROVIDERS} from '../dist/providers.js';
import {chipProgram} from './fixtures/film-code.mjs';
const key='sk-protocol-fixture-never-real-4567';
const openai={provider:'openai-compatible',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',apiKey:key};
const scene={title:'看见一次变化',narration:'具体物件沿路径移动，展示一次可理解的变化。',caption:'当场演示',duration:10,kind:'process',visual:{description:'带结构的芯片及总线',action:'指令包流经总线'}};
const script={title:'当场演示一个机制',scenes:[scene,scene,scene]};
const payload={topic:'一个机制',duration:30};
const req=(path,config=openai,data=payload)=>new Request('https://studio.example'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,payload:data})});
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const completion=object=>json({choices:[{message:{content:JSON.stringify(object)},finish_reason:'stop'}]});

test('URL and model remain editable, full endpoint URLs normalize, and metadata never saves secrets',()=>{
  assert.equal(validateProviderConfig({...openai,baseURL:'https://api.deepseek.com/v1/chat/completions',model:'chosen-model'}).baseURL,'https://api.deepseek.com/v1');
  assert.equal(validateProviderConfig({...openai,provider:'anthropic',baseURL:'https://api.anthropic.com/v1/messages'}).baseURL,'https://api.anthropic.com/v1');
  assert.equal(validateProviderConfig({...openai,provider:'minimax',baseURL:'https://api.minimax.cn/v1/t2a_v2'}).baseURL,'https://api.minimax.cn');
  const configs={text:openai,speech:{...openai,model:'voice-model'},video:{...openai,model:'video-model'},vision:{...openai,inherit:true}};
  assert.ok(!JSON.stringify(endpointMetadata(configs)).includes(key));assert.equal(endpointMetadata({text:{...openai,baseURL:'https://api.deepseek.com/v1?key='+key}}).text.baseURL,'');assert.equal(effectiveVision(configs),configs.text);configs.vision.inherit=false;assert.equal(effectiveVision(configs),configs.vision);assert.ok(SERVICE_PROVIDERS.text.some(p=>p.provider==='anthropic'));assert.ok(SERVICE_PROVIDERS.text.some(p=>p.provider==='gemini'));
});
test('Anthropic native Messages carries system instructions, user content, correct auth and chosen model',async()=>{
  const config={provider:'anthropic',baseURL:'https://api.anthropic.com/v1',model:'user-chosen-claude',apiKey:key};
  const response=await handleAPI(req('/api/script',config),{},{fetch:async(url,init)=>{assert.equal(url,config.baseURL+'/messages');assert.equal(init.headers['x-api-key'],key);assert.equal(init.headers.Authorization,undefined);assert.equal(init.headers['anthropic-version'],'2023-06-01');const body=JSON.parse(init.body);assert.equal(body.model,config.model);assert.match(body.system,/分镜阶段/);assert.equal(body.messages[0].role,'user');assert.equal(body.response_format,undefined);return json({content:[{type:'text',text:JSON.stringify(script)}],stop_reason:'end_turn',usage:{input_tokens:20,output_tokens:40}});}});
  assert.equal(response.status,200);assert.equal((await response.json()).script.scenes.length,3);
});
test('Gemini native GenerateContent uses header authentication and excludes thought parts',async()=>{
  const config={provider:'gemini',baseURL:'https://generativelanguage.googleapis.com/v1beta',model:'user-chosen-gemini',apiKey:key};
  const response=await handleAPI(req('/api/script',config),{},{fetch:async(url,init)=>{assert.equal(url,config.baseURL+'/models/'+config.model+':generateContent');assert.ok(!url.includes(key));assert.equal(init.headers['x-goog-api-key'],key);assert.equal(init.headers.Authorization,undefined);const body=JSON.parse(init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.equal(body.contents[0].role,'user');return json({candidates:[{content:{parts:[{thought:true,text:'private reasoning is not the script'},{text:JSON.stringify(script)}]},finishReason:'STOP'}],usageMetadata:{totalTokenCount:60}});}});assert.equal(response.status,200);
});
test('native vision protocols receive the three real inline frames rather than unsupported OpenAI blocks',async()=>{
  for(const provider of ['anthropic','gemini']){
    const config={provider,baseURL:provider==='anthropic'?'https://api.anthropic.com/v1':'https://generativelanguage.googleapis.com/v1beta',model:'chosen-vision-model',apiKey:key};
    const changed={...chipProgram,source:chipProgram.source+'\nfr.text("检查",fr.w*.5,fr.h*.1,{size:20});'};
    const response=await handleAPI(req('/api/review-scene',config,{scene,project:{},program:chipProgram,frames:Array(3).fill('data:image/jpeg;base64,/9j/AA==')}),{},{fetch:async(url,init)=>{const body=JSON.parse(init.body);if(provider==='anthropic'){assert.equal(body.messages[0].content.filter(p=>p.type==='image').length,3);return json({content:[{type:'text',text:JSON.stringify({program:changed,feedback:'放大主体细节。'})}],stop_reason:'end_turn'});}assert.equal(body.contents[0].parts.filter(p=>p.inlineData).length,3);return json({candidates:[{content:{parts:[{text:JSON.stringify({program:changed,feedback:'放大主体细节。'})}]},finishReason:'STOP'}]});}});assert.equal(response.status,200);
  }
});
test('JSON response_format can be disabled for compatible providers',async()=>{
  const response=await handleAPI(req('/api/script',{...openai,jsonMode:false}),{},{fetch:async(url,init)=>{assert.equal(JSON.parse(init.body).response_format,undefined);return completion(script);}});assert.equal(response.status,200);
});
test('public address classifier rejects private, mapped, reserved and metadata destinations',()=>{
  for(const address of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','192.0.2.1','198.18.0.1','::1','fc00::1','fe80::1','2001:db8::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(address),false,address);
  for(const address of ['1.1.1.1','8.8.8.8','93.184.216.34','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
});
test('custom public HTTPS endpoint is checked without forwarding credentials to DNS',async()=>{
  const config={...openai,baseURL:'https://custom-provider-one.example/v1',customEndpoint:true,model:'my-model'};let dns=0,provider=0;
  const response=await handleAPI(req('/api/script',config),{},{fetch:async(url,init)=>{if(url.startsWith('https://cloudflare-dns.com/')){dns++;assert.equal(init.headers.Authorization,undefined);assert.ok(!JSON.stringify(init).includes(key));return json({Status:0,Answer:url.includes('type=AAAA')?[]:[{type:1,data:'93.184.216.34'}]});}provider++;assert.equal(url,config.baseURL+'/chat/completions');assert.equal(init.headers.Authorization,'Bearer '+key);return completion(script);}});assert.equal(response.status,200);assert.equal(dns,2);assert.equal(provider,1);
});
test('custom endpoint resolving to a private address is rejected before credentials reach it',async()=>{
  let provider=0;const response=await handleAPI(req('/api/script',{...openai,baseURL:'https://private-provider-two.example/v1',customEndpoint:true}),{},{fetch:async url=>{if(url.startsWith('https://cloudflare-dns.com/'))return json({Status:0,Answer:[{type:1,data:'127.0.0.1'}]});provider++;return completion(script);}});assert.equal(response.status,400);assert.equal(provider,0);assert.equal((await response.json()).error.code,'CUSTOM_ENDPOINT');
});
test('H3 workflow optimization produces its three fields without creating a video task',async()=>{
  const response=await handleAPI(req('/api/video/prompt',openai,{scene,duration:10,topic:'指令运行',ratio:'16:9',style:'noir'}),{},{fetch:async(url,init)=>{assert.equal(url,openai.baseURL+'/chat/completions');const body=JSON.parse(init.body);assert.match(body.messages[0].content,/T2VA/);return completion({integrated_multimodal_description:'[Shot 1] A matte gold chip receives an instruction packet. The camera slowly pushes in as the packet reaches the decoder and settles.',overall_soundscape:'N/A',non_diegetic_music:'N/A'});}});assert.equal(response.status,200);assert.match((await response.json()).prompt,/integrated_multimodal_description:/);
});
