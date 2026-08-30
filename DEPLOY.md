# 念念 — 上线部署指南

把「念念」部署到公网，让别人输入网址就能访问。

本项目的架构对部署很友好：前端所有请求走相对路径 `/api/*`，`server/index.ts` 里已经
写好了生产环境托管 `dist/` 静态文件 + SPA fallback。**一个端口跑全站，代码零改动。**

---

> ## ⚠️ 平台政策更新（2026-08 核实）
>
> 免费托管这几年变化很大，以下几点是查证后的现状，避免踩坑：
>
> - **Fly.io 已取消新账号免费额度**（2024 年 10 月起），网上大量教程仍在说
>   「免费 3GB 持久卷」，那是**过期信息**，新用户注册后只有小额试用金。
> - **Render 免费层确实存在，但新账号常触发风控强制绑信用卡**，
>   且只接受 Visa / Mastercard，**银联借记卡不可用**。
> - **Railway 是目前唯一「注册无需信用卡」的可用选项**：给 30 天 $5 试用金。
>   这是本文档的主推方案。
>
> 结论：「永久免费 + 免信用卡 + 能跑 Node 后端」在 2026 年基本绝迹，
> 免费方案要么限时（Railway 30 天），要么需要绑卡（Render）。

---

## 方案总览

| 方案 | 花费 | 要信用卡 | 数据持久 | 适合 |
|---|---|---|---|---|
| **Railway**（主推） | 0 元（30 天） | **不需要** | 是（0.5GB 卷） | 先零成本跑一个月看效果 |
| **Render** | 0 元 | 新账号要绑卡 | 否（重启丢失） | 手上有双币信用卡 |
| **腾讯云/阿里云轻量** | ~10-30 元/月 | 不需要 | 是 | 长期稳定、国内访问快 |
| ~~Fly.io~~ | — | 要 | — | 新账号已无免费额度，不推荐 |

---

## 目录

