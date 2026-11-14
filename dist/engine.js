/* 见知 · Deterministic knowledge animation engine. No DOM or network needed. */
import {validateComposition,drawComposition,compositionFingerprint} from './composition.js';
import {getStyle,normalizeRatio,normalizeStyle,MAX_GENERATION_DURATION,MAX_PROJECT_DURATION} from './presets.js';
export const SUPPORTED_TOPICS = [
  { id: 'dice', label: '两个骰子：为什么 7 最容易出现？', keywords: ['骰子', '概率', 'dice'] },
  { id: 'coin', label: '抛硬币：连出正面，下次会怎样？', keywords: ['硬币', 'coin'] },
  { id: 'law', label: '大数定律：随机怎样长出秩序？', keywords: ['大数', '长期频率', 'law of large'] },
];

const DURATIONS = [10, 9, 12, 12, 10, 16, 12, 9];
const DICE = [
  ['两个骰子，押哪一个？', 'intro', '两个公平骰子，押点数和为 7，还是为 12？', '先别急着回答。让骰子自己告诉我们。'],
  ['随机，也有边界', 'fair', '每个面都有六分之一机会，两次结果相互独立。', '公平、独立，是接下来推演的前提。'],
  ['把所有可能，摊开', 'grid', '第一枚有六种结果，第二枚也有六种。', '6 × 6 = 36 种等可能的有序组合。'],
  ['7，拥有六条路', 'seven', '1 加 6、2 加 5……一共六条路径。', '和为 7 的概率：6 / 36 = 1 / 6。'],
  ['12，只有一条路', 'twelve', '12 只能由 6 加 6 组成。', '1 / 36。出现 7 的机会，是它的六倍。'],
  ['把偶然，重复一万次', 'simulation', '一次的结果无法预言，很多次之后，分布开始显形。', '柱子来自固定种子的模拟，不是预先画好的结论。'],
  ['骰子，不记得上一次', 'independence', '连续没有出现 7，也不会让下一次更容易。', '每次重新投掷，仍然是同样的 36 种机会。'],
  ['理解随机，看见秩序', 'outro', '概率描述长期规律，不保证下一次结果。', '偶然的一次，和长期的规律，可以同时成立。'],
];
const COIN = [
  ['连出正面，该反面了？', 'coinIntro', '硬币连续五次正面，下一次反面会更容易吗？', '先记下你的直觉，再看它是怎样发生的。'],
  ['下一次，仍是二选一', 'coinToss', '公平硬币的两面，每次都是二分之一。', '独立抛掷，意味着硬币不会记账。'],
  ['让可能性，长成一棵树', 'coinTree', '每次抛掷，可能性再次分叉。', '抛三次，有 2 × 2 × 2 = 8 条等可能的路径。'],
  ['一条路径，八分之一', 'coinPaths', '正正正与反反反，各占八条路径中的一条。', '一串结果显得特别，不代表它更难发生。'],
  ['有些结果，拥有更多路', 'coinTwo', '三次里恰好两次正面，可以发生在三个位置。', '三条路径，对应 3 / 8 的概率。'],
  ['投得更多，看见频率', 'coinFreq', '投掷次数增加，正面频率在一半附近波动。', '模拟曲线会波动，不会每次都恰好一半。'],
  ['过去，不会替未来欠账', 'coinMemory', '就算刚刚连续出现正面，下一次仍然是二分之一。', '这是独立性的含义，也是赌徒谬误的破绽。'],
  ['随机，没有记账本', 'coinOutro', '长期接近一半，不等于下一次必须补偿。', '看见规律，也为每一次不确定留出位置。'],
];
const LAW = [
  ['随机，为什么会有规律？', 'coinIntro', '一次抛硬币很难猜，重复很多次会怎样？', '从一枚硬币，看见大数定律的直觉。'],
  ['先给每次机会一个基准', 'coinToss', '公平、独立抛掷时，正面概率是二分之一。', '概率是机制的描述，频率是我们观察到的结果。'],
  ['小样本，波动很大', 'lawSmall', '只抛十次，正面可能多，也可能少。', '样本很小时，偏离一半很常见。'],
  ['再给随机一点时间', 'coinFreq', '继续抛掷，频率仍然上下摇摆。', '但较大的样本，通常让比例更加稳定。'],
  ['比例靠近，差值未必变小', 'lawGap', '接近一半，指的是比例，而非正反次数差。', '绝对差可以增加，相对差却可以减小。'],
  ['一万次，让曲线说话', 'coinFreq', '把每一次结果接进曲线，看频率逐步稳定。', '这里只展示一条模拟轨迹，不是所有随机序列。'],
  ['规律，不会命令下一次', 'coinMemory', '长期频率趋向概率，不会改变下一次的机会。', '大数定律不是补偿机制。'],
  ['次数越多，轮廓越清楚', 'coinOutro', '大数定律，让我们从随机观察中理解总体。', '一次无法预言。很多次，可以看见方向。'],
];

function identifyTopic(topic = '') {
  const q = String(topic).toLowerCase();
  if (!q.trim()) return 'dice';
  if (/大数|长期频率|law of large/.test(q)) return 'law';
  if (/硬币|coin/.test(q)) return 'coin';
  if (/骰子|dice/.test(q) || /^(概率|概率论|概率入门)$/.test(q.trim())) return 'dice';
  const err = new Error('本地代码引擎目前支持「骰子概率」「抛硬币」「大数定律」。其他主题需要接入模型或导入分镜 JSON；不会用无关内容替换标题。');
  err.code = 'UNSUPPORTED_TOPIC';
  throw err;
}

export function createProject(options = {}) {
  const topicKey = identifyTopic(options.topic);
  const duration = clamp(Number(options.duration)||90,15,MAX_GENERATION_DURATION);
  const scale = duration / 90;
  const entries = topicKey === 'dice' ? DICE : topicKey === 'coin' ? COIN : LAW;
  let start = 0;
  const scenes = entries.map(([title, kind, narration, caption], index) => {
    const scene = { id: `scene-${topicKey}-${index + 1}`, title, start, duration: DURATIONS[index] * scale, narration, caption, kind, variant: 0, revision: 0, motionSpeed: 1, particleCount: 34, detailLevel: 1 };
    start += scene.duration;
    return scene;
  });
  return {
    id: `jz-${Date.now().toString(36)}`,
    title: topicKey === 'dice' ? '为什么两个骰子，7 最容易出现？' : topicKey === 'coin' ? '连出正面，下一次会怎样？' : '大数定律：随机怎样长出秩序？',
    topic: options.topic || '骰子概率', topicKey, duration, ratio: normalizeRatio(options.ratio),
    style: normalizeStyle(options.style), mode: 'code', scenes, history: [],
    sources: [
      { title: 'OpenStax · Introductory Statistics · Probability Topics', url: 'https://openstax.org/books/introductory-statistics-2e/pages/3-introduction' },
      { title: 'OpenStax · Independent and Mutually Exclusive Events', url: 'https://openstax.org/books/introductory-statistics-2e/pages/3-2-independent-and-mutually-exclusive-events' },
    ],
    settings: { music: true, voice: true, captions: true, ...options.settings },
  };
}

export const SCRIPT_KINDS = ['process', 'compare', 'bars', 'network', 'timeline', 'orbit', 'particles', 'dice', 'combinations', 'distribution'];
const cleanText = (value, limit = 180) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit);

