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
 *
 * ⚠️ 本模块会被页面（`app/pages/*.vue`）经 `~~/server/utils/*` 静态引入，
 * 因此**也会被打进客户端 bundle**。而 `node:fs` / `node:path` 在浏览器里
 * 会被 Vite stub 成空对象、`process.cwd()` 没有对应全局，直接调用即抛错，
 * 导致整个客户端 chunk 在模块求值阶段崩溃、水合失败。
 * 所以下面对所有 Node 专属调用都加了 `IS_SERVER` 守卫：
 * 客户端一律拿不到配置文件，回退到内置默认值（站点文案用的是
 * `app/config/site.ts`，不受这里影响）。
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync, copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseToml } from 'smol-toml'

/** 仅服务端为 true；客户端构建里所有 fs / process.cwd 调用都会被跳过 */
const IS_SERVER = import.meta.server

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
    /** 是否允许在后台面板上可视化修改配置（写入 licore-site.toml） */
    allowConfigEdit: boolean
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
    allowConfigEdit: true,
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

/** 配置加载过程中产生的告警（每次 reload 重置后重新累积） */
let warnings: string[] = []

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
 * 运行时 GitHub Token（后台面板可写入，无需重启）
 *
 * 优先级：环境变量 GITHUB_TOKEN/GH_TOKEN > 运行时文件 > TOML [github].token
 *
 * 为什么要运行时文件：后台面板写入后立刻生效，不需要重启服务；
 * 也不要把 token 写进仓库里的 licore-site.toml（会被 git 追踪）。
 * 文件权限 0600，进程可读写，不提交到版本库。
 * ------------------------------------------------------------------ */

const RUNTIME_TOKEN_FILE = 'licore-runtime-token'

/** 读运行时 token 文件；文件不存在或为空返回 '' */
export function readRuntimeToken(): string {
  if (!IS_SERVER) return ''
  try {
    const p = resolve(process.cwd(), RUNTIME_TOKEN_FILE)
    if (!existsSync(p)) return ''
    return readFileSync(p, 'utf-8').trim()
  } catch {
    return ''
  }
}

/**
 * 写入运行时 token。传空字符串表示清除（回退到 env / TOML）。
 * @returns 实际生效的来源标识
 */
export function setRuntimeToken(token: string): { ok: boolean; source: string } {
  if (!IS_SERVER) return { ok: false, source: '' }
  const p = resolve(process.cwd(), RUNTIME_TOKEN_FILE)
  if (token.trim()) {
    writeFileSync(p, token.trim() + '\n', { encoding: 'utf-8', mode: 0o600 })
    try { chmodSync(p, 0o600) } catch { /* 某些文件系统不支持 chmod，忽略 */ }
    return { ok: true, source: 'runtime' }
  }
  try { unlinkSync(p) } catch { /* 文件本来就不存在 */ }
  return { ok: true, source: tokenSourceLabel() }
}

/** 当前 token 的来源标识，供后台面板展示 */
export function tokenSourceLabel(): string {
  if (!IS_SERVER) return 'env'
  if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) return 'env'
  if (readRuntimeToken()) return 'runtime'
  if (siteConfig.github.token) return 'toml'
  return 'none'
}

/**
 * 获取当前生效的 GitHub Token（优先级：env > runtime 文件 > TOML）。
 * 供 server/utils/github.ts 的 authHeaders() 调用。
 */
