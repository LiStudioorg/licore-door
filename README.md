# LiCore 官网

LiCore 官方网站（[github.com/LiStudioorg/licore](https://github.com/LiStudioorg/licore)），
基于 **Nuxt 4** + **[fuxsto-design](https://npmmirror.com/package/fuxsto-design)** 构建，
是一个**服务端渲染的动态站点**，部署在服务器上运行。

站点的更新日志、版本列表与下载链接**全部由服务端实时从 GitHub 拉取并聚合**，
上游发布新版本后无需重新部署，页面刷新即可看到最新数据。

---

## 一、核心设计

### 1. 动态 SSR，不做静态生成

站点以 `ssr: true` 运行，每次请求都由 Nitro 服务端渲染。
这样做是因为版本数据是动态的 —— 静态预渲染会把数据固化在构建产物里，
上游一发新版就得重新构建部署。

### 2. 服务端数据层（`server/utils/github.ts`）

| 机制 | 说明 |
| --- | --- |
| **TTL 缓存** | **发行版 / tag / 提交均为 5 分钟**，仓库信息 10 分钟，贡献者 30 分钟 |
| **并发去重** | 同一资源的并发请求合并为一次上游调用，避免触发限流 |
| **stale-while-error** | 上游失败或限流时，回退到最近一次成功的数据，页面不会白屏 |
| **超时保护** | 单次上游请求 8 秒超时，不会拖死 SSR |
| **可选 Token** | 配置 `GITHUB_TOKEN` 后配额从 60 次/小时提升到 5000 次/小时 |

Token 只在服务端使用，**不会进入客户端产物**。

### 3. 更新日志与下载的自动适配（`server/utils/changelog.ts`）

上游仓库当前的实际情况是：**有 10 个 git tag（v0.1.0 ~ v0.7.0），
但没有任何 GitHub Release，也没有 CI 上传二进制产物。**

因此站点实现了三级自动适配，会随上游状态自动切换，**无需改代码**：

| 上游状态 | 站点行为 |
| --- | --- |
| ① 有 Release **且**有二进制资产 | 展示官方二进制直接下载链接 |
| ② 有 Release 但**无**资产 | 用 Release 正文作为更新日志，下载回退为源码包 |
| ③ **完全没有 Release**（当前状态） | 以 tag 为版本轴，用**相邻 tag 之间的提交**按 Conventional Commits 自动合成更新日志；下载提供 `codeload` 源码归档 + 编译指引 |

> 你以后只要在 GitHub 上创建 Release（或加一个上传 `dist/` 产物的 CI），
> 官网在缓存过期（**5 分钟**）后就会**自动切换成官方二进制下载**。

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

### 环境变量

在项目根目录创建 `.env`：

```bash
# 可选：提升 GitHub API 配额（强烈建议在生产环境配置）
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

# 可选：覆盖站点域名（不设置则用 app/config/site.ts 里的默认值）
NUXT_PUBLIC_SITE_URL=http://licore.z321.cc.cd

# 运行时
PORT=3000
HOST=0.0.0.0
NITRO_PORT=3000
```

> `GITHUB_TOKEN` 只需要 **public repo 只读**权限（fine-grained token 勾选
> Public Repositories 的 Contents: Read 即可）。未配置时匿名配额
> 60 次/小时。因为发行数据是 5 分钟刷新，**生产环境强烈建议配置 token**，
> 否则 60 次/小时在高频访问下会很快耗尽（耗尽时页面仍可正常访问，只是实时数据降级）。

---

## 二·补、配置文件（TOML）

除了环境变量，站点还支持一个 TOML 配置文件 **`licore-site.toml`**（仓库根目录已附带一份，
字段含义全部写在文件注释里）。

> ⚠️ 这是**官网自己**的配置，与 LiCore 引擎无关。
> LiCore 引擎的配置是 `~/.licore/config.yaml`，格式为 **YAML** —— 上游
> `AGENTS.md` 明确规定"一律 YAML，不要混用 TOML/JSON 配置文件"。
> 两者不要搞混。

**优先级**：环境变量 > `licore-site.toml` > 内置默认值。
（所以 `GITHUB_TOKEN` / `NUXT_PUBLIC_SITE_URL` 设了环境变量就会盖掉文件里的值。）

**查找顺序**（找到第一个就用）：
`LICORE_SITE_CONFIG` 环境变量指定的路径 → 进程工作目录 → 项目根目录。

**改完必须重启服务**才会生效：

```bash
sudo systemctl restart licore-website   # 或
pm2 restart licore-website
```

### 容错行为

配置文件**不会**让站点挂掉 —— 这是刻意的设计：

| 情况 | 行为 |
| --- | --- |
| 文件不存在 | 全部用内置默认值，打印一条告警 |
| TOML 语法错误 | 同上，告警里带上具体出错的行与列 |
| 字段类型不对（如 `enabled = "yes"`） | 只有该字段回退默认值，其余字段照常生效 |
| `site.url` 不是 http(s) 绝对地址 | 回退默认值（避免拼出错误的 canonical） |
| `admin.sessionHours` 为负 | 回退默认值 |

所有告警都会打印到服务日志，并在**后台面板**顶部汇总显示，方便直接定位。

---

## 二·补二、后台管理面板（`/admin`）

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
| **缓存管理** | 列出每个缓存键的年龄 / TTL / 是否新鲜，支持**单项清理**与**一键清空**，让页面立刻重新拉取上游而不用等 TTL 过期 |
| **生效配置** | 当前加载的配置文件路径、站点地址、TTL、显示开关；**不回显密码**，只告知是否仍是默认值 |

### 安全设计

- **HMAC 签名的会话 Cookie**（`HttpOnly` + `SameSite=Lax`），无服务端会话存储。
  客户端拿不到签名密钥，**无法伪造** cookie；已验证篡改签名与伪造 payload 均返回 401。
- 账号与密码都用**恒定时间比较**，避免通过响应时间猜密码；登录失败不区分"用户名错"还是"密码错"。
- `enabled = false` 时，`/admin` 与 `/api/admin/*` **一律返回 404** —— 比只关登录更彻底。
- 面板页 `noindex, nofollow`，且 `public/robots.txt` 已 `Disallow: /admin`。
- 会话密钥在进程启动时随机生成，**重启服务会让所有会话失效**（需重新登录）。
  单机小站这样做足够；要多实例共享会话得改成固定密钥。

### 后台接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/admin/login` | `{ username, password }` → 写入会话 cookie |
| `POST /api/admin/logout` | 清除会话，幂等 |
| `GET /api/admin/status` | 面板数据源（需登录） |
| `POST /api/admin/cache/clear` | `{ key? }`，不传 key 即清空全部（需登录 + `allowCacheClear`） |

---

## 三、GitHub Actions 自动化

仓库内置两个 workflow：

| 文件 | 触发时机 | 作用 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR 到 `main` | 类型检查 → 生产构建 → **启动产物做冒烟测试** → 上传产物 |
| `.github/workflows/deploy.yml` | CI 成功后 / 手动触发 | 构建并部署到服务器，**原子切换 + 健康检查 + 失败可回滚** |

### CI 做了什么

CI 不只是"能编译"，它会真的把 `.output` 跑起来并断言 12 项：

- 7 条路由（`/`、`/changelog`、`/download`、`/docs`、`/about`、`/sitemap.xml`、`/robots.txt`）必须返回 200
- 5 个 SEO 关键标签必须存在（`<title>`、`canonical`、`og:title`、`description`、JSON-LD）

> 注意：本站是 SSR 动态站点，**即使 GitHub 上游不可达，页面也会降级渲染并返回 200**。
> 所以断言 200 是合理的，而不是断言页面里必须有实时数据 —— 否则上游一限流 CI 就会红。

### 启用自动部署

部署默认是**关闭**的，避免你还没配好 Secrets 就一路报错。启用步骤：

**1. 配置 Secrets**（仓库 Settings → Secrets and variables → Actions → Secrets）

| Secret | 必需 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | ✅ | 服务器地址 |
| `DEPLOY_USER` | ✅ | SSH 用户名 |
| `DEPLOY_SSH_KEY` | ✅ | 部署用私钥（**建议单独生成一把，别用你日常的密钥**） |
| `DEPLOY_KNOWN_HOSTS` | ✅ | `ssh-keyscan your-server` 的输出，用于固定主机指纹 |
| `DEPLOY_PATH` | ✅ | 应用根目录，例如 `/opt/licore-website` |
| `DEPLOY_PORT` | ⬜ | SSH 端口，默认 22 |
| `LICORE_GITHUB_TOKEN` | ⬜ | 提升 GitHub API 配额（强烈建议），只写入服务器，不进仓库 |

**2. 配置 Variables**（同页面的 Variables 标签）

| Variable | 必需 | 说明 |
| --- | --- | --- |
| `DEPLOY_ENABLED` | ✅ | 设为 `true` 才会在 CI 成功后自动部署 |
| `NUXT_PUBLIC_SITE_URL` | ⬜ | 默认 `http://licore.z321.cc.cd` |
| `APP_PORT` | ⬜ | 应用监听端口，默认 `3000` |

**3. 在服务器上准备目录与服务**

```bash
sudo mkdir -p /opt/licore-website/releases
sudo chown -R $USER /opt/licore-website
```

然后按下面「部署到服务器」一节配置好名为 `licore-website` 的 systemd 服务或 pm2 进程
（脚本就是靠这个名字重启服务的）。

**4. 生成部署密钥**

```bash
ssh-keygen -t ed25519 -C "licore-website-deploy" -f ./deploy_key -N ""
ssh-copy-id -i ./deploy_key.pub user@your-server
# 把 deploy_key 内容贴进 DEPLOY_SSH_KEY
ssh-keyscan your-server > known_hosts   # 内容贴进 DEPLOY_KNOWN_HOSTS
rm -f ./deploy_key ./deploy_key.pub     # 贴完就删掉本地私钥
```

### 部署脚本的行为

`.github/scripts/remote-deploy.sh` 在服务器上执行，流程是：

1. 解包到 `releases/<时间戳>-<短SHA>/` —— **新版本目录，不影响正在运行的版本**
2. 写入该版本的 `.env`（含 token，权限 600）
3. `ln -sfn` **原子切换** `current` 软链
4. 重启 `licore-website` 服务（systemd 用户级/系统级 → pm2 依次尝试）
5. 健康检查最多等 30 秒，失败即判定部署失败
6. 只保留最近 5 个版本，自动清理旧的

**回滚**（一条命令，秒级）：

```bash
cd /opt/licore-website
ln -sfn releases/<上一个版本目录> current
sudo systemctl restart licore-website
```

---

## 四、部署到服务器

> 📘 **完整的部署步骤请看 [DEPLOY.md](./DEPLOY.md)** —— 包含服务器准备、
> 两种部署方式、Nginx/HTTPS 配置、验证清单、回滚与故障排查表。
> 本节的 `deploy/` 目录提供可直接使用的 systemd unit 与安装脚本。

仓库内提供了部署资产：

| 文件 | 用途 |
| --- | --- |
| `deploy/install.sh` | 服务器端一键安装：建目录、装 systemd 服务、可选首次构建、可选配 Nginx |
| `deploy/licore-website.service` | systemd 单元模板（`__APP_DIR__` / `__NODE_BIN__` 由安装脚本替换） |

### 方式一：PM2（推荐）

```bash
npm run build

# 启动
pm2 start .output/server/index.mjs --name licore-website \
  --env PORT=3000

# 或使用 ecosystem 文件
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

`ecosystem.config.cjs` 示例：

```js
module.exports = {
  apps: [{
    name: 'licore-website',
    script: '.output/server/index.mjs',
    env: {
      PORT: 3000,
      HOST: '127.0.0.1',
      NUXT_PUBLIC_SITE_URL: 'http://licore.z321.cc.cd',
      GITHUB_TOKEN: 'ghp_xxx',
    },
    max_memory_restart: '512M',
  }],
}
```

### 方式二：systemd

```ini
# /etc/systemd/system/licore-website.service
[Unit]
Description=LiCore Website (Nuxt 4)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/licore-website
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=NUXT_PUBLIC_SITE_URL=http://licore.z321.cc.cd
Environment=GITHUB_TOKEN=ghp_xxx
ExecStart=/usr/bin/node .output/server/index.mjs
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now licore-website
```

### 方式三：Docker

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/.output ./.output
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
```

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name licore.z321.cc.cd;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
    }

    # 静态资源长缓存
    location /_nuxt/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
}
```

> ⚠️ `proxy_set_header Host $host` 必须带上，否则站点生成的绝对地址会不正确。
> 如果 Nginx 与 Node 不在同一台机器，把 `127.0.0.1` 换成实际地址，
> 并给 `HOST` 设为 `0.0.0.0`。

---

## 五、SEO 实现清单

| 项目 | 实现位置 | 说明 |
| --- | --- | --- |
| `<title>` 模板 | `app/app.vue` | 子页面自动拼 `｜ LiCore`，首页用绝对标题 |
| `meta description` | 各页面 `useSeoMeta` | 每页独立撰写，且**动态包含最新版本号** |
| `canonical` | `app/app.vue` + 各页 | 指向 `http://licore.z321.cc.cd/...` |
| Open Graph | 各页 `useSeoMeta` | `og:title` / `og:description` / `og:url` / `og:image` |
| Twitter Card | 各页 `useSeoMeta` | `summary_large_image` + `/og.svg` |
| `hreflang` | `app/app.vue` | 单语言站点，声明 `zh-CN` |
| 结构化数据 | 首页 / 更新日志 / 下载 / 关于 | `SoftwareApplication`、`WebSite`、`ItemList`、`BreadcrumbList`、`TechArticle`、`AboutPage` |
| sitemap | `@nuxtjs/sitemap` | 自动包含全部 5 个页面 |
| robots.txt | `public/robots.txt` | 允许抓取，屏蔽 `/api/`，指向 sitemap |
| 语义化 HTML | 全部页面 | `header` / `nav` / `main` / `section` / `article` / `time` / `dl` |
| 无障碍 | 全部页面 | 跳转链接、`aria-label`、`aria-current`、`aria-expanded`、focus 样式 |
| 404 处理 | `app/error.vue` | 返回真实 404 状态码 + `noindex` |

