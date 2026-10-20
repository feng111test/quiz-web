# PDF 题目整理与刷题

本功能是 [试卷学习工作台](../README.md) 的 PDF 模式。打开 PDF 后自动在本机逐页 OCR，并按识别出的题号尽力拆分题目草稿；人工核对题干、页码、选项、答案和解析。题目可关联原 PDF 页面、框选 PDF 区域或从电脑插入图片。校对后的题目可进入刷题模式，也可导出 JSON。

PDF、识别结果和截图只留在当前浏览器页面，不会上传云端。工具优先读取 PDF 内嵌文字，仅对缺少可用文字的扫描页运行本地 OCR；可一次选择多份 PDF，依次处理并分别保存题库。中文 OCR 模型和页面处理依赖在项目安装时下载，运行工具时不依赖 OCR 云 API。页面截图以 PNG data URL 写入导出的 JSON，因此图片较多时导出文件也会较大。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```powershell
cd web
npm install
npm run dev
```

打开终端显示的本机地址，通常为 `http://127.0.0.1:5173`，再从顶部切换到“PDF 整理刷题”。停止服务时在终端按 `Ctrl+C`。

首次启动会把中文识别模型从 npm 依赖复制到统一网页项目的 `public/tessdata/`；导入 PDF 时模型会在浏览器中加载。PDF 页面转图及 OCR 均在本机完成。构建检查可运行：

```powershell
npm run build
```

## 使用

1. 点击“批量选择 PDF”，可一次选择多份文件；系统会逐份打开、读取 PDF 内嵌文字，并仅对缺少可用文字的页面执行 OCR，生成题目草稿后自动存入每份 PDF 对应的本机题库。识别到的编号和选项仅用于辅助拆题。识别到“一、…”等部分标题时，会把该标题及首题前的共用材料附加到本部分每道题题干，跨页内容也会一并保留。已有题库会直接载入；单份 PDF 可点“重新识别整份试卷”重新生成。
2. 点击左侧题目进入校对；检查题干并使用“查看原页”定位对应的 PDF 页面，也可手工修改页码。PDF 页面区域和左侧页码列表均可独立滚动。
3. 校对题型和选项，补齐正确答案及可选解析；答案未填写的题目会作为草稿保存，但不能开始刷题。
4. 点击“截图并插入”进入截图模式，再在中间 PDF 页面拖动框选公式或图表；截图完成后自动退出模式。平时页面可正常滚动。也可使用“从电脑插入图片”添加题目图片。
5. 题目修改会自动保存到本机题库；使用“上一题 / 下一题”切换，或点击“确认并下一题”记录已校对并前进。逐题确认后可点击“开始刷题”练习，或导出 JSON。已存在同名 PDF 题库时会直接载入，避免重复识别并生成重复题目。

OCR 和自动拆题仅是辅助，不保证普通文字、题号、选项及页码完全正确；共用材料、化学式、上下标、图表、答案及题目跨页情况尤其需要人工核对。建议尽量只框选必要区域，避免把整页放进每道题。

OCR 监视区会显示引擎/中文模型加载、PDF 页面渲染、识别阶段、进度及本次用时；运行超过一段时间没有收到引擎进度时，会显示等待提示并记录日志。日志可复制，方便排查浏览器或模型加载问题。

## 批量调用 AI 转换文件夹中的 PDF

仓库提供独立 Node.js 脚本 `web/scripts/convert-pdf-exams.mjs`，不修改网页。脚本先在本机提取 PDF 内嵌文字、跳过内容完全相同的重复 PDF，再按地区合并学生版和答案版；调用视觉 AI 识别题目及图示位置，在本机裁剪化学方程式、结构式、表格或其他图块，最后输出可导入的题库 JSON。为识别图块，相关学生版页面以及从答案文字匹配到的答案版页面图像会发送给 AI 服务；题库 JSON 中仅保存图块裁剪，不上传整个 PDF 文件。图片以 data URL 嵌入 JSON，含较多裁剪图的题库文件会更大。请注意页面图像会增加数据传输和 API 费用，图片/公式仍需人工校对。PDF 页面通过 `@napi-rs/canvas` 在本地渲染。

