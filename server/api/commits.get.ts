/**
 * GET /api/commits?limit=30
 * 最近提交，首页活动流使用。
 */
import { getCommits, TTL } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${Math.round(TTL.commits / 1000)}, stale-while-revalidate=${Math.round((TTL.commits * 2) / 1000)}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)

  let commits: Awaited<ReturnType<typeof getCommits>>
  try {
    commits = await getCommits(limit, event)
  } catch (err) {
    return upstreamUnavailable(event, err)
  }

  return { ok: true, commits, fetchedAt: new Date().toISOString() }
})