/** Render model output as data, never as executable JavaScript or HTML. */
export function createProjectFromScript(input, options = {}) {
  let script = input;
  if (typeof script === 'string') {
    try { script = JSON.parse(script); } catch { throw new Error('分镜必须是有效 JSON，不能是代码或 HTML。'); }
  }
  if (!script || typeof script !== 'object' || !Array.isArray(script.scenes) || !script.scenes.length) {
    const error = new Error('模型返回中缺少 scenes 分镜数组，请重新生成。'); error.code = 'INVALID_SCRIPT'; throw error;
  }
  const raw = script.scenes.slice(0, 48).map(value => value && typeof value === 'object' ? value : {});
  const duration = clamp(Number(options.duration)||raw.reduce((sum, s) => sum + clamp(Number(s.duration) || 10, 1, 90), 0),15,MAX_PROJECT_DURATION);
  const total = raw.reduce((sum, s) => sum + clamp(Number(s.duration) || 10, 1, 90), 0);
  let start = 0;
  const warnings = [];
  const scenes = raw.map((value, index) => {
    const entry = value && typeof value === 'object' ? value : {};
    const v = entry.visual && typeof entry.visual === 'object' ? entry.visual : {};
    const kind = SCRIPT_KINDS.includes(entry.kind) ? entry.kind : 'process';
    if (kind !== entry.kind) warnings.push(`第 ${index + 1} 镜分类已规范化，画面仍需单独设计。`);
    const labels = (Array.isArray(v.labels) ? v.labels : []).slice(0, 8).map(x => cleanText(x, 40));
    const values = (Array.isArray(v.values) ? v.values : []).slice(0, 12).map(Number).filter(Number.isFinite).map(x => clamp(x, -1e12, 1e12));
    const items = (Array.isArray(v.items) ? v.items : []).slice(0, 8).map(x => typeof x === 'object' && x ? { label: cleanText(x.label ?? x.title ?? x.text, 40), detail: cleanText(x.detail ?? x.description, 80), value: Number.isFinite(Number(x.value)) ? clamp(Number(x.value), -1e12, 1e12) : undefined } : { label: cleanText(x, 40) });
    const scene = { id: `scene-script-${index + 1}`, title: cleanText(entry.title || `镜头 ${index + 1}`, 64), start, duration: clamp(Number(entry.duration) || 10, 1, 90) / total * duration, narration: cleanText(entry.narration, 1000), caption: cleanText(entry.caption || entry.narration || entry.title, 180), kind: `script:${kind}`, visual: { labels, values, items, unit: cleanText(v.unit, 16), note: cleanText(v.note, 80), description: cleanText(v.description, 600), action: cleanText(v.action, 400), formula: cleanText(v.formula, 120), emphasis: cleanText(v.emphasis, 100) }, variant: 0, revision: 0, motionSpeed: 1, particleCount: 34, detailLevel: 1,renderState:'pending' };
    Object.assign(scene.visual,{layout:cleanText(v.layout,100),visualIntent:cleanText(v.visualIntent,600),heroObjects:(Array.isArray(v.heroObjects)?v.heroObjects:[]).slice(0,12).map(x=>cleanText(x,100)),beats:(Array.isArray(v.beats)?v.beats:[]).slice(0,8).filter(x=>x&&typeof x==='object').map(x=>({at:clamp(Number(x.at)||0,0,1),meaning:cleanText(x.meaning,200),change:cleanText(x.change,400)})),continuity:cleanText(v.continuity,600)});
    if(entry.composition){scene.composition=validateComposition(entry.composition);scene.renderState='complete';scene.compositionFingerprint=compositionFingerprint(scene.composition);}
    start += scene.duration;
    return scene;
  });
  const sources = (Array.isArray(script.sources) ? script.sources : []).slice(0, 16).filter(x => x && typeof x === 'object' && /^https?:\/\//i.test(String(x.url))).map(x => ({ title: cleanText(x.title || x.url, 180), url: cleanText(x.url, 1000) }));
  return { id: `jz-api-${Date.now().toString(36)}`, title: cleanText(script.title || options.topic || '我的知识短片', 100), topic: cleanText(options.topic || script.title, 300), topicKey: 'custom', summary: cleanText(script.summary, 600), duration, ratio: normalizeRatio(options.ratio), style: normalizeStyle(options.style), mode: options.mode || 'code', scenes, sources, history: [], warnings, settings: { music: true, voice: true, captions: true, ...options.settings } };
}

export function setSceneComposition(project,index,input){
  if(!project.scenes[index])throw new Error('没有这个镜头。');const composition=validateComposition(input);
  const scenes=project.scenes.map((scene,i)=>i===index?{...scene,composition,compositionFingerprint:compositionFingerprint(composition),renderState:'complete',renderError:''}:scene);
  return {...project,scenes};
}

export function getSceneAt(project, time) {
  const t = clamp(Number(time) || 0, 0, Math.max(0, project.duration - 0.0001));
  let index = project.scenes.findIndex(s => t >= s.start && t < s.start + s.duration);
  if (index < 0) index = Math.max(0, project.scenes.length - 1);
  const scene = project.scenes[index];
  const localTime = Math.max(0, t - scene.start);
  return { scene, index, localTime, progress: clamp(localTime / scene.duration, 0, 1) };
}

export function getCaptionText(project,time){
  if(project.settings?.captions===false)return '';
  if(Array.isArray(project.subtitles))return project.subtitles.find(c=>time>=Number(c.start)&&time<Number(c.end))?.text||'';
  const {scene}=getSceneAt(project,time);
  const voiced=project.settings?.voice!==false&&(project.voiceBlob||(project.voiceClips||[]).some(c=>c.sceneId===scene.id));
  return voiced?(scene.narration||scene.caption||''):(scene.caption||scene.narration||'');
}

export function reviseScene(project, index, instruction = '') {
  if (!project.scenes[index]) return { project, summary: '请先选择一个镜头。', changes: [] };
  const q = String(instruction).trim();
  const old = project.scenes[index];
  const scene = { ...old };
  const changes = [];
  if (/慢|缓|slow/i.test(q)) { scene.motionSpeed = Math.max(0.25, (scene.motionSpeed || 1) * 0.65); changes.push('放慢本镜头的运动，保留片段时长'); }
  if (/快|speed|fast/i.test(q)) { scene.motionSpeed = Math.min(2.5, (scene.motionSpeed || 1) * 1.4); changes.push('加快本镜头的运动'); }
  if (/蓝|青|blue|cyan/i.test(q)) { scene.accent = '#66d5ed'; changes.push('主色调整为冰蓝色'); }
  if (/金|橙|gold|orange/i.test(q)) { scene.accent = '#f4bc71'; changes.push('主色调整为暖金色'); }
  if (/粒子|光点|particle/i.test(q)) {
    const fewer = /少|减|去掉|关闭|less|remove/i.test(q);
    scene.particleCount = fewer ? Math.max(0, (scene.particleCount ?? 34) - 22) : Math.min(100, (scene.particleCount ?? 34) + 24);
    changes.push(fewer ? '减少背景光点' : '增加背景光点');
  }
  if (/简洁|精简|简化|少.*字|短.*字幕|simple|short/i.test(q)) { scene.detailLevel = 0; scene.caption = scene.narration; changes.push('精简辅助标注'); }
  if (/详细|恢复标注|detail/i.test(q)) { scene.detailLevel = 1; changes.push('恢复辅助标注'); }
  if (/重做|再来|换一版|重新生成|变体|regenerat/i.test(q)) { scene.variant = (scene.variant || 0) + 1; changes.push('生成新的运动变体'); }
  if (!changes.length) return { project, summary: '本地修改支持：运动慢一点 / 快一点、改蓝色 / 金色、增减粒子、精简标注、换一版。自由改写知识内容需要接入模型，或直接编辑分镜文案。', changes };
  scene.revision = (scene.revision || 0) + 1;
  const scenes = project.scenes.map((s, i) => i === index ? scene : s);
  return { project: { ...project, scenes }, summary: `只更新第 ${index + 1} 镜：${changes.join('；')}。`, changes };
}

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = x => { const t = clamp(x); return t * t * (3 - 2 * t); };
const out = x => 1 - Math.pow(1 - clamp(x), 3);
const phase = (p, start, length) => clamp((p - start) / length);
const frac = n => n - Math.floor(n);
const noise = n => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453123);
const font = (size, weight = 500) => `${weight} ${size}px "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif`;

function palette(project, scene) {
  const theme=getStyle(project.style),paper=['paper','editorial','pastel','minimal'].includes(theme.id);
  return {...theme.palette,gold:scene.accent||theme.palette.gold,paper};
}

