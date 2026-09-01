# 工作台资讯 · 云端自动更新仓库

这个仓库为「个人工作台」PWA 提供**云端自动更新的资讯数据**（GitHub Actions 定时抓取），
**不需要你的电脑开机**——全部在 GitHub 云端执行。

## 工作原理

```
GitHub Actions（云端，每天 3 次：7:00 / 13:00 / 21:30 北京时间）
   │  ① 抓取：微博热搜 / 知乎热榜 / B站热门 / IT之家 / 36氪 / 新浪指数 / 东方财富板块
   │  ② 生成：news.json + finance-news.json + version.json（AI 科普可选）
   ▼
提交回本仓库
   ▼
jsdelivr CDN（国内可访问） ──▶ 前端资讯板块自动拉取最新数据
```

## 部署步骤（一次性，约 5 分钟）

> 本仓库代码已由 AI 通过 git 推送到 `github.com/VitaHoepZhang/workbench-news`（Public）。
> 以下步骤仅供手动重搭时参考。

1. **新建仓库**：登录 [github.com](https://github.com) → New repository → 仓库名填 `workbench-news`，选 **Public**（jsdelivr 只能分发公开仓库）→ Create repository。
2. **上传本目录全部文件**：把本目录（`.github/`、`scripts/`、`news.json`、`finance-news.json`、`README.md`）上传到仓库根目录。
   - 网页上传：仓库页面 → `Add file` → `Upload files`，把文件拖进去提交。
3. **首次运行**：仓库 `Actions` 标签页 → 左侧 `资讯自动更新` → 右侧 `Run workflow` 按钮手动触发一次，等 1-2 分钟跑完。
4. **确认生效**：跑完后访问以下地址应返回 JSON：
   ```
   https://cdn.jsdelivr.net/gh/VitaHoepZhang/workbench-news@main/news.json
   ```

## 可选：AI 科普增强（推荐）

配置后，科普解读和法律速递将由 DeepSeek AI 生成（每次约 1-2 分钱，几乎免费）：

1. 仓库 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
2. Name 填 `DEEPSEEK_API_KEY`，Secret 填你的 DeepSeek API Key（platform.deepseek.com）
3. 下次运行自动生效；不配置也能跑（用模板科普，前端知识库兜底）

## 前端接入

`modules/news.js` 中 `CLOUD_BASE` 已配置为：

```js
const CLOUD_BASE = "https://cdn.jsdelivr.net/gh/VitaHoepZhang/workbench-news@main";
```

改为后重新部署应用即可（数据源：云端 CDN 优先 → 本地兜底，离线也能看旧内容）。

## 手动触发

随时到仓库 `Actions` → `资讯自动更新` → `Run workflow` 立即刷新一次。
