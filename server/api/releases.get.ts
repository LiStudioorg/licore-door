/**
 * GET /api/releases
 * 下载页所用的版本与下载项列表。
 *
 * 默认不下发每个版本内嵌的完整提交数组（体积可达数百 KB），
 * 需要完整数据时显式加 ?commits=1。
 */
import { buildDownloads } from '../utils/changelog'
import { RELEASE_TTL_SECONDS } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${RELEASE_TTL_SECONDS}, stale-while-revalidate=${RELEASE_TTL_SECONDS * 2}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')
  const query = getQuery(event)
  const withCommits = query.commits === '1' || query.commits === 'true'

  let data
  try {
    data = await buildDownloads(event)
  } catch (err) {
    return upstreamUnavailable(event, err)
  }
  const versions = withCommits
    ? data.versions
    : data.versions.map(({ commits, ...rest }) => ({
        ...rest,
        commitCount: rest.commitCount || commits.length,
      }))

  return { ok: true, ...data, versions }
})
