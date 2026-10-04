#!/usr/bin/env bash
# ============================================================
# LiCore 官网 · PM2 一键部署/更新脚本（在服务器上用）
#
# --src 接受四种输入：
#   1. CI 下载的 zip（licore-website-build.zip）
#   2. tar.gz 归档
#   3. 解压后的目录（里面有 .output/）
#   4. 直接指向 .output 目录
#
# 首次部署与后续更新是同一条命令：版本化发布 + 原子切软链 +
# pm2 startOrReload + 健康检查，失败自动回滚上一版。
#
# 用法示例：
#   bash deploy-pm2.sh --src ./licore-website-build.zip
#   bash deploy-pm2.sh --src .output --port 3000 \
#       --site-url https://licore.z321.cc.cd --token ghp_xxx
#   bash deploy-pm2.sh --src ./build --no-pm2      # 只发布文件，不启动
# ============================================================
set -euo pipefail

# ---------- 默认值（全部可用参数覆盖） ----------
APP_DIR="/opt/licore-website"
APP_NAME="licore-website"
PORT="3000"
HOST_BIND="127.0.0.1"                # 只监听本机；公网访问请走 Nginx。直接暴露传 0.0.0.0
SITE_URL="http://licore.z321.cc.cd"
TOKEN=""
KEEP=5
NO_PM2=0
SRC=""
TMP=""

usage() {
  cat <<'USAGE'
用法：bash deploy-pm2.sh --src <产物> [选项]

  --src <路径>      产物：zip / tar.gz / 含 .output 的目录 / .output 本身（必填）
  --port <端口>     应用监听端口，默认 3000
  --host <地址>     监听地址，默认 127.0.0.1（公网访问请配 Nginx 反代）
  --site-url <URL>  站点规范地址，默认 http://licore.z321.cc.cd
  --token <TOKEN>   GitHub token（可选，提升 API 配额；省略则沿用上次的配置）
  --app-dir <路径>  应用根目录，默认 /opt/licore-website
  --keep <N>        保留最近几个版本用于回滚，默认 5
  --no-pm2          只发布文件、不启动 pm2（预演/排障用）
USAGE
}

# ---------- 参数解析 ----------
# 注意：用 ${2:?提示} 而不是 $2，避免 set -u 下漏传值时崩成 "unbound variable"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --src)      SRC="${2:?--src 需要一个路径参数}"; shift 2 ;;
    --port)     PORT="${2:?--port 需要一个端口号}"; shift 2 ;;
    --host)     HOST_BIND="${2:?--host 需要一个地址}"; shift 2 ;;
    --site-url) SITE_URL="${2:?--site-url 需要一个 URL}"; shift 2 ;;
    --token)    TOKEN="${2:?--token 需要一个 token}"; shift 2 ;;
    --app-dir)  APP_DIR="${2:?--app-dir 需要一个路径}"; shift 2 ;;
    --keep)     KEEP="${2:?--keep 需要一个数字}"; shift 2 ;;
    --no-pm2)   NO_PM2=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 1 ;;
  esac
done

# ---------- 参数校验（所有会写进 JS/TOML 的值先过一遍） ----------
[[ -n "$SRC" ]] || { usage >&2; echo "缺少必填参数 --src" >&2; exit 1; }
[[ -e "$SRC" ]] || { echo "❌ 产物不存在：$SRC" >&2; exit 1; }

[[ "$PORT" =~ ^[0-9]+$ ]] && [[ "$PORT" -ge 1 ]] && [[ "$PORT" -le 65535 ]] \
  || { echo "❌ 端口非法：$PORT" >&2; exit 1; }
[[ "$KEEP" =~ ^[0-9]+$ ]] && [[ "$KEEP" -ge 1 ]] \
  || { echo "❌ 保留版本数非法：$KEEP" >&2; exit 1; }

