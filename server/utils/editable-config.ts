/**
 * 后台面板「配置可视化编辑」的字段定义与校验。
 *
 * 把「哪些字段可改、怎么校验、怎么写回 TOML」集中在这个文件里，
 * 面板 UI 只负责渲染 —— 服务端返回的字段元数据即界面结构，
 * 避免前后端各写一份列表、改一处漏一处。
 *
 * 安全边界：
 *   - 白名单制。只有本文件登记的字段能被写入，任何未登记字段一律拒绝，
 *     避免面板被当成任意文件写入的入口。
 *   - **不在白名单内的敏感字段**：`admin.password` / `admin.username` /
 *     `github.token`。它们各自有专门的通道（token 走 token.set 接口），
 *     或者刻意不提供在线修改（改密码要求先证明持有当前密码，
 *     而面板本身已登录，等价于能改任何人的密码，风险与收益不成比例）。
 */
import {
  siteConfig,
  writeConfigValues,
  reloadConfig,
  tomlStringLiteral,
  type WritableField,
} from './config'

/** 字段的可视化编辑元数据 */
export interface EditableField {
  /** 全局唯一键，`section.field` 形式 */
  key: string
  section: string
  field: string
  label: string
  /** 说明文字，直接展示在输入框下方 */
  hint: string
  type: 'text' | 'url' | 'number' | 'boolean'
  /** 数字类型的取值范围 */
  min?: number
  max?: number
  /** 当前生效值 */
  value: string | number | boolean
  /** 该字段是否被环境变量覆盖（覆盖时面板不可改，只能提示） */
  lockedByEnv?: string
}

export interface EditableSection {
  key: string
  title: string
  description: string
  fields: EditableField[]
}

/** 面板可编辑字段的校验规则 */
interface FieldRule {
  section: string
  field: string
  label: string
  hint: string
  type: EditableField['type']
  min?: number
  max?: number
  /** 自定义校验：返回错误信息字符串表示不通过 */
  validate?: (value: string) => string | null
  /** 从当前生效配置里取值 */
  read: () => string | number | boolean
  /** 转成 TOML 字面量 */
  write: (value: string) => string
  /** 该字段被哪个环境变量覆盖时只读 */
  envVar?: string
}

function validateUrl(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) {
    return '必须是 http:// 或 https:// 开头的绝对地址'
  }
  try {
    new URL(value)
  } catch {
    return '不是合法的 URL'
  }
  return null
}

export const FIELD_RULES: FieldRule[] = [
  /* ---------------- [site] ---------------- */
  {
    section: 'site',
    field: 'url',
    label: '站点规范地址',
    hint: '用于 canonical、og:url 与 sitemap 的绝对地址。换域名后 nginx 的 server_name 也要同步改。',
    type: 'url',
    envVar: 'NUXT_PUBLIC_SITE_URL',
    validate: validateUrl,
    read: () => siteConfig.site.url,
    write: (v) => tomlStringLiteral(v.replace(/\/+$/, '')),
  },
  {
    section: 'site',
    field: 'name',
    label: '站点名称',
    hint: '出现在浏览器标题模板与页脚。',
    type: 'text',
    validate: (v) => (v.trim() ? null : '站点名称不能为空'),
    read: () => siteConfig.site.name,
    write: (v) => tomlStringLiteral(v.trim()),
  },
  {
    section: 'site',
    field: 'icp',
    label: '备案号 / 版权补充',
    hint: '显示在页脚。留空则只显示默认版权行，例如：京ICP备00000000号',
    type: 'text',
    read: () => siteConfig.site.icp,
    write: (v) => tomlStringLiteral(v.trim()),
  },

  /* ---------------- [display] ---------------- */
  {
    section: 'display',
    field: 'changelogMaxItems',
    label: '更新日志条目上限',
    hint: '更新日志页每个版本默认展开的变更条数，超出部分折叠。0 表示不限制。',
    type: 'number',
    min: 0,
    max: 500,
    read: () => siteConfig.display.changelogMaxItems,
    write: (v) => String(Number(v)),
  },
  {
    section: 'display',
    field: 'showActivity',
    label: '首页活动流',
    hint: '关闭后首页不再展示「最近提交」区块，同时省掉一次上游提交列表请求。',
    type: 'boolean',
    read: () => siteConfig.display.showActivity,
    write: (v) => (v === 'true' ? 'true' : 'false'),
  },
]

/** 按 `section.field` 找规则 */
function findRule(section: string, field: string): FieldRule | undefined {
  return FIELD_RULES.find((r) => r.section === section && r.field === field)
}

/** 字段是否被环境变量锁定 */
function lockedBy(rule: FieldRule): string | undefined {
  if (!rule.envVar) return undefined
  return process.env[rule.envVar] ? rule.envVar : undefined
}