export function effectiveGitHubToken(): string {
  if (!IS_SERVER) return ''
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || readRuntimeToken() || siteConfig.github.token
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
  if (!IS_SERVER) return null
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
  if (!IS_SERVER) return {}
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
      allowConfigEdit: pickBool(
        a.allowConfigEdit,
        DEFAULTS.admin.allowConfigEdit,
        'admin.allowConfigEdit',
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

/* ------------------------------------------------------------------ *
 * 运行时可变配置
 *
 * 历史设计是「模块导入时读一次，之后永不变化」—— 改配置必须重启进程。
 * 后台面板加入「可视化编辑」后这个前提不再成立：改完要**立即生效**。
 *
 * 现在的做法：
 *   - `siteConfig` 导出的是一个**普通可变对象**，所有消费方（auth / github /
 *     api 路由）继续按属性读取，无需改动；
 *   - `reloadConfig()` 重新解析 TOML 并**原地改写**该对象的字段
 *     （in-place mutation 而非重新赋值，这样已 import 的模块持有的引用依然有效，
 *      不会出现"新配置只对新 import 生效"的坑）；
 *   - 写盘用 `writeConfigValues()`，按字段精确改写 TOML 文本以保留注释。
 * ------------------------------------------------------------------ */

/** 站点配置。**运行时可被 reloadConfig() 原地改写**，消费方直接读属性即可。 */
export const siteConfig: SiteConfig = build()

/** 最近一次成功 reload 的时间（ISO），供面板展示 */
let lastReloadAt = ''

export function configLastReloadAt(): string {
  return lastReloadAt
}

/**
 * 重新从磁盘加载配置，并**原地**更新 `siteConfig`。
 *
 * 注意：只有「配置文件里显式写了值」的字段才会被覆盖。
 * 面板写入走的是 `writeConfigValues()` + `reloadConfig()`，写入的就是显式值，
 * 因此不会出现"面板改了 A，结果 B 被默认值冲掉"的情况。
 */
export function reloadConfig(): SiteConfig {
  warnings = []
  const fresh = build()
  // 原地改写：保留对象引用，避免已持有引用的模块读到旧值
  siteConfig.site.url = fresh.site.url
  siteConfig.site.name = fresh.site.name
  siteConfig.site.icp = fresh.site.icp
  siteConfig.admin.enabled = fresh.admin.enabled
  siteConfig.admin.username = fresh.admin.username
  siteConfig.admin.password = fresh.admin.password
  siteConfig.admin.sessionHours = fresh.admin.sessionHours
  siteConfig.admin.allowCacheClear = fresh.admin.allowCacheClear
  siteConfig.admin.allowConfigEdit = fresh.admin.allowConfigEdit
  siteConfig.github.token = fresh.github.token
  siteConfig.github.releases = fresh.github.releases
  siteConfig.github.repo = fresh.github.repo
  siteConfig.github.contributors = fresh.github.contributors
  siteConfig.display.changelogMaxItems = fresh.display.changelogMaxItems
  siteConfig.display.showActivity = fresh.display.showActivity
  lastReloadAt = new Date().toISOString()
  return siteConfig
}

/** 配置加载过程中产生的告警，供后台面板展示 */
export function configWarnings(): string[] {
  return [...warnings]
}

/** 当前生效的配置文件路径，未找到时为 null */
export function configPath(): string | null {
  return resolveConfigPath()
}

/* ------------------------------------------------------------------ *
 * 写入 TOML
 *
 * 为什么不用 `stringify()` 整份重写：那会把用户精心写的注释、字段顺序、
 * 空行全部抹掉 —— 配置文件是给人看的，注释本身就是文档（README 明确
 * 让人去读注释改配置）。所以这里做**逐字段精确改写**：
 * 只动目标那一行的值，其余文本原样保留。
 * ------------------------------------------------------------------ */

/** 可被面板写入的字段，限定在 `[section] field` 白名单内 */
export interface WritableField {
  section: string
  field: string
  /** 写入 TOML 的字面量（字符串会自动加引号并转义） */
  tomlLiteral: string
}

/** TOML 基本字符串转义：反斜杠、双引号与控制字符 */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

export function tomlStringLiteral(value: string): string {
  return tomlString(value)
}

/**
 * 在 TOML 文本中定位 `[section]` 段落，返回该段落的行范围（不含段头行）。
 * 段落从 `[section]` 起，到下一个 `[` 开头的段头或文件结尾为止。
 */
function findSectionRange(lines: string[], section: string): { start: number; end: number } | null {
  const header = `[${section}]`
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === header) {
      start = i + 1
      break
    }
  }
  if (start === -1) return null

  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * 把若干字段写入 TOML 文本，返回新的文本内容。
 *
 * 规则：
 *   - 字段已存在（且未被注释掉）→ 只替换该行的值，保留行尾注释与缩进；
 *   - 字段不存在 → 在该段落末尾追加一行；
 *   - 段落不存在 → 在文件末尾追加段落（带一行说明注释）。
 *
 * 这是纯函数，不碰磁盘，便于单测与幂等性验证。
 */
export function applyTomlUpdates(text: string, updates: WritableField[]): string {
  let lines = text.split('\n')

  for (const { section, field, tomlLiteral } of updates) {
    const range = findSectionRange(lines, section)

    if (!range) {
      // 整段缺失：末尾补一个段落
      while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop()
      lines.push('', `[${section}]`, `${field} = ${tomlLiteral}`, '')
      continue
    }

    // 只匹配未被注释掉的行：行首（允许缩进）直接是 `field =`
    const assignment = new RegExp(`^(\\s*)${field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=`)
    let replaced = false
    for (let i = range.start; i < range.end; i++) {
      const m = lines[i]!.match(assignment)
      if (!m) continue
      // 保留原行尾注释：`field = old  # 说明`
      const rest = lines[i]!.slice(m[0].length)
      const hashIndex = findTrailingComment(rest)
      const trailing = hashIndex >= 0 ? `  ${rest.slice(hashIndex).trim()}` : ''
      lines[i] = `${m[1]}${field} = ${tomlLiteral}${trailing}`
      replaced = true
      break
    }

    if (!replaced) {
      // 段落存在但字段缺失（或被整行注释掉了）：插到段落末尾（跳过尾部空行）
      let insertAt = range.end
      while (insertAt > range.start && lines[insertAt - 1]!.trim() === '') insertAt--
      lines.splice(insertAt, 0, `${field} = ${tomlLiteral}`)
    }
  }

  return lines.join('\n')
}

/** 在值部分里找行尾注释的起点；字符串内的 # 不算 */
function findTrailingComment(rest: string): number {
  let inString = false
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!
    if (ch === '\\' && inString) {
      i++
      continue
    }
    if (ch === '"') inString = !inString
    else if (ch === '#' && !inString) return i
  }
  return -1
}