function rr(ctx, x, y, w, h, r = 16) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + k, y); ctx.lineTo(x + w - k, y); ctx.quadraticCurveTo(x + w, y, x + w, y + k); ctx.lineTo(x + w, y + h - k); ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h); ctx.lineTo(x + k, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - k); ctx.lineTo(x, y + k); ctx.quadraticCurveTo(x, y, x + k, y); ctx.closePath();
}
function text(ctx, s, x, y, size, color, align = 'center', weight = 500) {
  ctx.font = font(size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}
function fitted(ctx, s, x, y, maxWidth, size, color, align = 'center', weight = 500) {
  ctx.font = font(size, weight);
  while (ctx.measureText(s).width > maxWidth && size > 17) ctx.font = font(--size, weight);
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y);
}
function lines(ctx, s, maxWidth, size, maxLines = 2) {
  ctx.font = font(size, 500);
  const result = []; let line = '';
  for (const c of String(s)) {
    if ((ctx.measureText(line + c).width > maxWidth || c === '\n') && line) { result.push(line); line = c === '\n' ? '' : c; }
    else line += c;
  }
  if (line) result.push(line);
  return result.slice(0, maxLines);
}
function line(ctx, x1, y1, x2, y2, color, width = 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
function circle(ctx, x, y, r, fill, stroke, sw = 2) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(); } }
function glow(ctx, x, y, r, color, alpha = .2) { ctx.save(); ctx.globalAlpha *= alpha; const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, color); g.addColorStop(1, 'transparent'); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore(); }
function pill(ctx, s, x, y, p, size = 27) { ctx.font = font(size, 500); const w = ctx.measureText(s).width + 44; rr(ctx, x - w / 2, y - 26, w, 52, 26); ctx.fillStyle = p.paper ? '#e9e1d3' : '#192430'; ctx.fill(); text(ctx, s, x, y, size, p.muted); }

function drawBackground(ctx, W, H, p, t, count) {
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W * .5, H * .43, 0, W * .5, H * .43, W * .9);
  g.addColorStop(0, p.paper ? '#eee1ca' : '#172431'); g.addColorStop(1, p.bg); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = .16;
  for (let x = 54; x < W; x += 52) for (let y = 70; y < H; y += 52) circle(ctx, x, y, 1.15, p.muted);
  ctx.restore();
  for (let i = 0; i < count; i++) {
    const x = noise(i + 4) * W, y = ((noise(i + 53) * H - t * (4 + noise(i) * 7)) % H + H) % H;
    ctx.save(); ctx.globalAlpha = .12 + .2 * Math.sin(i + t * .5) ** 2; circle(ctx, x, y, 1.5 + noise(i + 6) * 2, i % 4 === 0 ? p.blue : p.gold); ctx.restore();
  }
  ctx.save(); ctx.globalAlpha = .08; ctx.strokeStyle = p.gold; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(W * .5, H * .48, W * .48, W * .48, -.35, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(W * .5, H * .48, W * .54, W * .37, -.35, 0, TAU); ctx.stroke(); ctx.restore();
}

const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const faces = [{ids:[4,5,6,7],normal:[0,0,1],n:1},{ids:[1,0,3,2],normal:[0,0,-1],n:6},{ids:[0,1,5,4],normal:[0,-1,0],n:2},{ids:[7,6,2,3],normal:[0,1,0],n:5},{ids:[5,1,2,6],normal:[1,0,0],n:3},{ids:[0,4,7,3],normal:[-1,0,0],n:4}];
const pips = {1:[[0,0]],2:[[-.45,-.45],[.45,.45]],3:[[-.45,-.45],[0,0],[.45,.45]],4:[[-.45,-.45],[.45,-.45],[-.45,.45],[.45,.45]],5:[[-.45,-.45],[.45,-.45],[0,0],[-.45,.45],[.45,.45]],6:[[-.45,-.5],[.45,-.5],[-.45,0],[.45,0],[-.45,.5],[.45,.5]]};
function rotate([x,y,z], rx, ry, rz) { let a = y * Math.cos(rx) - z * Math.sin(rx), b = y * Math.sin(rx) + z * Math.cos(rx); y=a; z=b; a=x*Math.cos(ry)+z*Math.sin(ry); b=-x*Math.sin(ry)+z*Math.cos(ry); x=a; z=b; return [x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz),z]; }
function orient(value) { return value===6?[0,Math.PI]:value===2?[-Math.PI/2,0]:value===5?[Math.PI/2,0]:value===3?[0,-Math.PI/2]:value===4?[0,Math.PI/2]:[0,0]; }
function drawDie(ctx, x, y, size, value, spin, p, tint = false, tilt = .26) {
  const [ax, ay] = orient(value); const rx = ax - tilt + spin * 1.7, ry = ay + tilt * 1.2 + spin * 1.2, rz = -.08 + Math.sin(spin * .8) * .14;
  const pts=vertices.map(v=>rotate(v,rx,ry,rz));
  const project=v=>[x+v[0]*size*.45*(1+v[2]*.045),y+v[1]*size*.45*(1+v[2]*.045)];
  const sorted=faces.map(f=>({...f,norm:rotate(f.normal,rx,ry,rz)})).filter(f=>f.norm[2]>.015).sort((a,b)=>a.norm[2]-b.norm[2]);
  ctx.save();
  for(const f of sorted){
    const q=f.ids.map(i=>project(pts[i])); ctx.beginPath(); q.forEach((v,i)=>i?ctx.lineTo(...v):ctx.moveTo(...v));ctx.closePath();
    const light=.35+.65*f.norm[2];
    const r=tint?Math.round(60+light*80):Math.round(150+light*100), g=tint?Math.round(120+light*70):Math.round(143+light*102), b=tint?Math.round(142+light*60):Math.round(128+light*100);
    const gradient=ctx.createLinearGradient(x-size*.5,y-size*.5,x+size*.5,y+size*.5);gradient.addColorStop(0,`rgb(${r},${g},${b})`);gradient.addColorStop(1,`rgb(${Math.round(r*.75)},${Math.round(g*.75)},${Math.round(b*.75)})`);ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle=tint?'#6fb4bf':'#b9aa92';ctx.lineWidth=1.5;ctx.stroke();
    for(const [u,v] of pips[f.n]){
      const a=(u+1)/2,b=(v+1)/2; const px=lerp(lerp(q[0][0],q[1][0],a),lerp(q[3][0],q[2][0],a),b),py=lerp(lerp(q[0][1],q[1][1],a),lerp(q[3][1],q[2][1],a),b);
      ctx.beginPath();ctx.ellipse(px,py,size*.056,size*.056*Math.max(.4,f.norm[2]),rz,0,TAU);ctx.fillStyle='#19242c';ctx.fill();
    }
  }
  ctx.restore();
}

function flatDie(ctx,x,y,size,value,p,highlight=false){rr(ctx,x-size/2,y-size/2,size,size,size*.17);ctx.fillStyle=highlight?p.gold:(p.paper?'#ded5c4':'#223241');ctx.fill();ctx.strokeStyle=highlight?p.gold:p.faint;ctx.lineWidth=1.3;ctx.stroke();for(const [u,v]of pips[value])circle(ctx,x+u*size*.6,y+v*size*.6,size*.065,highlight?p.bg:p.muted);}

function drawGrid(ctx, p, progress, options={}) {
  const cell=options.cell||98, x0=-cell*2.5, y0=-cell*2.5-28;
  const shown=lerp(0,36,out(phase(progress,0,.7))); const seven=options.seven||0,twelve=options.twelve||0;
  for(let a=1;a<=6;a++){
    const appear=out(phase(progress,(a-1)*.035,.17));ctx.save();ctx.globalAlpha*=appear;
    flatDie(ctx,x0-cell,y0+(a-1)*cell,47,a,p);flatDie(ctx,x0+(a-1)*cell,y0-cell,47,a,p);ctx.restore();
    for(let b=1;b<=6;b++){
      const i=(a-1)*6+b-1;const reveal=out(clamp(shown-i));if(!reveal)continue;
      const x=x0+(b-1)*cell,y=y0+(a-1)*cell;
      const hit7=a+b===7,hit12=a+b===12;const hi=hit7?seven:hit12?twelve:0;
      ctx.save();ctx.globalAlpha*=reveal;ctx.translate(x,y+(1-reveal)*20);rr(ctx,-cell*.43,-cell*.43,cell*.86,cell*.86,14);ctx.fillStyle=hi>0?p.gold:(p.paper?'#e9dfcd':'#172430');ctx.fill();ctx.lineWidth=hi>0?2:1;ctx.strokeStyle=hi>0?p.gold:p.faint;ctx.stroke();text(ctx,String(a+b),0,0,hi>0?34:30,hi>0?p.bg:p.muted,'center',hi>0?700:500);ctx.restore();
    }
  }
  return {cell,x0,y0};
}

