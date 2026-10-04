/**
 * POST /api/admin/token.set
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

  // 只做「粘贴完整性」的轻量校验，不做精确格式断言。
  //
  // 这里曾经写成 startsWith('gh_')，但 GitHub 的所有 token 前缀在第 4 个字符
  // 才是下划线：ghp_ / gho_ / ghu_ / ghs_ / ghr_ / github_pat_。
  // 也就是说 `gh_` 这个前缀**任何真实 token 都不满足**，校验恒为真，
  // 导致后台面板永远保存失败（400）。断言一个我们无法穷举、且 GitHub
  // 会随时新增的格式是脆弱的，所以只拦「明显像被截断/粘错」的输入。
  //
  // 真正的有效性验证交给 GitHub：token 用错时 api.github.com 会返回 401，
  // 后台面板的「上游状态」卡片会如实显示不可达。
  if (raw) {
    const looksLikeToken =
      raw.length >= 20 && /^[A-Za-z0-9_-]+$/.test(raw) && !/\s/.test(raw)
    if (!looksLikeToken) {
      throw createError({
        statusCode: 400,
        message:
          '这看起来不像一个完整的 GitHub Token（长度至少 20 位、只含字母数字与 - _），请检查是否粘贴完整',
      })
    }
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
