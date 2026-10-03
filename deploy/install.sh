#!/usr/bin/env bash
#
# LiCore 官网服务器端一键安装脚本。
#
# 作用：创建目录结构、生成并安装 systemd 服务、引导你填入环境变量。
# 不会自动拉代码 —— 本仓库没有自动部署工作流，更新代码请看 DEPLOY.md 第 4 节，
# 或首次安装时直接用 --manual 在本机构建（见 usage）。
#
#   sudo bash deploy/install.sh
#   sudo bash deploy/install.sh --app-dir /opt/licore-website --port 3000 --user www-data
#
set -euo pipefail

APP_DIR="/opt/licore-website"
APP_PORT="3000"
RUN_USER="$(id -un)"
SITE_URL="http://licore.z321.cc.cd"
DOMAIN="licore.z321.cc.cd"
NODE_BIN="$(command -v node || true)"
SKIP_NGINX=0
MANUAL=0
GITHUB_TOKEN_VALUE=""

usage() {
  cat <<'USAGE'
用法：sudo bash deploy/install.sh [选项]

选项：
  --app-dir <路径>     应用根目录（默认 /opt/licore-website）
  --port <端口>        应用监听端口（默认 3000）
  --user <用户名>      运行服务的系统用户（默认当前用户）
  --site-url <URL>     站点规范地址（默认 http://licore.z321.cc.cd）
  --domain <域名>      配置 Nginx 用的域名
  --token <TOKEN>      GitHub token，写入 .env 提升 API 配额（可选）
  --skip-nginx         不配置 Nginx
  --manual             同时做一次本地构建，便于这台机器立刻跑起来
  -h, --help           显示本帮助
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir)  APP_DIR="$2"; shift 2 ;;
    --port)     APP_PORT="$2"; shift 2 ;;
    --user)     RUN_USER="$2"; shift 2 ;;
    --site-url) SITE_URL="$2"; shift 2 ;;
    --domain)   DOMAIN="$2"; shift 2 ;;
    --token)    GITHUB_TOKEN_VALUE="$2"; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --manual)   MANUAL=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请以 root 运行：sudo bash deploy/install.sh" >&2
  exit 1
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "未找到 node。请先安装 Node.js 22 或更高版本。" >&2
  echo "建议：curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js 版本过低（当前 v${NODE_MAJOR}），本项目要求 >= 22。" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "──────────────────────────────────────────"
echo " 应用目录 : $APP_DIR"
echo " 监听端口 : $APP_PORT"
echo " 运行用户 : $RUN_USER"
echo " 站点地址 : $SITE_URL"
echo " Node     : $NODE_BIN (v$( "$NODE_BIN" -p 'process.versions.node'))"
echo "──────────────────────────────────────────"

# 1. 目录结构：releases/ 放各版本，current 软链指向正在运行的版本
install -d -o "$RUN_USER" -g "$RUN_USER" -m 755 "$APP_DIR"
install -d -o "$RUN_USER" -g "$RUN_USER" -m 755 "$APP_DIR/releases"

# 2. 环境变量文件。
#    systemd 的 EnvironmentFile 读取版本目录内的 .env；这里在 $APP_DIR/.env
#    维护一份模板，--manual 首次部署时复制进版本目录。
#    后续手动更新版本（DEPLOY.md 第 4 节）时，请从这份模板重新生成版本级 .env。
if [[ -n "$GITHUB_TOKEN_VALUE" ]]; then
  TOKEN_LINE="GITHUB_TOKEN=$GITHUB_TOKEN_VALUE"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  TOKEN_LINE="GITHUB_TOKEN=$GITHUB_TOKEN"
else
  TOKEN_LINE="GITHUB_TOKEN="
fi

# 2.5 站点配置文件（TOML）。所有版本共用 $APP_DIR/licore-site.toml 这一份，
#     通过 LICORE_SITE_CONFIG 指过去 —— 改配置、重启服务即生效，
#     不用跟着 releases/ 目录一份份复制。
#     ⚠ 文件里含后台面板密码（按需求为明文），权限必须 600。
CONFIG_DST="$APP_DIR/licore-site.toml"
CONFIG_SRC="$REPO_ROOT/licore-site.toml"
if [[ ! -f "$CONFIG_DST" ]]; then
  if [[ -f "$CONFIG_SRC" ]]; then
    cp "$CONFIG_SRC" "$CONFIG_DST"
  else
    # 源码里也没有：写一个空壳，让站点用内置默认值，运维后续自行填写
    printf '# LiCore 官网配置（本文件由 install.sh 生成骨架）\n# 完整字段说明见仓库里的 licore-site.toml\n' > "$CONFIG_DST"
  fi
  echo "已准备站点配置：$CONFIG_DST（含后台密码，已设 600；部署后请改掉 [admin] 默认密码）"
fi
chown "$RUN_USER:$RUN_USER" "$CONFIG_DST"
chmod 600 "$CONFIG_DST"

cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=$APP_PORT
HOST=127.0.0.1
NUXT_PUBLIC_SITE_URL=$SITE_URL
LICORE_SITE_CONFIG=$CONFIG_DST
$TOKEN_LINE
EOF
chown "$RUN_USER:$RUN_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

# 3. 安装 systemd 服务（替换占位符）
UNIT_SRC="$REPO_ROOT/deploy/licore-website.service"
if [[ ! -f "$UNIT_SRC" ]]; then
  echo "找不到单元文件：$UNIT_SRC" >&2
  exit 1
fi
UNIT_DST="/etc/systemd/system/licore-website.service"
sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    "$UNIT_SRC" > "$UNIT_DST"

# 补上运行用户（单元模板里没写死，交给安装脚本决定）
if ! grep -q '^User=' "$UNIT_DST"; then
  sed -i "/^\[Service\]/a User=$RUN_USER\nGroup=$RUN_USER" "$UNIT_DST"
fi

systemctl daemon-reload
echo "已安装 systemd 服务：$UNIT_DST"

# 4. 可选：本地首次构建，让服务立刻能跑起来
if [[ "$MANUAL" -eq 1 ]]; then
  echo
  echo "▶ 执行本地首次构建（--manual）"
  if [[ ! -f "$REPO_ROOT/package.json" ]]; then
    echo "当前目录不是项目根目录，跳过构建。" >&2
  else
    RELEASE_ID="manual-$(date -u +%Y%m%d-%H%M%S)"
    TARGET="$APP_DIR/releases/$RELEASE_ID"
    install -d -o "$RUN_USER" -g "$RUN_USER" -m 755 "$TARGET"

    echo "  构建中（这一步较慢，请耐心等待）…"
    (
      cd "$REPO_ROOT"
      npm ci --no-audit --no-fund
      NUXT_PUBLIC_SITE_URL="$SITE_URL" npm run build
    )

    cp -r "$REPO_ROOT/.output" "$TARGET/"
    cp "$REPO_ROOT/package.json" "$TARGET/"
    cp "$APP_DIR/.env" "$TARGET/.env"
    chown -R "$RUN_USER:$RUN_USER" "$TARGET"
    chmod 600 "$TARGET/.env"

    ln -sfn "$TARGET" "$APP_DIR/current"
    chown -h "$RUN_USER:$RUN_USER" "$APP_DIR/current"
    echo "  已发布：$TARGET"
  fi
fi

# 5. 若还没有 current 软链，提示用户
if [[ ! -e "$APP_DIR/current" ]]; then
  echo
  echo "⚠ $APP_DIR/current 尚不存在。两种方式二选一："
  echo "   a) 在本项目目录执行：sudo bash deploy/install.sh --manual"
  echo "   b) 按 DEPLOY.md 第 4 节手动发布一个版本（构建 + 切软链）。"
  echo "  在 current 就位之前，服务启动会失败（这是预期行为）。"
else
  systemctl enable --now licore-website
  sleep 2
  if systemctl is-active --quiet licore-website; then
    echo "✓ 服务已启动"
  else
    echo "✗ 服务未启动，查看日志：journalctl -u licore-website -n 50 --no-pager" >&2
  fi
fi

# 6. 可选：配置 Nginx 反代
if [[ "$SKIP_NGINX" -eq 0 ]] && command -v nginx >/dev/null 2>&1; then
  NGINX_CONF="/etc/nginx/sites-available/licore-website"
  cat > "$NGINX_CONF" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    # 静态资源长缓存
    location /_nuxt/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
    }
}
EOF
  ln -sfn "$NGINX_CONF" /etc/nginx/sites-enabled/licore-website
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "✓ Nginx 已配置并重载（$DOMAIN → 127.0.0.1:$APP_PORT）"
  else
    echo "✗ Nginx 配置校验失败，请手动检查：nginx -t" >&2
  fi
elif [[ "$SKIP_NGINX" -eq 0 ]]; then
  echo "未检测到 Nginx，跳过反代配置。"
fi

cat <<EOF

════════════════════ 安装完成 ════════════════════
下一步：
  1. 确认 $APP_DIR/current 已就位（见上方提示）
  2. systemctl status licore-website
  3. journalctl -u licore-website -f        # 看日志
  4. curl -I http://127.0.0.1:$APP_PORT/    # 本机自测

⚠ 请立即修改站点配置 $CONFIG_DST 里的 [admin].password（默认 admin），
  改完执行 systemctl restart licore-website 生效。
  站点配置由 LICORE_SITE_CONFIG 指向该文件，全站共用这一份。

更新版本：本仓库没有自动部署，按 DEPLOY.md 第 4 节手动构建并发布新版本。

回滚：cd $APP_DIR && ln -sfn releases/<上一个版本> current && systemctl restart licore-website
═════════════════════════════════════════════════
EOF