function drawIntro(ctx,p,local,progress,s){
  const roll=(1-ease(phase(progress,.05,.32)))*local*(s.motionSpeed||1)*3;
  glow(ctx,0,-20,400,p.gold,.14);const bob=Math.sin(local*1.7)*6;
  ctx.save();ctx.globalAlpha=.14;ctx.fillStyle=p.gold;ctx.beginPath();ctx.ellipse(-170,180,150,28,0,0,TAU);ctx.fill();ctx.beginPath();ctx.ellipse(170,180,150,28,0,0,TAU);ctx.fill();ctx.restore();
  drawDie(ctx,-175,-60+bob,235,3,roll,p);drawDie(ctx,175,-60-bob,235,4,roll*.9,p,true);
  const q=out(phase(progress,.28,.25));ctx.save();ctx.globalAlpha*=q;line(ctx,-350,270,350,270,p.faint,2);
  text(ctx,'7',-200,350,110,p.gold,'center',700);text(ctx,'还是',0,350,32,p.muted);text(ctx,'12',200,350,110,p.blue,'center',700);
  text(ctx,'哪一个更容易出现？',0,465,31,p.ink);ctx.restore();
}
function drawFair(ctx,p,local,progress,s){
  const speed=s.motionSpeed||1;glow(ctx,0,0,380,p.blue,.13);
  const value=1+Math.floor(local*speed*.8)%6;drawDie(ctx,0,-35,240,value,.18*Math.sin(local*speed),p);
  for(let i=0;i<6;i++){
    const a=i*TAU/6-Math.PI/2+local*.025*speed, radius=280;const appear=out(phase(progress,i*.035,.18));
    ctx.save();ctx.globalAlpha*=appear;line(ctx,Math.cos(a)*150,Math.sin(a)*150-35,Math.cos(a)*230,Math.sin(a)*230-35,p.faint,2);flatDie(ctx,Math.cos(a)*radius,Math.sin(a)*radius-35,64,i+1,p,i+1===value);ctx.restore();
  }
  text(ctx,'1 / 6',0,355,85,p.gold,'center',600);pill(ctx,'公平骰子 · 每面等可能',0,450,p);
}
function drawSeven(ctx,p,local,progress,s){
  const hi=out(phase(progress,.07,.5));drawGrid(ctx,p,1,{seven:hi});
  const active=Math.min(5,Math.floor(phase(progress,.1,.65)*6));
  const cx=-245+active*98,cy=217-active*98;ctx.save();ctx.globalAlpha=.5;circle(ctx,cx,cy,52,null,p.gold,3);ctx.restore();
  const show=out(phase(progress,.5,.2));ctx.save();ctx.globalAlpha*=show;text(ctx,'6 / 36  =  1 / 6',0,390,64,p.gold,'center',600);text(ctx,'六条路径，同一个和：7',0,470,28,p.muted);ctx.restore();
}
function drawTwelve(ctx,p,local,progress,s){
  const q=out(phase(progress,0,.3));
  for(let i=0;i<6;i++){
    const x=-310+(i%3)*100,y=-120+Math.floor(i/3)*120;ctx.save();ctx.globalAlpha*=q;flatDie(ctx,x-20,y,44,i+1,p,true);flatDie(ctx,x+22,y+38,44,6-i,p,true);ctx.restore();
  }
  line(ctx,0,-240,0,245,p.faint,2);drawDie(ctx,245,-80,125,6,.04*Math.sin(local),p);drawDie(ctx,245,100,125,6,-.04*Math.sin(local),p,true);
  text(ctx,'和为 7',-220,-285,36,p.ink);text(ctx,'和为 12',235,-285,36,p.ink);
  text(ctx,'6 / 36',-220,330,65,p.gold,'center',600);text(ctx,'1 / 36',235,330,65,p.blue,'center',600);
  const appear=out(phase(progress,.45,.25));ctx.save();ctx.globalAlpha*=appear;pill(ctx,'7 的出现机会，是 12 的六倍',0,465,p);ctx.restore();
}