> 站点域名统一在 `app/config/site.ts` 的 `site.url` 里维护。
> 换域名只需要改这一处 + 更新 `public/robots.txt` 的 Sitemap 行。

---

## 六、目录结构

```
.
├── app/
│   ├── app.vue                 # 根组件：全局 SEO 模板、主题初始化
│   ├── error.vue               # 404 / 500 页面
│   ├── assets/css/main.css     # Tailwind v4 + fuxsto-design 样式入口
│   ├── components/
│   │   ├── SiteHeader.vue      # 顶栏导航 + 主题切换
│   │   ├── SiteFooter.vue      # 页脚
│   │   └── VersionCard.vue     # 版本条目（更新日志核心组件）
│   ├── composables/
│   │   ├── useTheme.ts         # 明暗主题
│   │   └── useFormat.ts        # 体积 / 日期 / 相对时间格式化
│   ├── config/site.ts          # 站点常量：域名、关键词、导航、构建矩阵
│   └── pages/
│       ├── index.vue           # 首页
│       ├── changelog.vue       # 更新日志（自动聚合）
│       ├── download.vue        # 下载（自动适配二进制 / 源码）
│       ├── docs.vue            # 使用文档
│       ├── about.vue           # 关于
│       └── admin.vue           # 后台管理面板（登录 + 状态 + 缓存管理）
├── server/
│   ├── api/                    # JSON 接口
│   │   ├── changelog.get.ts    # GET /api/changelog?limit=5
│   │   ├── releases.get.ts     # GET /api/releases
│   │   ├── repo.get.ts         # GET /api/repo
│   │   ├── commits.get.ts      # GET /api/commits?limit=20
│   │   ├── status.get.ts       # GET /api/status（公开健康检查）
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
├── public/                     # logo、favicon、og.svg、robots.txt、manifest
├── licore-site.toml            # 站点配置文件（TOML）
├── MAINTENANCE.md              # 给 AI 代理的维护手册（内容同步工作流）
├── DEPLOY.md                   # 部署指南
├── deploy/
│   ├── install.sh              # 服务器端一键安装脚本
│   └── licore-website.service  # systemd 单元模板
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # 类型检查 + 构建 + 冒烟测试
│   │   └── deploy.yml          # 部署到服务器
│   └── scripts/
│       └── remote-deploy.sh    # 服务器端部署脚本（原子切换 + 回滚）
├── nuxt.config.ts
└── package.json
```

