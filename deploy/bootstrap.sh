#!/usr/bin/env bash
# ============================================================
# LiCore 官网 · 引导脚本（在服务器上一条命令跑完部署）
#
# 作用：把 deploy-latest.sh 从仓库取到本地，然后执行它。
#       部署本身的逻辑全在 deploy-latest.sh / deploy-pm2.sh 里，
#       本脚本只负责「取脚本 + 校验 + 转交」。
#
# 一条命令用法（仓库公开时）：
#   curl -fsSL https://raw.githubusercontent.com/LiStudioorg/licore-door/main/deploy/bootstrap.sh | bash
#
# 带参数（推荐 —— 参数放环境变量，避免 bash -s -- 的引号坑）：
#   curl -fsSL .../bootstrap.sh | \
#     SITE_URL=https://licore.z321.cc.cd PORT=3000 bash
#
# 私有仓库用法（需要 token）：
#   curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" .../bootstrap.sh | bash
#
# 更稳的用法（先把脚本落盘看一遍再跑，便于排障）：
#   curl -fsSL .../bootstrap.sh -o bootstrap.sh
#   less bootstrap.sh && bash bootstrap.sh
#
# 支持的环境变量：
#   SITE_URL     站点规范地址，默认 http://licore.z321.cc.cd
#   PORT         监听端口，默认 3000
#   HOST         监听地址，默认 127.0.0.1
#   APP_DIR      应用根目录，默认 /opt/licore-website
#   KEEP         保留几个旧版本，默认 5
#   TAG          指定发行版（如 v1.0.1），默认最新
#   GITHUB_TOKEN 私有仓库或 API 限流时使用
#   ARGS         额外参数，原样追加（如 ARGS="--dry-run"）
# ============================================================
set -euo pipefail

REPO="${REPO:-LiStudioorg/licore-door}"
BRANCH="${BRANCH:-main}"
WORKDIR="${WORKDIR:-$HOME/.licore-deploy}"

SITE_URL="${SITE_URL:-}"
PORT="${PORT:-}"
HOST="${HOST:-}"
APP_DIR="${APP_DIR:-}"
KEEP="${KEEP:-}"
TAG="${TAG:-}"
ARGS="${ARGS:-}"

say()  { echo "  - $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# 从 GitHub 取文件到指定路径。
# 优先 raw（快、单次请求）；raw 对私有仓库也可用，但要带 Authorization。
# raw 取不到（例如分支名特殊）时回退到 contents API + base64 解码。
fetch_file() {
  local path="$1" out="$2" url code
  url="https://raw.githubusercontent.com/$REPO/$BRANCH/$path"
  local args=(-fsSL --max-time 60 -H "User-Agent: licore-bootstrap")
  [[ -n "${GITHUB_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $GITHUB_TOKEN")

  if code="$(curl "${args[@]}" -o "$out" -w '%{http_code}' "$url" 2>/dev/null)"; then
    [[ "$code" == "200" && -s "$out" ]] && return 0
  fi

  # 回退：contents API（私有仓库 + 特殊分支名时更可靠）
  url="https://api.github.com/repos/$REPO/contents/$path?ref=$BRANCH"
  args=(-fsSL --max-time 60
        -H "Accept: application/vnd.github.raw"
        -H "X-GitHub-Api-Version: 2022-11-28"
        -H "User-Agent: licore-bootstrap")
  [[ -n "${GITHUB_TOKEN:-}" ]] && args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
  if code="$(curl "${args[@]}" -o "$out" -w '%{http_code}' "$url" 2>/dev/null)"; then
    [[ "$code" == "200" && -s "$out" ]] && return 0
  fi
  return 1
}

echo "▶ 引导脚本启动"
command -v curl >/dev/null 2>&1 || fail "缺少 curl，请先安装：apt install -y curl"
command -v bash >/dev/null 2>&1 || fail "缺少 bash"
say "仓库：$REPO（分支 $BRANCH）"

# 预检：仓库到底能不能访问。早失败、给准话，别等下载到一半才报错。
PROBE="https://api.github.com/repos/$REPO"
PARGS=(-sSL --max-time 30 -o /dev/null -w '%{http_code}'
       -H "Accept: application/vnd.github+json" -H "User-Agent: licore-bootstrap")
[[ -n "${GITHUB_TOKEN:-}" ]] && PARGS+=(-H "Authorization: Bearer $GITHUB_TOKEN")
PCODE="$(curl "${PARGS[@]}" "$PROBE" 2>/dev/null || echo 000)"

if [[ "$PCODE" == "404" ]]; then
  fail "访问不到 $REPO（HTTP 404）。若是私有仓库，请带上 token 重试：
     curl -fsSL -H \"Authorization: Bearer \$GITHUB_TOKEN\" <bootstrap.sh 地址> | bash"
fi
[[ "$PCODE" == "200" ]] || say "⚠ 预检返回 HTTP $PCODE，仍继续尝试"
[[ "$PCODE" == "200" ]] && say "仓库可访问"

# ---------- 取脚本 ----------
mkdir -p "$WORKDIR" || fail "无法创建 $WORKDIR"
DEPLOY_SH="$WORKDIR/deploy-latest.sh"

echo "▶ 获取 deploy-latest.sh"
fetch_file "deploy/deploy-latest.sh" "$DEPLOY_SH" \
  || fail "下载 deploy-latest.sh 失败。请检查仓库地址/分支，或（私有仓库时）提供 GITHUB_TOKEN"

# 基本完整性校验：别把 404 页面当年脚本执行了
head -1 "$DEPLOY_SH" | grep -q '^#!/usr/bin/env bash' \
  || fail "下载到的 deploy-latest.sh 开头不是 bash shebang，内容可能不对（已存到 $DEPLOY_SH，可自行检查）"
grep -q 'deploy-pm2.sh' "$DEPLOY_SH" \
  || fail "下载到的 deploy-latest.sh 内容不完整（已存到 $DEPLOY_SH）"
# 语法预检：坏脚本绝不执行
bash -n "$DEPLOY_SH" || fail "deploy-latest.sh 语法检查未通过（已存到 $DEPLOY_SH）"
chmod +x "$DEPLOY_SH" 2>/dev/null || true
say "已获取并校验：$DEPLOY_SH"

# ---------- 组装参数 ----------
PASSTHRU=()
[[ -n "$SITE_URL" ]] && PASSTHRU+=(--site-url "$SITE_URL")
[[ -n "$PORT"     ]] && PASSTHRU+=(--port "$PORT")
[[ -n "$HOST"     ]] && PASSTHRU+=(--host "$HOST")
[[ -n "$APP_DIR"  ]] && PASSTHRU+=(--app-dir "$APP_DIR")
[[ -n "$KEEP"     ]] && PASSTHRU+=(--keep "$KEEP")
[[ -n "$TAG"      ]] && PASSTHRU+=(--tag "$TAG")
# ARGS 故意用 shell 分词：它本来就是给用户透传额外参数的逃生口
# shellcheck disable=SC2206
[[ -n "$ARGS"     ]] && PASSTHRU+=($ARGS)

echo "▶ 转交 deploy-latest.sh 执行部署"
[[ ${#PASSTHRU[@]} -gt 0 ]] && say "参数：${PASSTHRU[*]}"
echo

exec bash "$DEPLOY_SH" "${PASSTHRU[@]+"${PASSTHRU[@]}"}"
