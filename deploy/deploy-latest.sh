#!/usr/bin/env bash
# ============================================================
# LiCore 官网 · 一键拉取最新发行版并部署（在服务器上用）
#
# 从 GitHub Release 下载最新构建产物，然后交给同目录的
# deploy-pm2.sh 完成发布（版本化目录 + 原子切软链 + PM2 重载 +
# 健康检查 + 失败回滚）。本脚本只负责「取包」这一件事。
#
# 与 deploy-pm2.sh 的分工：
#   deploy-pm2.sh   —— 拿到产物之后怎么发布（核心逻辑，不动）
#   deploy-latest.sh（本脚本）—— 产物从哪来（GitHub Release）
#
# 用法：
#   bash deploy-latest.sh                       # 拉最新版并部署
#   bash deploy-latest.sh --list                # 只列出发行版，不部署
#   bash deploy-latest.sh --tag v1.0.3          # 部署指定版本
#   bash deploy-latest.sh --rollback            # 回滚到上一个已部署版本
#   bash deploy-latest.sh --dry-run             # 只下载解包看结构，不发布
#   bash deploy-latest.sh --port 3000 --site-url https://xxx
#
# 私有仓库需要凭据，按以下顺序自动查找：
#   1. 环境变量 GITHUB_TOKEN / GH_TOKEN
#   2. --token 参数
#   3. ~/.git-credentials 里 github.com 的 token
#   4. /opt/licore-website/ecosystem.config.cjs 里已配置的 GITHUB_TOKEN
#
# 其余参数原样透传给 deploy-pm2.sh（--port/--host/--site-url/--app-dir/--keep/--no-pm2）。
# ============================================================
set -euo pipefail

REPO="LiStudioorg/licore-door"
ASSET_NAME="licore-website-build.tar.gz"
APP_DIR="/opt/licore-website"
APP_NAME="licore-website"
TAG=""
LIST_ONLY=0
DRY_RUN=0
ROLLBACK=0
TOKEN=""
PASSTHRU=()

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SH="$SCRIPT_DIR/deploy-pm2.sh"
TMP=""

usage() {
  cat <<'USAGE'
用法：bash deploy-latest.sh [选项] [传给 deploy-pm2.sh 的参数]

  --tag <vX.Y.Z>    部署指定版本（默认最新）
  --list            只列出发行版列表，不下载不部署
  --rollback        回滚到上一个已部署版本（不下载，直接切软链）
  --dry-run         只下载并检查产物结构，不执行发布
  --token <TOKEN>   GitHub token（私有仓库必需；也会依次尝试环境变量等来源）
  --repo <owner/repo>  仓库，默认 LiStudioorg/licore-door
  --app-dir <路径>  应用根目录，默认 /opt/licore-website
  -h, --help        显示本帮助

其余参数（--port/--host/--site-url/--keep/--no-pm2）原样传给 deploy-pm2.sh。
例如：
  bash deploy-latest.sh --port 3000 --site-url https://licore.z321.cc.cd
USAGE
}

say()  { echo "  - $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# 只删自己创建的临时目录，避免误删
cleanup() { [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"; }
trap cleanup EXIT

# ---------- 参数解析 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)      TAG="${2:?--tag 需要一个版本号}"; shift 2 ;;
    --list)     LIST_ONLY=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --token)    TOKEN="${2:?--token 需要一个 token}"; shift 2 ;;
    --repo)     REPO="${2:?--repo 需要 owner/repo}"; shift 2 ;;
    --app-dir)  APP_DIR="${2:?--app-dir 需要一个路径}"; PASSTHRU+=(--app-dir "$2"); shift 2 ;;
    --port|--host|--site-url|--keep)
                [[ -n "${2:-}" ]] || { echo "❌ $1 需要一个值" >&2; exit 1; }
                PASSTHRU+=("$1" "$2"); shift 2 ;;
    --no-pm2)   PASSTHRU+=(--no-pm2); shift ;;
    -h|--help)  usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 1 ;;
  esac
