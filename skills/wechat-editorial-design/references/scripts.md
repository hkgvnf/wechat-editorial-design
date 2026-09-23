# 本地辅助脚本

这些脚本处理可信的本地 HTML 和素材，不发布文章，也不上传文件。先在 skill 根目录安装依赖：

```bash
npm install
npx playwright install chromium
```

需要 Node.js 20 或更新版本。命令示例从 skill 根目录执行；JSON 配置中的文件路径相对该配置文件所在目录解析。不要将下载的不可信 HTML 直接交给渲染脚本。

## 渲染成品

```bash
node scripts/render-design.cjs work/render.json
```

`work/render.json` 示例：

```json
{
  "html": "design.html",
  "outputDir": "output",
  "background": "#ffffff",
  "targets": [
    { "selector": "#article", "name": "article", "viewportWidth": 1080 },
    { "selector": "#cover", "name": "cover", "query": "?view=cover", "viewportWidth": 900, "jpeg": false }
  ]
}
```

每个选择器必须匹配一个可见元素，`name` 是输出目录内的文件名主干。脚本等待字体和图片，输出 PNG、默认附带 JPG，以及 `render-report.json`；`jpeg: false` 可只输出 PNG。外部 HTTP 请求被阻止，需将授权素材保存在本地或嵌入 HTML。切片可以作为源稿中的独立元素加入 targets；脚本不会自动决定合理切点。

## 检查 Logo 透明度

```bash
node scripts/inspect-logo.cjs work/assets/logo.png
```

输出尺寸、源文件是否有 alpha、透明/半透明/不透明像素数、近白色不透明像素数与可见内容边界。统计不能区分白色字标和白底，不能据此自动删除白色，也不会自动替换或重绘 Logo。先按 [品牌保真说明](design-and-brand.md) 进行多背景视觉检查。

## 初步检查文字对比

```bash
node scripts/audit-contrast.cjs work/render.json
```

复用渲染配置，输出 `contrast-report.json`。它记录 DOM 文本行区域，隐藏文字绘制但保留背景与 `currentColor`，以 3 CSS 像素网格采样背景，与不透明 sRGB 字色计算对比。报告包含已测区域数量、最低比值、低于 4.5 的区域及跳过原因。有弱对比区域时 CLI 退出码为 1；调用模块时可以使用导出的 `audit(configFile)` 获取报告。

这是普通 HTML 文本的保守筛查，不是完整 WCAG 审核。半透明文字或祖先、滤镜、混合模式、变换、阴影、遮罩、裁切等会跳过或警告。图片内文字、SVG/canvas、伪元素、表单控件、极细背景细节及文字互相遮挡需人工查看。截图区域内没有可支持的文字时也不会给出“通过”结论；退出码 0 只表示已采样区域中未发现低于阈值的情况。

## 生成可编辑复制页

```bash
node scripts/build-editor.cjs work/editor.json
```

`work/editor.json` 示例：

```json
{
  "title": "文章标题",
  "summary": "文章摘要",
  "article": "article-fragment.html",
  "output": "output/editor.html",
  "storageKey": "article:example-brand:example-campaign:draft",
  "assetVersion": "1"
}
```

`article` 是可信的 HTML 正文片段，使用内联样式，不包含文档标签、脚本或框架；本地 `<img>` 会嵌入输出 HTML。为每张图片设置稳定、唯一的 `data-asset-id`，更换图片时保留该 ID。

构建器把依赖中的 DOMPurify 一起嵌入单文件。编辑页对初始正文、草稿和粘贴内容使用排版标签与属性白名单，保留常用颜色、字号和间距，移除事件属性与外部资源。富文本配图请使用 `<img>`：CSS `url()` 背景或遮罩会被移除，复杂视觉应先导出为配图。精确设计源稿中的 CSS 遮罩不受编辑页白名单影响，可在渲染时使用。这是正常编辑内容的防护，不是执行任意不可信 HTML 的沙箱。

若希望使用示例，先将 `assets/starter/` 复制到任务工作目录，再运行它的 `render.json`，随后运行 `editor.json`。默认 `output/` 在示例副本内，不依赖安装位置。

同一活动更新配图时保留 `storageKey` 并调整 `assetVersion`；新活动使用新 key。实际保存、刷新恢复与素材迁移需要在当前浏览器中验证。复制到公众号后仍可能需要补传原图，使用方法见 [公众号交付](wechat-delivery.md)。脚本不附带真实品牌素材，运行产生的成品与报告应放在任务输出目录。
