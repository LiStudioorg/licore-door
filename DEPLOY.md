# 部署指南

把 LiCore 官网部署到一台 Linux 服务器。全程约 10 分钟。

站点是 **SSR 动态站点**（不是静态站），需要在服务器上常驻一个 Node 进程。

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

拿到形如 `ghp_xxx` 或 `github_pat_xxx` 的 token 后留好，下面会用到。

> 不配也能跑：配额耗尽时页面仍能正常访问，只是实时数据会降级，不影响 SEO。

---

## 3. 方式 A：PM2 一键部署（推荐）

**优点**：一条命令完成部署、更新、回滚。不需要在服务器上构建，本地构建后传产物即可。

### 3.1 本地构建产物

```bash
# 在本地开发机上
npm ci && npm run build
# 产物在 .output/ 目录（约 6.5 MB）

# 打包（可选，方便传输）
tar -czf licore-website-build.tar.gz .output package.json
```

### 3.2 把产物传到服务器

```bash
# 把构建产物和部署脚本一起传上去
scp deploy/deploy-pm2.sh user@server:~/
scp licore-website-build.tar.gz user@server:~/
```

### 3.3 首次部署

```bash
# SSH 到服务器后
bash ~/deploy-pm2.sh --src ~/licore-website-build.tar.gz \
  --site-url https://licore.z321.cc.cd \
  --token ghp_xxxxxxxxxxxxxxxxxxxx
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

### 3.4 后续更新

```bash
# 本地重新构建 + 传产物
npm run build
tar -czf licore-website-build.tar.gz .output package.json
scp licore-website-build.tar.gz user@server:~/

# 服务器上一键更新（token 会自动沿用上次配置）
bash ~/deploy-pm2.sh --src ~/licore-website-build.tar.gz
```

### 3.5 常用参数

```bash
bash deploy-pm2.sh --src <产物> \
  --port 3000 \                    # 监听端口（默认 3000）
  --host 127.0.0.1 \               # 监听地址（默认 127.0.0.1，公网访问走 Nginx）
  --site-url https://xxx.com \     # 站点规范地址
  --token ghp_xxx \                # GitHub token（省略则沿用上次）
  --app-dir /opt/licore-website \  # 应用根目录（默认 /opt/licore-website）
  --keep 5 \                       # 保留最近几个版本（默认 5）
  --no-pm2                         # 只发布文件，不启动 PM2（预演/排障用）
```

### 3.6 PM2 管理命令

```bash
pm2 status                              # 查看进程状态
pm2 logs licore-website --lines 50      # 查看日志
pm2 reload licore-website --update-env  # 优雅重载（改配置后用）
pm2 stop licore-website                 # 停止
pm2 delete licore-website               # 删除
pm2 save                                # 保存进程列表（配合 startup 开机自启）
pm2 startup                             # 设置开机自启（按提示执行输出命令）
```

### 3.7 修改后台密码

```bash
# 编辑配置文件
nano /opt/licore-website/licore-site.toml
# 修改 [admin] 段的 password 字段

# 重载生效
pm2 reload licore-website --update-env
```

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

拿到证书后，把 `NUXT_PUBLIC_SITE_URL` 改成 `https://...`（否则 canonical 与
sitemap 里仍是 http），然后重启服务：

**PM2 方式**：
```bash
# 编辑 ecosystem 或 TOML
nano /opt/licore-website/ecosystem.config.cjs
# 修改 NUXT_PUBLIC_SITE_URL
pm2 reload licore-website --update-env
```

**systemd 方式**：
```bash
sudo sed -i 's|^NUXT_PUBLIC_SITE_URL=.*|NUXT_PUBLIC_SITE_URL=https://licore.z321.cc.cd|' \
  /opt/licore-website/current/.env
sudo systemctl restart licore-website
```

---

## 6. 验证部署

```bash
# 本机直连（绕过 Nginx）
curl -I http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/api/status | head -c 400

# 经域名访问
curl -I http://licore.z321.cc.cd/
curl -s http://licore.z321.cc.cd/sitemap.xml | head -20
```

逐项检查清单：

- [ ] 服务运行中（`pm2 status` 或 `systemctl is-active`）
- [ ] 首页返回 200
- [ ] `/changelog` 能看到版本列表
- [ ] `/download` 有下载项
- [ ] `/admin` 能登录（默认 `admin/admin`，**记得改密码**）
- [ ] `/sitemap.xml` 里的域名正确（不是 `127.0.0.1`）
- [ ] `/api/status` 的 `upstream.reachable` 为 `true`

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
