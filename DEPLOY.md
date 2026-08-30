# 念念 — 上线部署指南

把「念念」部署到公网，让别人输入网址就能访问。

本项目的架构对部署很友好：前端所有请求走相对路径 `/api/*`，`server/index.ts` 里已经
写好了生产环境托管 `dist/` 静态文件 + SPA fallback。**一个端口跑全站，代码零改动。**

---

## 目录

- [方案总览](#方案总览)
- [第一步：代码推到 GitHub](#第一步代码推到-github)
- [第二步：Render 一键部署](#第二步render-一键部署)
- [第三步：填 API Key](#第三步填-api-key)
- [验证清单](#验证清单)
- [数据持久化（重要）](#数据持久化重要)
- [休眠与冷启动](#休眠与冷启动)
- [备选：Fly.io（免费持久盘）](#备选flyio免费持久盘)
- [备选：Docker 自建](#备选docker-自建)
- [自定义域名与备案](#自定义域名与备案)
- [让别人能"搜到"（SEO）](#让别人能搜到seo)
- [常见问题](#常见问题)

---

## 方案总览

| 方案 | 花费 | 上手 | 数据持久 | 适合 |
|---|---|---|---|---|
| **Render 免费** | 0 元 | 10 分钟 | 否（重启丢失） | 演示、内测、发给朋友看 |
| **Fly.io** | 0 元起 | 20 分钟 | 是（3GB 卷） | 想长期跑、账号不能丢 |
| **腾讯云轻量** | ~10-30 元/月 | 1-2 小时 | 是 | 国内访问要快（需备案） |

---

## 第一步：代码推到 GitHub

项目目前还不是 Git 仓库，先初始化。

```bash
cd C:/Users/LEGLON/WorkBuddy/念念/particle_diary

git init
git add .
```

**提交前务必确认密钥没有被加进去**（这一步不能跳）：

```bash
git status --short | findstr /I "env"
```

没有输出才是对的。`.gitignore` 已经忽略了 `.env` 和 `server/data/`。
如果这里出现了 `.env`，**立刻停手**，说明忽略规则失效了。

```bash
git commit -m "feat: 粒子日记 念念 首个可部署版本"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> GitHub 上新建仓库时，**不要**勾选 "Add a README file"，否则 push 会因历史冲突失败。

---

## 第二步：Render 一键部署

1. 打开 <https://render.com>，用 **GitHub 账号**登录并授权
2. 点 **New +** → **Blueprint**
3. 选中刚推上去的仓库 → Render 会自动读取仓库里的 `render.yaml`
4. 服务名 `particle-diary`、区域 `Singapore`、计划 `Free` 会自动填好
5. 点 **Apply**，Render 开始构建（首次约 3-5 分钟）

构建完成后的网址形如：`https://particle-diary.onrender.com`

`render.yaml` 已经帮你配好了这些，不需要手动填：

| 配置项 | 值 | 说明 |
|---|---|---|
| Build Command | `npm ci && npm run build` | 装依赖 + 编译前端 |
| Start Command | `npm start` | 即 `tsx server/index.ts` |
| Health Check | `/api/health` | 后端已实现 |
| Region | `singapore` | 对国内延迟低于美国节点 |
| Node | `22` | 通过 `NODE_VERSION` 指定 |

---

## 第三步：填 API Key

部署完成后，两个密钥要在 Render 后台手动填（**不能写进代码或 yaml**）：

1. 进入服务 → 左侧 **Environment**
2. 找到这两项，把值填进去：
   - `DEEPSEEK_API_KEY` — 对话 + 日记凝聚
   - `MIMO_API_KEY` — 图片理解
3. 点 **Save Changes**，Render 会自动重启服务

> 建议在 DeepSeek 和小米 MiMo 平台设置**余额告警或消费上限**，
> 公网服务一旦被别人刷，费用会实打实地扣。

---

## 验证清单

依次确认（把域名换成你自己的）：

| # | 检查项 | 预期结果 |
|---|---|---|
| 1 | 访问 `https://xxx.onrender.com/api/health` | 返回 `{"status":"ok","service":"particle-diary-api"}` |
| 2 | 访问根路径 | 首页粒子动画正常，无白屏 |
| 3 | 注册一个新账号 | 注册成功并能登录 |
| 4 | 上传照片 → AI 搭话 | 能收到带图片理解的开场白 |
| 5 | 聊几句 → 凝合日记 | 生成 ~100 字日记，无「聊起」等禁词 |
| 6 | 刷新页面 | 账号和日记都还在（IndexedDB 按 uid 隔离） |

---

## 数据持久化（重要）

**Render 免费层的磁盘是临时的。** 账号数据写在 `server/data/users.json`，
以下情况会被清空：

- 服务休眠后重新唤醒
- 每次重新部署
- Render 的平台维护

也就是说：**别人注册的账号，过一阵子可能就没了。** 演示够用，长期跑不行。

三个解决办法，任选其一：

**① 升级 Render Starter（$7/月 + $0.25/GB 磁盘）**
在 `render.yaml` 里加一段：

```yaml
    disk:
      name: niannian-data
      mountPath: /var/data
      sizeGB: 1
```

同时在环境变量加 `PARTICLE_DIARY_DATA_DIR=/var/data`。
`server/utils/store.ts` 已支持这个变量，代码无需改动。

**② 改用 Fly.io**
免费额度自带 3GB 持久卷，见下一节。

**③ 迁到真正的数据库**
把 `users.json` 换成 SQLite / Postgres，是最彻底的方案，但要动 `server/` 代码。

---

## 休眠与冷启动

Render 免费层 **15 分钟无请求自动休眠**，下次访问要等 30-50 秒冷启动——
第一次打开会很慢，让人以为网站挂了。

免费保活办法：用 [UptimeRobot](https://uptimerobot.com) 之类的监控服务，
每 5-10 分钟 ping 一次 `/api/health`。注意间隔别短于 5 分钟，否则可能违反 Render 的服务条款。

---

## 备选：Fly.io（免费持久盘）

Fly.io 的免费额度包含 3GB 持久卷，数据不会丢，是免费方案里更靠谱的选择。

```bash
# 安装 CLI（Windows）
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"

cd C:/Users/LEGLON/WorkBuddy/念念/particle_diary

fly auth login
fly apps create particle-diary        # 名字全局唯一，被占用就换一个

# 创建 1GB 持久卷（对应 fly.toml 里的 niannian_data）
fly volumes create niannian_data --region sin --size 1

# 设置密钥（不会写进任何文件）
fly secrets set DEEPSEEK_API_KEY=sk-你的key MIMO_API_KEY=你的key

fly deploy
```

之后每次更新代码只需 `fly deploy`。

---

## 备选：Docker 自建

如果你有服务器（腾讯云/阿里云/家里 NAS），用仓库里的 `Dockerfile`：

```bash
docker build -t particle-diary .
docker run -d -p 3001:3001 --env-file .env --name niannian particle-diary
```

镜像是多阶段构建，运行时只装生产依赖，体积较小。
配合 Nginx 反代 + Let's Encrypt 证书即可对外提供 HTTPS。

---

## 自定义域名与备案

**一个常见误解**：不是所有情况都要备案。

| 服务器位置 | 用域名需要备案吗 |
|---|---|
| 境外（Render / Fly.io / 香港） | **不需要** |
| 境内（腾讯云 / 阿里云大陆节点） | **必须备案**，约 2-4 周 |

Render 免费层**支持绑定自定义域名**：服务设置 → Custom Domains → 添加域名，
然后去你的域名服务商加一条 CNAME 解析指向 Render 给的地址，HTTPS 证书自动签发。

想便宜买域名的话，`.top` / `.xyz` 首年通常几块钱；`.com` 约 60-80 元/年。

---

## 让别人能"搜到"（SEO）

部署完别人输入网址能访问，但**百度/谷歌搜不到**——念念是 SPA，
页面内容全靠 JS 渲染，爬虫抓到的基本是个空壳。要做SEO得额外补：

1. **基础 meta 标签** — 在 `index.html` 补 `<title>`、`<meta name="description">`、
   Open Graph（`og:title` / `og:description` / `og:image`），分享到微信/QQ 时才有卡片
2. **robots.txt + sitemap.xml** — 在项目根目录**新建 `public/` 文件夹**（目前还没有），
   把这两个文件放进去，Vite 构建时会自动复制到 `dist/` 根目录
3. **提交收录** — [百度站长平台](https://ziyuan.baidu.com) 和
   [Google Search Console](https://search.google.com/search-console) 各提交一次
4. **预渲染（进阶）** — 用 `vite-plugin-prerender` 或 prerender.io 给爬虫返回静态 HTML

对日记类应用来说，内容本身是私密的，SEO 的意义其实有限——
除非你想让 Landing Page 被搜到。那种情况下优先做第 1、3 步，性价比最高。

---

## 常见问题

**Q：构建失败，提示内存不足（OOM）**
`render.yaml` 里的 `buildCommand` 已通过 `NODE_OPTIONS=--max-old-space-size=460`
限制构建期内存。若仍失败，把值降到 `384`，或改用 Fly.io（构建内存更宽裕）。

**Q：网站能打开，但聊天没有回复**
十有八九是 API Key 没填或填错。检查 Render 后台 Environment 里
`DEEPSEEK_API_KEY` 和 `MIMO_API_KEY` 是否有值，改完记得 Save 触发重启。

**Q：国内打开首页很慢，或者白屏等很久才出内容**

原因是 `index.html` 里引入了 Google Fonts（`fonts.googleapis.com`），
国内网络访问它经常超时，而浏览器会**阻塞渲染等字体加载完**，首屏就卡住了。

三种解法，按推荐度排序：

1. **字体自托管（最稳）** — 把用到的 Noto Serif SC / Inter 子集化后放进
   `public/fonts/`，用 `@font-face` 本地引用，彻底不依赖外网
2. **异步加载（改动最小）** — 给字体 `<link>` 加两个属性，让首屏不等字体：
   ```html
   <link rel="stylesheet" href="...谷歌字体地址..." media="print" onload="this.media='all'" />
   ```
3. **换国内镜像** — 第三方镜像的稳定性没有保障，仅作临时过渡

注意这只影响**访客侧**的加载速度，服务器（新加坡节点）自己拉取字体是正常的。

**Q：本地 `npm start` 报错找不到 tsx**
`tsx` 已从开发依赖移到生产依赖，需要重新安装一次：

```bash
npm install
```

**Q：改了代码后线上没变化**
Render 默认开启自动部署，push 到 `main` 分支后会自动重新构建。
如果关掉了，去服务页面手动点 **Manual Deploy** → **Deploy latest commit**。

**Q：想回滚**
Render 服务页 → **Events** → 找到历史部署 → **Rollback to this version**。