done

# ---------- 工具函数 ----------

# 静默探测命令是否存在（command -v 在 set -e 下放 if 里用）
have() { command -v "$1" >/dev/null 2>&1; }

# 从 JSON 里取字段。不依赖 jq：优先用 node（部署环境已有 Node 22+），
# 退化到 python3；都没有才报错。
json_get() {
  # $1=文件  $2=点号路径，如 "assets.0.browser_download_url"
  if have node; then
    node -e '
      const fs=require("fs");
      let d; try { d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")) } catch { process.exit(3) }
      const path=process.argv[2].split(".");
      let cur=d;
      for (const k of path) { if (cur==null) { process.exit(1) } cur=cur[k] }
      if (cur==null) process.exit(1);
      process.stdout.write(typeof cur==="object" ? JSON.stringify(cur) : String(cur));
    ' "$1" "$2"
  elif have python3; then
    python3 -c '
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit(3)
cur=d
for k in sys.argv[2].split("."):
    if cur is None: sys.exit(1)
    cur=cur[int(k)] if isinstance(cur,list) else cur.get(k)
    if cur is None: sys.exit(1)
sys.stdout.write(json.dumps(cur) if isinstance(cur,(dict,list)) else str(cur))
' "$1" "$2"
  else
    fail "需要 node 或 python3 来解析 GitHub API 响应"
  fi
}

# 带鉴权地请求 GitHub API，结果写入 $1 指定的文件。
# token 只放进 header，不出现在命令行参数里（避免被 ps 看到）。
api_get() {
  local url="$1" out="$2" code
  local args=(-sL --max-time 30 -H "Accept: application/vnd.github+json"
              -H "X-GitHub-Api-Version: 2022-11-28" -H "User-Agent: licore-deploy")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  code="$(curl "${args[@]}" -o "$out" -w '%{http_code}' "$url" || echo 000)"
  echo "$code"
}

# 下载资产。私有仓库的 browser_download_url 需要带 Authorization 才有效，
# 因此统一走 API 的 assets/<id> 端点。
# 注意 Accept 必须是 application/octet-stream —— 用 +json 会拿到资产的元数据
# JSON 而不是字节流。
download_asset() {
  local url="$1" out="$2" code
  local args=(-sL --max-time 300
              -H "Accept: application/octet-stream"
              -H "X-GitHub-Api-Version: 2022-11-28"
              -H "User-Agent: licore-deploy")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  code="$(curl "${args[@]}" -o "$out" -w '%{http_code}' "$url" || echo 000)"
  if [[ "$code" != "200" ]]; then
    rm -f "$out"
    echo "$code"
    return 0
  fi
  # 兜底：确认拿到的确实是 gzip，而不是 JSON 错误页
  if ! tar -tzf "$out" >/dev/null 2>&1; then
    rm -f "$out"
    echo "bad-archive"
    return 0
  fi
  echo "$code"
}

# ---------- 1. 解析 token（要在任何 API 调用之前） ----------
if [[ -z "$TOKEN" ]]; then
  TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
fi
if [[ -z "$TOKEN" && -f "$HOME/.git-credentials" ]]; then
  # 取 github.com 那条凭据的密码段
  TOKEN="$(sed -nE 's#^https://[^:]*:([^@]*)@github\.com$#\1#p' "$HOME/.git-credentials" | head -1)"
  [[ -n "$TOKEN" ]] && say "使用 ~/.git-credentials 里的 GitHub 凭据"
fi
if [[ -z "$TOKEN" && -f "$APP_DIR/ecosystem.config.cjs" ]]; then
  TOKEN="$(sed -nE "s/.*GITHUB_TOKEN *: *'([^']*)'.*/\1/p" "$APP_DIR/ecosystem.config.cjs" | head -1)"
  [[ -n "$TOKEN" ]] && say "使用已部署的 ecosystem.config.cjs 里的 token"