let simulations;
function sampleData(){
  if(simulations)return simulations;const prefix=new Uint32Array(10001*11),heads=new Uint32Array(10001),rolls=new Uint8Array(10000);let seed=1729;
  function rnd(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
  for(let i=1;i<=10000;i++){const a=1+Math.floor(rnd()*6),b=1+Math.floor(rnd()*6);rolls[i-1]=a+b;for(let j=0;j<11;j++)prefix[i*11+j]=prefix[(i-1)*11+j]+(j===a+b-2?1:0);heads[i]=heads[i-1]+(rnd()<.5?1:0);}
  return simulations={prefix,heads,rolls};
}
function simulationN(progress){return Math.max(1,Math.min(10000,Math.round(Math.exp(lerp(0,Math.log(10000),ease(phase(progress,.02,.85)))))));}
function drawSimulation(ctx,p,local,progress,s){
  const{prefix,rolls}=sampleData();const n=simulationN(progress);const w=66,gap=12,x0=-390,y0=220,h=470;
  const axisMax=Math.max(.2,Math.ceil(Math.max(...Array.from({length:11},(_,j)=>prefix[n*11+j]/n))/.05)*.05);
  for(let r=0;r<=4;r++){const y=y0-r*h/4;line(ctx,-430,y,455,y,p.faint,1);text(ctx,`${Math.round(r*axisMax/4*100)}%`,-450,y,20,p.muted,'right');}
  for(let j=0;j<11;j++){
    const x=x0+j*(w+gap),freq=prefix[n*11+j]/n,barH=freq/axisMax*h;const gold=j===5;
    const grad=ctx.createLinearGradient(x,y0-barH,x,y0);grad.addColorStop(0,gold?p.gold:p.blue);grad.addColorStop(1,p.paper?'#d4c7af':'#1b3947');
    rr(ctx,x-w/2,y0-barH,w,Math.max(2,barH),7);ctx.fillStyle=grad;ctx.fill();text(ctx,String(j+2),x,y0+42,27,gold?p.gold:p.muted,'center',gold?700:500);
    if(s.detailLevel!==0&&progress>.45&&[0,5,10].includes(j))text(ctx,`${(freq*100).toFixed(1)}%`,x,y0-barH-27,21,gold?p.gold:p.ink);
  }
  text(ctx,n.toLocaleString('en-US'),0,-390,76,p.gold,'center',600);text(ctx,'次模拟投掷',0,-315,27,p.muted);
  const k=rolls[Math.min(9999,n-1)],targetX=x0+(k-2)*(w+gap);const drop=frac(local*(2.5*(s.motionSpeed||1)));ctx.save();ctx.globalAlpha=.7*(1-drop);circle(ctx,targetX,-260+drop*400,9,p.gold);ctx.restore();
  if(progress>.68){ctx.save();ctx.globalAlpha=ease(phase(progress,.68,.18));const theoretical=[1,2,3,4,5,6,5,4,3,2,1];ctx.beginPath();theoretical.forEach((v,j)=>{const x=x0+j*(w+gap),y=y0-(v/36)/axisMax*h;j?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=p.white;ctx.lineWidth=2;ctx.setLineDash([7,8]);ctx.stroke();ctx.setLineDash([]);text(ctx,'虚线：理论概率  ·  柱形：模拟频率',0,380,24,p.muted);ctx.restore();}
  pill(ctx,'两端少，中间多：路径数量塑造分布',0,475,p,25);
}
function drawIndependence(ctx,p,local,progress,s){
  const old=out(phase(progress,0,.28));for(let i=0;i<5;i++){ctx.save();ctx.globalAlpha=.14*(1-old*.6);flatDie(ctx,-290+i*140,-285,65,[2,4,3,6,1][i],p);text(ctx,'过去',-290+i*140,-220,19,p.muted);ctx.restore();}
  line(ctx,-360,-140,360,-140,p.faint,2);drawDie(ctx,-130,70,170,3,Math.sin(local*(s.motionSpeed||1))*.18,p);drawDie(ctx,130,70,170,4,Math.cos(local*(s.motionSpeed||1))*.18,p,true);
  text(ctx,'下一次',0,-75,28,p.muted);text(ctx,'P(和为 7) = 1 / 6',0,320,61,p.gold,'center',600);pill(ctx,'独立事件 · 机会每次重新开始',0,455,p,25);
}
function drawOutro(ctx,p,local,progress,s){
  const q=out(phase(progress,.05,.7));glow(ctx,0,0,400,p.gold,.15);
  for(let j=0;j<11;j++){const v=6-Math.abs(5-j),x=(j-5)*61,y=130-v*38;line(ctx,x,150,x,y,p.blue,6);circle(ctx,x,y,5,p.gold);}
  drawDie(ctx,-115,-195,145,3,Math.sin(local*.3)*.08,p);drawDie(ctx,115,-195,145,4,-Math.sin(local*.3)*.08,p,true);
  ctx.save();ctx.globalAlpha*=q;text(ctx,'长期有规律',0,310,64,p.gold,'center',600);text(ctx,'下一次，仍有不确定',0,415,39,p.ink);ctx.restore();
}

function coin(ctx,x,y,r,p,angle=0,heads=true){
  const sx=Math.max(.09,Math.abs(Math.cos(angle)));ctx.save();ctx.translate(x,y);ctx.scale(sx,1);circle(ctx,0,0,r,p.gold,p.paper?'#895927':'#f8d297',5);circle(ctx,0,0,r*.84,null,p.paper?'#dca453':'#92683d',3);circle(ctx,0,0,r*.7,null,p.paper?'#dca453':'#bb8e52',1);text(ctx,heads?'正':'反',0,0,r*.68,p.bg,'center',700);ctx.restore();
}
function drawCoinIntro(ctx,p,local,progress,s){
  const speed=s.motionSpeed||1;glow(ctx,0,-40,340,p.gold,.17);coin(ctx,0,-60+Math.sin(local*1.3*speed)*18,175,p,local*2.3*speed,Math.cos(local*2.3*speed)>0);
  for(let i=0;i<5;i++){ctx.save();ctx.globalAlpha=out(phase(progress,.25+i*.06,.1));coin(ctx,-280+i*140,250,45,p,0,true);ctx.restore();}
  text(ctx,'正 · 正 · 正 · 正 · 正',0,355,30,p.muted);pill(ctx,'下一次，会轮到反面吗？',0,460,p);
}
function drawCoinToss(ctx,p,local,progress,s){
  const q=ease(phase(progress,.05,.4));coin(ctx,0,-60,135,p,local*.6*(1-q)*(s.motionSpeed||1),true);
  for(let i=0;i<2;i++){const x=i?245:-245;line(ctx,i?110:-110,30,x,175,p.faint,3);coin(ctx,x,245,80,p,0,!i);text(ctx,'1 / 2',x,385,65,i?p.blue:p.gold,'center',600);}
  pill(ctx,'公平 · 独立 · 每次重新开始',0,485,p,25);
}
function drawCoinTree(ctx,p,local,progress,s,two=false){
  const xs=[-340,-110,135,365],baseYs=[0];
  const show=phase(progress,.02,.72)*3;
  const levels=[[''],['正','反'],['正正','正反','反正','反反'],['正正正','正正反','正反正','正反反','反正正','反正反','反反正','反反反']];
  for(let level=0;level<4;level++){
    for(let i=0;i<levels[level].length;i++){
      const count=levels[level].length,y=(i-(count-1)/2)*(650/count),appear=out(clamp(show-level+1));if(!appear)continue;
      const path=levels[level][i],isTwo=(path.match(/正/g)||[]).length===2;
      const highlight=level===3&&(two?isTwo:(i===0||i===7));
      ctx.save();ctx.globalAlpha*=appear;
      if(level>0){const py=(Math.floor(i/2)-((count/2)-1)/2)*(650/(count/2));line(ctx,xs[level-1]+20,py,xs[level]-24,y,highlight?p.gold:p.faint,highlight?3:2);}
      circle(ctx,xs[level],y,level===0?15:level===3?15:24,highlight?p.gold:p.bg,highlight?p.gold:p.blue,2);
      if(level===1||level===2)text(ctx,path.slice(-1),xs[level],y,23,p.ink);
      if(level===3)text(ctx,path,xs[level]+25,y,23,highlight?p.gold:p.muted,'left');
      ctx.restore();
    }
  }
  const showFormula=out(phase(progress,.55,.2));ctx.save();ctx.globalAlpha*=showFormula;text(ctx,two?'3 条路径  /  8 种可能':'2 × 2 × 2  =  8',0,430,57,p.gold,'center',600);ctx.restore();
}
function drawCoinPaths(ctx,p,local,progress,s){
  const qs=['正正正','正正反','正反正','正反反','反正正','反正反','反反正','反反反'];
  for(let i=0;i<8;i++){
    const a=i*TAU/8-Math.PI/2;const appear=out(phase(progress,i*.04,.16));ctx.save();ctx.globalAlpha*=appear;const hi=i===0||i===7;const x=Math.cos(a)*290,y=Math.sin(a)*290-40;line(ctx,Math.cos(a)*100,Math.sin(a)*100-40,x,y,hi?p.gold:p.faint,hi?3:1);pill(ctx,qs[i],x,y,hi?{...p,muted:p.gold}:p,24);ctx.restore();
  }
  coin(ctx,0,-40,90,p,local*.15,true);text(ctx,'每条具体序列：1 / 8',0,420,49,p.gold,'center',600);
}
function drawCoinFreq(ctx,p,local,progress,s,small=false){
  const{heads}=sampleData();const end=small?Math.round(lerp(1,10,ease(phase(progress,0,.75)))):simulationN(progress),x0=-375,y0=240,w=750,h=510;
  for(let j=0;j<=4;j++){const y=y0-h*j/4;line(ctx,x0,y,x0+w,y,p.faint,1);text(ctx,`${j*25}%`,x0-22,y,21,p.muted,'right');}
  line(ctx,x0,y0-h*.5,x0+w,y0-h*.5,p.gold,2);text(ctx,'50%',x0+w+12,y0-h*.5,22,p.gold,'left');
  ctx.save();ctx.beginPath();const max=small?10:10000;const points=Math.min(end,900);for(let j=1;j<=points;j++){const n=Math.max(1,Math.round(lerp(1,end,j/points)));const x=x0+(small?n/max:Math.log(n+1)/Math.log(max+1))*w,y=y0-(heads[n]/n)*h;j===1?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.strokeStyle=p.blue;ctx.lineWidth=3;ctx.stroke();ctx.restore();
  const x=x0+(small?end/10:Math.log(end+1)/Math.log(10001))*w,y=y0-heads[end]/end*h;glow(ctx,x,y,30,p.blue,.3);circle(ctx,x,y,7,p.blue);
  text(ctx,end.toLocaleString('en-US'),0,-390,74,p.gold,'center',600);text(ctx,'次抛掷',0,-315,25,p.muted);
  text(ctx,`正面频率 ${(heads[end]/end*100).toFixed(1)}%`,0,355,49,p.ink,'center',500);pill(ctx,small?'小样本：比例容易大幅偏离':'一条模拟轨迹 · 虚线基准为理论概率',0,465,p,24);
}
function drawLawGap(ctx,p,local,progress,s){
  const{heads}=sampleData();const ns=[10,100,10000];const widths=[0,0,0];
  ns.forEach((n,i)=>{const reveal=out(phase(progress,i*.13,.24)),x=-280+i*280,delta=Math.abs(heads[n]-(n-heads[n]));ctx.save();ctx.globalAlpha*=reveal;text(ctx,n.toLocaleString('en-US'),x,-225,48,p.ink,'center',600);text(ctx,'次抛掷',x,-168,23,p.muted);coin(ctx,x,-20,60,p,0,true);text(ctx,String(delta),x,125,55,p.gold,'center',600);text(ctx,'正反次数差',x,184,23,p.muted);text(ctx,`${(delta/n*100).toFixed(1)}%`,x,290,52,p.blue,'center',600);text(ctx,'相对次数差',x,350,23,p.muted);ctx.restore();});
  pill(ctx,'比例趋近，不要求绝对次数差趋近零',0,465,p,25);
}
function drawCoinMemory(ctx,p,local,progress,s){
  for(let i=0;i<5;i++){ctx.save();ctx.globalAlpha=.2;coin(ctx,-280+i*140,-265,45,p,0,true);ctx.restore();}
  line(ctx,-350,-150,350,-150,p.faint,2);coin(ctx,0,35,140,p,local*.45*(s.motionSpeed||1),Math.cos(local*.45)>0);text(ctx,'下一次，仍然 1 / 2',0,320,57,p.gold,'center',600);pill(ctx,'独立事件 · 不补偿 · 不欠账',0,455,p,25);
}
function drawCoinOutro(ctx,p,local,progress,s){
  const{heads}=sampleData();ctx.beginPath();for(let i=10;i<=10000;i+=25){const x=-360+Math.log(i)/Math.log(10000)*720,y=(.5-heads[i]/i)*900;i===10?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.strokeStyle=p.blue;ctx.lineWidth=4;ctx.stroke();line(ctx,-360,0,360,0,p.faint,1);coin(ctx,0,-225,100,p,Math.sin(local*.3)*.2,true);text(ctx,'长期的秩序',0,235,65,p.gold,'center',600);text(ctx,'每次的不确定',0,340,42,p.ink);pill(ctx,'大数定律 ≠ 下一次的保证',0,460,p,25);
}

function visualLabels(scene, fallback = ['起点', '变化', '结果']) {
  const v=scene.visual||{};
  const a=v.labels?.length?v.labels:v.items?.length?v.items.map(x=>x.label):fallback;
  return a.filter(Boolean).slice(0,8);
}
function genericNode(ctx,x,y,r,label,p,active=0){
  glow(ctx,x,y,r*1.9,p.gold,.05+.13*active);circle(ctx,x,y,r,p.paper?'#e9dfcd':'#172631',active?p.gold:p.faint,2+active);circle(ctx,x,y,r-9,null,active?p.gold:p.faint,1);
  let size=26,ls=lines(ctx,label,r*1.5,size,20);while(ls.length>3&&size>17){size--;ls=lines(ctx,label,r*1.5,size,20);}ls=ls.slice(0,3);ls.forEach((s,i)=>text(ctx,s,x,y+(i-(ls.length-1)/2)*(size*1.35),size,active?p.gold:p.ink));
}
function drawGenericProcess(ctx,p,local,progress,s){
  const labels=visualLabels(s);const count=Math.min(6,labels.length),positions=[];const reveal=phase(progress,.02,.75)*count;
  for(let i=0;i<count;i++){
    const x=count<=3?(i-(count-1)/2)*280:((i%3)-1)*280,y=count<=3?0:(i<3?-165:165);
    positions.push([x,y]);
    if(i>0){const [px,py]=positions[i-1],q=out(clamp(reveal-i+.7));const distance=Math.hypot(x-px,y-py),dx=(x-px)/distance,dy=(y-py)/distance,sx=px+dx*105,sy=py+dy*105,ex=x-dx*105,ey=y-dy*105;line(ctx,sx,sy,lerp(sx,ex,q),lerp(sy,ey,q),p.blue,3);if(q>.9){const a=frac(local*(s.motionSpeed||1)*.25-i*.18);circle(ctx,lerp(sx,ex,a),lerp(sy,ey,a),7,p.gold);}}
    const appear=out(clamp(reveal-i+1));ctx.save();ctx.globalAlpha*=appear;genericNode(ctx,x,y,100,labels[i],p,clamp(reveal-i));text(ctx,String(i+1).padStart(2,'0'),x,y-145,25,p.muted);ctx.restore();
  }
  if(s.visual?.note)pill(ctx,s.visual.note,0,440,p,24);
}
function drawGenericCompare(ctx,p,local,progress,s){
  const labels=visualLabels(s,['方案 A','方案 B']);const vals=s.visual?.values||[];const reveal=out(phase(progress,.04,.6));const max=Math.max(1,...vals.map(Math.abs));
  for(let i=0;i<2;i++){
    const x=i?225:-225;rr(ctx,x-190,-300,380,610,24);ctx.fillStyle=p.paper?'#e9dfcd':'#15232e';ctx.fill();ctx.strokeStyle=i?p.blue:p.gold;ctx.lineWidth=2;ctx.stroke();
    fitted(ctx,labels[i]||`方案 ${i?'B':'A'}`,x,-225,310,38,p.ink,'center',600);
    const h=vals.length>=2?Math.abs(vals[i])/max*260:165;const c=i?p.blue:p.gold;glow(ctx,x,0,160,c,.12);
    for(let j=0;j<12;j++){const a=j*TAU/12+local*.15*(i?-1:1)*(s.motionSpeed||1);circle(ctx,x+Math.cos(a)*92,Math.sin(a)*92-10,4,c);}
    rr(ctx,x-65,215-h*reveal,130,Math.max(3,h*reveal),12);ctx.fillStyle=c;ctx.fill();
    if(vals.length>=2)text(ctx,`${vals[i]}${s.visual.unit||''}`,x,275,46,c,'center',600);
    const detail=s.visual?.items?.[i]?.detail;if(detail)fitted(ctx,detail,x,-145,300,23,p.muted);
  }
  text(ctx,'VS',0,0,30,p.muted);if(vals.length<2)pill(ctx,'结构对照示意 · 未提供定量数据',0,440,p,23);
}
function drawGenericBars(ctx,p,local,progress,s){
  const labels=visualLabels(s,['项目 A','项目 B','项目 C']);const values=s.visual?.values||[];const signed=values.some(v=>v<0);const n=Math.min(8,Math.max(labels.length,values.length)),x0=-360,w=720/Math.max(1,n),base=signed?0:260;
  const max=Math.max(1,...values.map(Math.abs));for(let j=0;j<=4;j++)line(ctx,-400,260-j*130,400,260-j*130,p.faint,1);line(ctx,-400,base,400,base,p.muted,2);
  for(let i=0;i<n;i++){
    const q=out(phase(progress,.05+i*.055,.5)),x=x0+w*(i+.5);const value=values[i];const real=Number.isFinite(value);const h=(real?Math.abs(value)/max:.6)*(signed?225:460),negative=real&&value<0,tip=base+(negative?1:-1)*h*q;
    const c=i%2?p.blue:p.gold;const g=ctx.createLinearGradient(x,tip,x,base);g.addColorStop(0,c);g.addColorStop(1,p.paper?'#d4c7af':'#193140');rr(ctx,x-w*.33,negative?base:tip,w*.66,Math.max(2,h*q),10);ctx.fillStyle=g;ctx.fill();
    if(real&&q>.8)text(ctx,`${value}${s.visual?.unit||''}`,x,tip+(negative?28:-32),27,c,'center',600);
    fitted(ctx,labels[i]||`${i+1}`,x,330,w*.9,25,p.muted);circle(ctx,x,tip,4,c);
  }
  if(!values.length)pill(ctx,'未提供数值 · 等高示意',0,440,p,24);else if(s.visual.note)pill(ctx,s.visual.note,0,440,p,24);
}
function drawGenericNetwork(ctx,p,local,progress,s,orbit=false){
  const labels=visualLabels(s,['核心','因素一','因素二','因素三','因素四']);const count=Math.max(1,Math.min(7,labels.length-1));
  for(let i=0;i<count;i++){
    const a=i*TAU/count-Math.PI/2+(orbit?local*.09*(s.motionSpeed||1):0),r=290,x=Math.cos(a)*r,y=Math.sin(a)*r;
    const q=out(phase(progress,.04+i*.05,.32));line(ctx,0,0,x*q,y*q,p.faint,2);const d=frac(local*.3+i*.17);circle(ctx,x*d,y*d,5,p.blue);ctx.save();ctx.globalAlpha*=q;genericNode(ctx,x,y,75,labels[i+1]||`节点 ${i+1}`,p,phase(progress,.2+i*.05,.35));ctx.restore();
  }
  genericNode(ctx,0,0,105,labels[0]||'核心',p,1);if(s.visual.note)pill(ctx,s.visual.note,0,440,p,24);
}
function drawGenericTimeline(ctx,p,local,progress,s){
  const labels=visualLabels(s);const n=Math.min(6,labels.length);line(ctx,0,-360,0,350,p.faint,4);line(ctx,0,-360,0,lerp(-360,350,out(phase(progress,0,.85))),p.gold,4);
  for(let i=0;i<n;i++){
    const y=lerp(-310,300,n===1?.5:i/(n-1)),side=i%2?1:-1,x=side*210,q=out(phase(progress,.03+i*.09,.25));
    ctx.save();ctx.globalAlpha*=q;circle(ctx,0,y,13,p.gold);line(ctx,side*15,y,x-side*100,y,p.blue,2);rr(ctx,x-150,y-55,300,110,16);ctx.fillStyle=p.paper?'#e9dfcd':'#172631';ctx.fill();fitted(ctx,labels[i],x,y,260,31,p.ink);ctx.restore();
  }
}
function drawGenericParticles(ctx,p,local,progress,s){
  const labels=visualLabels(s,['信息','连接','理解']);const q=ease(phase(progress,.05,.7));for(let i=0;i<90;i++){
    const group=i%Math.min(3,labels.length),tx=(group-1)*270,ty=Math.sin(i*2.4)*70;const x=lerp((noise(i+1)-.5)*820,tx+Math.cos(i*2.4)*75,q),y=lerp((noise(i+78)-.5)*660,ty,q);const wobble=Math.sin(local*(s.motionSpeed||1)+i)*5;circle(ctx,x+wobble,y,2+noise(i+8)*3,i%3?p.blue:p.gold);
  }
  labels.slice(0,3).forEach((label,i)=>{const x=(i-1)*270;ctx.save();ctx.globalAlpha=out(phase(progress,.3,.25));genericNode(ctx,x,0,96,label,p,1);ctx.restore();});if(s.visual.note)pill(ctx,s.visual.note,0,440,p,24);
}
function drawScriptScene(ctx,p,local,progress,s){
  const kind=s.kind.slice(7);
  if(kind==='compare')drawGenericCompare(ctx,p,local,progress,s);
  else if(kind==='bars'||kind==='distribution')drawGenericBars(ctx,p,local,progress,s);
  else if(kind==='network'||kind==='orbit')drawGenericNetwork(ctx,p,local,progress,s,kind==='orbit');
  else if(kind==='timeline')drawGenericTimeline(ctx,p,local,progress,s);
  else if(kind==='particles')drawGenericParticles(ctx,p,local,progress,s);
  else if(kind==='dice'){
    const v=s.visual?.values||[];drawDie(ctx,-150,-40,220,clamp(Math.round(v[0]||3),1,6),Math.sin(local*(s.motionSpeed||1))*.2,p);drawDie(ctx,150,-40,220,clamp(Math.round(v[1]||4),1,6),Math.cos(local*(s.motionSpeed||1))*.2,p,true);
    const labels=visualLabels(s,[]);labels.slice(0,2).forEach((x,i)=>fitted(ctx,x,i?190:-190,280,340,34,p.ink));
  }
  else if(kind==='combinations'){
    const labels=visualLabels(s,['A','B','C','D']);const n=Math.min(6,labels.length);const cell=110;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const q=out(phase(progress,(i*n+j)*.015,.2)),x=(j-(n-1)/2)*cell,y=(i-(n-1)/2)*cell;ctx.save();ctx.globalAlpha*=q;rr(ctx,x-48,y-48,96,96,12);ctx.fillStyle=p.paper?'#e9dfcd':'#172631';ctx.fill();fitted(ctx,`${labels[i]}·${labels[j]}`,x,y,84,23,i===j?p.gold:p.muted);ctx.restore();
    }
    pill(ctx,`${n} × ${n} 种组合示意`,0,435,p,25);
  }
  else drawGenericProcess(ctx,p,local,progress,s);
  if(s.visual?.formula){ctx.save();ctx.globalAlpha=out(phase(progress,.12,.25));fitted(ctx,s.visual.formula,0,-435,840,36,p.gold,'center',600);ctx.restore();}
  if(s.visual?.emphasis&&s.detailLevel!==0){ctx.save();ctx.globalAlpha=out(phase(progress,.45,.22));fitted(ctx,s.visual.emphasis,0,385,800,27,p.ink);ctx.restore();}
}

function drawScene(ctx,p,scene,local,progress){
  const s=scene;const k=s.kind;
  if(k.startsWith('script:'))drawScriptScene(ctx,p,local,progress,s);
  else if(k==='intro')drawIntro(ctx,p,local,progress,s);
  else if(k==='fair')drawFair(ctx,p,local,progress,s);
  else if(k==='grid'){drawGrid(ctx,p,progress);const q=out(phase(progress,.6,.2));ctx.save();ctx.globalAlpha*=q;text(ctx,'6 × 6 = 36',0,390,69,p.gold,'center',600);text(ctx,'有序组合 · 每一格机会相同',0,470,25,p.muted);ctx.restore();}
  else if(k==='seven')drawSeven(ctx,p,local,progress,s);
  else if(k==='twelve')drawTwelve(ctx,p,local,progress,s);
  else if(k==='simulation')drawSimulation(ctx,p,local,progress,s);
  else if(k==='independence')drawIndependence(ctx,p,local,progress,s);
  else if(k==='outro')drawOutro(ctx,p,local,progress,s);
  else if(k==='coinIntro')drawCoinIntro(ctx,p,local,progress,s);
  else if(k==='coinToss')drawCoinToss(ctx,p,local,progress,s);
  else if(k==='coinTree')drawCoinTree(ctx,p,local,progress,s);
  else if(k==='coinPaths')drawCoinPaths(ctx,p,local,progress,s);
  else if(k==='coinTwo')drawCoinTree(ctx,p,local,progress,s,true);
  else if(k==='coinFreq')drawCoinFreq(ctx,p,local,progress,s);
  else if(k==='lawSmall')drawCoinFreq(ctx,p,local,progress,s,true);
  else if(k==='lawGap')drawLawGap(ctx,p,local,progress,s);
  else if(k==='coinMemory')drawCoinMemory(ctx,p,local,progress,s);
  else if(k==='coinOutro')drawCoinOutro(ctx,p,local,progress,s);
}

function drawDesignedFrame(ctx,project,scene,index,time,localTime,progress,width,height){
  const theme=getStyle(project.style),p=palette(project,scene),small=Math.min(width,height);
  const family=theme.fontFamily==='serif'?'"Noto Serif CJK SC", "Songti SC", SimSun, Georgia, serif':theme.fontFamily==='mono'?'Consolas, "Noto Sans CJK SC", monospace':'"Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  if(scene.composition){
    drawComposition(ctx,scene.composition,{time:localTime+(Number(scene.sourceOffset)||0)+(scene.variant||0)*.17,duration:Number(scene.renderDuration)||scene.duration,width,height,style:theme,scene,project});
  }else{
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=p.bg;ctx.fillRect(0,0,width,height);
    ctx.fillStyle=p.ink;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${small*.06}px ${family}`;
    const titleLines=lines(ctx,scene.title,width*.8,small*.06,3);titleLines.forEach((s,i)=>ctx.fillText(s,width/2,height*.33+i*small*.085));
    const state=scene.renderState==='failed'?'此镜画面设计未完成':scene.renderState==='generating'?'正在设计这一镜的画面':'分镜已生成，画面等待设计';
    ctx.font=`400 ${small*.029}px ${family}`;ctx.fillStyle=p.gold;ctx.fillText(state,width/2,height*.57);
    ctx.font=`400 ${small*.022}px ${family}`;ctx.fillStyle=p.muted;ctx.fillText(scene.renderState==='failed'?'请重试当前镜头，已完成镜头会保留':'这里暂时显示分镜占位，不代表已完成画面',width/2,height*.64);ctx.restore();
  }
  drawDesignedOverlay(ctx,project,scene,index,time,progress,width,height);
}
export function drawDesignedOverlay(ctx,project,scene,index,time,progress,width,height){
  const theme=getStyle(project.style),p=palette(project,scene),small=Math.min(width,height);
  const family=theme.fontFamily==='serif'?'"Noto Serif CJK SC", serif':'"Noto Sans CJK SC", sans-serif';
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=.78;ctx.fillStyle=p.muted;ctx.font=`400 ${small*.018}px ${family}`;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText('见知  /  '+scene.title,width*.065,height*.055);ctx.textAlign='right';ctx.fillText(`${String(index+1).padStart(2,'0')} / ${String(project.scenes.length).padStart(2,'0')}`,width*.935,height*.055);
  if(project.settings?.captions!==false){
    const caption=getCaptionText(project,time),size=small*(width>height?.034:.039),maxWidth=width*.85;
    const allLines=lines(ctx,caption,maxWidth,size,100),cue=project.subtitles?.find(c=>time>=Number(c.start)&&time<Number(c.end));
    const cp=cue?clamp((time-Number(cue.start))/Math.max(.01,Number(cue.end)-Number(cue.start)),0,.999):clamp(progress,0,.999);
    const pages=Math.max(1,Math.ceil(allLines.length/2)),page=Math.min(pages-1,Math.floor(cp*pages)),visible=allLines.slice(page*2,page*2+2);
    if(visible.length){
      const y=height*.87,lh=size*1.5;ctx.globalAlpha=.94;ctx.fillStyle=p.paper?'rgba(250,246,238,.88)':'rgba(6,7,9,.78)';roundedCaption(ctx,width*.055,y-size*.9,width*.89,visible.length*lh+size*.45,small*.008);ctx.fill();
      ctx.font=`400 ${size}px ${family}`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=p.ink;visible.forEach((s,i)=>ctx.fillText(s,width/2,y+i*lh));
    }
  }
  ctx.globalAlpha=.3;ctx.strokeStyle=p.faint;ctx.lineWidth=Math.max(.5,small*.001);line(ctx,width*.065,height*.965,width*.935,height*.965,p.faint,Math.max(.5,small*.001));line(ctx,width*.065,height*.965,width*(.065+.87*clamp(time/project.duration)),height*.965,p.gold,Math.max(.5,small*.001));ctx.restore();
}
function roundedCaption(ctx,x,y,w,h,r){rr(ctx,x,y,w,h,r);}

export function drawFrame(ctx, project, time, width = 1080, height = 1920) {
  if(!ctx || !project?.scenes?.length) return;
  const landscape = width > height, W=landscape?1920:1080,H=landscape?1080:1920;
  const {scene,index,localTime,progress}=getSceneAt(project,time);const p=palette(project,scene);
  if(scene.composition||scene.renderState){drawDesignedFrame(ctx,project,scene,index,Math.max(0,Number(time)||0),localTime,progress,width,height);return;}
  const t=Math.max(0,Number(time)||0), sourceLocal=localTime+(Number(scene.sourceOffset)||0), motionTime=sourceLocal+(scene.variant||0)*.71;
  const renderProgress=Math.pow(clamp(sourceLocal/(Number(scene.renderDuration)||scene.duration),0,1),clamp(1/(scene.motionSpeed||1),.65,1.8));
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle=p.bg;ctx.fillRect(0,0,width,height);const fit=Math.min(width/W,height/H);ctx.setTransform(fit,0,0,fit,(width-W*fit)/2,(height-H*fit)/2);ctx.globalAlpha=1;ctx.lineCap='round';ctx.lineJoin='round';
  drawBackground(ctx,W,H,p,t,scene.particleCount??34);
  const left=landscape?105:84,top=landscape?72:95;
  circle(ctx,left+17,top,16,null,p.gold,2);circle(ctx,left+17,top,5,p.gold);line(ctx,left+1,top,left+33,top,p.gold,1);
  text(ctx,'见知',left+59,top,29,p.ink,'left',600);text(ctx,'V I B E   S T U D I O',left+145,top,17,p.muted,'left',500);
  text(ctx,`${String(index+1).padStart(2,'0')}  /  ${String(project.scenes.length).padStart(2,'0')}`,W-left,top,23,p.muted,'right');
  const titleX=landscape?left:92,titleY=landscape?277:267,titleW=landscape?610:895;let titleSize=landscape?65:76;
  let titleLines=lines(ctx,scene.title,titleW,titleSize,20);while(titleLines.length>2&&titleSize>26){titleSize--;titleLines=lines(ctx,scene.title,titleW,titleSize,20);}titleLines=titleLines.slice(0,2);const reveal=.75+.25*out(phase(progress,0,.07));ctx.save();ctx.globalAlpha=reveal;
  titleLines.forEach((s,i)=>text(ctx,s,titleX,titleY+i*(titleSize*1.35),titleSize,p.ink,'left',700));
  if(scene.detailLevel!==0){const tagline=project.topicKey==='dice'?'PROBABILITY / 概率的形状':project.topicKey==='law'?'LAW OF LARGE NUMBERS / 大数定律':project.topicKey==='coin'?'INDEPENDENCE / 随机的记忆':'VISUAL EXPLANATION / 知识可视化';text(ctx,tagline,titleX,titleY+titleLines.length*titleSize*1.35+35,landscape?20:22,p.gold,'left',500);}
  ctx.restore();
  const cx=landscape?1310:540,cy=landscape?475:945,scale=landscape?.81:.94;
  ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);
  const enter=out(phase(progress,0,.06));ctx.globalAlpha=lerp(.65,1,enter);ctx.translate(0,(1-enter)*22);
  drawScene(ctx,p,scene,motionTime,renderProgress);ctx.restore();
  if(project.settings?.captions!==false){
    const cue=project.subtitles?.find(c=>t>=Number(c.start)&&t<Number(c.end));
    let caption=getCaptionText(project,t);
    const capSize=landscape?30:37,capW=landscape?1470:880,capY=landscape?895:1577;
    const allCaptionLines=lines(ctx,caption,capW,capSize,100);
    const captionProgress=cue?clamp((t-Number(cue.start))/Math.max(.01,Number(cue.end)-Number(cue.start)),0,.999):clamp(progress,0,.999);
    const chunk=Math.min(Math.max(0,Math.ceil(allCaptionLines.length/2)-1),Math.floor(captionProgress*Math.ceil(allCaptionLines.length/2)));
    const capLines=allCaptionLines.slice(chunk*2,chunk*2+2);
    ctx.save();const boxW=capW+52,boxH=capLines.length*(capSize*1.55)+36;rr(ctx,W/2-boxW/2,capY-29,boxW,boxH,16);ctx.fillStyle=p.paper?'rgba(245,238,225,.93)':'rgba(8,14,21,.75)';ctx.fill();
    capLines.forEach((s,i)=>text(ctx,s,W/2,capY+i*capSize*1.55,capSize,p.ink));ctx.restore();
  }
  const by=H-(landscape?65:104);line(ctx,left,by,W-left,by,p.faint,2);line(ctx,left,by,lerp(left,W-left,clamp(t/project.duration)),by,p.gold,3);
  for(const s of project.scenes.slice(1))circle(ctx,lerp(left,W-left,s.start/project.duration),by,3,p.muted);
  const ft=landscape?18:21;text(ctx,'CODE ANIMATION  /  图形推演',left,by+37,ft,p.muted,'left');text(ctx,`${Math.floor(t/60).toString().padStart(2,'0')}:${Math.floor(t%60).toString().padStart(2,'0')}  /  ${Math.floor(project.duration/60).toString().padStart(2,'0')}:${Math.floor(project.duration%60).toString().padStart(2,'0')}`,W-left,by+37,ft,p.muted,'right');
  ctx.restore();
}
