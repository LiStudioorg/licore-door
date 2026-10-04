/**
 * GET /api/changelog
 * 返回自动聚合的更新日志。服务端缓存，客户端可轮询。
 */
import { buildChangelog } from '../utils/changelog'
import { RELEASE_TTL_SECONDS } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${RELEASE_TTL_SECONDS}, stale-while-revalidate=${RELEASE_TTL_SECONDS * 2}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 0, 100)
  /** 默认不下发每个版本内嵌的完整提交数组（体积大且页面已有聚合明细） */
  const withCommits = query.commits === '1' || query.commits === 'true'

  let log: Awaited<ReturnType<typeof buildChangelog>>
  try {
    log = await buildChangelog(event)
  } catch (err) {
    // 冷启动 + 上游失败时没有旧缓存可回退，这里显式降级而不是抛 500
    return upstreamUnavailable(event, err)
  }

  const slice = limit > 0 ? log.versions.slice(0, limit) : log.versions
  const versions = withCommits
    ? slice
    : slice.map(({ commits, ...rest }) => ({ ...rest, commitCount: rest.commitCount || commits.length }))

  return {
    ok: true,
    // 前端需要展示缓存时长，不再直接从 server/utils 引常量（那会把服务端模块打进客户端）
    ttlSeconds: RELEASE_TTL_SECONDS,
    ...log,
    versions,
  }
})