# 监听地址必须是 IP 或主机名（不能含单引号，会破坏 ecosystem 配置）
[[ "$HOST_BIND" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || \
[[ "$HOST_BIND" =~ ^[a-zA-Z0-9_.-]+$ ]] \
  || { echo "❌ 监听地址非法：$HOST_BIND" >&2; exit 1; }

# site-url / token 不能含单引号（ecosystem 用单引号包字符串）
[[ "$SITE_URL" != *"'"* ]] || { echo "❌ site-url 里不能包含单引号" >&2; exit 1; }
[[ "$TOKEN"    != *"'"* ]] || { echo "❌ token 里不能包含单引号" >&2; exit 1; }

say()  { echo "  - $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

trap '[[ -n "$TMP" ]] && rm -rf "$TMP"' EXIT

# ---------- 1. 环境检查 ----------
echo "▶ 环境检查"
command -v node >/dev/null || fail "未找到 node，先装 Node 22+：curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || fail "Node 版本过低（v${NODE_MAJOR}），需要 22+"
say "Node $(node -v)"

if [[ "$NO_PM2" -eq 0 ]]; then
  command -v pm2 >/dev/null || fail "未找到 pm2，请执行：npm i -g pm2"
  say "PM2 $(pm2 -v)"
fi

# ---------- 2. 定位产物 ----------
echo "▶ 定位产物：$SRC"
case "$SRC" in
  *.zip)
    command -v unzip >/dev/null || fail "缺少 unzip，请先解压再传入目录"
    TMP="$(mktemp -d)"; unzip -q "$SRC" -d "$TMP"
    SRC="$TMP"
    ;;
  *.tar.gz|*.tgz)
    command -v tar >/dev/null || fail "缺少 tar"
    TMP="$(mktemp -d)"; tar -xzf "$SRC" -C "$TMP"
    SRC="$TMP"
    ;;
esac

# 兼容四种产物结构：
#   a. <root>/.output/...           → OUT_DIR=$SRC/.output
#   b. <root>/server/index.mjs       → OUT_DIR=$SRC
#   c. <root>/<nested>/.output/...   → OUT_DIR=$SRC/<nested>/.output
#   d. <root>/<nested>/server/...    → OUT_DIR=$SRC/<nested>
locate_output() {
  if [[ -f "$1/.output/server/index.mjs" ]]; then
    OUT_DIR="$1/.output"; PKG="$1/package.json"
  elif [[ -f "$1/server/index.mjs" ]]; then
    OUT_DIR="$1"; PKG="$(dirname "$1")/package.json"
  else
    # 解压后可能多套了一层目录（CI zip 常见：licore-website-build/.output/...）
    FOUND=""
    for d in "$1"/*/; do
      [[ -f "${d}.output/server/index.mjs" ]] && FOUND="${d%/}" && break
      [[ -f "${d}server/index.mjs" ]] && FOUND="${d%/}" && break
    done
    if [[ -n "$FOUND" ]]; then
      say "产物嵌套在：${FOUND}（已自动进入）"
      locate_output "$FOUND"
      return $?
    fi
    return 1
  fi
  return 0
}
if ! locate_output "$SRC"; then
  fail "在 $SRC 下找不到 .output/server/index.mjs（请把 zip/tar 解压后再传）"
fi
say "产物：$OUT_DIR"

# ---------- 3. 准备应用目录 ----------
echo "▶ 准备应用目录：$APP_DIR"
if [[ -e "$APP_DIR" && ! -d "$APP_DIR" ]]; then
  fail "$APP_DIR 已存在但不是目录（可能是文件），换一个路径或先删除它"
fi
if ! mkdir -p "$APP_DIR/releases" 2>/dev/null; then
  if command -v sudo >/dev/null; then
    sudo mkdir -p "$APP_DIR/releases"
    sudo chown -R "$(id -un):$(id -gn)" "$APP_DIR"
    say "已用 sudo 创建 $APP_DIR/releases 并移交所有权给 $(id -un)"
  else
    fail "无法创建 $APP_DIR/releases：请用 root 运行，或换 --app-dir 到你有写权限的目录"
  fi
fi

RELEASE_ID="$(date -u +%Y%m%d-%H%M%S)-$RANDOM"
TARGET="$APP_DIR/releases/$RELEASE_ID"
# 防御性：万一 RELEASE_ID 撞了（同秒+同 RANDOM），先清掉残留
rm -rf "$TARGET" 2>/dev/null || true
mkdir -p "$TARGET"
cp -a "$OUT_DIR" "$TARGET/.output"
if [[ -f "$PKG" ]]; then
  cp "$PKG" "$TARGET/package.json"
fi
say "新版本：$RELEASE_ID"

# ---------- 4. 站点配置（全站共用一份，不随版本走） ----------
CONFIG="$APP_DIR/licore-site.toml"
if [[ -f "$CONFIG" ]]; then
  say "站点配置已存在，保留：$CONFIG"
else
  cat > "$CONFIG" <<TOML
# LiCore 官网配置（由 deploy-pm2.sh 生成）
[site]
url = "$SITE_URL"
name = "LiCore"
icp = ""

[admin]
enabled = true
username = "admin"
password = "admin"        # ← 首次部署后请立即修改！
sessionHours = 12
allowCacheClear = true
TOML
  chmod 600 "$CONFIG"
  say "已生成站点配置：$CONFIG"
fi

# ---------- 5. 生成 PM2 进程配置 ----------
# 沿用上次填过的 token，避免更新时被迫重复填写
if [[ -z "$TOKEN" && -f "$APP_DIR/ecosystem.config.cjs" ]]; then
  TOKEN="$(sed -nE "s/.*GITHUB_TOKEN *: *'([^']*)'.*/\1/p" "$APP_DIR/ecosystem.config.cjs" | head -1)"
  if [[ -n "$TOKEN" ]]; then
    say "沿用上次填过的 GitHub token"
  fi
fi

mkdir -p "$APP_DIR/logs"
cat > "$APP_DIR/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [{
    name: '$APP_NAME',
    script: '.output/server/index.mjs',
    cwd: '$APP_DIR/current',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '512M',
    autorestart: true,
    restart_delay: 3000,
    kill_timeout: 15000,
    output: '$APP_DIR/logs/out.log',
    error: '$APP_DIR/logs/error.log',
    merge_logs: true,
    time: true,
    env: {
      NODE_ENV: 'production',
      PORT: '$PORT',
      HOST: '$HOST_BIND',
      NUXT_PUBLIC_SITE_URL: '$SITE_URL',
      LICORE_SITE_CONFIG: '$CONFIG',
      GITHUB_TOKEN: '$TOKEN',
    },
  }],
}
EOF
chmod 600 "$APP_DIR/ecosystem.config.cjs"
say "进程配置：$APP_DIR/ecosystem.config.cjs"

