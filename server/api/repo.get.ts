/**
 * GET /api/repo
 * 仓库元信息（star / fork / 语言 / 许可证等），首页统计卡使用。
 */
import { getContributors, getRepoMeta, TTL } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${Math.round(TTL.repo / 1000)}, stale-while-revalidate=${Math.round((TTL.repo * 2) / 1000)}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')

  let repo: Awaited<ReturnType<typeof getRepoMeta>>
  let contributors: Awaited<ReturnType<typeof getContributors>>
  try {
    ;[repo, contributors] = await Promise.all([
      getRepoMeta(event),
      getContributors(event),
    ])
  } catch (err) {
    return upstreamUnavailable(event, err)
  }

  return { ok: true, repo, contributors, fetchedAt: new Date().toISOString() }
})
