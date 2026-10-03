/**
 * POST /api/admin/login
 * 用 licore-site.toml 里的 admin.username / admin.password 登录。
 *
 * 请求体：{ username: string, password: string }
 * 成功：Set-Cookie 会话 + { ok: true }
 * 失败：401
 */
import { checkCredentials, setSessionCookie } from '../../utils/auth'
import { siteConfig } from '../../utils/config'

export default defineEventHandler(async (event) => {
  // 后台被关闭时，连登录接口也不存在
  if (!siteConfig.admin.enabled) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }

  const body = await readBody<{ username?: unknown; password?: unknown }>(event).catch(() => null)
  const username = typeof body?.username === 'string' ? body.username : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!username || !password) {
    throw createError({ statusCode: 400, message: '请输入用户名和密码' })
  }

  if (!checkCredentials(username, password)) {
    // 不区分「用户名错」和「密码错」，避免帮攻击者缩小范围
    throw createError({ statusCode: 401, message: '用户名或密码不正确' })
  }

  setSessionCookie(event, username)
  return { ok: true, username, expiresInSeconds: siteConfig.admin.sessionHours * 3600 }
})
