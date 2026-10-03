#!/usr/bin/env bash
# 在目标服务器上执行的部署脚本。
# 由 deploy.yml 通过 ssh ... 'bash -s' < remote-deploy.sh 传入，
# 单独成文件是为了避免 YAML 折叠块标量带来的缩进歧义。
#
# 必需环境变量：RELEASE_ID APP_DIR APP_PORT SITE_URL GITHUB_TOKEN_VALUE
set -euo pipefail

: "${RELEASE_ID:?缺少 RELEASE_ID}"
: "${APP_DIR:?缺少 APP_DIR}"
: "${APP_PORT:?缺少 APP_PORT}"
: "${SITE_URL:?缺少 SITE_URL}"
: "${GITHUB_TOKEN_VALUE:=}"

RELEASES_DIR="${APP_DIR}/releases"
NEW_DIR="${RELEASES_DIR}/${RELEASE_ID}"
ARCHIVE="/tmp/licore-website-${RELEASE_ID}.tar.gz"

# 1. 解包到新版本目录
mkdir -p "$NEW_DIR"
tar -xzf "$ARCHIVE" -C "$NEW_DIR"
rm -f "$ARCHIVE"

# 2. 写入该版本的环境变量。token 只落在服务器上，绝不进仓库。
{
  printf 'NODE_ENV=production\n'
  printf 'PORT=%s\n' "$APP_PORT"
  printf 'HOST=127.0.0.1\n'
  printf 'NUXT_PUBLIC_SITE_URL=%s\n' "$SITE_URL"
  printf 'GITHUB_TOKEN=%s\n' "$GITHUB_TOKEN_VALUE"
} > "${NEW_DIR}/.env"
chmod 600 "${NEW_DIR}/.env"

# 3. 原子切换：软链改名是原子操作，不会出现"半个版本在跑"
ln -sfn "$NEW_DIR" "${APP_DIR}/current"

# 4. 重启服务：优先 systemd（用户级/系统级），否则回退 pm2
restarted=0
if systemctl --user list-unit-files 2>/dev/null | grep -q '^licore-website'; then
  systemctl --user restart licore-website && restarted=1
elif sudo -n systemctl list-unit-files 2>/dev/null | grep -q '^licore-website'; then
  sudo -n systemctl restart licore-website && restarted=1
elif command -v pm2 >/dev/null 2>&1; then
  pm2 reload licore-website --update-env || pm2 restart licore-website
  restarted=1
fi

if [ "$restarted" -ne 1 ]; then
  echo "未找到名为 licore-website 的 systemd 服务或 pm2 进程，请先配置服务。" >&2
  echo "参考 README 的『部署到服务器』一节。" >&2
  exit 1
fi

# 5. 健康检查：最多等 30 秒
ready=0
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:${APP_PORT}/"; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "服务在 30 秒内未就绪，部署判定为失败。" >&2
  echo "提示：回滚只需把 ${APP_DIR}/current 指回上一个版本目录并重启。" >&2
  exit 1
fi
echo "健康检查通过"

# 6. 清理旧版本，只保留最近 5 个
cd "$RELEASES_DIR"
ls -1t | tail -n +6 | while read -r old; do
  [ -n "$old" ] && rm -rf "${RELEASES_DIR:?}/${old}"
done
echo "当前保留的版本："
ls -1t | head -5