---

## 七、运维与排查

### 健康检查

```bash
curl http://127.0.0.1:3000/api/status
```

返回上游可达性、各缓存条目的年龄与 TTL、以及是否配置了 Token：

```json
{
  "ok": true,
  "upstream": { "reachable": true, "repo": "LiStudioorg/licore", "latencyMs": 0 },
  "tokenConfigured": false,
  "cache": { "entries": [{ "key": "releases", "ageSeconds": 6, "ttlSeconds": 600, "fresh": true }] }
}
```

### 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 页面数据不更新 | 缓存 TTL 未到（最长 30 分钟）；或上游未发布新版本。看 `/api/status` 的 `ageSeconds` |
| `/api/status` 返回 503 | 上游不可达且**无**历史缓存。检查服务器能否访问 `api.github.com` |
| 上游可达但页面很久不变 | 大概率是匿名配额耗尽（60 次/小时）。配置 `GITHUB_TOKEN` |
| sitemap 里是 `127.0.0.1` | 生产环境请设置 `NUXT_PUBLIC_SITE_URL`，并确认 Nginx 传了 `Host` 头 |
| 下载页没有二进制 | 上游确实没有 Release 资产，站点已自动回退为源码包。创建 Release 后会自动切换 |

### 数据缓存时长调整

发行数据默认 **5 分钟**刷新。改 `server/utils/github.ts` 里的 `TTL` 对象即可，
也可以直接用环境变量把所有 TTL 统一覆盖（本地调试很有用）：

