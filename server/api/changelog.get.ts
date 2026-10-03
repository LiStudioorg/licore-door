/**
 * GET /api/changelog
 * 返回自动聚合的更新日志。服务端缓存，客户端可轮询。
 */
import { buildChangelog } from '../utils/changelog'
import { TTL } from '../utils/github'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${Math.round(TTL.releases / 1000)}, stale-while-revalidate=${Math.round((TTL.releases * 2) / 1000)}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 0, 100)
  /** 默认不下发每个版本内嵌的完整提交数组（体积大且页面已有聚合明细） */
  const withCommits = query.commits === '1' || query.commits === 'true'

  const log = await buildChangelog(event)
  const slice = limit > 0 ? log.versions.slice(0, limit) : log.versions
  const versions = withCommits
    ? slice
    : slice.map(({ commits, ...rest }) => ({ ...rest, commitCount: rest.commitCount || commits.length }))

  return {
    ok: true,
    ...log,
    versions,
  }
})
