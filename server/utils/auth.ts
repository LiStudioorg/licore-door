/**
 * 后台面板的认证。
 *
 * 方案：**HMAC 签名的会话 Cookie**（无服务端会话存储）。
 *
 *   cookie 值 = base64url(payload) + "." + base64url(HMAC-SHA256(payload, secret))
 *
 * 这样后台是**无状态**的 —— 重启服务不会把所有人踢下线，也不需要引入
 * Redis 之类的存储。客户端拿不到 secret，因此无法伪造通过校验的 cookie。
 *
 * 安全边界（务必知悉）：
 *   - 站点是 http 部署的，cookie 的 Secure 属性只能在 https 下才设得上，
 *     因此这里按请求协议动态决定，http 环境下运输层是不加密的。
 *   - 账号密码是明文存在 licore-site.toml 里的（按需求如此），
 *     所以**本文件的权限**与**不要提交真实密码到公开仓库**由你自己保证。
 *   - secret 在进程启动时随机生成：重启后所有会话失效，需要重新登录。
 *     这对单机小站点是可接受的取舍；若要多实例共享会话，需改成固定 secret。
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { siteConfig } from './config'

export const SESSION_COOKIE = 'licore_admin_session'

/** 进程级随机密钥：重启即失效（见文件头说明） */
const SECRET = randomBytes(32)

interface SessionPayload {
  /** 用户名 */
  u: string
  /** 过期时间（毫秒时间戳） */
  exp: number
  /** 随机数，避免相同用户在同一毫秒产生完全相同的 cookie */
  n: string
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string): string {
  return createHmac('sha256', SECRET).update(data).digest('base64url')
}

/** 恒定时间字符串比较，避免时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  // timingSafeEqual 要求长度一致，长度不同直接判否（长度本身不是秘密）
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** 生成会话 cookie 值 */
export function createSession(username: string): string {
  const payload: SessionPayload = {
    u: username,
    exp: Date.now() + siteConfig.admin.sessionHours * 3600 * 1000,
    n: randomBytes(8).toString('hex'),
  }
  const body = b64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

/** 校验会话 cookie，返回用户名；无效或过期返回 null */
export function verifySession(token: string | undefined): string | null {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null

  const body = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!safeEqual(signature, sign(body))) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as SessionPayload
    if (!payload?.exp || Date.now() > payload.exp) return null
    if (payload.u !== siteConfig.admin.username) return null
    return payload.u
  } catch {
    return null
  }
}

/** 恒定时间比较账号密码，避免通过响应时间猜密码 */
export function checkCredentials(username: string, password: string): boolean {
  const okUser = safeEqual(username, siteConfig.admin.username)
  const okPass = safeEqual(password, siteConfig.admin.password)
  // 两个都比较完再合并结果，避免用户名校验失败时短路泄露信息
  return okUser && okPass
}

/** 会话剩余有效期（秒），用于设置 cookie maxAge */
export function sessionMaxAge(): number {
  return siteConfig.admin.sessionHours * 3600
}

/** 是否为 https 请求（决定 cookie 要不要加 Secure） */
export function isSecureRequest(event: H3Event): boolean {
  const proto = getRequestHeader(event, 'x-forwarded-proto')
  if (proto) return proto.split(',')[0]!.trim() === 'https'
  return getRequestProtocol(event) === 'https'
}

/**
 * 当前请求是否已登录。
 * 后台未启用时一律返回 false —— 关闭面板应当等价于完全不可见。
 */
export function isAuthenticated(event: H3Event): boolean {
  if (!siteConfig.admin.enabled) return false
  return verifySession(getCookie(event, SESSION_COOKIE)) !== null
}

/** 写会话 cookie */
export function setSessionCookie(event: H3Event, username: string): void {
  setCookie(event, SESSION_COOKIE, createSession(username), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAge(),
    secure: isSecureRequest(event),
  })
}

/** 清除会话 cookie */
export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}
