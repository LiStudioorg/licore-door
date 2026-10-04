/**
 * POST /api/admin/token/set
 * 设置/清除运行时 GitHub Token。
 *
 * 请求体：{ token?: string }
 *   - 非空字符串 → 写入运行时文件，立即生效（无需重启）
 *   - 空字符串 / 不传 → 清除运行时文件，回退到 env / TOML
 *
 * 需要登录 + admin.enabled。
 * 运行时文件存在服务器工作目录，权限 0600，不提交到 git。
 */
import { isAuthenticated } from '../../utils/auth'
import { siteConfig, setRuntimeToken, tokenSourceLabel } from '../../utils/config'

export default defineEventHandler(async (event) => {
  if (!siteConfig.admin.enabled) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (!isAuthenticated(event)) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  const body = await readBody<{ token?: unknown }>(event).catch(() => null)
  const raw = typeof body?.token === 'string' ? body.token.trim() : ''

  if (raw && !raw.startsWith('gh_')) {
    throw createError({
      statusCode: 400,
      message: 'GitHub Token 必须以 gh_ 开头，请检查是否粘贴完整',
    })
  }

  const result = setRuntimeToken(raw)
  if (!result.ok) {
    throw createError({ statusCode: 500, message: '写入运行时 token 失败' })
  }

  return {
    ok: true,
    cleared: raw.length === 0,
    source: tokenSourceLabel(),
    message: raw
      ? 'Token 已保存，立即生效'
      : '运行时 Token 已清除，回退到环境变量或 TOML',
  }
})
