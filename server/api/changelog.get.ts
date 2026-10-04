/**
 * GET /api/changelog
 * 返回自动聚合的更新日志。服务端缓存，客户端可轮询。
 */
import { buildChangelog } from '../utils/changelog'
import { releaseTtlSeconds } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${releaseTtlSeconds()}, stale-while-revalidate=${releaseTtlSeconds() * 2}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 0, 100)
  /** 默认不下发每个版本内嵌的完整提交数组（体积大且页面已有聚合明细） */
  const withCommits = query.commits === '1' || query.commits === 'true'
  /**
   * summary=1：只下发首页那种"版本摘要卡"需要的字段。
   *
   * 首页只渲染最新 4 条的 version / date / hasBinaries / summary / commitCount，
   * 却要为了这 4 条把 17 个版本的 changes 全部塞进 SSR payload
   * （实测约 45 KB JSON，占首页 HTML 的三分之一）。
   * 这里按需裁剪，首页用 ?limit=4&summary=1 + limit 拿到刚好够用的数据。
   *
   * /changelog 页不走这个分支 —— 它要渲染完整的变更明细。
   */
  const summary = query.summary === '1' || query.summary === 'true'

  let log: Awaited<ReturnType<typeof buildChangelog>>
  try {
    log = await buildChangelog(event)
  } catch (err) {
    // 冷启动 + 上游失败时没有旧缓存可回退，这里显式降级而不是抛 500
    return upstreamUnavailable(event, err)
  }

  const slice = limit > 0 ? log.versions.slice(0, limit) : log.versions
  const versions = summary
    ? slice.map((v) => ({
        version: v.version,
        versionNumber: v.versionNumber,
        date: v.date,
        isPrerelease: v.isPrerelease,
        hasBinaries: v.hasBinaries,
        summary: v.summary,
        commitCount: v.commitCount || v.commits.length,
      }))
    : withCommits
      ? slice
      : slice.map(({ commits, ...rest }) => ({ ...rest, commitCount: rest.commitCount || commits.length }))

  return {
    ok: true,
    // 前端需要展示缓存时长，不再直接从 server/utils 引常量（那会把服务端模块打进客户端）
    ttlSeconds: releaseTtlSeconds(),
    ...log,
    versions,
  }
})
