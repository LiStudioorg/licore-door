/**
 * GET /api/status
 * 健康检查 + 上游缓存状态。便于运维确认"数据是否在正常刷新"。
 */
import { cacheStats, getRepoMeta } from '../utils/github'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(event, 'cache-control', 'no-store')
  const started = Date.now()
  try {
    const repo = await getRepoMeta(event)
    return {
      ok: true,
      upstream: {
        reachable: true,
        repo: repo.fullName,
        pushedAt: repo.pushedAt,
        latencyMs: Date.now() - started,
      },
      cache: cacheStats(),
      tokenConfigured: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      now: new Date().toISOString(),
    }
  } catch (err) {
    setResponseStatus(event, 503)
    return {
      ok: false,
      upstream: { reachable: false, error: (err as Error).message },
      cache: cacheStats(),
      tokenConfigured: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      now: new Date().toISOString(),
    }
  }
})
