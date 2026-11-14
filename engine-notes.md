# 当前：vibe-knowledge-film 独立代码

新创作使用 `film-runtime.js` + `film-worker.js` + 上游 `vendor/vibe-knowledge-film/vk.js`。每个镜头按分镜现写 JavaScript；语法通过 Acorn 检查，代码只在无同源权限iframe中的Worker运行。预览、静帧检查与逐帧导出共用绘图代码。默认两轮用真实帧进行视觉返修。流程及实际验证见 [docs/VIBE_FILM.md](docs/VIBE_FILM.md)。

以下为旧版兼容引擎说明；其中JSON不执行JS的描述只适用于旧composition，不能代表当前新代码生成流程。

# v0.3 独立画面绘制升级

- `composition.js` 解释安全 JSON：16 种图形原语、嵌套分组、SVG 几何路径、网络、曲线、柱状图、分式、数字、网格与关键帧。不会执行模型代码、HTML 或外部请求。
- 每镜的实际对象、坐标、数据和动画由模型独立设计，不再仅由少量 `kind` 模板决定画面。旧 `kind` 只保留作兼容预览。
- `validateComposition` 做结构与边界检查；API 的画面质量门槛独立执行。路径数值有限且有界，关键帧按属性限制，分组深度和对象总数有上限。
- `compositionFingerprint` 忽略标题、标签、对象 ID 和版式名字，保留几何、路径、数据、动画关系与数学数值。新增连线或数值推演可以产生新的结构指纹，仅换几个字不能。
- `createProjectFromScript` 保留导演设计字段和 composition。没有完成画面的镜头显示明确待设计、生成中或失败占位，不把旧模板当作生成结果。
- 新画面直接使用实际画布尺寸，支持 7 种比例和 8 种风格；局部配色、运动节奏和粒子数量仍生效。拆分镜头继续使用 `sourceOffset` 和 `renderDuration`。
- Node Canvas 不需要浏览器 `Path2D`，内置有界 SVG 路径追踪；自定义字体使用本机可用字体栈，不下载素材。
- 本轮静帧验证：复杂芯片结构、23 人配对网络与行星轨道 3 种独立构图 × 8 种风格 × 7 种比例，共 168 帧，另原有 6 项引擎测试通过。静帧只保存在工作目录，未生成音视频或发布参考素材。


# v0.2 兼容引擎说明

- Pure Canvas engine; compatible with browser CanvasRenderingContext2D and @napi-rs/canvas. No asset/network/DOM dependency.
- 90s dice structure: 0/10/19/31/43/53/69/81, 8 scenes. 120s scales all timings proportionally.
- Portrait 1080×1920 and landscape 1920×1080 get separately composed title/stage/caption layouts, not crop/letterbox.
- Every die is a projected rotating cube; opposite faces sum to seven. Simulation uses fixed seeded PRNG and real cumulative frequencies for 10,000 samples, distinct from theoretical probabilities. Visuals never claim exact convergence for finite samples.
- Supported built-ins: dice, coin, law of large numbers. Unknown topics throw UNSUPPORTED_TOPIC; no fake semantic generation.
- `getSceneAt` returns `{scene,index,localTime,progress}`.
- `project.subtitles` (array of `{start,end,text}`) overrides scene fallback captions, suitable for exact speech cue alignment.
- Local revision supports slower/faster movement, blue/gold accent, particle count, annotation simplification and motion variants. Keeps scene timing and all unselected scenes unchanged. Unmatched requests do not mutate the project.
- Readability intentionally permits calm moments; animation explains mechanisms instead of continuously moving decorative text.
- Scope updated: no MP4 or audio is pre-generated. This engine drives website preview and user-triggered generation.
- `createProjectFromScript(script, options)` turns API JSON into a safe `topicKey:custom` project. Text, labels, finite bounded values, HTTP(S) sources and durations are normalized; model code/HTML is never evaluated. Supported kinds: process, compare, bars, network, timeline, orbit, particles, dice, combinations, distribution. Unknown kinds become dynamic process diagrams and add a warning.
- API visual.description/action/formula/emphasis are retained with length bounds. Formula and emphasis get concise on-canvas labels; description/action remain editable prompt data, not executable instructions or pretend natural-language animation control.
- Generic bars handle signed values around a zero baseline. Missing values are visibly marked as a nonquantitative equal-height illustration.
- Scene splitting preserves source animation if both halves carry `renderDuration = old.renderDuration || old.duration`, and the later half adds split-local-time to `sourceOffset`.
- Static QA rendered 240+ frames across topics/styles/ratios and all script scene kinds; no browser or long-video render was run.