/**
 * 生成用于面板渲染的字段清单。
 * 顺带标出被环境变量覆盖而**面板改不动**的字段 —— 否则用户改了没效果，
 * 会误以为是面板坏了。
 */
export function editableSections(): EditableSection[] {
  const sectionMeta: Record<string, { title: string; description: string }> = {
    site: {
      title: '站点信息',
      description: '影响 SEO 输出（canonical / sitemap）与页面标题、页脚。',
    },
    display: {
      title: '页面展示',
      description: '控制页面上的内容展示方式，不影响上游数据聚合。',
    },
  }

  const grouped = new Map<string, EditableField[]>()
  for (const rule of FIELD_RULES) {
    const list = grouped.get(rule.section) ?? []
    list.push({
      key: `${rule.section}.${rule.field}`,
      section: rule.section,
      field: rule.field,
      label: rule.label,
      hint: rule.hint,
      type: rule.type,
      min: rule.min,
      max: rule.max,
      value: rule.read(),
      lockedByEnv: lockedBy(rule),
    })
    grouped.set(rule.section, list)
  }

  return [...grouped.entries()].map(([key, fields]) => ({
    key,
    title: sectionMeta[key]?.title ?? key,
    description: sectionMeta[key]?.description ?? '',
    fields,
  }))
}

/** 单次提交的校验结果 */
export interface ValidatedUpdate {
  updates: WritableField[]
  /** 归一化后的值，便于回显 */
  normalized: Record<string, string | number | boolean>
}

export class ConfigValidationError extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

/**
 * 校验面板提交的配置补丁，返回可直接写盘的字段列表。
 *
 * @param patch `{ 'site.url': '...', 'display.showActivity': false }`
 */
export function validatePatch(patch: Record<string, unknown>): ValidatedUpdate {
  const updates: WritableField[] = []
  const normalized: Record<string, string | number | boolean> = {}
  const fieldErrors: Record<string, string> = {}

  const entries = Object.entries(patch)
  if (entries.length === 0) {
    throw new ConfigValidationError('没有需要更新的字段')
  }

  for (const [key, raw] of entries) {
    const dot = key.indexOf('.')
    if (dot <= 0) {
      fieldErrors[key] = '字段名格式应为 section.field'
      continue
    }
    const section = key.slice(0, dot)
    const field = key.slice(dot + 1)

    // 白名单校验：未登记的字段直接拒绝，不给任何写入机会
    const rule = findRule(section, field)
    if (!rule) {
      fieldErrors[key] = '该字段不允许在面板上修改'
      continue
    }

    // 环境变量优先：被覆盖时面板写入不会生效，直接拒绝并说明原因
    const locked = lockedBy(rule)
    if (locked) {
      fieldErrors[key] = `该字段已被环境变量 ${locked} 覆盖，请改环境变量后重启服务`
      continue
    }

    // 类型归一化
    let textValue: string
    if (rule.type === 'boolean') {
      if (typeof raw === 'boolean') textValue = raw ? 'true' : 'false'
      else if (raw === 'true' || raw === 'false') textValue = raw
      else {
        fieldErrors[key] = '应为布尔值（开启 / 关闭）'
        continue
      }
      normalized[key] = textValue === 'true'
    } else if (rule.type === 'number') {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) {
        fieldErrors[key] = '应为数字'
        continue
      }
      const int = Math.floor(n)
      if (rule.min !== undefined && int < rule.min) {
        fieldErrors[key] = `不能小于 ${rule.min}`
        continue
      }
      if (rule.max !== undefined && int > rule.max) {
        fieldErrors[key] = `不能大于 ${rule.max}`
        continue
      }
      textValue = String(int)
      normalized[key] = int
    } else {
      if (typeof raw !== 'string') {
        fieldErrors[key] = '应为文本'
        continue
      }
      textValue = rule.type === 'url' ? raw.trim().replace(/\/+$/, '') : raw
      if (rule.validate) {
        const err = rule.validate(textValue)
        if (err) {
          fieldErrors[key] = err
          continue
        }
      }
      normalized[key] = textValue
    }

    updates.push({ section, field, tomlLiteral: rule.write(textValue) })
  }

  if (Object.keys(fieldErrors).length) {
    throw new ConfigValidationError('部分字段校验未通过', fieldErrors)
  }

  return { updates, normalized }
}

/** 写盘 + 立即重载，返回实际生效的新配置 */
export function applyPatch(patch: Record<string, unknown>): {
  written: string[]
  path: string | null
  backup?: string
  changed: Record<string, string | number | boolean>
} {
  const { updates, normalized } = validatePatch(patch)

  const result = writeConfigValues(updates)
  if (!result.ok) {
    throw new ConfigValidationError(result.error || '写入配置文件失败')
  }

  // 关键：立即重载，无需重启服务
  reloadConfig()

  return {
    written: updates.map((u) => `${u.section}.${u.field}`),
    path: result.path,
    backup: result.backup,
    changed: normalized,
  }
}
