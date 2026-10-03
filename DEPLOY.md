# 部署指南

把 LiCore 官网部署到一台 Linux 服务器。全程约 15 分钟。

站点是 **SSR 动态站点**（不是静态站），需要在服务器上常驻一个 Node 进程。

---

## 目录

1. [架构：部署后长什么样](#1-架构部署后长什么样)
2. [准备工作](#2-准备工作)
3. [方式 A：GitHub Actions 自动部署（推荐）](#3-方式-agithub-actions-自动部署推荐)
4. [方式 B：服务器上手动部署](#4-方式-b服务器上手动部署)
5. [配置 Nginx 与域名](#5-配置-nginx-与域名)
6. [验证部署](#6-验证部署)
7. [日常运维](#7-日常运维)
8. [回滚](#8-回滚)
9. [故障排查](#9-故障排查)

---

## 1. 架构：部署后长什么样

```
/opt/licore-website/
├── releases/
│   ├── 20261003-120000-abc1234/    ← 旧版本（保留，可回滚）
│   │   ├── .output/                ← Nuxt 构建产物（实际运行的代码）
│   │   ├── package.json
│   │   └── .env                    ← 该版本的环境变量（含 token，权限 600）
│   └── 20261003-130000-def5678/    ← 新版本
└── current -> releases/20261003-130000-def5678   ← 软链，指向正在跑的版本
```

部署 = 解包新版本目录 + **原子切换 current 软链** + 重启服务。
因为换软链是原子操作，不会出现"半个版本在跑"的状态。

进程结构：

```
浏览器 → Nginx (80) → Node/Nuxt (127.0.0.1:3000) → GitHub API
```

Nginx 负责域名、静态资源缓存、TLS；Node 负责 SSR 渲染与从 GitHub 拉数据。

---

## 2. 准备工作

### 服务器要求

| 项目 | 要求 |
| --- | --- |
| 系统 | 任意主流 Linux（Ubuntu 22.04+ / Debian 12+ / CentOS Stream 9+） |
| 内存 | **最低 1 GB**，建议 2 GB（构建时需要；只跑运行时 512 MB 够） |
| Node.js | **22 或更高** |
| 其他 | git、curl、nginx（可选） |

> 内存不足是最常见的失败原因。如果你打算在服务器上直接构建，**至少 2 GB**，
> 否则 npm ci / nuxt build 会被 OOM killer 杀掉。内存小就用方式 A（在 GitHub 上构建）。

### 安装 Node.js 22

```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v    # 应输出 v22.x 或更高
```

### 建议先准备一个 GitHub Token

站点每 5 分钟会向 GitHub 拉取一次版本数据。匿名配额只有 **60 次/小时**，很容易耗尽。

去 GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** →
新建，权限只需要 **Public Repositories → Contents: Read**（只读）。

拿到形如 `github_pat_xxx` 的 token 后留好，下面会用到。

> 不配也能跑：配额耗尽时页面仍能正常访问，只是实时数字会降级成占位符，不影响 SEO。

---

## 3. 方式 A：GitHub Actions 自动部署（推荐）

**优点**：在 GitHub 的机器上构建，你不占服务器内存；推送即部署；自带原子切换与回滚。

### 3.1 生成部署专用密钥

在你自己的电脑上执行（**不要**在服务器上生成后传来传去）：

```bash
ssh-keygen -t ed25519 -C "licore-website-deploy" -f ./deploy_key -N ""

# 把公钥装到服务器
ssh-copy-id -i ./deploy_key.pub 用户名@你的服务器IP

# 记录服务器指纹（防中间人）
ssh-keyscan 你的服务器IP > ./known_hosts
```

### 3.2 在服务器上初始化目录

```bash
# 用哪个用户跑服务？下面用 www-data 举例，也可以是你自己的账号
sudo mkdir -p /opt/licore-website/releases
sudo chown -R www-data:www-data /opt/licore-website
```

### 3.3 在服务器上安装 systemd 服务

把仓库里的 `deploy/` 目录传上去（或手动创建），然后：

```bash
# 如果服务器上已有仓库副本
sudo bash deploy/install.sh --app-dir /opt/licore-website --user www-data --port 3000

# 或者只手动装 unit 文件
sudo cp deploy/licore-website.service /etc/systemd/system/
sudo sed -i \
  -e 's|__APP_DIR__|/opt/licore-website|g' \
  -e "s|__NODE_BIN__|$(command -v node)|g" \
  /etc/systemd/system/licore-website.service
sudo sed -i '/^\[Service\]/a User=www-data\nGroup=www-data' /etc/systemd/system/licore-website.service
sudo systemctl daemon-reload
```

> 此时**不要** `systemctl start` —— `current` 软链还不存在，启动了必然失败。
> 等第一次部署完成后脚本会自动启动它。

### 3.4 在 GitHub 仓库配置 Secrets 和 Variables

进入仓库 **Settings → Secrets and variables → Actions**。

**Secrets 标签**（敏感信息）：

| 名称 | 值 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 用户名（如 `www-data` 或你自己的账号） |
| `DEPLOY_SSH_KEY` | 上一步 `deploy_key` 文件的**完整内容** |
| `DEPLOY_KNOWN_HOSTS` | 上一步 `known_hosts` 文件的完整内容 |
| `DEPLOY_PATH` | `/opt/licore-website` |
| `DEPLOY_PORT` | SSH 端口，默认 22，可留空 |
| `LICORE_GITHUB_TOKEN` | 第 2 步拿到的 token（强烈建议） |

**Variables 标签**（非敏感）：

| 名称 | 值 |
| --- | --- |
| `DEPLOY_ENABLED` | `true` ← **不设这个不会自动部署** |
| `NUXT_PUBLIC_SITE_URL` | `http://licore.z321.cc.cd` |
| `APP_PORT` | `3000` |

### 3.5 触发部署

推一个 commit 到 `main`，或者到 **Actions → Deploy → Run workflow** 手动触发。

部署成功后删除本地私钥：

```bash
rm -f ./deploy_key ./deploy_key.pub
```

---

## 4. 方式 B：服务器上手动部署

**适用**：不想配 CI，或想在服务器上直接跑。

```bash
# 1. 装依赖（Node 22+、git、curl）
sudo apt update && sudo apt install -y git curl

# 2. 拉代码
sudo git clone https://github.com/LiStudioorg/licore-door.git /opt/licore-website-src
cd /opt/licore-website-src

# 3. 一键安装并构建
#    --manual 会在本机执行 npm ci + npm run build 并发布第一个版本
sudo bash deploy/install.sh \
  --app-dir /opt/licore-website \
  --user "$USER" \
  --port 3000 \
  --token '你的_GITHUB_TOKEN' \
  --manual
```

`--manual` 做的事：构建 → 拷 `.output` 到 `releases/manual-<时间戳>/` → 切换 `current` →
`systemctl enable --now licore-website`。

> **注意**：手动模式部署的版本，后续被 GitHub Actions 部署覆盖是正常的
> —— Actions 会创建自己的版本目录并切换软链，旧的会按"保留最近 5 个"规则清理。

**没有 `deploy/` 目录时**（比如你只拿了构建产物），可以完全手动：

```bash
sudo mkdir -p /opt/licore-website/releases/$(date -u +%Y%m%d-%H%M%S)
# 把 .output 与 package.json 拷进去，写好 .env，切软链，再起服务
```

---

## 5. 配置 Nginx 与域名

`install.sh` 会自动配置 Nginx（检测到已安装时）。手动配置如下：

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

### 加 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d licore.z321.cc.cd
```

拿到证书后，记得把 `NUXT_PUBLIC_SITE_URL` 改成 `https://...`（否则 canonical 与
sitemap 里仍是 http），然后重启服务：

```bash
sudo sed -i 's|^NUXT_PUBLIC_SITE_URL=.*|NUXT_PUBLIC_SITE_URL=https://licore.z321.cc.cd|' \
  /opt/licore-website/current/.env
sudo systemctl restart licore-website
```

---

## 6. 验证部署

```bash
# 服务状态
systemctl status licore-website

# 实时日志
journalctl -u licore-website -f

# 本机直连（绕过 Nginx）
curl -I http://127.0.0.1:3000/
curl -s http://127.0.0.1:3000/api/status | head -c 400

# 经域名访问
curl -I http://licore.z321.cc.cd/
curl -s http://licore.z321.cc.cd/sitemap.xml | head -20
```

逐项检查清单：

- [ ] `systemctl is-active licore-website` → `active`
- [ ] 首页返回 200
- [ ] `/changelog` 能看到版本列表（如 v0.7.0）
- [ ] `/download` 有下载项
- [ ] `/sitemap.xml` 里的域名是 `http://licore.z321.cc.cd` 而不是 `127.0.0.1`
- [ ] `/api/status` 的 `upstream.reachable` 为 `true`
- [ ] 页面里 star 数、提交记录等实时数据正常显示

---

## 7. 日常运维

```bash
# 看日志
journalctl -u licore-website -n 100 --no-pager
journalctl -u licore-website -f

# 重启 / 停止
sudo systemctl restart licore-website
sudo systemctl stop licore-website

# 改环境变量（比如换 token）后需重启
sudo nano /opt/licore-website/current/.env
sudo systemctl restart licore-website
```

**看当前跑的是哪个版本**：

```bash
readlink /opt/licore-website/current
```

**看历史版本**：

```bash
ls -1t /opt/licore-website/releases/
```

**调整缓存时长**：默认发行数据 5 分钟刷新。想改的话在服务器 `.env` 里加：

```
GITHUB_CACHE_TTL_SECONDS=300
```

然后重启服务。

---

## 8. 回滚

如果新版本有问题，切回上一个版本（**秒级完成**）：

```bash
cd /opt/licore-website

# 看有哪些版本
ls -1t releases/

# 切到上一个（ls -1t 第二个）
sudo ln -sfn /opt/licore-website/releases/$(ls -1t releases/ | sed -n '2p') current

# 重启生效
sudo systemctl restart licore-website

# 确认
readlink current
curl -I http://127.0.0.1:3000/
```

> 为什么必须重启：systemd 在启动时解析 `WorkingDirectory` 软链，
> 换软链不会影响已经跑起来的进程。

---

## 9. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 服务起不来，日志报 ENOENT | `current` 软链不存在或指向空目录。先完成一次部署：`ls -l /opt/licore-website/current` |
| `EADDRINUSE: address already in use` | 端口被占。`ss -ltnp \| grep 3000` 查凶手，或换 `APP_PORT` |
| 502 Bad Gateway | Node 没跑起来。`systemctl status licore-website` + `journalctl -u licore-website -n 50` |
| 页面打开但实时数据是 `—` | GitHub 配额耗尽或网络不通。查 `curl http://127.0.0.1:3000/api/status`，配 `GITHUB_TOKEN` 解决 |
| 构建时被 Killed（OOM） | 服务器内存不足。改用方式 A 在 GitHub 上构建，或临时加 swap |
| sitemap/canonical 里是 `127.0.0.1` | `NUXT_PUBLIC_SITE_URL` 没设对。改 `.env` 后重启 |
| Actions 部署报 `Permission denied` | `DEPLOY_USER` 对 `DEPLOY_PATH` 无写权限，或密钥没装对。检查 `ssh -i deploy_key user@host` 能否登录 |
| Actions 部署报 `未找到名为 licore-website 的服务` | 服务器上没装 systemd unit，或名字不一致。见第 3.3 步 |
| Deploy workflow 被跳过 | 没有设 Variable `DEPLOY_ENABLED=true` |

**快速诊断命令**：

```bash
# 一屏看清状态
systemctl is-active licore-website; \
readlink /opt/licore-website/current; \
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/; \
curl -s http://127.0.0.1:3000/api/status | head -c 300
```

---

## 附：安全建议

- **部署密钥单独生成**，不要复用你日常的 SSH 私钥；GitHub 里删了 Secret 就等于吊销。
- **`GITHUB_TOKEN` 只给只读权限**；只用公开仓库的话不需要任何写权限。
- `.env` 权限保持 `600`，属主是运行服务的用户。
- 服务监听 `127.0.0.1`，**不要**直接暴露 3000 端口到公网，流量都走 Nginx。
- 定期 `sudo apt update && sudo apt upgrade` 更新系统与 Node。