/** 写盘结果 */
export interface WriteConfigResult {
  ok: boolean
  path: string | null
  /** 备份文件路径（若已备份） */
  backup?: string
  error?: string
}

/**
 * 将白名单字段写入配置文件，并备份原文件。
 *
 * 失败时**不抛异常**，返回 `{ ok: false, error }`，由调用方决定怎么提示 ——
 * 写配置失败不该让整个面板 500。
 */
export function writeConfigValues(updates: WritableField[]): WriteConfigResult {
  if (!IS_SERVER) return { ok: false, path: null, error: '仅在服务端可用' }
  const path = resolveConfigPath()
  if (!path) {
    return { ok: false, path: null, error: '未找到配置文件（licore-site.toml），无法写入' }
  }

  try {
    const before = readFileSync(path, 'utf-8')
    const after = applyTomlUpdates(before, updates)

    // 写前先自检：改完的文本必须仍能被解析，否则宁可整个操作失败，
    // 也不能把站点配置写成一份语法错误的文件（那会让下次启动退回全部默认值）。
    try {
      parseToml(after)
    } catch (err) {
      return {
        ok: false,
        path,
        error: `改写后的配置无法解析，已放弃写入：${(err as Error).message}`,
      }
    }

    // 备份原文件，便于手工回滚
    const backup = `${path}.bak`
    copyFileSync(path, backup)

    writeFileSync(path, after, { encoding: 'utf-8', mode: 0o600 })
    try { chmodSync(path, 0o600) } catch { /* 某些文件系统不支持 chmod，忽略 */ }

    return { ok: true, path, backup }
  } catch (err) {
    return { ok: false, path, error: (err as Error).message }
  }
}
