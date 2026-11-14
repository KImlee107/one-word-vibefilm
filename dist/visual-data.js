/** Chart numbers and quantity wording are different kinds of information. */
export function visualNumber(value){
  if(typeof value==='number')return Number.isFinite(value)?value:undefined;
  if(typeof value!=='string'||!/^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(value))return undefined;
  const number=Number(value);return Number.isFinite(number)?number:undefined;
}
export function visualValueText(value){
  if(typeof value==='string')return value.trim().slice(0,400);
  if(typeof value==='number'||typeof value==='boolean'||value===null)return String(value);
  try{return JSON.stringify(value).slice(0,400);}catch{return '未提供精确数值';}
}
export function normalizeVisualValues(visual={}){
  const raw=(Array.isArray(visual.values)?visual.values:[]).slice(0,16),numbers=raw.map(visualNumber);
  let valueNotes=(Array.isArray(visual.valueNotes)?visual.valueNotes:[]).slice(0,24).map(visualValueText).filter(Boolean);
  const dataWarnings=(Array.isArray(visual.dataWarnings)?visual.dataWarnings:[]).slice(0,12).map(visualValueText).filter(Boolean);
  const descriptive=numbers.some(n=>n===undefined);
  if(descriptive){
    // Keep the entire sequence together, so labels and values cannot shift.
    const sequence=raw.map(visualValueText);
    valueNotes=[...sequence,...valueNotes.filter(note=>!sequence.includes(note))];
    dataWarnings.push('数量描述保留为文字，未提供精确数据；请使用文字或标明示意，不推算具体计数、比例或条形长度。');
  }
  return {values:descriptive?[]:numbers,valueNotes:valueNotes.slice(0,24),dataWarnings:[...new Set(dataWarnings)].slice(0,12)};
}
