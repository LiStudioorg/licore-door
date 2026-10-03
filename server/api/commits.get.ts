/**
 * GET /api/commits?limit=30
 * 最近提交，首页活动流使用。
 */
import { getCommits, TTL } from '../utils/github'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${Math.round(TTL.commits / 1000)}, stale-while-revalidate=${Math.round((TTL.commits * 2) / 1000)}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const commits = await getCommits(limit, event)
  return { ok: true, commits, fetchedAt: new Date().toISOString() }
})