智谱 GLM-4V-Flash 单次输出上限为 1024 tokens；脚本逐页识别学生版，把答案版文字作为答案/解析依据，并只附上按题号匹配到的答案页。若整页回复达到输出上限，脚本会依据页面题号逐题重试，并要求精简解析但保留题干、选项、答案及必要图块；单题仍超过上限时会明确报错，不写入不完整题库。若输入超过 16K 上下文上限，会先移除相邻页上下文、保留答案页重试，仍超限时才移除答案页后重试。修正后加 `--overwrite` 重试。

从仓库根目录打开 PowerShell，先试运行统计输入范围（不会调用 AI）：

```powershell
Set-Location web
node scripts/convert-pdf-exams.mjs --dry-run
```

安全输入 API Key 并启动转换。密钥不会写入脚本或命令历史；按当前预设默认使用智谱 GLM-4V-Flash。结果写入源 PDF 目录下的 `题库JSON` 子目录；已存在的题库默认跳过，使用 `--overwrite` 才会覆盖。

```powershell
$secureKey = Read-Host "智谱 API Key" -AsSecureString
$env:ZHIPU_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
try {
  node scripts/convert-pdf-exams.mjs
} finally {
  Remove-Item Env:ZHIPU_API_KEY -ErrorAction SilentlyContinue
  $secureKey = $null
}
```

也可使用 `AI_API_BASE_URL` 和 `AI_MODEL` 指定兼容接口及模型。批量调用会消耗模型额度；实际费用和可用免费额度以服务商控制台为准。生成 JSON 可在 PDF 整理页通过“导入题库”加载。

若报 `无法连接 AI 接口`，可先在同一个 PowerShell 终端检查 Node.js 网络连通性（不发送 API Key，不产生模型请求）：

```powershell
node -e "fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>console.log('HTTP',r.status)).catch(e=>console.error(e.cause?.code,e.cause?.message||e.message))"
```

返回 HTTP 401 表示网络已连通（未提供 Key 是预期的未授权响应）；`ENOTFOUND`、`ETIMEDOUT`、`ECONNRESET` 等则检查 DNS、防火墙或 HTTPS 代理，并在网络恢复后重新运行脚本。

如果连通性测试返回 HTTP 401，但带 Key 的脚本报 `UND_ERR_SOCKET`，且本机配置了 `HTTP_PROXY` / `HTTPS_PROXY`，可让 Node.js 显式使用系统代理后再试：

```powershell
$secureKey = Read-Host "智谱 API Key" -AsSecureString
$env:ZHIPU_API_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
try {
  node --use-env-proxy scripts/convert-pdf-exams.mjs
} finally {
  Remove-Item Env:ZHIPU_API_KEY -ErrorAction SilentlyContinue
  $secureKey = $null
}
```

## 导出格式

题目结构与小程序题目字段接近，额外使用 `images` 保存页面裁剪图：

```json
{
  "type": "single",
  "title": "题干文字",
  "options": [{ "key": "A", "content": "选项文字" }],
  "answer": ["A"],
  "explanation": "",
  "images": [{ "page": 1, "dataUrl": "data:image/png;base64,..." }]
}
```

**当前小程序尚未实现图片题目的显示和此导出格式的导入**，因此导出的文件是人工校对好的题库数据，不可直接作为小程序可刷题题库使用；仍需另行适配小程序图片字段、题目导入流程及云端图片存储。

## 依赖许可

- [PDF.js](https://github.com/mozilla/pdf.js)：Apache-2.0
- [Tesseract.js](https://github.com/naptha/tesseract.js)：Apache-2.0
- [chi_sim Tesseract language data](https://github.com/naptha/tessdata)：npm 包标注 MIT
