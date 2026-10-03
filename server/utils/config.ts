/**
 * 站点配置文件（TOML）的加载与校验。
 *
 * 设计要点：
 *   - **只读一次**：模块首次导入时同步读取并解析，结果缓存在模块作用域内。
 *     SSR 站点在进程生命周期内配置是稳定的，改配置后重启服务即生效；
 *     这样避免每次请求都做一次磁盘 IO。
 *   - **容错优先**：配置文件不存在、格式错误、字段类型不对，都不应该让站点挂掉。
 *     一律退回内置默认值并打印告警 —— 官网因为一个手滑的 TOML 就 500 是不可接受的。
 *   - **环境变量优先**：`NUXT_PUBLIC_SITE_URL` / `GITHUB_TOKEN` 等环境变量
 *     优先级高于 TOML，便于容器化部署与 CI 覆盖，不必改动仓库里的文件。
 *
 * 注意：本文件只含站点自身的配置，**与 LiCore 引擎的 YAML 配置无关**。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

export interface SiteConfig {
  site: {
    url: string
    name: string
    icp: string
  }
  admin: {
    enabled: boolean
    username: string
    password: string
    sessionHours: number
    allowCacheClear: boolean
  }
  github: {
    token: string
    releases: number
    repo: number
    contributors: number
  }
  display: {
    changelogMaxItems: number
    showActivity: boolean
  }
}

/** 内置默认值。TOML 里缺失的字段一律回落到这里。 */
const DEFAULTS: SiteConfig = {
  site: {
    url: 'http://licore.z321.cc.cd',
    name: 'LiCore',
    icp: '',
  },
  admin: {
    enabled: true,
    username: 'admin',
    password: 'admin',
    sessionHours: 12,
    allowCacheClear: true,
  },
  github: {
    token: '',
    releases: 300,
    repo: 600,
    contributors: 1800,
  },
  display: {
    changelogMaxItems: 0,
    showActivity: true,
  },
}

/* ------------------------------------------------------------------ *
 * 取值助手：类型不对就用默认值，并记录一条告警
 * ------------------------------------------------------------------ */

const warnings: string[] = []

function warn(message: string) {
  warnings.push(message)
  console.warn(`[config] ${message}`)
}

function pickString(value: unknown, fallback: string, path: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') {
    warn(`${path} 期望字符串，实际是 ${typeof value}，已回退默认值`)
    return fallback
  }
  // 空字符串在 TOML 里是合法写法，但对外链/名称无意义，一并回退默认值
  return value.trim() || fallback
}

/** icp 是允许为空字符串的，单独处理 */
function pickOptionalString(value: unknown, fallback: string, path: string): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string') {
    warn(`${path} 期望字符串，实际是 ${typeof value}，已回退默认值`)
    return fallback
  }
  return value.trim()
}

function pickBool(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') {
    warn(`${path} 期望布尔值（true/false），实际是 ${typeof value}，已回退默认值`)
    return fallback
  }
  return value
}

function pickInt(value: unknown, fallback: number, path: string, min = 0): number {
  if (value === undefined) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) {
    warn(`${path} 期望数字，实际是 ${JSON.stringify(value)}，已回退默认值`)
    return fallback
  }
  const i = Math.floor(n)
  if (i < min) {
    warn(`${path} 不能小于 ${min}（当前 ${i}），已回退默认值`)
    return fallback
  }
  return i
}

/** 站点地址需要是 http(s) 开头的绝对地址，否则 canonical 会生成错的链接 */
function pickUrl(value: unknown, fallback: string, path: string): string {
  const raw = pickString(value, fallback, path)
  // 去掉结尾斜杠，避免拼出 http://x.com//changelog 这样的双斜杠
  const trimmed = raw.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    warn(`${path} 必须是 http:// 或 https:// 开头的绝对地址（当前 ${JSON.stringify(trimmed)}），已回退默认值`)
    return fallback
  }
  return trimmed
}

/* ------------------------------------------------------------------ *
 * 加载
 * ------------------------------------------------------------------ */

/**
 * 配置文件查找顺序（找到第一个就用）：
 *   1. 环境变量 LICORE_SITE_CONFIG 指定的路径
 *   2. 进程工作目录下的 licore-site.toml
 *   3. 项目根目录（本文件上溯两级）下的 licore-site.toml
 *
 * 第 3 条是为了让 `npm run dev` 与直接 `node .output/server/index.mjs`
 * 都能找到同一份配置。
 */
