// Independently written renderer fixtures. They are tests, never model templates.
export const chipProgram={version:1,designIntent:'一枚指令沿芯片引脚进入总线，在译码与运算模块间传递。',layout:'chip-instruction-cutaway',heroObjects:['带引脚的芯片','指令包','内部总线'],source:`
const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.clamp(t/scene.duration),c=scene.palette;
const left=W*.2,top=H*.24,w=W*.6,h=H*.42;
fr.rect(left,top,w,h,{r:S*.025,fill:'#171c22',color:c.gold,w:S*.002});
fr.rect(left+S*.012,top+S*.012,w-S*.024,h-S*.024,{r:S*.02,color:'#48505b',w:S*.001});
for(let i=0;i<10;i++){let x=left+w*(i+1)/11;fr.line(x,top-S*.035,x,top,{color:c.gold,w:S*.012});fr.line(x,top+h,x,top+h+S*.035,{color:c.gold,w:S*.012});}
for(let i=0;i<4;i++){let y=top+h*(i+1)/5;fr.line(left-S*.035,y,left,y,{color:c.gold,w:S*.012});fr.line(left+w,y,left+w+S*.035,y,{color:c.gold,w:S*.012});}
const centers=[W*.32,W*.5,W*.68];
for(let i=0;i<3;i++){fr.rect(centers[i]-W*.065,H*.35,W*.13,H*.12,{r:S*.008,fill:'#232d35',color:c.blue,w:S*.0015});}
fr.poly([[left,H*.55],[W*.32,H*.55],[W*.32,H*.47],[W*.5,H*.47],[W*.5,H*.55],[W*.68,H*.55],[W*.68,H*.47]],{color:c.blue,w:S*.003,k:VK.ss(p,0,.72)});
const u=VK.ss(p,.10,.72),x=VK.lerp(left,W*.68,u),y=H*(.55-.08*VK.ss(u,.74,1));
fr.rect(x-S*.014,y-S*.012,S*.028,S*.024,{r:S*.004,fill:c.gold});
fr.text('FETCH  →  DECODE  →  EXECUTE',W*.5,H*.73,{font:'mono',size:S*.026,color:c.ink,a:VK.ss(p,.6,.85)});
`};
export const birthdayProgram={version:1,designIntent:'23枚人物铭牌逐一进入房间，真实计算全部253条两两配对关系。',layout:'room-to-pair-network',heroObjects:['人物铭牌','配对细线'],source:`
const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.clamp(t/scene.duration),c=scene.palette;
const nodes=[];for(let i=0;i<23;i++){const a=i*Math.PI*2/23-Math.PI/2;nodes.push([W*.5+Math.cos(a)*W*.30,H*.43+Math.sin(a)*H*.28]);}
let count=0;const drawn=Math.floor(253*VK.ss(p,.27,.78));
for(let i=0;i<23;i++){for(let j=i+1;j<23;j++){if(count<drawn)fr.line(nodes[i][0],nodes[i][1],nodes[j][0],nodes[j][1],{color:c.gold,a:.19,w:S*.001});count++;}}
for(let i=0;i<23;i++){const a=VK.ss(p,i*.006,i*.006+.12);fr.g({a},()=>{fr.circle(nodes[i][0],nodes[i][1]-S*.009,S*.009,{fill:c.gold});fr.rect(nodes[i][0]-S*.014,nodes[i][1]+S*.003,S*.028,S*.023,{r:S*.008,fill:c.gold});});}
fr.text(String(drawn)+' PAIRS',W*.5,H*.43,{font:'latin',size:S*.085,color:c.ink});
fr.text('23 × 22 ÷ 2 = 253',W*.5,H*.76,{font:'mono',size:S*.03,color:c.gold,a:VK.ss(p,.75,.88)});
`};
// New portrait regression scene: a small, explicitly illustrative vector sum.
export const portraitVectors={version:1,designIntent:'同一词的二维示意内容向量加入不同位置向量，算出不同结果；逐步展开与合并。',layout:'two-positions-two-readable-sums',heroObjects:['同一词的两份向量','两组位置向量','两次真实求和'],source:`
const W=fr.w,H=fr.h,S=Math.min(W,H),p=VK.clamp(t/scene.duration),c=scene.palette;
const xs=[W*.30,W*.70],ys=[H*.30,H*.56];
for(let row=0;row<2;row++){
 const y=ys[row],pos=[.1+.1*row,.2-.1*row];
 fr.label('猫 · 位置'+(row+1),W*.5,y-H*.065,{size:S*.06,maxWidth:W*.8,color:c.ink});
 for(let dim=0;dim<2;dim++){
  const x=xs[0]+(dim-.5)*W*.12,px=xs[1]+(dim-.5)*W*.12;
  fr.rect(x-W*.052,y-H*.028,W*.104,H*.056,{r:S*.012,fill:c.ink});
  fr.text([.4,.6][dim].toFixed(1),x,y,{font:'mono',size:S*.048,color:c.bg});
  fr.g({a:VK.ss(p,.12,.35)},()=>{fr.rect(px-W*.052,y-H*.028,W*.104,H*.056,{r:S*.012,color:c.gold,w:S*.003});fr.text(pos[dim].toFixed(1),px,y,{font:'mono',size:S*.048,color:c.ink});});
 }
 fr.label('+',W*.5,y,{size:S*.075,maxWidth:W*.1,color:c.gold,a:VK.ss(p,.12,.35)});
 const grow=VK.ss(p,.36,.75),ry=y+H*.095;
 fr.poly([[W*.3,y+H*.037],[W*.3,ry],[W*.44,ry]],{color:c.gold,w:S*.004,k:grow});
 fr.poly([[W*.7,y+H*.037],[W*.7,ry],[W*.56,ry]],{color:c.gold,w:S*.004,k:grow});
 fr.g({a:grow},()=>{for(let dim=0;dim<2;dim++){const x=W*.5+(dim-.5)*W*.12;fr.rect(x-W*.052,ry-H*.028,W*.104,H*.056,{r:S*.012,fill:c.gold});fr.text(([.4,.6][dim]+pos[dim]*grow).toFixed(1),x,ry,{font:'mono',size:S*.048,color:c.bg});}});
}
fr.label('相同的词，加入不同的位置',W*.5,H*.765,{size:S*.041,maxWidth:W*.9,color:c.ink});
`};