fi

# ---------- 2. 定位 deploy-pm2.sh ----------
# 只有真正要发布时才需要它；--list / --rollback / --dry-run 都不需要，
# 这时缺文件也不该拦着（而且要避免为了拿脚本白白多打一次 API）。
NEED_DEPLOY_SH=1
if [[ "$LIST_ONLY" -eq 1 || "$ROLLBACK" -eq 1 ]]; then
  NEED_DEPLOY_SH=0
fi

if [[ "$NEED_DEPLOY_SH" -eq 1 && ! -f "$DEPLOY_SH" ]]; then
  echo "▶ 未找到 $DEPLOY_SH，尝试从仓库获取"
  mkdir -p "$SCRIPT_DIR"
  TMP_SCRIPT="$SCRIPT_DIR/.deploy-pm2.b64"
  code="$(api_get "https://api.github.com/repos/$REPO/contents/deploy/deploy-pm2.sh" "$TMP_SCRIPT")"
  if [[ "$code" == "200" ]]; then
    json_get "$TMP_SCRIPT" "content" | tr -d '\n' | base64 -d > "$DEPLOY_SH" 2>/dev/null \
      || { rm -f "$TMP_SCRIPT" "$DEPLOY_SH"; fail "解析 deploy-pm2.sh 内容失败"; }
    rm -f "$TMP_SCRIPT"
  else
    rm -f "$TMP_SCRIPT"
    fail "无法获取 deploy-pm2.sh（HTTP $code）。请把它和本脚本放在同一目录。"
  fi
  [[ -s "$DEPLOY_SH" ]] || fail "拉取到的 deploy-pm2.sh 是空文件"
  chmod +x "$DEPLOY_SH" 2>/dev/null || true
  say "已获取 deploy-pm2.sh"
fi

# ---------- 3. 回滚模式 ----------
if [[ "$ROLLBACK" -eq 1 ]]; then
  echo "▶ 回滚到上一个已部署版本"
  [[ -d "$APP_DIR/releases" ]] || fail "$APP_DIR/releases 不存在，没有可回滚的版本"
  CUR="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
  # 按目录名倒序（YYYYMMDD-HHMMSS-RANDOM，字典序即时间序），跳过当前版本
  PREV=""
  while IFS= read -r d; do
    [[ "$APP_DIR/releases/$d" == "$CUR" ]] && continue
    PREV="$APP_DIR/releases/$d"; break
  done < <(ls -1 "$APP_DIR/releases" | sort -r)

  [[ -n "$PREV" ]] || fail "只有一个版本，无法回滚"
  echo "  当前：${CUR:-无}"
  echo "  回滚：$PREV"
  ln -sfn "$PREV" "$APP_DIR/current"
  if have pm2 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    pm2 reload "$APP_NAME" --update-env
    # 回滚也要做健康检查：切过去起不来就等于把站点弄挂了
    PORT_TMP="$(sed -nE "s/.*PORT *: *'([0-9]+)'.*/\1/p" "$APP_DIR/ecosystem.config.cjs" 2>/dev/null | head -1)"
    PORT_TMP="${PORT_TMP:-3000}"
    ok=0
    for _ in $(seq 1 30); do
      curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT_TMP/" && { ok=1; break; }
      sleep 1
    done
    [[ "$ok" -eq 1 ]] || fail "回滚后健康检查失败，请检查 pm2 logs $APP_NAME"
    echo "✅ 已回滚到 $(basename "$PREV")"
  else
    echo "⚠ 未检测到运行中的 PM2 进程 $APP_NAME，已只切换软链"
    echo "  手动启动：pm2 startOrReload $APP_DIR/ecosystem.config.cjs --update-env"
  fi
  exit 0
fi

# ---------- 4. 查询发行版 ----------
have curl || fail "缺少 curl，请先安装：apt install -y curl"

