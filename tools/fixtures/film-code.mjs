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
