const custom={id:'custom',label:'自定义 OpenAI 兼容接口',provider:'openai-compatible',baseURL:'',model:''};
export const TEXT_PROVIDERS=[
  {id:'deepseek',label:'DeepSeek',provider:'openai-compatible',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash'},
  {id:'openai',label:'OpenAI',provider:'openai-compatible',baseURL:'https://api.openai.com/v1',model:''},
  {id:'qwen',label:'通义千问 / 百炼',provider:'openai-compatible',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
  {id:'siliconflow',label:'硅基流动',provider:'openai-compatible',baseURL:'https://api.siliconflow.cn/v1',model:''},
  {id:'openrouter',label:'OpenRouter',provider:'openai-compatible',baseURL:'https://openrouter.ai/api/v1',model:''},
  {id:'anthropic',label:'Anthropic / Claude（原生）',provider:'anthropic',baseURL:'https://api.anthropic.com/v1',model:''},
  {id:'gemini',label:'Google Gemini（原生）',provider:'gemini',baseURL:'https://generativelanguage.googleapis.com/v1beta',model:''},custom
];
export const SERVICE_PROVIDERS={
  text:TEXT_PROVIDERS,vision:TEXT_PROVIDERS,
  speech:[{id:'minimax',label:'MiniMax 语音（原生）',provider:'minimax',baseURL:'https://api.minimax.cn',model:'speech-2.8-hd'},{id:'openai',label:'OpenAI 兼容语音',provider:'openai-compatible',baseURL:'https://api.openai.com/v1',model:'gpt-4o-mini-tts'},custom],
  video:[{id:'minimax',label:'MiniMax 视频（原生）',provider:'minimax',baseURL:'https://api.minimax.cn',model:'MiniMax-H3'},{id:'wan',label:'通义万相 / 百炼（原生）',provider:'dashscope',baseURL:'https://dashscope.aliyuncs.com/api/v1',model:'wan2.7-t2v'},{...custom,label:'自定义 Videos 兼容接口'}]
};
function storedURL(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash?value:'';}catch{return '';}}
export function endpointMetadata(configs){
  return Object.fromEntries(Object.entries(configs).map(([type,c])=>[type,{provider:c.provider,baseURL:storedURL(c.baseURL),model:c.model,jsonMode:c.jsonMode!==false,inherit:c.inherit===true}]));
}
export function effectiveVision(configs){return configs.vision?.inherit===false?configs.vision:configs.text;}