# ---------- 6. 原子切换 ----------
# 记录上一版（用于回滚）。注意：current 可能是断链，要校验目标真实存在
PREV=""
if [[ -L "$APP_DIR/current" ]]; then
  CANDIDATE="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
  if [[ -n "$CANDIDATE" && -d "$CANDIDATE" ]]; then
    PREV="$CANDIDATE"
  fi
fi

ln -sfn "$TARGET" "$APP_DIR/current"
# 切换后立刻校验，避免软链指向了不存在的路径
ACTUAL="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
[[ "$ACTUAL" == "$TARGET" ]] || fail "软链切换失败：current 指向 $ACTUAL，期望 $TARGET"
say "current → $TARGET"
[[ -n "$PREV" ]] && say "上一版本（可回滚）：$PREV" || say "上一版本：无（首次部署）"

# ---------- 7. 清理旧版本（在 --no-pm2 退出之前执行，保证旧版本不会堆积） ----------
# 按目录名排序（YYYYMMDD-HHMMSS-RANDOM，字典序即时间序）—— 不按 mtime，同秒部署会乱序
if [[ -d "$APP_DIR/releases" ]]; then
  mapfile -t OLD < <(ls -1 "$APP_DIR/releases" | sort -r | tail -n +$((KEEP + 1)))
  CUR_REAL="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
  for d in "${OLD[@]}"; do
    [[ "$APP_DIR/releases/$d" == "$CUR_REAL" ]] && continue
    if rm -rf "$APP_DIR/releases/$d" 2>/dev/null; then
      say "已清理旧版本：$d"
    else
      say "⚠ 清理失败：$APP_DIR/releases/$d（不影响本次部署）"
    fi
  done
