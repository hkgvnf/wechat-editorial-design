# 公众号图文设计 Skill - By Jason Optio

按实际内容需求，将文案、现场照片、品牌素材或插画组织成能使用的公众号文章、活动长图、封面与可编辑复制页。重点是事实清楚、图文自然融合、原版 Logo 保真，以及手机上易读。

适用于活动预告和邀请、参会与演讲报道、活动回顾、公司动态、品牌专题及节日祝福。先判断读者要了解什么，再选择结构与视觉；语言、字体、配色和交付形式跟随当次任务。

| 内容类型 | 内容重点 | 常用素材 |
| --- | --- | --- |
| 活动预告／邀请 | 时间地点、参与身份、活动看点，按需附报名信息 | 已确认议程、活动主视觉、人物资料 |
| 人物参会／演讲报道 | 参与背景、发言要点、交流内容 | 真实人物与现场照片、演讲稿 |
| 活动回顾 | 已发生的亮点、现场与有依据的成果 | 现场全景、交流照片、活动记录 |
| 公司动态 | 发生了什么、影响谁、有哪些已确认变化 | 正式资料、产品或服务截图、团队照片 |
| 节日祝福／感谢 | 对受众的感谢与祝愿 | 品牌原件、合适的节日插画 |

活动报道优先使用真实资料和照片；公司动态围绕已确认进展展开。完整照片可用构图、图注和留白融入页面，不要求每张图片都抠成透明，也不默认使用节日装饰或营销结尾。

多章节配图先确定各自的叙事作用，再用统一画风连接；同一场景换裁切不自动算作新配图。融合检查覆盖最终底色上的图片四边、章节交界和手机缩览，区分真实透明素材与不透明底片；文字对比度合格不能代替这些视觉检查。

## 安装到 Codex

将 `skills/wechat-editorial-design` 整个目录复制到你的 Codex 技能目录，通常是 `~/.codex/skills/`。如果设置了 `CODEX_HOME`，使用其下的 `skills/`。保留 `SKILL.md`、`agents`、`references`、`scripts` 和 `assets` 的目录关系。

PowerShell 示例（在仓库目录执行；若目标已存在，先查看差异，避免覆盖自己的修改）：

```powershell
$skillHome = if ($env:CODEX_HOME) { Join-Path $env:CODEX_HOME 'skills' } else { Join-Path $env:USERPROFILE '.codex/skills' }
$destination = Join-Path $skillHome 'wechat-editorial-design'
if (Test-Path -LiteralPath $destination) { throw '技能已存在，请先检查差异。' }
New-Item -ItemType Directory -Force -Path $skillHome | Out-Null
Copy-Item -LiteralPath './skills/wechat-editorial-design' -Destination $destination -Recurse
```

在 Codex 的新会话中调用：

```text
请使用 $wechat-editorial-design，根据我提供的活动资料、演讲稿和现场照片，
制作人物参会回顾公众号图文。使用简体中文，保留真实现场与原版 Logo，
按内容选择高雅、清楚的排版。请交付标题、摘要、封面、长图和可编辑复制页。
```

也可以直接说「根据这份已确认的公司新闻稿做公司动态长图」或「按活动议程做预告，只要长图和封面」。技能会按需求选择结构与输出，不强制每次交付整套文件。详细判断见 [内容类型与叙事](skills/wechat-editorial-design/references/content-types.md)。

如需运行辅助脚本，在安装后的技能目录执行 `npm install`，再执行 `npx playwright install chromium`。技能文档也可以配合当前环境提供的其他设计工具使用，不要求所有项目都运行这些脚本。

## 先跑通无品牌示例

需要 Node.js 20 或更新版本。在仓库根目录运行：

```sh
npm ci
npx playwright install chromium
npm run demo
npm test
```

打开 `skills/wechat-editorial-design/assets/starter/output/article-editor.html`。同一 `output/` 目录还包含完整长图、两种封面、连续章节切片，以及导出尺寸报告。秋日来信和其中的 SVG 只演示排版与导出机制；制作活动或公司动态时应替换内容结构和素材，示例的主题与风格不是默认模板。

正式使用时，先把 `assets/starter/` 复制到当前任务的工作目录，再修改其中的源稿和配置；所有示例输出都落在该副本内的 `output/`，无需依赖仓库层级，也避免改动已安装的技能。

```sh
node skills/wechat-editorial-design/scripts/audit-contrast.cjs skills/wechat-editorial-design/assets/starter/render.json
```

这会把普通 HTML 文字与实际背景进行采样比较。报告标明弱对比与无法检测的情况；它不是完整无障碍认证。图片里的字、Logo、字体是否适合手机阅读，仍需查看真实成品。

## 内含什么

| 文件 | 用途 |
| --- | --- |
| [SKILL.md](skills/wechat-editorial-design/SKILL.md) | 触发范围、设计流程与交付检查 |
| [内容类型与叙事](skills/wechat-editorial-design/references/content-types.md) | 活动、人物报道、公司动态与节日的结构选择、事实核验和配图 |
| [设计与品牌](skills/wechat-editorial-design/references/design-and-brand.md) | 图文融合、透明 Logo、留白与文字可读性 |
| [配图连续性](skills/wechat-editorial-design/references/artwork-continuity.md) | 章节配图分工、避免重复场景、透明素材与背景接缝复核 |
| [配图检查](skills/wechat-editorial-design/references/artwork-audit.md) | 素材复用、透明像素与边缘色差报告的用法及局限 |
| [公众号交付](skills/wechat-editorial-design/references/wechat-delivery.md) | 可编辑正文、长图、复制页、草稿与平台限制 |
| [脚本说明](skills/wechat-editorial-design/references/scripts.md) | 参数、目录、运行方式与输出 |
| `render-design.cjs` | 从本地 HTML 导出指定区域的 PNG / JPG |
| `inspect-logo.cjs` | 只读统计 alpha、白色像素和内容边界 |
| `audit-contrast.cjs` | 最终背景上的普通 HTML 文字对比度筛查 |
| `audit-artwork.cjs` | 单篇正文内的素材去重、透明统计与源图边缘检查 |
| `build-editor.cjs` | 嵌入图片，生成可编辑、可复制、可保存的单文件页面 |

## 使用边界

- 仓库只含通用方法、代码和无品牌示例，不含客户 Logo、真实成品或账号凭据。MIT 许可覆盖本仓库内容，不授予任何第三方品牌资产的使用权。
- 辅助脚本接收你信任的本地 HTML 和素材，不是用于安全执行未知网页的沙箱，也不是 HTML 消毒工具。
- 复制页将 HTML 和纯文本写入剪贴板，图片以 data URI 嵌入。微信后台可能移除图片或样式；请按配图顺序补传原图，并在后台和手机预览。仓库不登录或自动发布到公众号。
- 平台规范可能变化。示例的 `900×383` 与 `1080×1080` 是可改的导出配置；需要最新规则时，应查看官方说明或当前后台要求。
- 草稿按活动键隔离；更换配图后递增 `assetVersion`，保持 `data-asset-id`，可更新图片同时保留文字修改。下载副本使用独立草稿键。

## 验证

`npm test` 覆盖图片透明度检查、指定尺寸导出、强弱文字对比识别、素材字节去重、Logo 与隐藏图片排除、合理重复的说明记录、透明素材和边缘色差报告、编辑页小屏布局、富文本与纯文本剪贴板、复制降级、草稿恢复、换图保留文字，以及下载副本的草稿隔离。字体和截图外观仍会随系统字体而变；正式交付前应人工查看所有图片与章节衔接。

仓库使用 MIT License。
