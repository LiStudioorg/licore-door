# LiCore 官网

LiCore 官方网站（[github.com/LiStudioorg/licore](https://github.com/LiStudioorg/licore)），
基于 **Nuxt 4** + **[fuxsto-design](https://npmmirror.com/package/fuxsto-design)** 构建，
是一个**服务端渲染的动态站点**。

站点的更新日志、版本列表与下载链接**全部由服务端实时从 GitHub 拉取并聚合**，
上游发布新版本后无需重新部署，页面刷新即可看到最新数据。

> 📚 **文档导航**
>
> | 文档 | 读者 | 内容 |
> | --- | --- | --- |
> | **README.md**（本文） | 所有人 | 项目概览、本地启动、功能说明 |
> | [DEVELOPMENT.md](./DEVELOPMENT.md) | 改代码的人 | 架构、代码结构、改造任务、踩过的坑 |
> | [DEPLOY.md](./DEPLOY.md) | 运维 | 服务器部署、Nginx、回滚、故障排查 |
> | [MAINTENANCE.md](./MAINTENANCE.md) | 改内容的人 | 文案维护手册、事实核查清单 |

---

## 一、核心设计

### 1. 动态 SSR，不做静态生成

站点以 `ssr: true` 运行，每次请求都由 Nitro 服务端渲染。
这样做是因为版本数据是动态的 —— 静态预渲染会把数据固化在构建产物里，
上游一发新版就得重新构建部署。

### 2. 服务端数据层（`server/utils/github.ts`）

| 机制 | 说明 |
| --- | --- |
| **TTL 缓存** | 发行版 / tag / 提交均为 5 分钟，仓库信息 10 分钟，贡献者 30 分钟 |
| **并发去重** | 同一资源的并发请求合并为一次上游调用，避免触发限流 |
| **stale-while-error** | 上游失败或限流时，回退到最近一次成功的数据，页面不会白屏 |
| **超时保护** | 单次上游请求 8 秒超时，不会拖死 SSR |
| **可选 Token** | 配置 `GITHUB_TOKEN` 后配额从 60 次/小时提升到 5000 次/小时 |

Token 只在服务端使用，**不会进入客户端产物**。

### 3. 更新日志与下载的自动适配（`server/utils/changelog.ts`）

上游仓库当前的实际情况是：**有 17 个 git tag（v0.1.0 ~ v0.8.0），
且已有 GitHub Release 与二进制产物**（v0.8.0 带 9 个平台归档）。

因此站点实现了三级自动适配，会随上游状态自动切换，**无需改代码**：

| 上游状态 | 站点行为 |
| --- | --- |
| ① 有 Release **且**有二进制资产（**当前状态**） | 展示官方二进制直接下载链接 |
| ② 有 Release 但**无**资产 | 用 Release 正文作为更新日志，下载回退为源码包 |
| ③ 完全没有 Release | 以 tag 为版本轴，用**相邻 tag 之间的提交**按 Conventional Commits 自动合成更新日志；下载提供 `codeload` 源码归档 + 编译指引 |

> 上游从「无 Release」演进到「有二进制资产」时，官网在缓存过期（**5 分钟**）后
> 就自动切换成了官方二进制下载 —— 实测 `/api/downloads` 返回
> `mode: release-assets`，全程无需改代码。

---

## 二、本地开发

```bash
# 1. 安装依赖（已配置 npmmirror 源，见 .npmrc）
npm install

# 2. 启动开发服务器
npm run dev
# → http://localhost:3000

# 3. 生产构建与运行
npm run build
npm run start        # 等价于 node .output/server/index.mjs
```

### 配置文件（TOML）

站点使用 **`licore-site.toml`**（仓库根目录已附带一份，字段含义全部写在文件注释里）。

> ⚠️ 这是**官网自己**的配置，与 LiCore 引擎无关。
> LiCore 引擎的配置是 `~/.licore/config.yaml`，格式为 **YAML** —— 两者不要搞混。

**优先级**：环境变量 > `licore-site.toml` > 内置默认值。

**查找顺序**（找到第一个就用）：
`LICORE_SITE_CONFIG` 环境变量 → 进程工作目录 → 项目根目录。

**改完必须重启服务**才会生效：

```bash
pm2 reload licore-website --update-env   # 或
sudo systemctl restart licore-website
```

**容错行为**：配置文件不会让站点挂掉 —— 文件不存在、语法错误、字段类型不对，
一律退回内置默认值并打印告警，不会白屏。所有告警都会在后台面板顶部汇总显示。

### 环境变量

在项目根目录创建 `.env`（本地开发用；生产环境建议用 TOML 或 PM2 ecosystem 管理）：

```bash
# 可选：提升 GitHub API 配额（强烈建议在生产环境配置）
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# 可选：覆盖站点域名（不设置则用 app/config/site.ts 里的默认值）
NUXT_PUBLIC_SITE_URL=http://licore.z321.cc.cd
```

> `GITHUB_TOKEN` 只需要 **public repo 只读**权限（fine-grained token 勾选
> Public Repositories 的 Contents: Read 即可）。未配置时匿名配额
> 60 次/小时。因为发行数据是 5 分钟刷新，**生产环境强烈建议配置 token**。

---

## 三、后台管理面板（`/admin`）

站点内置一个运维面板，访问 **`/admin`**。

### 登录

默认账号密码 **`admin` / `admin`**，在 `licore-site.toml` 里修改：

```toml
[admin]
enabled = true
username = "admin"
password = "admin"        # ← 改这里
sessionHours = 12         # 会话有效期（小时）
allowCacheClear = true    # 是否允许在面板上一键清缓存
```

> 🔒 **公网部署请务必改掉默认密码。** 密码是**明文**存在配置文件里的，
> 请确保该文件权限收紧（`chmod 600 licore-site.toml`），且**不要把真实密码提交到公开仓库**。
> 面板检测到仍在使用默认密码时会在顶部显示醒目告警。

### 面板能做什么

| 功能 | 说明 |
| --- | --- |
| **上游状态** | GitHub 可达性、最近推送时间、响应耗时、token 是否已配置 |
| **缓存管理** | 列出每个缓存键的年龄 / TTL / 是否新鲜，支持**单项清理**与**一键清空** |
| **生效配置** | 当前加载的配置文件路径、站点地址、TTL、显示开关；**不回显密码**，只告知是否仍是默认值 |

### 安全设计

- **HMAC 签名的会话 Cookie**（`HttpOnly` + `SameSite=Lax`），无服务端会话存储，无法伪造。
- 账号与密码都用**恒定时间比较**，避免通过响应时间猜密码。
- `enabled = false` 时，`/admin` 与 `/api/admin/*` **一律返回 404**。
- 面板页 `noindex, nofollow`，且 `public/robots.txt` 已 `Disallow: /admin`。
- 会话密钥在进程启动时随机生成，**重启服务会让所有会话失效**。

### 后台接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/admin/login` | `{ username, password }` → 写入会话 cookie |
| `POST /api/admin/logout` | 清除会话，幂等 |
| `GET /api/admin/status` | 面板数据源（需登录） |
| `POST /api/admin/cache/clear` | `{ key? }`，不传 key 即清空全部（需登录 + `allowCacheClear`） |

---

## 四、CI 与发行

仓库内置**两个** workflow：

| 文件 | 触发时机 | 作用 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR 到 `main`，或手动触发 | 类型检查 → 生产构建 → **启动产物做冒烟测试** → 上传产物 |
| `.github/workflows/release.yml` | CI 成功之后自动触发，或手动触发 | 打 tag → 发布 Release（附 `licore-website-build.tar.gz`） |

> 🚫 **本仓库不含自动部署工作流。**
> 推送到 `main` 会**构建并发版**，但**不会**碰任何服务器 ——
> 部署仍是手动的，见下方「五、部署」。

CI 会真的把 `.output` 跑起来并断言：

- 8 条路由必须返回 200
- 5 个 SEO 关键标签必须存在
- **后台鉴权底线**：未登录访问 `/api/admin/status` 必须 401

> 注意：本站是 SSR 动态站点，**即使 GitHub 上游不可达，页面也会降级渲染并返回 200**。
> 所以断言 200 是合理的。鉴权断言则相反：它断言的是**必须失败**。

### 版本号规则

发行版本号形如 `v1.0.3`：

- **补丁号自动递增** —— 取已有最大 tag 的补丁号 +1
- **主次号取自 `package.json` 的 `version`** —— 想主动跨小版本/大版本，
  改 `package.json` 后推送即可（若新主次号更大，则从 `.0` 起算，不会倒退）
- 同一个 commit 已经打过 tag 时会自动跳过，不会重复发行

### 如何发布

推送代码即可，CI 构建通过后自动发行：

```bash
git push origin main
```

产物随 Release 发布，服务器上**一条命令**即可部署：

```bash
curl -fsSL https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh | bash
```

> 首次部署请看 [DEPLOY.md](./DEPLOY.md)。

---

## 五、部署到服务器

> 📘 **完整的部署步骤请看 [DEPLOY.md](./DEPLOY.md)** —— 包含服务器准备、
> 三种部署方式、Nginx/HTTPS 配置、验证清单、回滚与故障排查表。

仓库内提供了部署资产：

| 文件 | 用途 |
| --- | --- |
| `deploy/bootstrap.sh` | **一条命令部署的入口**：取脚本 + 校验 + 转交 |
| `deploy/deploy-latest.sh` | 从 GitHub Release 拉取最新发行版并部署 |
| `deploy/deploy-pm2.sh` | PM2 发布脚本：版本化目录 + 原子切软链 + 重载 + 健康检查 + 失败回滚 |
| `deploy/install.sh` | 服务器端一键安装：建目录、装 systemd 服务、可选首次构建、可选配 Nginx |
| `deploy/licore-website.service` | systemd 单元模板 |
| `deploy/ecosystem.config.cjs` | PM2 进程配置模板 |

> 三层分工，各管一件事：
> `bootstrap.sh` 管**怎么拿到脚本**，`deploy-latest.sh` 管**产物从哪来**，
> `deploy-pm2.sh` 管**怎么发布**。日常更新只要跑第一条命令。

---

## 六、SEO 实现清单

| 项目 | 实现位置 | 说明 |
| --- | --- | --- |
| `<title>` 模板 | `app/app.vue` | 子页面自动拼 `｜ LiCore`，首页用绝对标题 |
| `meta description` | 各页面 `usePageSeo` | 每页独立撰写，且**动态包含最新版本号** |
| `canonical` | `app/app.vue` + 各页 | 指向 `http://licore.z321.cc.cd/...`，响应式 |
| Open Graph | 各页 `usePageSeo` | `og:title` / `og:description` / `og:url` + 分享图（含宽高、alt、type） |
| Twitter Card | 各页 `usePageSeo` | `summary_large_image` + `/og.png`（1200×630） |
| `hreflang` | `app/app.vue` | 单语言站点，声明 `zh-CN` |
| 结构化数据 | `app/app.vue` + 各页 | 全站兜底 `Organization`/`WebSite`，页面用 `@id` 引用并叠加自己的类型 |
| sitemap | `@nuxtjs/sitemap` | 自动包含全部 5 个页面，含 `lastmod` |
| robots.txt | `public/robots.txt` | 允许抓取，屏蔽 `/api/` 与 `/admin`，指向 sitemap |
| 引擎验证 | `public/BingSiteAuth.xml` | Bing Webmaster Tools 站点所有权验证 |
| 语义化 HTML | 全部页面 | `header` / `nav` / `main` / `section` / `article` / `time` / `dl` |
| 无障碍 | 全部页面 | 跳转链接、`aria-label`、`aria-current`、`aria-expanded`、focus 样式 |
| 404 处理 | `app/error.vue` | 返回真实 404 状态码 + `noindex` |

> 站点域名统一在 `app/config/site.ts` 的 `site.url` 里维护。
> 换域名只需要改这一处 + 更新 `public/robots.txt` 的 Sitemap 行。

---

## 七、目录结构

```
.
├── app/
│   ├── app.vue                 # 根组件：全局 SEO 模板、JSON-LD 兜底、主题初始化
│   ├── error.vue               # 404 / 500 页面
│   ├── assets/css/main.css     # Tailwind v4 + fuxsto-design 样式入口
│   ├── components/
│   │   ├── SiteHeader.vue      # 顶栏导航 + 主题切换
│   │   ├── SiteFooter.vue      # 页脚
│   │   ├── LinkButton.vue      # 链接型按钮（跳转必须用它，见 DEVELOPMENT §13.1）
│   │   └── VersionCard.vue     # 版本条目（更新日志核心组件）
│   ├── composables/
│   │   ├── useTheme.ts         # 明暗主题
│   │   ├── useFormat.ts        # 体积 / 日期 / 相对时间格式化
│   │   └── usePageSeo.ts       # 页面 SEO 统一入口（补全分享图字段）
│   ├── config/site.ts          # 站点常量：域名、关键词、导航、构建矩阵
│   └── pages/
│       ├── index.vue           # 首页
│       ├── changelog.vue       # 更新日志（自动聚合）
│       ├── download.vue        # 下载（自动适配二进制 / 源码）
│       ├── docs.vue            # 使用文档
│       ├── about.vue           # 关于
│       └── admin.vue           # 后台管理面板
├── server/
│   ├── api/                    # JSON 接口
│   │   ├── changelog.get.ts
│   │   ├── releases.get.ts
│   │   ├── repo.get.ts
│   │   ├── commits.get.ts
│   │   ├── status.get.ts       # 公开健康检查
│   │   └── admin/              # 后台接口（全部需登录）
│   │       ├── login.post.ts
│   │       ├── logout.post.ts
│   │       ├── status.get.ts
│   │       └── cache/clear.post.ts
│   └── utils/
│       ├── github.ts           # GitHub 数据层（缓存 / 去重 / 回退 / 可清理）
│       ├── changelog.ts        # 更新日志与下载项聚合
│       ├── config.ts           # TOML 配置加载与校验（容错 + 默认值）
│       └── auth.ts             # 后台认证（HMAC 签名会话 cookie）
├── public/                     # logo、favicon、og.svg / og.png、robots.txt、manifest
├── licore-site.toml            # 站点配置文件（TOML）
├── deploy/
│   ├── bootstrap.sh            # 一条命令部署的入口（curl | bash）
│   ├── deploy-latest.sh        # 拉取最新发行版
│   ├── deploy-pm2.sh           # PM2 发布（版本化+切链+重载+回滚）
│   ├── install.sh              # 服务器端一键安装脚本
│   ├── licore-website.service  # systemd 单元模板
│   └── ecosystem.config.cjs    # PM2 进程配置模板
├── .github/workflows/ci.yml    # 类型检查 + 构建 + 冒烟测试 + 鉴权断言
├── .github/workflows/release.yml  # 打 tag + 发布 Release（附构建产物）
├── nuxt.config.ts
└── package.json
```

---

## 八、运维与排查

### 健康检查

```bash
curl http://127.0.0.1:3000/api/status
```

### 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面数据不更新 | 缓存 TTL 未到（最长 30 分钟）；或上游未发布新版本。看 `/api/status` 的 `ageSeconds` |
| `/api/status` 返回 503 | 上游不可达且**无**历史缓存。检查服务器能否访问 `api.github.com` |
| 上游可达但页面很久不变 | 大概率是匿名配额耗尽（60 次/小时）。配置 `GITHUB_TOKEN` |
| sitemap 里是 `127.0.0.1` | 生产环境请设置 `NUXT_PUBLIC_SITE_URL`，并确认 Nginx 传了 `Host` 头 |
| 下载页没有二进制 | 上游确实没有 Release 资产，站点已自动回退为源码包 |
| `/admin` 登录不上 | 配置文件改了但没重启服务；或会话过期（默认 12 小时） |
| 更新后页面还是旧内容 | `current` 软链没切到新目录。`readlink /opt/licore-website/current` 确认 |

### 数据缓存时长调整

发行数据默认 **5 分钟**刷新。缓存时长**不硬编码在代码里**，
而是读 `licore-site.toml` 的 `[github]` 段：

```toml
[github]
releases = 300       # 秒
repo = 600
contributors = 1800
```

改完**重启/重载服务**生效。

本地调试想秒级刷新，用环境变量统一覆盖所有 TTL（不必改配置文件）：

```bash
GITHUB_CACHE_TTL_SECONDS=5 npm run dev
```

> 不要改 `server/utils/github.ts` 里的 `TTL` 常量 —— 它由配置驱动，
> 手改会被配置覆盖，属于无效修改。

---

## 九、内容维护

仓库提供 **[MAINTENANCE.md](./MAINTENANCE.md)** —— 一份**写给 AI 代理的操作手册**。
你只需对 AI 说一句"按 MAINTENANCE.md 同步一下上游内容"，它就会：

1. 从上游拉取 README、提交记录、tag
2. 按文档里的解析规则比对差异
3. 只改该改的位置，并跑类型检查 + 构建 + 冒烟测试
4. 如实报告改了什么、没改什么、哪些无法确认

> **版本号与下载链接不在维护范围内** —— 那部分由站点运行时自动从 GitHub 聚合，永远是最新的。

---

## 十、技术栈

| 组件 | 版本 | 用途 |
| --- | --- | --- |
| Nuxt | 4.5.x | SSR 框架 |
| Vue | 3.5.x | 视图层 |
| Nitro | 2.13.x | 服务端运行时 |
| Tailwind CSS | 4.x | 原子化样式 |
| fuxsto-design | 1.0.5 | Vue 3 组件库（单色 zinc 设计语言） |
| lucide-vue-next | 0.577.x | 图标 |
| smol-toml | 1.9.x | TOML 配置解析（零依赖） |
| @nuxtjs/sitemap | 7.x | sitemap 生成 |

---

## 十一、许可

本站为 LiCore 项目的展示站点。LiCore 本身以 **AGPL-3.0-only** 分发，
版权归 LiStudioorg 所有。
