# API 接入与使用

本网站公开访问。每位访问者使用自己的 DeepSeek 与 MiniMax API Key，网站没有共享模型密钥或代付账户。密钥只存在于当前页面内存及当前请求中，服务端不保存；刷新后需要重新填写。本次改造未使用真实用户密钥、未提交付费请求，也未生成任何音视频。

## 已预设的模型

接口设置面板只需要两份密钥：DeepSeek API Key，以及同时用于配音和视频的 MiniMax API Key。模型、服务地址和协议已经预设。

| 功能 | 确定的模型 ID | 基础地址 | 原生协议 |
| --- | --- | --- | --- |
| 文本与分镜 | `deepseek-flash`（DeepSeek V4.1 Flash） | `https://api.deepseek.com/v1` | Chat Completions JSON |
| 中文配音 | `speech-2.8-hd` | `https://api.minimax.cn` | MiniMax `/v1/t2a_v2` |
| AI 视频镜头 | `MiniMax-H3` | `https://api.minimax.cn` | MiniMax `/v2/video_generation` |

DeepSeek 官方当前以 `deepseek-flash` 为调用 ID，服务对应 DeepSeek-V4.1-Flash-1017。该预设请求显式传入 `thinking:{type:"disabled"}`，采用非思考模式生成短 JSON 分镜；不会把输出额度优先花在默认开启的推理内容上。[DeepSeek 模型说明](https://api-docs.deepseek.com/quick_start/pricing/)；[思考模式参数](https://api-docs.deepseek.com/guides/thinking_mode/)。

MiniMax 国内预设使用 `api.minimax.cn`。账户、地区、余额和对应模型权限需要与该地址匹配；国际部署可在源码配置中改为 `https://api.minimax.io`。网站保留旧通义万相、OpenAI-compatible 文本/配音和第三方 Videos 适配代码，但这些不是本次界面的默认模型。

## 请求与密钥

客户端向同源 `/api/*` 发送 `{config,payload}`。配置字段为：

```json
{
  "provider": "minimax",
  "baseURL": "https://api.minimax.cn",
  "model": "speech-2.8-hd",
  "apiKey": "由访问者在网页填写"
}
```

请求经本站 Worker 转发给指定服务商。Key 不会写入源码、项目 JSON、偏好 skill、浏览器持久存储或服务端日志，也不会返回给浏览器。后端错误会隐藏原始密钥及 Bearer 值。模型 HTML 不会执行；新逐镜动画 JavaScript 仅在无同源权限的 iframe 内的隔离 Worker 中运行，不在主页面执行，不接触密钥。

接口只接受同源 Origin 的 JSON POST（健康检查除外），并限制体积、服务商公开域名、HTTPS、重定向及自定义端口。公开访问不表示其他人能使用你的模型账户；每次请求都需要访问者提供自己的 Key。项目和媒体保存在各访问者自己的浏览器页面，不共享。

默认服务商域名包含 DeepSeek、MiniMax 国内/国际地址和已有兼容服务。自定义公开服务可由部署者使用非敏感环境变量 `EXTRA_PROVIDER_HOSTS` 添加，多个域名用英文逗号分隔。始终拒绝本地地址、IP、带内嵌账号的 URL 和非 HTTPS 地址。

## 本站接口

除健康检查外，均为同源 `POST application/json`。失败统一返回 `{error:{code,message}}`。

| 路由 | payload | 返回 |
| --- | --- | --- |
| `GET /api/health` | 无 | 本站能力与版本，不请求模型 |
| `/api/test` | `{capability:"text"}`，也可为 speech/video | 鉴权及只读查询结果摘要 |
| `/api/script` | `{topic,brief?,duration,ratio,style,audience,preferences,jsonMode?}` | `{script,usage,mayBeBillable}` |
| `/api/script/repair` | 原生成参数 + `{draft,issue}` | `{script,usage,repaired:true,mayBeBillable}`；最多1次由前端明确显示的格式整理 |
| `/api/scene-code` | `{scene,index,project,previousDesigns,preferences,beatTimes}` | `{program,fingerprint,skill,usage,mayBeBillable}` |
| `/api/review-scene` | 上述上下文 + `{program,frames:[三张JPEG dataURL],round}` | `{program,feedback,fingerprint,usage,mayBeBillable}` |
| `/api/scene-art` | `{scene,index,sceneCount,project,previousDesigns,preferences,jsonMode?}` | `{composition,fingerprint,usage,mayBeBillable}` |
| `/api/revise` | `{scene,instruction,context,jsonMode?}` | `{scene,usage,mayBeBillable}`；保留镜长 |
| `/api/speech` | `{text,voice?,speed?}` | MP3 二进制流 |
| `/api/video/create` | `{prompt,duration,ratio,resolution?}` | `{job,mayBeBillable}` |
| `/api/video/status` | `{id}` | `{job}` |
| `/api/video/content` | `{id}` | 已完成镜头的 MP4 流 |

连接测试不提交内容生成：DeepSeek 查询 `/models`；MiniMax 配音查询 `/v1/get_voice`，视频查询 V2 任务列表。MiniMax 音色和已有任务的详细列表不会返回客户端，只提供验证摘要。鉴权成功不代表指定模型余额、地区和生成权限都已经验证，实际生成时服务商仍可拒绝请求。

## MiniMax 配音协议

后端向 `/v1/t2a_v2` 提交 `speech-2.8-hd`、文本和原生 `voice_setting` / `audio_setting`。默认中文音色为 `male-qn-qingse`，语速 1，32 kHz、128 kbps、MP3 单声道，并指定 `language_boost:"Chinese"`。

非流式结果的 `data.audio` 是十六进制字符串，后端检验并解码为真正的 MP3 字节，再交给浏览器。它不是 OpenAI 的 `/audio/speech` 二进制协议。HTTP 200 中 `base_resp.status_code` 非零同样被当作失败处理。音频 JSON 上限为 16 MB，避免使用文本 JSON 的 1 MB 限制截断正常旁白。配音按镜头调用，过长文本需拆分。

[MiniMax 同步语音合成](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)；[音色查询](https://platform.minimax.cn/docs/api-reference/voice-management-get)。

## MiniMax H3 视频协议

生成的是一个镜头。MiniMax-H3 使用原生 V2 content 数组：

```json
{
  "model": "MiniMax-H3",
  "content": [{"type":"text","text":"连续运动的知识镜头画面描述"}],
  "resolution": "768P",
  "duration": 9,
  "ratio": "9:16"
}
```

默认 768P 可控制调用成本；适配器也支持 `2K`。每镜 4–15 秒整数，H3 原生支持 `21:9/16:9/4:3/1:1/3:4/9:16`。网站的 `4:5` 画幅由 `3:4` 原片在预览和合成时裁切，创建接口会明确返回 `requestedRatio/generatedRatio/cropToFit`。90 秒讲解由多个镜头组成，不把整片当作一次模型调用。

创建返回 `task_id`，随后查询 `/v2/query/video_generation/{task_id}`。任务状态 `queued/running/succeeded/failed/cancelled` 被转换为网站统一状态；没有服务商实际进度时返回 `progress:null`。兼容 `{task:{...}}` 与平铺任务结果。

成功结果从 `content.url` 下载，不使用旧 MiniMax 的 `file_id` / files-retrieve 流程。下载仅接受已核实的 MiniMax 媒体 CDN 域名，并且不会向签名媒体 URL 转发 API Key。单次下载上限为 256 MB。

客户端轮询同一任务，不重复提交。停止等待不保证取消服务商已经接受的生成任务，超时后可用任务 ID 到服务商查看，避免重复计费。

[H3 创建任务](https://platform.minimax.cn/docs/api-reference/video-generation-v2-create)；[H3 查询任务](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)；[只读任务列表](https://platform.minimax.cn/docs/api-reference/video-generation-v2-list)。

## 结构化分镜与客户端

v0.3 采用两阶段：`/api/script` 先编排分镜，随后逐镜调用 `/api/scene-art` 独立设计图形和动画。前一步完成只代表剧本完成，不能标为视频已生成。代码画面不再局限于十种固定版式。

`brief` 可填写完整专业创作提示词、脚本参考与导演说明。分镜接口保留至多 18,000 字符并真实传入模型，返回脚本也会携带这份说明；客户端应将其保存到 `project.brief`。逐镜绘图接口继续传入其中至多 8,000 字符，使字体、字幕安全区、动画事件、视觉风格与节奏要求能够贯穿两阶段，而非只剩下简短主题。网页选定的 `duration` 优先于说明里的参考时长；生日悖论模板可选择 120 秒，但其它时长仍按网页选择适配。导演说明不能覆盖安全 JSON 输出结构，也不授予脚本执行或外部请求能力。

生日悖论主题会附加明确数学锚点：忽略闰年、365 天均匀且个人生日独立；23 人至少一对同生日约 50.7%、全部不同约 49.3%，无序配对数为 `23×22/2=253`，采用全部不同概率的补集推导。这些是假设模型下的结论；253 个配对事件本身不能假设为相互独立。其它主题不会被强行加入生日公式。

脚本格式为 `{title,summary,sources,scenes}`。每镜含 `title,narration,caption,duration,kind,visual`；kind 仅为内容分类。`visual` 还保存具体可见对象 `heroObjects`、三段变化 `beats`、独立构图 `layout` 和衔接 `continuity`。目标时长为 15–300 秒，完整脚本为 3–48 镜；常用时长为 15/30/45/60/90/120/180/300 秒。画幅支持 `9:16/16:9/1:1/4:5/3:4/4:3/21:9`，八种风格使用共享预设的字体、纹理和色板。

`/api/scene-art` 的 payload 包括当前镜头、编号、总镜数、项目上下文和已经完成的画面设计摘要。模型输出 `{version:1,designIntent,layout,camera,objects,transitions}`，`objects` 是安全声明式绘图程序，可包含路径、分组、网络、曲线、分式、数值、网格和关键帧。它不包含或执行模型生成的 JavaScript、HTML、URL、命令或外部资源。完整字段约定见项目 UPGRADE.md；公开产品中使用的是图形数据而非任意脚本沙盒。

服务端校验结构、有限数值、对象数、图层深度和运动事件。中间镜头要求具体图形结构与至少两个实质动作，拒绝简单圆点标签、静态模板和只换文字的重复几何。首尾镜允许简洁提问或收束。`fingerprint` 忽略标题、标签和布局名字，保留几何、数据与关键帧；与 `previousDesigns` 中的完成镜头完全重复时返回 `ART_DUPLICATE`。真实连续推演可通过新增关系、路径、公式或数据产生不同指纹。

绘图错误返回 `ART_FORMAT/ART_INCOMPLETE/ART_TOO_SIMPLE/ART_TOO_GENERIC/ART_STATIC/ART_DUPLICATE` 等明确状态，不悄悄回退旧模板，也不暗中重复提交付费请求。调用者可保留已完成镜头并手动重试失败镜。整体进度由客户端按实际完成镜头数计算；服务端不提供伪造的时间百分比。图形通过校验仍不等于科学事实或审美质量已完全核验，来源继续标记 `needs-review`。

`dist/api-client.js` 导出 `health`、`testConnection`、`generateScript`、`generateSceneArt`、`reviseSceneWithAI`、`generateSpeech`、`createVideoTask`、`getVideoTask`、`pollVideoTask` 和 `downloadVideo`。`generateSceneArt` 返回绘图 composition 本身，并在 `apiMeta` 附带实际 token usage、fingerprint 与可能计费标记。配置预设入口为 `PROVIDER_PRESETS.recommendedText/recommendedSpeech/recommendedVideo`，三者均不包含密钥。

## 验证边界

协议、参数、十六进制解码、状态归一化、任务下载的密钥隔离、正文超时与取消均通过本地模拟请求验证。本轮没有访问用户模型账户，没有检验真实余额、模型权限或服务商最终生成质量。

## 逐镜代码与视觉返修

新创作默认使用 `/api/scene-code`，按实际安装的 [vibe-knowledge-film](VIBE_FILM.md) 为每镜独立编写绘图函数体。浏览器渲染18%、48%、78%静帧及重复确定性检查；每轮 `/api/review-scene` 通过 Chat Completions 的 `image_url` 输入发送这三张实际帧，返回看图反馈和修改后的完整代码。默认2轮，可在界面选择0或1轮控制成本。每次均为真实模型请求，没有隐藏无限重试。检查不通过不计完成。原 `/api/scene-art` 为旧项目兼容保留。

## v0.4.1 分镜格式修复

`/api/script` 在事实与内容校验前，兼容 `script/storyboard/data/result/output/video/film` 包装、直接镜头数组、`shots/segments/分镜` 等常见字段、中英文旁白字段、秒数字符串与开始/结束时间。缺少的镜头时长按已有文案长度排程；不会把旧演示模板改名后当作新分镜。缺失镜头、缺失正文、无效数字和不支持的字段仍会报告具体问题。

解析失败返回 `recovery:{draft,shape,finishReason,canRepair,usage}`：draft有长度上限并移除本次密钥；不落盘、不写日志。前端先显示正在整理及额外调用提示，最多发送一次 `/api/script/repair`，保留首轮用量。鉴权、限流、网络和取消不触发格式整理；第二次失败即停止，允许下载诊断内容。模型输出截断与字段问题分别显示。支持将 `repairFormats:false` 传给客户端 `generateScript` 来关闭追加请求。