function resolveConfigPath(): string | null {
  const fromEnv = process.env.LICORE_SITE_CONFIG
  if (fromEnv) {
    const p = resolve(fromEnv)
    if (existsSync(p)) return p
    warn(`LICORE_SITE_CONFIG 指向的文件不存在：${p}，继续按默认路径查找`)
  }

  const candidates = [
    resolve(process.cwd(), 'licore-site.toml'),
    // server/utils/config.ts -> 项目根
    resolve(import.meta.dirname ?? '.', '../../licore-site.toml'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

function loadRaw(): Record<string, unknown> {
  const path = resolveConfigPath()
  if (!path) {
    warn('未找到 licore-site.toml，全部使用内置默认值')
    return {}
  }
  try {
    const text = readFileSync(path, 'utf-8')
    const parsed = parseToml(text)
    console.info(`[config] 已加载配置文件：${path}`)
    return (parsed ?? {}) as Record<string, unknown>
  } catch (err) {
    // TOML 语法错误、权限不足等：宁可跑默认值也不要让站点起不来
    warn(`解析 ${path} 失败，全部使用内置默认值：${(err as Error).message}`)
    return {}
  }
}

function section(raw: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = raw[key]
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    warn(`[${key}] 不是一个配置段（table），已忽略`)
    return {}
  }
  return value as Record<string, unknown>
}

function build(): SiteConfig {
  const raw = loadRaw()
  const s = section(raw, 'site')
  const a = section(raw, 'admin')
  const g = section(raw, 'github')
  const d = section(raw, 'display')

  const config: SiteConfig = {
    site: {
      // 站点地址：环境变量 > TOML > 默认值
      url: pickUrl(
        process.env.NUXT_PUBLIC_SITE_URL || s.url,
        DEFAULTS.site.url,
        'site.url',
      ),
      name: pickString(s.name, DEFAULTS.site.name, 'site.name'),
      icp: pickOptionalString(s.icp, DEFAULTS.site.icp, 'site.icp'),
    },
    admin: {
      enabled: pickBool(a.enabled, DEFAULTS.admin.enabled, 'admin.enabled'),
      username: pickString(a.username, DEFAULTS.admin.username, 'admin.username'),
      // 密码不做 trim：前后空格可能是用户有意为之
      password:
        typeof a.password === 'string' && a.password.length > 0
          ? a.password
          : DEFAULTS.admin.password,
      sessionHours: pickInt(a.sessionHours, DEFAULTS.admin.sessionHours, 'admin.sessionHours', 1),
      allowCacheClear: pickBool(
        a.allowCacheClear,
        DEFAULTS.admin.allowCacheClear,
        'admin.allowCacheClear',
      ),
    },
    github: {
      // token：环境变量 > TOML；环境变量优先可以避免把密钥写进仓库
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || pickOptionalString(g.token, '', 'github.token'),
      releases: pickInt(g.releases, DEFAULTS.github.releases, 'github.releases', 1),
      repo: pickInt(g.repo, DEFAULTS.github.repo, 'github.repo', 1),
      contributors: pickInt(g.contributors, DEFAULTS.github.contributors, 'github.contributors', 1),
    },
    display: {
      changelogMaxItems: pickInt(
        d.changelogMaxItems,
        DEFAULTS.display.changelogMaxItems,
        'display.changelogMaxItems',
      ),
      showActivity: pickBool(d.showActivity, DEFAULTS.display.showActivity, 'display.showActivity'),
    },
  }

  // 默认密码告警：只在后台启用时提示，避免开发环境噪音
  if (config.admin.enabled && config.admin.password === 'admin') {
    warn('后台面板正在使用默认密码 admin，请在生产环境修改 licore-site.toml 的 admin.password')
  }

  return config
}

/** 站点配置（进程内只构建一次） */
export const siteConfig: SiteConfig = build()

/** 配置加载过程中产生的告警，供后台面板展示 */
export function configWarnings(): string[] {
  return [...warnings]
}

/** 当前生效的配置文件路径，未找到时为 null */
export function configPath(): string | null {
  return resolveConfigPath()
}
