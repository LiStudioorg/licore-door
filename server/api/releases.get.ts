/**
 * GET /api/releases
 * 下载页所用的版本与下载项列表。
 *
 * 默认不下发每个版本内嵌的完整提交数组（体积可达数百 KB），
 * 需要完整数据时显式加 ?commits=1。
 */
import { buildDownloads } from '../utils/changelog'
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
  const withCommits = query.commits === '1' || query.commits === 'true'

  const data = await buildDownloads(event)
  const versions = withCommits
    ? data.versions
    : data.versions.map(({ commits, ...rest }) => ({
        ...rest,
        commitCount: rest.commitCount || commits.length,
      }))

  return { ok: true, ...data, versions }
})
