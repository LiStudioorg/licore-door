# 部署指南

把 LiCore 官网部署到一台 Linux 服务器。全程约 10 分钟。

站点是 **SSR 动态站点**（不是静态站），需要在服务器上常驻一个 Node 进程。

> 相关文档：[README.md](./README.md)（项目概览）·
> [DEVELOPMENT.md](./DEVELOPMENT.md)（开发与架构）·
> [MAINTENANCE.md](./MAINTENANCE.md)（内容维护）

---

## 目录

1. [架构：部署后长什么样](#1-架构部署后长什么样)
2. [准备工作](#2-准备工作)
3. [方式 A：PM2 一键部署（推荐）](#3-方式-apm2-一键部署推荐)
4. [方式 B：systemd 手动部署](#4-方式-bsystemd-手动部署)
5. [配置 Nginx 与域名](#5-配置-nginx-与域名)
6. [验证部署](#6-验证部署)
7. [日常运维](#7-日常运维)
8. [回滚](#8-回滚)
9. [故障排查](#9-故障排查)

---

## 1. 架构：部署后长什么样

无论哪种方式，目录结构都是版本化的：

```
/opt/licore-website/
├── releases/
│   ├── 20261003-120000-abc1234/    ← 旧版本（保留，可回滚）
│   │   ├── .output/                ← Nuxt 构建产物（实际运行的代码）
│   │   └── package.json
│   └── 20261003-130000-def5678/    ← 新版本
├── current -> releases/20261003-130000-def5678   ← 软链，指向正在跑的版本
├── licore-site.toml                ← 站点配置（全站共用一份）
└── logs/                           ← 日志（PM2 模式）
```

部署 = 解包新版本目录 + **原子切换 `current` 软链** + 重启服务。
因为换软链是原子操作，不会出现"半个版本在跑"的状态。

进程结构：

```
浏览器 → Nginx (80) → Node/Nuxt (127.0.0.1:3000) → GitHub API
```

两种运行方式的区别：

| 项目 | PM2（方式 A） | systemd（方式 B） |
| --- | --- | --- |
| 进程管理 | PM2 daemon | systemd |
| 环境变量 | `ecosystem.config.cjs`（PM2 读取） | 每个 release 目录下的 `.env`（systemd `EnvironmentFile`） |
| 更新命令 | `bash deploy-pm2.sh --src <产物>` | 手动拷产物 + 切软链 + `systemctl restart` |
| 日志 | `pm2 logs licore-website` | `journalctl -u licore-website` |
| 自动重启 | PM2 `autorestart: true` | systemd `Restart=always` |
| 内存控制 | `max_memory_restart: 512M` | 无内置限制 |

---

## 2. 准备工作

### 服务器要求

| 项目 | 要求 |
| --- | --- |
| 系统 | 任意主流 Linux（Ubuntu 22.04+ / Debian 12+ / CentOS Stream 9+） |
| 内存 | **最低 1 GB**，建议 2 GB（只跑运行时 512 MB 够） |
| Node.js | **22 或更高** |
| 其他 | git、curl、pm2（方式 A）或 nginx（可选） |

### 安装 Node.js 22

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # 应输出 v22.x 或更高
```

### 安装 PM2（方式 A 需要）

```bash
npm i -g pm2
pm2 -v    # 应输出 5.x
```

### 建议先准备一个 GitHub Token

站点每 5 分钟会向 GitHub 拉取一次版本数据。匿名配额只有 **60 次/小时**，很容易耗尽。

去 GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** →
新建，权限只需要 **Public Repositories → Contents: Read**（只读）。

拿到形如 `ghp_xxx` 或 `github_pat_xxx` 的 token 后留好，**部署完成后再填**
（见 §3.4，在后台面板里直接粘贴，不用改配置文件也不用重启）。

> 不配也能跑：配额耗尽时页面仍能正常访问，只是实时数据会降级，不影响 SEO。

---

## 3. 方式 A：PM2 一键部署（推荐）

**优点**：一条命令完成部署、更新、回滚。不需要在服务器上构建，拿到产物即可。

### 3.1 一条命令完成部署

CI 会在每次 `main` 分支校验通过后**自动构建并发行**（打 tag + 发布 Release），
产物随 Release 一起发布。服务器上跑这一条就够了：

```bash
curl -fsSL https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh | bash
```

带参数时**用环境变量传**，不要用 `bash -s --`（引号很容易出错）：

```bash
curl -fsSL https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh \
  | SITE_URL=https://licore.z321.cc.cd PORT=3000 bash
```

支持的环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SITE_URL` | `https://licore.z321.cc.cd` | 站点规范地址（**必须与线上协议一致**） |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（公网走 Nginx） |
| `APP_DIR` | `/opt/licore-website` | 应用根目录 |
| `KEEP` | `5` | 保留几个旧版本用于回滚 |
| `TAG` | 最新 | 指定发行版，如 `v1.0.1` |
| `ARGS` | 空 | 额外参数，如 `ARGS="--dry-run"` |

**更稳妥的用法**（先把脚本落盘看一眼再执行，排障也方便）：

```bash
curl -fsSL https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh -o bootstrap.sh
less bootstrap.sh
bash bootstrap.sh
```

三个脚本的分工：

```
bootstrap.sh      取脚本 + 校验 + 转交（就是上面这条命令跑的东西）
  └─ deploy-latest.sh   从 GitHub Release 下载最新产物
       └─ deploy-pm2.sh 发布：版本化目录 + 原子切软链 + PM2 重载 + 健康检查 + 失败回滚
```

脚本会落盘到 `~/.licore-deploy/`，之后可以直接复跑，不必再走 `curl`：

```bash
bash ~/.licore-deploy/deploy-latest.sh              # 更新到最新版
bash ~/.licore-deploy/deploy-latest.sh --list       # 列出发行版
bash ~/.licore-deploy/deploy-latest.sh --tag v1.0.1 # 部署指定版本
bash ~/.licore-deploy/deploy-latest.sh --dry-run    # 只下载验结构，不发布
bash ~/.licore-deploy/deploy-latest.sh --rollback   # 回滚到上一版
```

其余参数（`--port` / `--host` / `--site-url` / `--app-dir` / `--keep` / `--no-pm2`）
原样透传给 `deploy-pm2.sh`。

#### 关于鉴权

本仓库是**公开**的，下载脚本与 Release 产物都不需要任何凭据 ——
上面那条 `curl | bash` 直接就能跑。

如果将来仓库改回私有，脚本仍能工作，会按顺序自动查找凭据：

1. 环境变量 `GITHUB_TOKEN` / `GH_TOKEN`
2. `--token` 参数
3. `~/.git-credentials` 里 `github.com` 的 token
4. 已部署的 `/opt/licore-website/ecosystem.config.cjs` 里的 `GITHUB_TOKEN`

此时引导命令需要带上鉴权头：

```bash
curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh | bash
```

> 第 4 条意味着：**首次部署后，后续更新无需再提供任何凭据**。

#### 手动下载（不想用脚本时）

```bash
curl -fL -o build.tar.gz \
  https://github.com/LiStudioorg/licore-door/releases/latest/download/licore-website-build.tar.gz
bash deploy-pm2.sh --src build.tar.gz
```

也可打开仓库的 [Releases 页面](https://github.com/LiStudioorg/licore-door/releases)
手动下载，或从 Actions 页面下载 `licore-website-build` artifact。

> 如需自己在本地构建（例如改了代码但还没推送）：
> ```bash
> npm ci && npm run build
> tar -czf licore-website-build.tar.gz .output package.json \
>   deploy/deploy-pm2.sh deploy/deploy-latest.sh
> ```
> 注意包内要保留 `.output/` 顶层目录，部署脚本靠它定位产物。

### 3.2 把产物传到服务器（手动方式）

用 `deploy-latest.sh` 时**这一步不需要** —— 脚本直接在服务器上下载。
只有走纯手动流程时才需要：

```bash
scp licore-website-build.tar.gz user@server:~/
```

### 3.3 首次部署

```bash
# 推荐：一条命令
bash ~/deploy-latest.sh --site-url https://licore.z321.cc.cd

# 或手动指定产物
bash deploy-pm2.sh --src ~/licore-website-build.tar.gz \
  --site-url https://licore.z321.cc.cd
```

脚本会自动完成：
1. 检查 Node ≥ 22、PM2 已安装
2. 解压产物到 `/opt/licore-website/releases/<时间戳>/`
3. 生成 `licore-site.toml`（后台密码默认 `admin/admin`）
4. 生成 `ecosystem.config.cjs`（PM2 配置）
5. 原子切换 `current` 软链
6. 启动/重载 PM2
7. 健康检查（30 秒内必须响应）
8. 清理旧版本（默认保留 5 个）

> **GitHub Token 不用在这里传 `--token`**：部署后打开
> `https://licore.z321.cc.cd/admin` 登录，在「GitHub Token」区域直接粘贴即可，
> 立即生效且不用重启（见 §3.4）。

### 3.4 配置 GitHub Token（在后台面板里填）

部署完成后打开 `https://你的域名/admin`，用 `licore-site.toml` 里的
`[admin]` 账号密码登录，在页面顶部的 **GitHub Token** 区域粘贴 token，点「保存」。

**立即生效，不需要重启服务，也不需要改配置文件。**

token 的生效优先级（从高到低）：

| 来源 | 说明 |
| --- | --- |
| 环境变量 `GITHUB_TOKEN` / `GH_TOKEN` | 优先级最高，适合容器化部署 |
| **后台面板写入** | 存在工作目录的 `licore-runtime-token`（权限 `0600`） |
| `licore-site.toml` 的 `[github].token` | 静态配置，改完要重启 |

面板上会显示当前 token 来自哪个来源。点「清除」可删掉面板写入的 token，
回退到环境变量或 TOML。

> 想用命令行配置（不想开面板）也行，任选一种：
> ```bash
> # 方式 1：写运行时文件（和面板写入等效，立即生效）
> printf '%s\n' 'ghp_xxx' > /opt/licore-website/licore-runtime-token
> chmod 600 /opt/licore-website/licore-runtime-token
>
> # 方式 2：写进 TOML（改完要 pm2 reload）
> nano /opt/licore-website/licore-site.toml   # 填 [github].token = "ghp_xxx"
> pm2 reload licore-website --update-env
> ```
>
> `licore-runtime-token` 已在 `.gitignore` 里，不会被误提交。

### 3.5 后续更新

```bash
# 服务器上一条命令搞定（自动下载最新版 + 发布 + 健康检查）
bash ~/deploy-latest.sh
```

失败会自动回滚到上一版。想手动指定版本：

```bash
bash ~/deploy-latest.sh --tag v1.0.5
```

> 更新**不需要**再提供 GitHub 凭据 —— 脚本会复用部署时
> 写在 `ecosystem.config.cjs` 里的 token。

### 3.6 常用参数

```bash
bash deploy-pm2.sh --src <产物> \
  --port 3000 \                    # 监听端口（默认 3000）
  --host 127.0.0.1 \               # 监听地址（默认 127.0.0.1，公网访问走 Nginx）
  --site-url https://xxx.com \     # 站点规范地址
  --app-dir /opt/licore-website \  # 应用根目录（默认 /opt/licore-website）
  --keep 5 \                       # 保留最近几个版本（默认 5）
  --no-pm2                         # 只发布文件，不启动 PM2（预演/排障用）
```

> 不再推荐用 `--token` 传 GitHub token：那会写进 TOML 且需要重启。
> 用后台面板更省事（见 §3.4）。

### 3.7 PM2 管理命令

```bash
pm2 status                              # 查看进程状态
pm2 logs licore-website --lines 50      # 查看日志
pm2 reload licore-website --update-env  # 优雅重载（改配置后用）
pm2 stop licore-website                 # 停止
pm2 delete licore-website               # 删除
pm2 save                                # 保存进程列表（配合 startup 开机自启）
pm2 startup                             # 设置开机自启（按提示执行输出命令）
```

### 3.8 修改后台密码

```bash
# 编辑配置文件
nano /opt/licore-website/licore-site.toml
# 修改 [admin] 段的 password 字段

# 重载生效
pm2 reload licore-website --update-env
```

> 🔒 密码**刻意不支持在面板上改** —— 面板本身已登录，能改密码就等于
> 「会话被窃取 = 直接丢密码」，而且改完已有会话仍然有效。
> 请按上面的方式改配置文件。

### 3.9 在面板上改站点配置（无需重启）

登录 `/admin` 后，「配置编辑」卡片可以直接改 `[site]` 与 `[display]` 段的字段
（站点地址、站点名称、备案号、更新日志条目上限、首页活动流开关）。

**保存后立即生效**：服务会写回 `licore-site.toml` 并**热重载**，
不需要 `pm2 reload`，也不需要重新部署。

```bash
# 面板保存时会在同目录留一份备份，可随时手工回滚：
ls -l /opt/licore-website/licore-site.toml*
# licore-site.toml        ← 当前生效
# licore-site.toml.bak    ← 最近一次面板保存前的版本

cp /opt/licore-website/licore-site.toml.bak /opt/licore-website/licore-site.toml
pm2 reload licore-website --update-env
```

写入是**保留注释**的（只替换目标行的值），所以文件里那些说明文字不会丢。
想要只读面板，把 `[admin]` 段设成 `allowConfigEdit = false` 即可。

> ✅ **面板里改的值不会被后续部署覆盖**：`deploy-pm2.sh` 发现
> `licore-site.toml` 已存在时会**原样保留**，只在首次部署时生成一份。
> 只有你自己手工覆盖文件才会丢。另外改 `site.url` 时记得 `nginx` 的
> `server_name` 与 `NUXT_PUBLIC_SITE_URL`（若设了，优先级更高）也要同步。

---

## 4. 方式 B：systemd 手动部署

适用于不想用 PM2、偏好 systemd 的场景，或者需要更精细的进程控制。

### 4.1 安装 systemd 服务

```bash
# 在服务器上准备目录
sudo mkdir -p /opt/licore-website/releases
sudo chown -R www-data:www-data /opt/licore-website

# 把仓库里的 deploy/ 目录传上去
scp -r deploy/ user@server:~/

# 安装 systemd 服务
sudo bash deploy/install.sh \
  --app-dir /opt/licore-website \
  --user www-data \
  --port 3000 \
  --token '你的_GITHUB_TOKEN' \
  --manual
```

`--manual` 会在服务器上执行 `npm ci + npm run build` 并发布第一个版本。

### 4.2 后续更新

```bash
# 1. 本地构建
npm ci && npm run build

# 2. 发布成新版本
RELEASE=/opt/licore-website/releases/$(date -u +%Y%m%d-%H%M%S)
sudo mkdir -p "$RELEASE"
sudo rsync -av .output/ package.json "$RELEASE/"

# 3. 写该版本的环境变量
sudo tee "$RELEASE/.env" > /dev/null <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
NUXT_PUBLIC_SITE_URL=https://licore.z321.cc.cd
LICORE_SITE_CONFIG=/opt/licore-website/licore-site.toml
GITHUB_TOKEN=你的_GITHUB_TOKEN
EOF
sudo chmod 600 "$RELEASE/.env"

# 4. 原子切换并重启
sudo ln -sfn "$RELEASE" /opt/licore-website/current
sudo systemctl restart licore-website

# 5. 验证
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

### 4.3 systemd 管理命令

```bash
systemctl status licore-website              # 查看状态
journalctl -u licore-website -f              # 实时日志
journalctl -u licore-website -n 100 --no-pager  # 最近 100 行
sudo systemctl restart licore-website        # 重启
sudo systemctl stop licore-website           # 停止
readlink /opt/licore-website/current         # 当前版本
ls -1t /opt/licore-website/releases/         # 历史版本
```

---

## 5. 配置 Nginx 与域名

两种方式都需要配 Nginx 做反向代理（除非你想直接暴露 3000 端口，不推荐）。

### 5.1 手动配置

```bash
sudo tee /etc/nginx/sites-available/licore-website > /dev/null <<'EOF'
server {
    listen 80;
    server_name licore.z321.cc.cd;

    location /_nuxt/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

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
}
EOF

sudo ln -sfn /etc/nginx/sites-available/licore-website /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> ⚠️ `proxy_set_header Host $host;` **必须保留**，否则站点生成的绝对地址会出错。

### 5.2 加 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d licore.z321.cc.cd
```

> 🔴 **启用 HTTPS 后必须把站点协议改成 https，这一步不能省。**
>
> 站点若经 CDN / Nginx 把 `http://` 301 到 `https://`，而配置里仍写着 `http://`，
> 那么**每个页面**的 canonical、`og:url`、sitemap 的 `<loc>` 都会声明
> "正版是 http 版"，而爬虫实际抓到的是 https 版 —— 索引信号被劈成两半，
> 抓取配额还会被 301 白白消耗（`og:image` 走 http 还可能让社交卡片静默退化）。
>
> 域名在**五处**定义，改的时候**五处一起改**（漏一处就前功尽弃）：
>
> | 位置 | 说明 |
> | --- | --- |
> | 环境变量 `NUXT_PUBLIC_SITE_URL` | 优先级最高，生产环境多由此覆盖 |
> | **`.github/workflows/ci.yml` 与 `release.yml` 的 `NUXT_PUBLIC_SITE_URL` 兜底值** | **构建期覆盖源码**；写错会让发出去的包永远是旧协议（见下） |
> | `licore-site.toml` 的 `[site].url` | 面板上也能改，保存即生效 |
> | `app/config/site.ts` 的 `site.url` | 构建期默认值（需重新构建才生效） |
> | `public/robots.txt` 的 Sitemap 行 | **静态文件**，改配置不会自动更新它 |
>
> ⚠️ **最容易漏的是 workflow 里那个兜底值**。它是
> `${{ vars.NUXT_PUBLIC_SITE_URL || 'http://…' }}` 的形式：仓库变量没设置时
> 就用引号里那个字符串，**把 http 烘焙进产物、覆盖掉源码里的 https**。
> 现象极隐蔽：源码全仓搜不到 `http://`、CI 全绿、页面 200 正常，
> 只有解开 Release 产物才看得到 `"siteUrl": "http://…"`。
> 因此**改完必须验产物，不能只验源码**：
>
> ```bash
> grep -rn 'http://licore\.z321\.cc\.cd' .output/public/ .output/server/ \
>   && echo "产物里有残留，检查 workflow 的兜底值" || echo "产物干净"
> ```

**PM2 方式**：
```bash
# 编辑 ecosystem 或 TOML
nano /opt/licore-website/ecosystem.config.cjs
# 修改 NUXT_PUBLIC_SITE_URL 为 https://licore.z321.cc.cd
pm2 reload licore-website --update-env
```

**systemd 方式**：
```bash
sudo sed -i 's|^NUXT_PUBLIC_SITE_URL=.*|NUXT_PUBLIC_SITE_URL=https://licore.z321.cc.cd|' \
  /opt/licore-website/current/.env
sudo systemctl restart licore-website
```

**别忘了手改 `robots.txt`**（它不受环境变量影响）：

```bash
# 在部署根目录（如 /opt/licore-website/current/.output/public/robots.txt）
sudo sed -i 's|^Sitemap: http://|Sitemap: https://|' \
  /opt/licore-website/current/.output/public/robots.txt
```

**改完必须验证**（四类输出都应为 `https://`）：

```bash
B=https://licore.z321.cc.cd
curl -s $B/            | grep -oE 'rel="canonical" href="[^"]*"'
curl -s $B/            | grep -oE 'property="og:(url|image)"[^>]*'
curl -s $B/sitemap.xml | grep -oE '<loc>[^<]*</loc>' | head -3
curl -s $B/robots.txt  | grep -i sitemap
```

> 出现任何一处 `http://` 都说明上面四处没改全。

---

## 6. 验证部署

```bash
# 本机直连（绕过 Nginx）
curl -I http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/api/status | head -c 400

# 经域名访问（生产走 HTTPS；裸 http 会被 CDN 301 到 https）
curl -I https://licore.z321.cc.cd/
curl -s https://licore.z321.cc.cd/sitemap.xml | head -20
```

逐项检查清单：

- [ ] 服务运行中（`pm2 status` 或 `systemctl is-active`）
- [ ] 首页返回 200
- [ ] `/changelog` 能看到版本列表
- [ ] `/download` 有下载项
- [ ] `/admin` 能登录（默认 `admin/admin`，**记得改密码**）
- [ ] `/sitemap.xml` 里的域名正确（不是 `127.0.0.1`）
- [ ] **canonical / `og:url` / sitemap 的协议与线上一致**（站点跑 HTTPS 就不能是 `http://`，
      否则爬虫抓到的 https 页面读到的 canonical 指向 http，索引信号会被劈成两半）
- [ ] `/api/status` 的 `upstream.reachable` 为 `true`
- [ ] `/og.png` 能打开（分享图，`content-type: image/png`）
- [ ] `/BingSiteAuth.xml` 能打开（Bing 验证文件）

### 搜索引擎收录检查

部署后确认这两个文件可公开访问（搜索引擎按固定路径读取，**被 Nginx
或 robots.txt 挡住会导致验证失败**）：

```bash
curl -s -o /dev/null -w 'og.png: %{http_code} %{content_type}\n' \
  https://licore.z321.cc.cd/og.png
curl -s https://licore.z321.cc.cd/BingSiteAuth.xml
```

`BingSiteAuth.xml` 应输出一段含验证码的 XML。两者都在 `public/` 下，
构建时原样拷进产物根目录，**无需额外配置 Nginx 规则**。

> Nginx 配置里的 `location /_nuxt/` 长缓存规则不会影响这两个文件 ——
> 它们走 `location /` 的默认分支。

---

## 7. 日常运维

### PM2 方式

```bash
pm2 status                              # 进程状态
pm2 logs licore-website --lines 50      # 最近日志
pm2 reload licore-website --update-env  # 改配置后重载
pm2 restart licore-website              # 硬重启
```

**修改配置后重载**：
```bash
# 修改 TOML 或 ecosystem
nano /opt/licore-website/licore-site.toml
nano /opt/licore-website/ecosystem.config.cjs

# 重载（不需要重新部署）
pm2 reload licore-website --update-env
```

> 💡 如果只是改 `[site]` / `[display]` 段（站点地址、名称、备案号、展示开关），
> 更省事的做法是直接在 `/admin` 面板的「配置编辑」里改 —— 保存即生效，
> **不用重载**（见 §3.9）。手改文件仍需要重载才能生效。

**看当前跑的是哪个版本**：
```bash
readlink /opt/licore-website/current
```

### systemd 方式

```bash
systemctl status licore-website
journalctl -u licore-website -n 100 --no-pager
journalctl -u licore-website -f
sudo systemctl restart licore-website

# 改环境变量（比如换 token）后需重启
sudo nano /opt/licore-website/current/.env
sudo systemctl restart licore-website
```

### 两种方式通用

**看历史版本**：
```bash
ls -1t /opt/licore-website/releases/
```

**调整缓存时长**：默认发行数据 5 分钟刷新。改 `licore-site.toml` 的
`[github]` 段，或用环境变量：

```bash
# PM2: 在 ecosystem.config.cjs 的 env 里加
# systemd: 在 .env 里加
GITHUB_CACHE_TTL_SECONDS=300
```

然后重载/重启服务。

---

## 8. 回滚

如果新版本有问题，切回上一个版本（**秒级完成**）：

```bash
# PM2 方式：一条命令（自动切软链 + 重载 + 健康检查）
bash ~/deploy-latest.sh --rollback
```

手动操作（任何方式都适用）：

```bash
cd /opt/licore-website

# 看有哪些版本（按时间倒序）
ls -1t releases/

# 切到上一个版本
sudo ln -sfn /opt/licore-website/releases/$(ls -1t releases/ | sed -n '2p') current

# 重启生效
# PM2 方式
pm2 reload licore-website --update-env

# systemd 方式
sudo systemctl restart licore-website

# 确认
readlink current
curl -I http://127.0.0.1:3000/
```

> 为什么必须重启/重载：systemd 和 PM2 都在启动时解析 `WorkingDirectory` 软链，
> 换软链不会影响已经跑起来的进程。

**PM2 方式还有自动回滚**：`deploy-pm2.sh` 在健康检查失败时会**自动切回上一版**，
不需要手动操作。

---

## 9. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 服务起不来，日志报 ENOENT | `current` 软链不存在或指向空目录。`ls -l /opt/licore-website/current` |
| `EADDRINUSE: address already in use` | 端口被占。`ss -ltnp \| grep 3000` 查凶手，或换 `--port` |
| 502 Bad Gateway | Node 没跑起来。`pm2 status` 或 `systemctl status` + 查日志 |
| 页面打开但实时数据是 `—` | GitHub 配额耗尽或网络不通。`curl http://127.0.0.1:3000/api/status` |
| 构建时被 Killed（OOM） | 服务器内存不足。在本地构建后只传 `.output` 产物 |
| sitemap/canonical 里是 `127.0.0.1` | `NUXT_PUBLIC_SITE_URL` 没设对 |
| 站点是 HTTPS，但 canonical / og:url / sitemap 里是 `http://` | 协议没跟着改。**五处**一起改：`NUXT_PUBLIC_SITE_URL`、**两个 workflow 的兜底值**、`licore-site.toml`、`app/config/site.ts`、`public/robots.txt`（见 §5.2）。**若源码已改对但仍不对，一定是 workflow 兜底值**——它会在构建期覆盖源码，验产物：`grep -rn 'http://<域名>' .output/`。这是**索引信号被劈成两半**的严重问题，务必修 |
| `sitemap.xml` 的 `lastmod` 每次抓取都变 | 曾用 `autoLastmod: true`（打当前时间，会被搜索引擎忽略）。现由 `/api/sitemap-urls` 提供真实 `pushed_at`；若仍异常，检查该接口能否取到上游数据 |
| `/admin` 登录不上 | 配置文件改了但没重启；或会话过期（默认 12 小时） |
| 更新后页面还是旧内容 | `current` 软链没切到新目录。`readlink /opt/licore-website/current` |
| PM2 进程反复重启 | 看 `pm2 logs licore-website --lines 100` 找崩溃原因 |

**快速诊断命令**：

```bash
# 一屏看清状态（PM2）
pm2 status; \
readlink /opt/licore-website/current; \
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/; \
curl -s http://127.0.0.1:3000/api/status | head -c 300

# 一屏看清状态（systemd）
systemctl is-active licore-website; \
readlink /opt/licore-website/current; \
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/; \
curl -s http://127.0.0.1:3000/api/status | head -c 300
```

---

## 附：安全建议

- **`/admin` 的默认密码 `admin` 必须改掉**（`licore-site.toml` 的 `[admin].password`，改完重载/重启服务）。配置文件按需求是明文存密码的，务必 `chmod 600` 且不要把真实密码提交到公开仓库。
- **`GITHUB_TOKEN` 只给只读权限**；只用公开仓库的话不需要任何写权限。
- `.env`（systemd 方式）权限保持 `600`，属主是运行服务的用户。
- `ecosystem.config.cjs`（PM2 方式）权限保持 `600`。
- 服务监听 `127.0.0.1`，**不要**直接暴露 3000 端口到公网，流量都走 Nginx。
- 站点启用 HTTPS 后，后台会话 cookie 会自动带上 `Secure` 属性，运输层更安全。
- 定期 `sudo apt update && sudo apt upgrade` 更新系统与 Node。
