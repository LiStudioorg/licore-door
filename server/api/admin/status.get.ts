/**
 * GET /api/admin/status
 * 后台面板的数据源：上游可达性 + 缓存明细 + 生效配置概览。
 *
 * 需要登录。这里比公开的 /api/status 多返回「生效配置」与配置告警，
 * 便于运维在面板上直接确认 TOML 有没有被正确读到。
 */
import { cacheStats, getRepoMeta, releaseTtlSeconds } from '../../utils/github'
import { isAuthenticated } from '../../utils/auth'
import {
  configPath,
  configWarnings,
  siteConfig,
  effectiveGitHubToken,
  tokenSourceLabel,
  configLastReloadAt,
} from '../../utils/config'
import { editableSections } from '../../utils/editable-config'

export default defineEventHandler(async (event) => {
  if (!siteConfig.admin.enabled) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (!isAuthenticated(event)) {
    throw createError({ statusCode: 401, message: '未登录' })
  }

  // 面板数据必须实时，不能被任何一层缓存住
  setResponseHeader(event, 'cache-control', 'no-store')

  const started = Date.now()
  let reachable = false
  let pushedAt = ''
  let error = ''
  let stars = 0
  try {
    const repo = await getRepoMeta(event)
    reachable = true
    pushedAt = repo.pushedAt
    stars = repo.stars
  } catch (err) {
    error = (err as Error).message
  }

  const tokenConfigured = Boolean(effectiveGitHubToken())
  const tokenSource = tokenSourceLabel()

  return {
    ok: reachable,
    upstream: {
      reachable,
      repo: 'LiStudioorg/licore',
      pushedAt,
      stars,
      latencyMs: Date.now() - started,
      error: error || undefined,
    },
    cache: cacheStats(),
    // 输出配置概览时**绝不回显密码**，只告诉面板「是不是默认值」
    config: {
      path: configPath(),
      warnings: configWarnings(),
      site: {
        url: siteConfig.site.url,
        name: siteConfig.site.name,
        icp: siteConfig.site.icp,
      },
      admin: {
        enabled: siteConfig.admin.enabled,
        username: siteConfig.admin.username,
        sessionHours: siteConfig.admin.sessionHours,
        allowCacheClear: siteConfig.admin.allowCacheClear,
        allowConfigEdit: siteConfig.admin.allowConfigEdit,
        usingDefaultPassword: siteConfig.admin.password === 'admin',
      },
      github: {
        tokenConfigured,
        tokenSource,
        releasesTtlSeconds: siteConfig.github.releases,
        repoTtlSeconds: siteConfig.github.repo,
        contributorsTtlSeconds: siteConfig.github.contributors,
        // 实际生效的发行缓存（可能被 GITHUB_CACHE_TTL_SECONDS 统一覆盖）
        effectiveReleaseTtlSeconds: releaseTtlSeconds(),
      },
      display: {
        changelogMaxItems: siteConfig.display.changelogMaxItems,
        showActivity: siteConfig.display.showActivity,
      },
    },
    /** 可视化编辑：字段清单与当前值由服务端下发，前端只负责渲染 */
    editable: editableSections(),
    /** 最近一次配置热重载时间（保存配置后不为空） */
    lastConfigReloadAt: configLastReloadAt() || null,
    now: new Date().toISOString(),
  }
})
