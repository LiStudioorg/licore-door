/**
 * GET /api/repo
 * 仓库元信息（star / fork / 语言 / 许可证等），首页统计卡使用。
 */
import { getContributors, getRepoMeta, TTL } from '../utils/github'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${Math.round(TTL.repo / 1000)}, stale-while-revalidate=${Math.round((TTL.repo * 2) / 1000)}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const [repo, contributors] = await Promise.all([
    getRepoMeta(event),
    getContributors(event).catch(() => []),
  ])
  return { ok: true, repo, contributors, fetchedAt: new Date().toISOString() }
})
