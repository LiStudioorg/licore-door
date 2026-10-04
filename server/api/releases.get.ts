/**
 * GET /api/releases
 * 下载页所用的版本与下载项列表。
 *
 * 注意：`buildDownloads()` 已经把每个版本的完整提交数组与变更明细裁掉了
 * （见 server/utils/changelog.ts 的 VersionSummary），所以这里不再需要
 * 二次裁剪。需要完整变更明细请用 /api/changelog?commits=1。
 */
import { buildDownloads } from '../utils/changelog'
import { releaseTtlSeconds } from '../utils/github'
import { upstreamUnavailable } from '../utils/upstream'

export default defineEventHandler(async (event) => {

  // 缓存与跨域：与内部 TTL 缓存配合，避免频繁打上游
  setResponseHeader(
    event,
    'cache-control',
    `public, max-age=60, s-maxage=${releaseTtlSeconds()}, stale-while-revalidate=${releaseTtlSeconds() * 2}`,
  )
  setResponseHeader(event, 'access-control-allow-origin', '*')
  setResponseHeader(event, 'access-control-allow-methods', 'GET, OPTIONS')

  let data
  try {
    data = await buildDownloads(event)
  } catch (err) {
    return upstreamUnavailable(event, err)
  }

  return { ok: true, ...data }
})