echo "▶ 查询发行版：$REPO"
REL_JSON="$(mktemp)"

if [[ -n "$TAG" ]]; then
  CODE="$(api_get "https://api.github.com/repos/$REPO/releases/tags/$TAG" "$REL_JSON")"
else
  CODE="$(api_get "https://api.github.com/repos/$REPO/releases/latest" "$REL_JSON")"
fi

# 分情况报错，让用户知道到底是没发版、还是没鉴权
if [[ "$CODE" == "404" ]]; then
  if [[ -n "$TAG" ]]; then
    fail "找不到发行版 $TAG（HTTP 404）。用 --list 查看已有版本。"
  fi
  # /releases/latest 在「只有 prerelease」或「一个都没有」时都返回 404
  CODE2="$(api_get "https://api.github.com/repos/$REPO/releases?per_page=1" "$REL_JSON")"
  if [[ "$CODE2" == "200" ]]; then
    N="$(json_get "$REL_JSON" "0.tag_name" 2>/dev/null || echo '')"
    if [[ -n "$N" ]]; then
      fail "没有正式发行版（只有预发行）。最新为 $N，可用 --tag $N 指定部署。"
    fi
    fail "仓库还没有任何发行版。先推送代码让 CI 跑完发行工作流（见 README「四、CI 与发行」）。"
  fi
  [[ -n "$TOKEN" ]] || fail "无法访问 $REPO 的发行版（HTTP 404）。该仓库是私有的，请提供 token：export GITHUB_TOKEN=xxx"
  fail "查询发行版失败（HTTP $CODE / $CODE2）"
fi
[[ "$CODE" == "200" ]] || fail "查询发行版失败（HTTP $CODE）"

REL_TAG="$(json_get "$REL_JSON" "tag_name")"
REL_NAME="$(json_get "$REL_JSON" "name" 2>/dev/null || echo "$REL_TAG")"
REL_DATE="$(json_get "$REL_JSON" "published_at" 2>/dev/null || echo '')"
say "最新版本：$REL_TAG（$REL_DATE）"

# --list：打印发行版列表后退出
if [[ "$LIST_ONLY" -eq 1 ]]; then
  echo
  echo "▶ 发行版列表"
  LIST_JSON="$(mktemp)"
  CODE="$(api_get "https://api.github.com/repos/$REPO/releases?per_page=30" "$LIST_JSON")"
  [[ "$CODE" == "200" ]] || fail "查询列表失败（HTTP $CODE）"
  if have node; then
    node -e '
      const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
      if (!d.length) { console.log("  （暂无发行版）"); process.exit(0) }
      for (const r of d) {
        const size=(r.assets||[]).filter(a=>a.name.endsWith(".tar.gz"))
                    .reduce((s,a)=>s+a.size,0);
        console.log(`  ${r.tag_name.padEnd(12)} ${(r.published_at||"").slice(0,10)}  ${(size/1048576).toFixed(1)} MB  ${r.prerelease?"[预发行] ":""}${r.name||""}`);
      }
    ' "$LIST_JSON"
  else
    json_get "$LIST_JSON" "" >/dev/null 2>&1 || true
    grep -oE '"tag_name":"[^"]*"' "$LIST_JSON" | sed 's/.*:"/  /;s/"$//'
  fi
  rm -f "$LIST_JSON" "$REL_JSON"
  exit 0
fi

# ---------- 5. 找产物资产 ----------
# 先精确匹配约定名；没有就退而取第一个 .tar.gz，避免改名后脚本直接失效
ASSET_URL="$(json_get "$REL_JSON" "assets.0.browser_download_url" 2>/dev/null || echo '')"
ASSET_API=""
if have node; then
  ASSET_API="$(node -e '
    const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const want=process.argv[2];
    const as=d.assets||[];
    const hit=as.find(a=>a.name===want) || as.find(a=>a.name.endsWith(".tar.gz")) || as.find(a=>a.name.endsWith(".zip"));
    if (hit) process.stdout.write(`${hit.name}\t${hit.url||""}\t${hit.browser_download_url||""}`);
  ' "$REL_JSON" "$ASSET_NAME" 2>/dev/null || echo '')"