- [第一步：代码推到 GitHub](#第一步代码推到-github)
- [第二步：Railway 部署](#第二步railway-部署)
- [验证清单](#验证清单)
- [数据持久化](#数据持久化)
- [30 天试用结束后怎么办](#30-天试用结束后怎么办)
- [备选：Render](#备选render)
- [备选：腾讯云 / 阿里云轻量](#备选腾讯云--阿里云轻量)
- [备选：Docker 自建](#备选docker-自建)
- [自定义域名与备案](#自定义域名与备案)
- [让别人能"搜到"（SEO）](#让别人能搜到seo)
- [常见问题](#常见问题)

---

## 第一步：代码推到 GitHub

✅ **已完成** — 代码已推送至 `https://github.com/Manchi3/niannian`，首次提交 `2e65937`。

如果是换台机器重来，步骤是：

```bash
cd particle_diary
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

## 第二步：Railway 部署

Railway 给新账号 **30 天 / $5 试用金**，注册**不需要信用卡**，
足够跑一个 512MB 的小服务一整个月。

### 1. 创建项目

1. 打开 <https://railway.app>，点 **Login** → 用 **GitHub** 登录并授权
2. 点 **New Project** → **Deploy from GitHub repo**
3. 在列表里选 **Manchi3/niannian**（如果是第一次用，需要先授权 Railway 访问仓库）
4. Railway 会自动读到仓库里的 `railway.json` + `Dockerfile`，开始构建

### 2. 设置环境变量（关键）

项目创建后，点进服务卡片 → **Variables** 标签页 → **+ New Variable**，逐个添加：

| 变量名 | 值 |
|---|---|
| `DEEPSEEK_API_KEY` | 你的 DeepSeek key（**从本地 `.env` 里复制**） |
| `MIMO_API_KEY` | 你的 MiMo key（**从本地 `.env` 里复制**） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` |
| `MIMO_MODEL` | `mimo-v2.5` |
| `SMTP_HOST` | `smtp.qq.com` — **可选**，可留空 |
| `SMTP_PORT` | `465` — 可选 |
| `SMTP_USER` | 你的邮箱地址 — 可选 |
| `SMTP_PASS` | 邮箱授权码 — 可选 |

### 关于邮箱验证码（已停用，SMTP 非必需）

念念现在使用**纯密码注册 + 密码登录**，验证码入口已从界面移除，
**SMTP 这四项留空即可，不影响注册和登录**。

停用原因有两条：

1. 验证码**发不出去**——Railway 免费试用账号封锁了 SMTP 端口（465/587 全部
   连接超时），而 DeepSeek 的 API 走 443 端口所以正常，这印证了是端口封锁
2. 若改用「验证码在界面自动填充」绕行，任何人都能凭联系方式登录他人账号，
   安全性为零

密码以 **SHA-256 + salt** 存储（`server/utils/security.ts`），
注册时强制至少 6 位。邮件模块保留在 `server/utils/mailer.ts`，将来若迁移到
出站不受限的环境（如国内云服务器），可随时把验证码入口加回来。

（以下是原 SMTP 配置说明，仅在重新启用验证码时才需要）

**获取 QQ 邮箱授权码**：
1. 登录 <https://mail.qq.com> → **设置** → **账号**
2. 找到 **POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务**
3. 开启 **IMAP/SMTP 服务**，按提示用手机发短信验证
4. 页面会生成一串 **16 位授权码**，复制它填到 `SMTP_PASS`
   （**不是**你的 QQ 登录密码）

其他邮箱同理，改 `SMTP_HOST` / `SMTP_PORT` 即可：
网易 163 是 `smtp.163.com:465`，Gmail 是 `smtp.gmail.com:587`（587 走 STARTTLS）。

> 注意：验证码只支持发到**邮箱**，手机号暂不支持（需要短信服务，且要域名备案）。

> `PARTICLE_DIARY_DATA_DIR` 不需要填——`Dockerfile` 里已经设为 `/app/data`，
> 下一步挂载的卷就落在这个路径。
>
> `PORT` 也不需要填——Railway 会自动注入，并覆盖 Dockerfile 里的默认值。

### 3. 挂载持久卷（关键）

不加卷的话，账号数据写在容器文件系统里，重新部署就没了。

1. 服务卡片 → **Settings** → 找到 **Volumes** 区域 → **+ New Volume**
2. **Mount Path** 填：`/app/data`
3. 保存后 Railway 会自动重新部署

### 4. 生成公网域名

1. 服务卡片 → **Settings** → **Networking** 区域
2. 点 **Generate Domain**
3. 得到一个形如 `https://niannian-production-xxxx.up.railway.app` 的地址

这就是可以发给任何人的网址，自带 HTTPS。

### 5. 设置用量提醒（建议）

$5 额度用完后服务会直接停掉。去 **Settings** → **Usage** 开启用量通知，
避免某天突然发现网站打不开了。

512MB 内存常驻大约消耗 $5/月，所以**试用金大约刚好够跑满 30 天**。

---

## 验证清单

依次确认（把域名换成你自己的）：

| # | 检查项 | 预期结果 |
|---|---|---|
| 1 | 访问 `https://你的域名/api/health` | 返回 `{"status":"ok","service":"particle-diary-api"}` |
| 2 | 访问根路径 | 首页粒子动画正常，无白屏 |
| 3 | 注册一个新账号 | 注册成功并能登录 |
| 4 | 上传照片 → AI 搭话 | 能收到带图片理解的开场白 |
| 5 | 聊几句 → 凝合日记 | 生成 ~100 字日记，无「聊起」等禁词 |
| 6 | 重新部署一次服务 | 账号和日记**还在**（验证持久卷生效） |

第 6 项请务必测——在 Railway 点一次 **Redeploy**，再看数据是否还在。

---

## 数据持久化

各平台对磁盘的处理差别很大，这是选方案时最该关注的点：

| 平台 | 磁盘行为 |
|---|---|
| **Railway**（挂卷后） | ✅ 数据在卷上，重新部署/重启都不丢 |
| **Render 免费层** | ❌ 临时磁盘，休眠唤醒或重新部署即清空 |
| **腾讯云/阿里云** | ✅ 自带磁盘，永久 |

本项目通过 `PARTICLE_DIARY_DATA_DIR` 环境变量控制数据目录
（`server/utils/store.ts` 已支持），换平台时改环境变量即可，**代码不用动**。

---

## 30 天试用结束后怎么办

Railway 额度耗尽后服务会停止，数据保留 30 天。届时三个选择：

1. **续费 Railway Hobby**（$5/月）— 最省事，配置不用动
2. **迁到腾讯云/阿里云轻量**（~10-30 元/月）— 国内访问快、数据稳，见下一节
3. **找张双币信用卡上 Render 免费层** — 长期 0 元，但要接受 15 分钟休眠和冷启动

如果到时想迁走，记得先把 `server/data/` 下的内容备份下来。

---

## 备选：Render

适合手上有 **Visa / Mastercard 双币信用卡** 的情况。
注意：Render 官方称免费层不需要信用卡，但**新账号（尤其国内 IP 注册）
常触发风控要求绑卡验证**，银联借记卡无法通过。

步骤：

1. <https://render.com> → 用 GitHub 登录
2. **New +** → **Blueprint** → 选 `Manchi3/niannian`
3. Render 自动读取 `render.yaml`（免费层、新加坡节点、健康检查 `/api/health`）
4. 手动填 `DEEPSEEK_API_KEY` 和 `MIMO_API_KEY`
5. 点 **Apply**，等 3-5 分钟构建

已知短板：15 分钟无请求休眠，冷启动 30-60 秒；免费层磁盘临时，账号数据会丢。

---

## 备选：腾讯云 / 阿里云轻量

**最推荐的长期方案**，尤其适合国内访问：

| | Render / Railway | 腾讯云/阿里云轻量 |
|---|---|---|
| 支付方式 | 信用卡 | 支付宝 / 微信 |
| 价格 | 免费或 $5/月 | 学生机约 10-30 元/月 |
| 数据持久 | 受限 | 有真磁盘，永久 |
| 国内访问速度 | 一般 | 快 |

买到服务器后（选 Ubuntu 22.04），用仓库里的 `Dockerfile`：

```bash
# 装 Docker
curl -fsSL https://get.docker.com | sh

# 拉代码
git clone https://github.com/Manchi3/niannian.git
cd niannian

# 写环境变量
cp .env.example .env
nano .env          # 填入真实的 DEEPSEEK_API_KEY 和 MIMO_API_KEY

# 构建并启动
docker build -t niannian .
docker run -d -p 80:3001 --env-file .env --restart unless-stopped --name niannian niannian
```

机器上还需在防火墙/安全组放行 80 端口。
想上 HTTPS 就用 Nginx 反代 + Let's Encrypt。

---

## 备选：Docker 自建

任何有 Docker 的环境都能跑：

```bash
docker build -t niannian .
docker run -d -p 3001:3001 --env-file .env --name niannian niannian
```

镜像是多阶段构建，运行时只装生产依赖。
配合 Nginx 反代 + Let's Encrypt 证书即可对外提供 HTTPS。

---

## 自定义域名与备案

**一个常见误解**：不是所有情况都要备案。

| 服务器位置 | 用域名需要备案吗 |
|---|---|
| 境外（Railway / Render / 香港） | **不需要** |
| 境内（腾讯云 / 阿里云大陆节点） | **必须备案**，约 2-4 周 |

Railway 和 Render 都支持绑定自定义域名（在服务设置里添加，
再去域名服务商加一条 CNAME 解析），HTTPS 证书自动签发。

想便宜买域名的话，`.top` / `.xyz` 首年通常几块钱；`.com` 约 60-80 元/年。

---

## 让别人能"搜到"（SEO）

部署完别人输入网址能访问，但**百度/谷歌搜不到**——念念是 SPA，
页面内容全靠 JS 渲染，爬虫抓到的基本是个空壳。要做 SEO 得额外补：

1. **基础 meta 标签** — `index.html` 已有 `<title>` 和 `<meta description>`，
   但缺 Open Graph（`og:title` / `og:description` / `og:image`），
   补上后分享到微信/QQ 才会显示卡片
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
Railway 构建资源比 Render 免费层宽裕，一般没问题。若真遇到，
在 `Dockerfile` 的 build 阶段加一行：
```dockerfile
ENV NODE_OPTIONS=--max-old-space-size=460
```

**Q：网站能打开，但聊天没有回复**
十有八九是 API Key 没填或填错。检查 Railway 的 **Variables** 里
`DEEPSEEK_API_KEY` 和 `MIMO_API_KEY` 是否有值，改完会自动重新部署。

**Q：重新部署后账号没了**
说明持久卷没挂上。去 **Settings** → **Volumes** 确认 Mount Path 是 `/app/data`，
并且 `PARTICLE_DIARY_DATA_DIR` 环境变量也是 `/app/data`（Dockerfile 里已默认设好）。

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

注意这只影响**访客侧**的加载速度，服务器自己拉取字体是正常的。

**Q：本地 `npm start` 报错找不到 tsx**
`tsx` 已从开发依赖移到生产依赖，需要重新安装一次：

```bash
npm install
```

**Q：改了代码后线上没变化**
Railway 连接 GitHub 后，push 到 `main` 分支会自动重新构建部署。
如果没有，去服务页面点 **Deploy** 手动触发。

**Q：想回滚**
Railway 服务页 → **Deployments** → 找到历史部署 → 点 **Rollback**。
