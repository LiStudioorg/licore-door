/**
 * POST /api/admin/logout
 * 清除会话 cookie。无论是否已登录都返回 200（幂等）。
 *
 * 这里不做 enabled 检查：后台被关闭时清掉残留 cookie 是无害且有益的，
 * 与其它后台接口一律 404 的策略并不冲突（那些接口会读写数据）。
 */
import { clearSessionCookie } from '../../utils/auth'

export default defineEventHandler((event) => {
  clearSessionCookie(event)
  return { ok: true }
})
