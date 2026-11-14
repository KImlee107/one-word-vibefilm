/** Recover only a complete visual object whose enclosing scene brace was omitted.
 * No eval, new fields, string changes, truncated-content completion or API calls.
 * The caller must still validate the full storyboard schema and duration.
 */
export function recoverSceneClosures(source) {
  const tokens=[];
  const pattern=/\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,])/gy;
  let end=0;
  while(end<source.length){
    if(!source.slice(end).trim())break;
    pattern.lastIndex=end;const match=pattern.exec(source);
    if(!match)throw new SyntaxError('Unsupported JSON syntax');
    tokens.push(match[1]);end=pattern.lastIndex;
    if(tokens.length>100000)throw new SyntaxError('Too many JSON tokens');
  }
  let at=0,repaired=0;
  const consume=expected=>{if(tokens[at++]!==expected)throw new SyntaxError('Unexpected JSON token');};
  function value(path=[],depth=0){
    if(depth>64)throw new SyntaxError('JSON nesting is too deep');
    const token=tokens[at];
    if(token==='['){
      at++;const array=[];
      if(tokens[at]===']'){at++;return array;}
      while(true){array.push(value([...path,array.length],depth+1));if(tokens[at]===']'){at++;return array;}consume(',');}
    }
    if(token==='{'){
      at++;const object=Object.create(null);
      const scene=path.length>=2&&path.at(-2)==='scenes'&&typeof path.at(-1)==='number';
      if(tokens[at]==='}'){at++;return object;}
      while(true){
        const keyToken=tokens[at++];if(!keyToken?.startsWith('"'))throw new SyntaxError('Expected JSON property');
        const key=JSON.parse(keyToken);if(Object.hasOwn(object,key))throw new SyntaxError('Duplicate JSON property');
        consume(':');object[key]=value([...path,key],depth+1);
        if(tokens[at]==='}'){at++;return object;}
        // The source contains every scene field, but goes straight from visual
        // to the next scene or scenes array closer. This is the observed bug.
        if(scene&&key==='visual'&&object.visual&&typeof object.visual==='object'&&!Array.isArray(object.visual)
          &&typeof object.title==='string'&&typeof object.narration==='string'&&Number.isFinite(object.duration)
          &&(tokens[at]===']'||tokens[at]===','&&tokens[at+1]==='{')){
          repaired++;return object;
        }
        consume(',');
      }
    }
    if(token===undefined||/^[{}\[\]:,]$/.test(token))throw new SyntaxError('Incomplete JSON value');
    at++;return JSON.parse(token);
  }
  const result=value();
  if(at!==tokens.length||!repaired)throw new SyntaxError('Not a recoverable scene closure');
  return {value:result,normalizations:[`已在本地恢复 ${repaired} 个分镜闭合括号；未改写文案或新增模型请求。`]};
}
