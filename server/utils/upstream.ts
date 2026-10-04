import type { H3Event } from 'h3'

/**
 * API 路由统一的上游错误处理。
 *
 * 为什么需要这一层：
 * `server/utils/github.ts` 的 `cached()` 有 stale-while-error（有旧数据就回退），
 * 但**冷启动 + 上游失败**时没有旧数据可回退，会直接抛错。
 * 如果路由不捕获，Nitro 会把 500 记成 `[request error] [unhandled]`——
 * 既污染日志（误判为应用自身崩溃），前端也拿不到结构化响应。
 *
 * 这里改成显式返回 503 + `{ ok: false }`：
 *   - `setResponseStatus` 走正常响应路径，Nitro 不记 unhandled；
 *   - 前端的 `$fetch(...).catch(() => null)` 会正常走 fallback 分支；
 *   - `/api/status` 仍能如实反映"上游不可达"。
 */
export function upstreamUnavailable(
  event: H3Event,
  err: unknown,
): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[api] ${event.path} 上游取数失败：${message}`)
  setResponseStatus(event, 503, '上游数据暂时不可用')
  return { ok: false, error: 'upstream unavailable' }
}
