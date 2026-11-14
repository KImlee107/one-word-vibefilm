// Web adaptation of HeyChengC/vibe-knowledge-film (MIT). No reference-film scripts.
export const FILM_METHOD=`使用已接入的 vibe-knowledge-film 方法：先找形象、再写画面；一个世界、一把尺子、几样道具贯穿全片。每镜重新编写 Canvas JavaScript，绝不从固定模板替换文案。
讲解主体必须是外行能认出的东西且长得像本身：芯片有封装、引脚、总线和寄存器；骰子有透视面和点数；血细胞有凹陷、厚度和高光。不得用写了名字的圆圈或方框代替。数学本身可用真实可数的点、刻度、分式与关系，但必须对应实际数量和推导。
每个名词能在画面找到，每个关键动词实际发生。方法用一个小例子当场演算；对比用同一尺度；命名/结论可以只上字并让已有物件停住，不强行添加装饰图。先让观众看见例子再给公式。背景粒子和文字漂浮不算知识动画。
遮住字幕检查三问：这是什么（生活名词）？在干什么（明确动词）？因此明白了什么（因果）？主体占约六成内容宽度、最小重要单元清楚，一镜只有一个主要运动焦点。保留纵向80%以后的字幕安全区。
样式遵守网页所选配色、免费商用字体与比例；原skill的无旁白和仅16:9限制已由用户的多比例、配音字幕要求覆盖。字幕由应用统一绘制，代码不重复画旁白或水印。事实未知要标示意，不编数字；所有数字真算，不能把253个配对当相互独立。
每镜建立→动作→落定，让动作服务知识，留阅读停顿；前后镜头同一物件延续但必须推进机制，不能整片只有同一幅图。
`;
export const CODE_API=`运行环境：使用上游 VK 引擎，返回 draw(fr,t,scene,VK) 的函数体字符串 source，不能包含函数外壳、import、HTML、fetch或Markdown。
fr.w/fr.h为实际像素，必须以W=fr.w,H=fr.h,S=Math.min(W,H)和归一化比例布局，兼容提供的ratio。t为当前镜内秒数，scene.duration总秒数，p=VK.clamp(t/scene.duration)。scene.palette含bg,ink,gold,accent,muted,blue等网页配色。scene.beatTimes为已上传配乐在本镜的实际秒数（没有则空），可优先让关键事件对齐相近节拍，不能凭空宣称分析过音乐。
可用：VK.clamp(x,a=0,b=1),lerp(a,b,k),ss(t,start,end),seg(t,start,end),smooth(k),E.io3(k),E.out3(k),hash(n),rng(seed),rgba(hex,a),mix(c1,c2,k)。所有对象从t重新计算，禁止Math.random、跨帧状态、Date、异步或运行环境访问。
Frame接口（参数必须准确）：
fr.g({a:透明度,at:[x,y],s:缩放或[sx,sy],rot:弧度,clip:[x,y,w,h]},()=>{...});
fr.line(x1,y1,x2,y2,{color,w:线宽,a});
fr.poly([[x,y],...],{color,w,fill,close:true,k:0到1路径生长});
fr.path('SVG路径字符串',{fill,color,w,at:[x,y],s:缩放});
fr.circle(cx,cy,r,{fill,color,w,a}); fr.ellipse(cx,cy,rx,ry,{fill,color,w,a,rot}); fr.arc(cx,cy,r,a0,a1,{color,w});
fr.rect(左x,上y,w,h,{fill,color,w:描边宽度,r:圆角});
fr.text('短标注',x,y,{font:'serif'或'sans'或'latin'或'mono',size:像素,color,a,align:'c'或'l'或'r',glow:2});
fr.grad(x0,y0,x1,y1,[[0,'#hex',1],[1,'#hex',1]])返回渐变可作fill；fr.rgrad(cx,cy,内半径,外半径,stops)。
fr.glow(x,y,r,color,a)微弱光晕。fr.x是CanvasRenderingContext2D，可用save/restore/beginPath/bezierCurveTo/fill等标准2D路径实现复杂物体（禁止取画布或访问图像数据）。
实心物件可放fr.look.under=(ctx,t)=>{...标准Canvas绘制...}避免辉光洗白；或者fr.look.bloom=.1。不要更改fr.look.bg/bgo默认网页背景。文字最小S*.025、主数字S*.12，至少上下各留8%和20%。不用固定1920坐标。for循环必须有小于500的明确有限边界；不要while，不要递归。
JSON输出必须为 {"version":1,"designIntent":"这次具体的画面如何解释机制","layout":"构图说明","heroObjects":["可辨识的具体对象"],"source":"独立JavaScript绘图函数体"}。只返回此JSON。至少有一个非文字主体按t发生知识动作。文字卡首尾镜可用数字/已有道具跟随推演。不要画整段旁白，不要仅使用相同三圆加连线的代码。
`;
export const SCENE_CODE_PROMPT=FILM_METHOD+CODE_API;
export const SCENE_REVIEW_PROMPT=FILM_METHOD+CODE_API+`
现在你是看图返工的导演。用户给出本镜三个真实渲染帧（18%、48%、78%）及源代码。先看图，不能仅凭代码判断。指出实际可见的问题并调整代码：主角是否认得出/够大，是否只是圈+名字，动作是否对应机制，是否小字重叠、画面发白、字幕区被占，推演是否清楚。
本轮必须进行一项具体的视觉改善（可以是体积、构图、运动、可读性或停顿），不改事实，不只改变量名或旁白。保持已正确的主体及跨镜连续性，重新输出完整program。JSON结构 {"feedback":"从实际帧看到的不足和本轮具体修正","program":{version:1,designIntent,layout,heroObjects,source}}。没有看到清楚的对象要重做本镜，禁止空泛的好评。`;
