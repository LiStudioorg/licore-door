/**
 * POST /api/admin/cache/clear
 * 清空 GitHub 数据缓存，让下一次页面访问立即重新拉取上游。
 *
 * 请求体（可选）：{ key?: string }  只清某一个缓存键
 * 需要登录，且需要 licore-site.toml 里 admin.allowCacheClear = true。
 */
import { cacheStats, invalidateCache } from '../../../utils/github'
import { isAuthenticated } from '../../../utils/auth'
import { siteConfig } from '../../../utils/config'

export default defineEventHandler(async (event) => {
  if (!siteConfig.admin.enabled) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (!isAuthenticated(event)) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  if (!siteConfig.admin.allowCacheClear) {
    throw createError({ statusCode: 403, message: '配置已禁止在面板上清理缓存' })
  }

  const body = await readBody<{ key?: unknown }>(event).catch(() => null)
  const key = typeof body?.key === 'string' && body.key ? body.key : undefined

  const cleared = invalidateCache(key)

  return {
    ok: true,
    cleared,
    clearedCount: cleared.length,
    cache: cacheStats(),
    at: new Date().toISOString(),
  }
})