fi

# ---------- 8. --no-pm2 模式：已发布+切换+清理，但不启动进程 ----------
if [[ "$NO_PM2" -eq 1 ]]; then
  echo
  echo "⚠ --no-pm2：已发布 $RELEASE_ID 并切换 current 软链，但未启动/重载 PM2。"
  echo "  如果 PM2 正在跑旧版本，它仍然在用旧代码。手动切换："
  echo "    pm2 reload $APP_NAME --update-env"
  echo "  或直接启动："
  echo "    pm2 startOrReload $APP_DIR/ecosystem.config.cjs --update-env"
  exit 0
fi

# ---------- 9. 启动 + 健康检查 ----------
echo "▶ 启动/重载 PM2"
pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env

# 健康检查地址：监听 0.0.0.0 时用 127.0.0.1 探测（0.0.0.0 不能直接 curl）
HEALTH_HOST="$HOST_BIND"
[[ "$HOST_BIND" == "0.0.0.0" ]] && HEALTH_HOST="127.0.0.1"

ok=0
for i in $(seq 1 30); do
  if curl -sf -o /dev/null --max-time 5 "http://$HEALTH_HOST:$PORT/"; then ok=1; break; fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "❌ 健康检查失败（30 秒内 $HEALTH_HOST:$PORT 未响应）。诊断信息：" >&2
  echo "--- pm2 status ---" >&2
  pm2 status 2>&1 | head -30 >&2 || true
  echo "--- error.log（最近 60 行） ---" >&2
  tail -n 60 "$APP_DIR/logs/error.log" 2>/dev/null >&2 || true
  echo "--- out.log（最近 30 行） ---" >&2
  tail -n 30 "$APP_DIR/logs/out.log" 2>/dev/null >&2 || true

  if [[ -n "$PREV" ]]; then
    ln -sfn "$PREV" "$APP_DIR/current"
    # 回滚：先尝试优雅 reload；不行就重启（应对进程已崩溃的情况）
    if ! pm2 reload "$APP_NAME" --update-env 2>/dev/null; then
      pm2 startOrReload "$APP_DIR/ecosystem.config.cjs" --update-env 2>/dev/null || true
    fi
    echo "↩ 已回滚到：$PREV" >&2
  fi
  exit 1
fi

if ! pm2 save >/dev/null 2>&1; then
  say "⚠ pm2 save 失败（不影响本次部署，但下次开机不会自动恢复，请手动运行 pm2 save）"
fi

echo
echo "✅ 部署成功"
echo "  当前版本   : $RELEASE_ID"
echo "  本机地址   : http://$HEALTH_HOST:$PORT"
echo "  后台面板   : http://$HEALTH_HOST:$PORT/admin"
echo "  配置文件   : $CONFIG"
echo
echo "下一步："
echo "  1. 改后台密码：编辑 $CONFIG 里 [admin].password，然后"
echo "       pm2 reload $APP_NAME --update-env"
echo "  2. 开机自启（首次）：pm2 startup  然后按提示执行它输出的 sudo 命令"
echo "  3. 公网访问   : 配 Nginx 反代到 127.0.0.1:$PORT（见 DEPLOY.md 第 5 节）"
echo
echo "更新     : bash deploy-pm2.sh --src <新产物>     （本脚本，重复执行即可）"
echo "回滚     : ln -sfn $APP_DIR/releases/<上一个版本> $APP_DIR/current && pm2 reload $APP_NAME --update-env"
