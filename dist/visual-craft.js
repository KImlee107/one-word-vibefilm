import {getStyle} from './presets.js';
const keys=['world','heroDesign','materials','lighting','lineLanguage','typeHierarchy','continuity'];
export function visualBible(input,style='noir'){
  const theme=getStyle(style),light=['paper','editorial','minimal','pastel'].includes(theme.id);
  const guide={world:theme.label+'：'+theme.description,heroDesign:'道具保持同一套比例、结构与颜色含义；真实物体要有可辨认细节。',materials:light?'暖纸或哑光实体，软阴影与克制边缘层次，避免白字叠在浅色道具上。':'哑光主体与局部暖金边光，主体有厚度与遮挡，不用满屏高亮白色卡片。',lighting:'固定左上主光，重要部位局部提亮；不让辉光洗掉结构、点数和文字。',lineLanguage:'主轮廓、关联线、辅助线分三个层级；仅强调正在发生的因果关系。',typeHierarchy:'标题、主数字、少量短标签分层；公式有独立位置，一屏一个阅读焦点。',continuity:'物件跨镜保持身份，以推进、局部放大、结构变化或视角衔接，而非反复换标题。'};
  let supplied=0;for(const key of keys)if((!input?.style||input.style===theme.id||['heroDesign','continuity'].includes(key))&&typeof input?.[key]==='string'&&input[key].trim()){guide[key]=input[key].trim().slice(0,600);supplied++;}
  return {...guide,origin:input?.origin==='selected-style'?'selected-style':supplied?'model-and-style':'selected-style',style:theme.id};
}
export function shotPlan(input){
  if(!input||typeof input!=='object'||Array.isArray(input))return undefined;const result={};
  for(const key of ['focalObject','visibleChange','conclusion','framing','material','enter','hold','exit','continuity'])if(typeof input[key]==='string')result[key]=input[key].trim().slice(0,450);
  return Object.keys(result).length?result:undefined;
}
export const REFINED_DIRECTION=`参考片精修方法（不是复刻参考片内容）：先让物件和事件成立，再展示术语。全片同一视觉世界、几样道具和一把尺度；场景建立、物体特写、机制演算、同尺度对照、克制结论交替使用，不把每个镜头都画成几张同样大小的白卡加连线。
物件的结构和材质承担解释：纸张有边缘、叠层和轻阴影，水杯有杯壁、水位和真实流向，骰子有可数点阵，图表有明确的量和单位。轮廓、内部结构与细节使用不同线宽，光影只强化体积；不为了高级感加与机制无关的亮线和粒子。
一镜只有一个主动作，先建立空间关系，让关键变化发生，最后留至少半秒阅读停顿；下一镜保留主物件或运动方向，改变景别或信息重心。细节可少，因果必须清楚；同屏保持少量主要标注；候选很多时用无字点阵加一个放大样本，不画几十张小卡重复名字。不要密集微字，不用抽象方框替代所有名词，不强迫每句文字另起一页。
保持所选背景与色彩含义。暗底避免大面积亮白纸面导致整屏白闪；需要看纸张时保留暗边界和清楚深色字。浅底保持深色字与适当的实物阴影；禁止浅金字叠白纸、过强辉光、同色文字与物体融成一块。
每镜在同一次JSON返回中先给shotPlan：focalObject（主角）、visibleChange（可见变化）、conclusion（观众如何从画面得出结论）、framing（景别与焦点）、material（材质与光源）、enter/hold/exit（进场、停留、离场）、continuity（如何接前镜）。再写source实现这些状态。计划不替代实际渲染；最终以真实帧的主体、对比、结构和动作验收，不用“已优化”自证质量。`;