```bash
# 所有资源缓存 5 秒，改动上游后立刻能看到效果
GITHUB_CACHE_TTL_SECONDS=5 npm run dev
```

页面上的"服务端缓存 N 分钟"文案、以及 API 的 `cache-control` 头
都直接读取 `TTL.releases`，改一处即全局生效，不会出现文案与配置不一致。

---

## 八、内容维护

官网的**文档类内容**（首页特性卡、文档页命令表、关于页描述）是手写的，
会随上游 [LiStudioorg/licore](https://github.com/LiStudioorg/licore) 演进变旧。

仓库提供 **[MAINTENANCE.md](./MAINTENANCE.md)** —— 一份**写给 AI 代理的操作手册**。
你只需对 AI 说一句"按 MAINTENANCE.md 同步一下上游内容"，它就会：

1. 从上游拉取 README、提交记录、tag
2. 按文档里的解析规则比对差异（特性列表 / 命令表 / 技术细节）
3. 只改该改的位置，并跑类型检查 + 构建 + 冒烟测试
4. 如实报告改了什么、没改什么、哪些无法确认

> **版本号与下载链接不在维护范围内** —— 那部分由站点运行时自动从 GitHub 聚合
> （每 5 分钟刷新），永远是最新的，不需要人工介入。

---

## 九、技术栈

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

## 十、许可

本站为 LiCore 项目的展示站点。LiCore 本身以 **AGPL-3.0-only** 分发，
版权归 LiStudioorg 所有。
