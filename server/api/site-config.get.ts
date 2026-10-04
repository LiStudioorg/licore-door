/**
 * GET /api/site-config
 * 对外暴露**页面渲染需要**的那部分生效配置。
 *
 * 为什么需要它：页面不能直接 import `server/utils/config` 的函数
 * （会把 node:fs / process.cwd 打进客户端 bundle，见 DEVELOPMENT §13.3），
 * 但这些展示开关又必须能在后台面板改完立即生效、并且 SSR 与客户端水合读到的
 * 是同一份值。放进 SSR payload 是最自然的解法。
 *
 * 安全：只返回展示相关的开关，**不含 token、密码、用户名**等任何敏感字段。
 */
import { siteConfig } from '../utils/config'

export default defineEventHandler((event) => {
  // 展示开关属于站点级配置，允许短缓存；面板改完最多 60 秒后全量生效。
  // 调用方（useRuntimeConfig 组合式）在面板保存后会主动刷新。
  setResponseHeader(event, 'cache-control', 'public, max-age=0, s-maxage=30, must-revalidate')

  return {
    ok: true,
    display: {
      changelogMaxItems: siteConfig.display.changelogMaxItems,
      showActivity: siteConfig.display.showActivity,
    },
    site: {
      name: siteConfig.site.name,
      url: siteConfig.site.url,
      icp: siteConfig.site.icp,
    },
  }
})
