/** Lexical reference analysis, not a replacement for the isolated Worker boundary. */
export const FILM_ALIAS_NAMES=['W','H','PI','TAU','clamp','lerp','seg','smooth','ss','E','fade','hash','rng','noise1','hex','rgba','mix','fontOf'];
const globals=new Set([...FILM_ALIAS_NAMES,'Math','Number','String','Boolean','Array','Object','JSON','Intl','parseInt','parseFloat','isFinite','isNaN','undefined','NaN','Infinity','Error','TypeError','RangeError']);
class Scope{
  constructor(parent,fn=false){this.parent=parent;this.fn=fn;this.names=new Set();}
  bind(name,kind){if(kind==='var'&&!this.fn&&this.parent)this.parent.bind(name,kind);else this.names.add(name);}
  has(name){return this.names.has(name)||this.parent?.has(name)||globals.has(name);}
}
function bind(pattern,scope,kind='let'){
  if(!pattern)return;
  if(pattern.type==='Identifier')scope.bind(pattern.name,kind);
  else if(pattern.type==='RestElement')bind(pattern.argument,scope,kind);
  else if(pattern.type==='AssignmentPattern')bind(pattern.left,scope,kind);
  else if(pattern.type==='ArrayPattern')pattern.elements.forEach(p=>bind(p,scope,kind));
  else if(pattern.type==='ObjectPattern')pattern.properties.forEach(p=>bind(p.type==='RestElement'?p.argument:p.value,scope,kind));
}
export function undefinedFilmIdentifiers(ast){
  const scopeOf=new WeakMap(),root=new Scope(null,true),missing=new Set();
  function collect(node,scope){
    if(!node||typeof node!=='object')return;
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      if(node.type==='FunctionDeclaration'&&node.id)scope.bind(node.id.name,'let');
      scope=new Scope(scope,true);if(node.id)scope.bind(node.id.name,'let');node.params.forEach(p=>bind(p,scope));
    }else if(['BlockStatement','ForStatement','ForOfStatement','ForInStatement','SwitchStatement','CatchClause'].includes(node.type)){
      scope=new Scope(scope);if(node.type==='CatchClause')bind(node.param,scope);
    }
    scopeOf.set(node,scope);
    if(node.type==='VariableDeclaration')node.declarations.forEach(d=>bind(d.id,scope,node.kind));
    for(const [key,value]of Object.entries(node)){if(['start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(n=>collect(n,scope));else if(value&&typeof value==='object')collect(value,scope);}
  }
  collect(ast,root);
  function patternRefs(pattern,scope){
    if(!pattern)return;
    if(pattern.type==='AssignmentPattern'){visit(pattern.right,scope);patternRefs(pattern.left,scope);}
    else if(pattern.type==='ObjectPattern')for(const p of pattern.properties){if(p.computed)visit(p.key,scope);patternRefs(p.type==='RestElement'?p.argument:p.value,scope);}
    else if(pattern.type==='ArrayPattern')pattern.elements.forEach(p=>patternRefs(p,scope));
    else if(pattern.type==='RestElement')patternRefs(pattern.argument,scope);
  }
  function visit(node,scope){
    if(!node||typeof node!=='object')return;scope=scopeOf.get(node)||scope;
    if(node.type==='Identifier'){if(!scope.has(node.name))missing.add(node.name);return;}
    if(node.type==='VariableDeclarator'){patternRefs(node.id,scope);visit(node.init,scope);return;}
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){node.params.forEach(p=>patternRefs(p,scope));visit(node.body,scope);return;}
    if(node.type==='MemberExpression'){visit(node.object,scope);if(node.computed)visit(node.property,scope);return;}
    if(node.type==='Property'){if(node.computed)visit(node.key,scope);visit(node.value,scope);return;}
    if(node.type==='CatchClause'){patternRefs(node.param,scope);visit(node.body,scope);return;}
    if(node.type==='LabeledStatement'){visit(node.body,scope);return;}
    if(['BreakStatement','ContinueStatement'].includes(node.type))return;
    for(const [key,value]of Object.entries(node)){if(['start','end'].includes(key))continue;if(Array.isArray(value))value.forEach(n=>visit(n,scope));else if(value&&typeof value==='object')visit(value,scope);}
  }
  visit(ast,root);return [...missing].sort();
}
