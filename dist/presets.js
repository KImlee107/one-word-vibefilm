export const MAX_PROJECT_DURATION=600;
export const MAX_GENERATION_DURATION=300;
export const DURATION_PRESETS=[
  {seconds:15,label:'15 秒 · 知识闪现'}, {seconds:30,label:'30 秒 · 快速解答'},
  {seconds:45,label:'45 秒 · 一个发现'}, {seconds:60,label:'60 秒 · 精简讲解'},
  {seconds:90,label:'90 秒 · 标准讲解'}, {seconds:120,label:'2 分钟 · 故事推演'}, {seconds:150,label:'2 分 30 秒 · Vibe 叙事'},
  {seconds:180,label:'3 分钟 · 深入理解'}, {seconds:300,label:'5 分钟 · 完整专题'}
];
export const RATIO_PRESETS=[
  {id:'9:16',label:'9:16 · 竖屏短视频',width:1080,height:1920},
  {id:'16:9',label:'16:9 · 横屏视频',width:1920,height:1080},
  {id:'1:1',label:'1:1 · 方形',width:1080,height:1080},
  {id:'4:5',label:'4:5 · 竖版信息流',width:1080,height:1350},
  {id:'3:4',label:'3:4 · 图文平台',width:1080,height:1440},
  {id:'4:3',label:'4:3 · 经典横屏',width:1440,height:1080},
  {id:'21:9',label:'21:9 · 宽银幕',width:2520,height:1080}
];
export const STYLE_PRESETS=[
  {id:'noir',label:'黑金叙事',description:'深黑暖金、宋体标题、低密度留白与柔光。让公式、连线和数字逐步发生，接近参考片的克制科普叙事。',fontFamily:'serif',texture:'cinematic',palette:{bg:'#090a0b',ink:'#f5edda',muted:'#a99e82',gold:'#d9b96e',accent:'#e1c17c',blue:'#85b9bc',faint:'#373126',white:'#fff6df'}},
  {id:'paper',label:'纸上实验',description:'暖纸底、铅笔灰与朱红批注、细线草图和书页式实验图解；物件先变化，再出现简短标签。',fontFamily:'serif',texture:'paper',palette:{bg:'#f3eee2',ink:'#34342d',muted:'#868175',gold:'#b7803d',accent:'#bf6149',blue:'#447e89',faint:'#d7d0bf',white:'#fffaf0'}},
  {id:'neon',label:'霓虹科技',description:'近黑紫底、青紫荧光、等宽数字、发光路径与数据脉冲；强调信号、芯片和算法实际运行过程。',fontFamily:'mono',texture:'scanline',palette:{bg:'#090818',ink:'#f2efff',muted:'#9b9abb',gold:'#b29aff',accent:'#b28aff',blue:'#53e4da',faint:'#272242',white:'#ffffff'}},
  {id:'blueprint',label:'工程蓝图',description:'普鲁士蓝底、网格与辅助刻度、白色结构线和橙色活动部件；以拆解、剖面和尺寸关系解释机制。',fontFamily:'mono',texture:'grid',palette:{bg:'#102a43',ink:'#edf6fa',muted:'#8eafc2',gold:'#efbd6c',accent:'#efab58',blue:'#74c7e6',faint:'#2d4f66',white:'#ffffff'}},
  {id:'editorial',label:'杂志信息图',description:'浅米白底、粗体数字、大色块和非对称版面；让比例、面积与结构形成鲜明可读的视觉对比。',fontFamily:'sans',texture:'editorial',palette:{bg:'#f5f2ec',ink:'#252927',muted:'#81847d',gold:'#d67a4f',accent:'#df704b',blue:'#387c8c',faint:'#dedcd4',white:'#ffffff'}},
  {id:'cosmos',label:'宇宙深空',description:'深靛蓝、稀疏星尘与冷暖辉光、轻盈轨迹和尺度缩放；适合宇宙、微观世界、能量与系统演化。',fontFamily:'serif',texture:'stars',palette:{bg:'#080d20',ink:'#e9efff',muted:'#8d9dbb',gold:'#f0c281',accent:'#d6aeef',blue:'#79bce8',faint:'#26324f',white:'#ffffff'}},
  {id:'pastel',label:'柔彩手绘',description:'温柔浅色底、圆角物件、手绘感细线、清晰形变；用生活化对象与直观类比解释抽象知识。',fontFamily:'sans',texture:'soft',palette:{bg:'#f8f2ed',ink:'#4e4b58',muted:'#92909e',gold:'#d5a758',accent:'#b77990',blue:'#74abb1',faint:'#e3d9dd',white:'#fffaf8'}},
  {id:'minimal',label:'极简白',description:'纯净白底、黑色精确线条、单一强调色与大留白；减少装饰，用空间关系、运动方向和简练公式表达。',fontFamily:'sans',texture:'none',palette:{bg:'#fafafa',ink:'#222831',muted:'#858a92',gold:'#cc8b43',accent:'#357c75',blue:'#4b88bc',faint:'#e1e4e6',white:'#ffffff'}}
];
export function normalizeRatio(value){return RATIO_PRESETS.some(p=>p.id===value)?value:'9:16';}
export function normalizeStyle(value){return STYLE_PRESETS.some(p=>p.id===value)?value:'noir';}
export function getStyle(value){return STYLE_PRESETS.find(p=>p.id===normalizeStyle(value));}
export function getDimensions(ratio,{preview=false}={}){
  const p=RATIO_PRESETS.find(p=>p.id===normalizeRatio(ratio));
  if(!preview)return {width:p.width,height:p.height};
  const scale=Math.min(1,960/Math.max(p.width,p.height));
  return {width:Math.max(2,Math.round(p.width*scale/2)*2),height:Math.max(2,Math.round(p.height*scale/2)*2)};
}
