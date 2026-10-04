/**
 * POST /api/admin/config.set
 * 后台面板的「配置可视化编辑」写入接口。
 *
 * 请求体：{ patch: { 'site.url': '...', 'display.showActivity': false } }
 *
 * 行为：
 *   1. 白名单校验 + 类型校验 + 环境变量覆盖检查（见 server/utils/editable-config.ts）
 *   2. 按字段精确改写 licore-site.toml（**保留注释**），并备份为 .bak
 *   3. 立即 reloadConfig()，**无需重启服务**即生效
 *
 * 需要登录 + admin.enabled + admin.allowConfigEdit。
 */
import { isAuthenticated } from '../../utils/auth'
import { siteConfig, configPath } from '../../utils/config'
import { applyPatch, ConfigValidationError, editableSections } from '../../utils/editable-config'

export default defineEventHandler(async (event) => {
  if (!siteConfig.admin.enabled) {
    throw createError({ statusCode: 404, message: 'Not Found' })
  }
  if (!isAuthenticated(event)) {
    throw createError({ statusCode: 401, message: '未登录' })
  }
  if (!siteConfig.admin.allowConfigEdit) {
    throw createError({ statusCode: 403, message: '配置已禁止在面板上修改（admin.allowConfigEdit = false）' })
  }

  const body = await readBody<{ patch?: unknown }>(event).catch(() => null)
  const patch = body?.patch
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw createError({ statusCode: 400, message: '请求体缺少 patch 对象' })
  }

  try {
    const result = applyPatch(patch as Record<string, unknown>)
    return {
      ok: true,
      written: result.written,
      path: result.path,
      backup: result.backup,
      // 回显最新的完整字段清单，前端无需再发一次 status
      sections: editableSections(),
      message: result.written.length
        ? `已保存 ${result.written.length} 项配置，立即生效`
        : '没有字段发生变化',
    }
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw createError({
        statusCode: 400,
        message: err.message,
        data: { fieldErrors: err.fieldErrors },
      })
    }
    throw createError({ statusCode: 500, message: (err as Error).message })
  }
})