fi
if [[ -n "$ASSET_API" ]]; then
  IFS=$'\t' read -r ASSET_FILE ASSET_API_URL ASSET_BROWSER_URL <<< "$ASSET_API"
else
  ASSET_FILE="$ASSET_NAME"
  ASSET_API_URL=""
  ASSET_BROWSER_URL="$ASSET_URL"
fi

[[ -n "$ASSET_API_URL" || -n "$ASSET_BROWSER_URL" ]] \
  || fail "发行版 $REL_TAG 里没有找到可用的产物（期望 $ASSET_NAME）。
  如果 Release 是空的，说明发行工作流的「打包部署产物」步骤失败了，
  去 Actions 页面看那次运行的具体报错。"
say "产物：$ASSET_FILE"

# ---------- 6. 下载 ----------
echo "▶ 下载产物"
TMP="$(mktemp -d)"
PKG_TGZ="$TMP/$ASSET_FILE"

if [[ -n "$ASSET_API_URL" && -n "$TOKEN" ]]; then
  # 私有仓库优先走 API（browser_download_url 对私有资产需要鉴权，
  # 且用 API 端点时可以带 Accept: application/octet-stream 直接下字节流）
  CODE="$(download_asset "$ASSET_API_URL" "$PKG_TGZ")"
  [[ "$CODE" == "200" ]] || fail "下载产物失败（HTTP $CODE）"
else
  # 公开仓库直接下 browser_download_url
  DL_ARGS=(-sL --max-time 300 -H "User-Agent: licore-deploy")
  [[ -n "$TOKEN" ]] && DL_ARGS+=(-H "Authorization: Bearer $TOKEN")
  CODE="$(curl "${DL_ARGS[@]}" -o "$PKG_TGZ" -w '%{http_code}' "$ASSET_BROWSER_URL" || echo 000)"
  [[ "$CODE" == "200" ]] || fail "下载产物失败（HTTP $CODE）：$ASSET_BROWSER_URL"
fi

SIZE="$(wc -c < "$PKG_TGZ" | tr -d ' ')"
[[ "$SIZE" -gt 10240 ]] || fail "下载到的产物只有 ${SIZE}B，明显不完整"
if ! tar -tzf "$PKG_TGZ" >/dev/null 2>&1; then
  fail "下载到的文件不是合法 tar.gz，可能鉴权失败或资产损坏"
fi
say "已下载 $(echo "$SIZE" | awk '{printf "%.1f", $1/1048576}') MB"

# ---------- 7. 干跑：只检查产物结构 ----------
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "▶ 干跑模式，检查产物结构"
  tar -tzf "$PKG_TGZ" > "$TMP/list.txt"
  grep -qx '\./\.output/server/index\.mjs' "$TMP/list.txt" \
    || fail "产物里缺 .output/server/index.mjs（结构不对，deploy-pm2.sh 会拒绝）"
  say "✓ 含 .output/server/index.mjs"
  grep -qx '\./deploy-pm2\.sh' "$TMP/list.txt" && say "✓ 含 deploy-pm2.sh" \
    || say "· 不含 deploy-pm2.sh（用同目录那份）"
  echo
  echo "✅ 干跑通过：产物可用，未做任何发布。"
  echo "   去掉 --dry-run 即可真正部署。"
  exit 0
fi

# ---------- 8. 交给 deploy-pm2.sh 发布 ----------
echo "▶ 交给 deploy-pm2.sh 发布"
echo
exec bash "$DEPLOY_SH" --src "$PKG_TGZ" "${PASSTHRU[@]+"${PASSTHRU[@]}"}"
