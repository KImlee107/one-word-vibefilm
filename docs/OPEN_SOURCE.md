# 开源调研与使用记录

核实日期：2026-11-14。本记录区分「流程参考」「代码复用」「素材使用」。公开可读的仓库不自动等于可以再用。

## 当前实际使用范围（2026-11-14更新）

已按用户要求接入 **HeyChengC/vibe-knowledge-film**，固定提交 `62d51508aad00003dc6209afa80c4b5dc540de59`。上游 `engine/vk.js` 原样保存到 `dist/vendor/vibe-knowledge-film/vk.js`，许可证为MIT（同目录 `LICENSE.txt`）。运行时桥接到 OffscreenCanvas，并把固定W/H适配为当前画幅，不修改所分发的上游文件。`.agents/skills/vibe-knowledge-film` 保存网页适配和原始工作流。`worker/film-prompts.js` 将方法实际用于分镜、独立代码生成及看图返修。

排除授权的参考片逐字稿、例片、音乐、画面设计，以及用户上传视频/抽帧，均未分发。两项早期候选 Andy/LuZhong 项目仍仅作流程调研，没有复制其代码或素材。

网页适配保留用户要求的多画幅、配音、字幕和配乐，覆盖原skill的仅横屏/无旁白限制。细节见 [VIBE_FILM.md](VIBE_FILM.md)。

## 当前工程依赖

package.json 固定使用 **mediabunny 1.65.2**，供浏览器视频编码/封装模块使用。它的许可是 **MPL-2.0**，不是 MIT。该版本源代码：[Vanilagy/mediabunny v1.65.2](https://github.com/Vanilagy/mediabunny/tree/v1.65.2)，对应 commit 173f6b70765fa3a6ffc1c82737514416fa559ef5。许可原文由安装包保存至 vendor/mediabunny-1.65.2.LICENSE；本轮未修改其源码。

分发其浏览器构建文件时，保留版权与许可证声明，并在交付中提供该许可及对应源代码位置；如以后修改受 MPL 覆盖的源文件，需按该许可提供相关源文件。未把整个应用笼统标为 MIT。

## 已核实的候选与限制

| 项目 | 核实内容 | 本轮关系 |
| --- | --- | --- |
| [andyhuo520/vibe-knowledge](https://github.com/andyhuo520/vibe-knowledge) | 代码和文档 MIT；提供有旁白的知识片流程、风格库、事实清单、cine 时间轴和可选生成镜头。 | 流程与确定性时间轴思想参考；未并入运行代码。 |
| [LuZhong-Li/vibe-knowledge-video-skill](https://github.com/LuZhong-Li/vibe-knowledge-video-skill) | 仓库 LICENSE 为 MIT；提供 HTML 动画、Remotion、剪辑和 AI 辅助等分支及检验方法。 | 流程、分支选择与逐帧检查思想参考；未并入运行代码。 |
| [worlds3/vibe-knowledge](https://github.com/worlds3/vibe-knowledge) | 纯 Canvas 时间函数、字幕与 BGM 同步、浏览器导出思路；核实当日完整文件树未见许可证文件。 | 仅调研公开说明；未复制其实现或素材。 |
| [Manim Community](https://github.com/ManimCommunity/manim) | [MIT](https://github.com/ManimCommunity/manim/blob/main/LICENSE)，面向解释性数学动画。 | 可选后续数学镜头引擎；本 Demo 未安装或使用。 |
| [Remotion Agent Skills](https://github.com/remotion-dev/skills) | 官方维护的创建、字幕、预览、渲染和 SaaS 开发指南。Remotion 本体有[独立许可](https://www.remotion.dev/docs/license)。 | 候选方案调研；本 Demo 不依赖 Remotion。 |

MIT 允许使用、修改和分发其覆盖的代码，但需保留版权和许可声明；不能把这项许可扩展到另行说明的素材或外部服务。

## 素材边界

Andy 项目的 [NOTICE.md](https://github.com/andyhuo520/vibe-knowledge/blob/main/NOTICE.md) 明确：

- 示例视频、封面、风格墙、动图和风格 still.jpg 是演示作品，不能作为自己的作品重新上传。
- 默认 BGM 按作者声明可用于该工具制作的视频，不能单独分发或出售。此 Demo 未使用它。
- 默认音色是 AI 设计声音；声音克隆需要相应授权。此 Demo 未使用上游音色样本。
- 第三方字体、图标、库和外部服务另见 [THIRD_PARTY.md](https://github.com/andyhuo520/vibe-knowledge/blob/main/THIRD_PARTY.md)。

LuZhong-Li 的 MIT 文件已核实；这不自动授权其文档引用的电影、商业配乐、角色、外部图片或其他第三方内容。本轮未下载这些资产。

## 成本与适配判断

上游所称「基础档 0 积分」表示不消耗其指定的 AI 素材平台积分，不代表模型、配音、渲染、存储或维护没有成本。限免状态与价格需在接入服务时核实。

上游 workflow 中的固定 BGM、特定发布渠道、桌面路径、指定模型以及平台专属工具属于原项目设置。本 Demo 不继承这些个人化限制。需要时由用户在界面选择声音、音乐和画幅；当前会话的明确要求优先于默认偏好。

## 许可证快照

| 保存路径 | 上游文件 | Git blob SHA |
| --- | --- | --- |
| vendor/andyhuo520-vibe-knowledge.LICENSE | [LICENSE](https://github.com/andyhuo520/vibe-knowledge/blob/main/LICENSE) | 177ee00a4b131e893e1714b6844cc61692cf8681 |
| vendor/luzhong-li-vibe-knowledge-video-skill.LICENSE | [LICENSE](https://github.com/LuZhong-Li/vibe-knowledge-video-skill/blob/main/LICENSE) | c97584b54b0aabace1136ff831e816962387dd68 |

实际依赖的许可另保存在 vendor/mediabunny-1.65.2.LICENSE，来源为已安装的 mediabunny@1.65.2 包；上游同版本[许可文件](https://github.com/Vanilagy/mediabunny/blob/v1.65.2/LICENSE)。

快照按上游原文保存。技术参考入口：[Andy 主 skill](https://github.com/andyhuo520/vibe-knowledge/blob/main/skills/vibe-knowledge/SKILL.md)、[cine 时间轴](https://github.com/andyhuo520/vibe-knowledge/blob/main/skills/ai-teardown/references/10-cine.md)、[LuZhong-Li 主 skill](https://github.com/LuZhong-Li/vibe-knowledge-video-skill/blob/main/SKILL.md)。


## 新增实际分发

- Acorn 8.15.0（MIT），原样浏览器模块 `dist/vendor/acorn.mjs` 与许可证。https://github.com/acornjs/acorn/tree/8.15.0
- Noto Sans/Serif CJK SC（SIL OFL1.1），免费商用。保留版权/许可证，常用汉字子集转换成 WOFF，内部字体名改为 Jianzhi Knowledge Sans/Serif；CSS可用别名，Worker注册VK字体。`dist/fonts/OFL.txt` 记录来源与修改。未分发整个系统字体包或其Debian打包脚本。
