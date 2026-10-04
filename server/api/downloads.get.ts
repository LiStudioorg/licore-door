/**
 * GET /api/downloads
 * 下载页数据：最新版本的可下载项 + 全部版本列表 + 数据源说明。
 * 前端通过 $fetch 调用本路由，而不是直接 import server/utils，
 * 这样 server/utils 里的 node:fs / process.cwd 不会被打进客户端 bundle。
 */
import { buildDownloads } from '../utils/changelog'
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

  let data: Awaited<ReturnType<typeof buildDownloads>>
  try {
    data = await buildDownloads(event)
  } catch (err) {
    return upstreamUnavailable(event, err)
  }

  return { ok: true, ...data, ttlSeconds: releaseTtlSeconds() }
})
