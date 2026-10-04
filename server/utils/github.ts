/**
 * GitHub 上游数据访问层。
 *
 * 设计要点（对应"动态站点而非静态站"的部署形态）：
 *   - 服务端在请求时拉取 GitHub，不在构建时固化，因此页面永远反映上游最新状态；
 *   - 结果写入进程内缓存，带 TTL 与 stale-while-error 回退：上游挂了/限流了，
 *     仍然把最近一次成功的数据吐给访客，而不是白屏；
 *   - 同一资源的并发请求会合并成一次上游调用（in-flight 去重），避免被限流；
 *   - 可选 GITHUB_TOKEN 提升配额（未配置时匿名 60 次/小时，也够用）。
 *
 * 注意：本模块只在服务端运行，token 不会进入客户端产物。
 */
import type { H3Event } from 'h3'
import { siteConfig, effectiveGitHubToken } from './config'

const API = 'https://api.github.com'
const OWNER = 'LiStudioorg'
const REPO = 'licore'

/** 单次上游请求超时，避免拖死 SSR 渲染 */
const FETCH_TIMEOUT_MS = 8000

export interface GitHubAsset {
  name: string
  size: number
  downloadCount: number
  browserDownloadUrl: string
  contentType: string | null
}

export interface GitHubRelease {
  id: number
  tagName: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  createdAt: string
  publishedAt: string
  htmlUrl: string
  tarballUrl: string
  zipballUrl: string
  author: { login: string; avatarUrl: string } | null
  assets: GitHubAsset[]
}

export interface GitHubTag {
  name: string
  sha: string
  zipUrl: string
  tarUrl: string
}

export interface GitHubCommit {
  sha: string
  shortSha: string
  message: string
  /** 提交信息首行 */
  subject: string
  /** 提交信息正文（首行之后的部分） */
  body: string
  /** 按 Conventional Commits 解析出的类型，如 feat / fix / docs */
  type: string | null
  /** 解析出的作用域，如 cli / runtime */
  scope: string | null
  url: string
  date: string
  authorName: string
  authorLogin: string | null
  authorAvatarUrl: string | null
}

export interface RepoMeta {
  name: string
  fullName: string
  description: string | null
  homepage: string | null
  htmlUrl: string
  stars: number
  forks: number
  openIssues: number
  watchers: number
  language: string | null
  license: string | null
  defaultBranch: string
  createdAt: string
  pushedAt: string
  updatedAt: string
  topics: string[]
  avatarUrl: string
  archived: boolean
}

/* ------------------------------------------------------------------ *
 * 缓存
 * ------------------------------------------------------------------ */

interface CacheEntry<T> {
  value: T
  /** 写入时间 */
  at: number
  /** 该条目的 TTL */
  ttl: number
}

const store = new Map<string, CacheEntry<unknown>>()
/** 进行中的请求，用于合并并发调用 */
const inflight = new Map<string, Promise<unknown>>()

function getFresh<T>(key: string): T | null {
  const hit = store.get(key) as CacheEntry<T> | undefined
  if (!hit) return null
  if (Date.now() - hit.at > hit.ttl) return null
  return hit.value
}

/** 取任意缓存（即使已过期），用于上游失败时的兜底 */
function getStale<T>(key: string): T | null {
  const hit = store.get(key) as CacheEntry<T> | undefined
  return hit ? hit.value : null
}

function setCache<T>(key: string, value: T, ttl: number) {
  store.set(key, { value, at: Date.now(), ttl })
}

/**
 * 带缓存与去重的取数封装。
 * @param key   缓存键
 * @param ttl   新鲜期（毫秒）
 * @param loader 真正的上游加载函数
 */
export async function cached<T>(
  key: string,
  ttl: number,
  loader: () => Promise<T>,
): Promise<T> {
  const fresh = getFresh<T>(key)
  if (fresh !== null) return fresh

  const pending = inflight.get(key) as Promise<T> | undefined
  if (pending) return pending

  const task = (async () => {
    try {
      const value = await loader()
      setCache(key, value, ttl)
      return value
    } catch (err) {
      // 上游失败：能用旧数据就用旧数据，保证站点可用性
      const stale = getStale<T>(key)
      if (stale !== null) {
        console.warn(`[github] ${key} 拉取失败，回退到缓存数据：`, (err as Error).message)
        return stale
      }
      throw err
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, task)
  return task
}

/* ------------------------------------------------------------------ *
 * 低层请求
 * ------------------------------------------------------------------ */

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'licore-website',
  }
  // token 优先级：环境变量 GITHUB_TOKEN/GH_TOKEN > 运行时文件 > TOML [github].token
  // 用 effectiveGitHubToken() 而非 siteConfig.github.token，这样后台写入的
  // 运行时 token 无需重启就能生效。
  const token = effectiveGitHubToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function ghFetch<T>(path: string, event?: H3Event): Promise<T> {
  const url = path.startsWith('http') ? path : `${API}${path}`

  const opts = {
    headers: authHeaders(),
    timeout: FETCH_TIMEOUT_MS,
    retry: 1,
    retryDelay: 400,
  }

  // 优先复用 Nuxt 的 $fetch（带重试与代理支持）
  const res = event
    ? await event.$fetch<unknown>(url, opts)
    : await $fetch<unknown>(url, opts)

  return res as T
}

/* ------------------------------------------------------------------ *
 * 数据整形
 * ------------------------------------------------------------------ */

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<desc>.+)$/i

function parseCommitMessage(message: string) {
  const [first = '', ...rest] = message.split('\n')
  const subject = first.trim()
  const body = rest.join('\n').trim()
  const m = CONVENTIONAL.exec(subject)
  if (!m?.groups) return { subject, body, type: null, scope: null }
  return {
    subject,
    body,
    type: (m.groups.type || '').toLowerCase() || null,
    scope: m.groups.scope?.trim() || null,
  }
}

function mapCommit(raw: any): GitHubCommit {
  const message: string = raw?.commit?.message ?? ''
  const parsed = parseCommitMessage(message)
  const sha: string = raw?.sha ?? ''
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    ...parsed,
    url: raw?.html_url ?? `https://github.com/${OWNER}/${REPO}/commit/${sha}`,
    date: raw?.commit?.committer?.date ?? raw?.commit?.author?.date ?? '',
    authorName: raw?.commit?.author?.name ?? 'unknown',
    authorLogin: raw?.author?.login ?? null,
    authorAvatarUrl: raw?.author?.avatar_url ?? null,
  }
}

function mapRelease(raw: any): GitHubRelease {
  return {
    id: raw?.id ?? 0,
    tagName: raw?.tag_name ?? '',
    name: raw?.name || raw?.tag_name || '',
    body: raw?.body ?? '',
    draft: Boolean(raw?.draft),
    prerelease: Boolean(raw?.prerelease),
    createdAt: raw?.created_at ?? '',
    publishedAt: raw?.published_at ?? raw?.created_at ?? '',
    htmlUrl: raw?.html_url ?? '',
    tarballUrl: raw?.tarball_url ?? '',
    zipballUrl: raw?.zipball_url ?? '',
    author: raw?.author
      ? { login: raw.author.login, avatarUrl: raw.author.avatar_url }
      : null,
    assets: Array.isArray(raw?.assets)
      ? raw.assets.map((a: any) => ({
          name: a?.name ?? '',
          size: a?.size ?? 0,
          downloadCount: a?.download_count ?? 0,
          browserDownloadUrl: a?.browser_download_url ?? '',
          contentType: a?.content_type ?? null,
        }))
      : [],
  }
}

function mapTag(raw: any): GitHubTag {
  const name: string = raw?.name ?? ''
  const sha: string = raw?.commit?.sha ?? ''
  return {
    name,
    sha,
    zipUrl: `https://codeload.github.com/${OWNER}/${REPO}/zip/refs/tags/${name}`,
    tarUrl: `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/tags/${name}`,
  }
}

/* ------------------------------------------------------------------ *
 * 对外 API
 * ------------------------------------------------------------------ */

/**
 * 各资源的缓存时长（毫秒）。
 *
 * 发行相关数据固定 5 分钟刷新一次：上游一发布新版本、或补上 Release 资产，
 * 官网最多 5 分钟后就会自动反映出来，无需重新部署。
 *
 * 优先级：环境变量 GITHUB_CACHE_TTL_SECONDS（统一覆盖，本地调试设为 5 即可秒级刷新）
 *        > licore-site.toml 的 [github] 段 > 内置默认值。
 */
const TTL_OVERRIDE = Number(process.env.GITHUB_CACHE_TTL_SECONDS) || 0
/** TOML 里按秒配置；同样受 GITHUB_CACHE_TTL_SECONDS 统一覆盖 */
const seconds = (n: number) => (TTL_OVERRIDE > 0 ? TTL_OVERRIDE * 1000 : n * 1000)

export const TTL = {
  /** 仓库元信息：变化慢，10 分钟 */
  repo: seconds(siteConfig.github.repo),
  /** 发行版：5 分钟刷新（核心要求） */
  releases: seconds(siteConfig.github.releases),
  /** 版本 tag：跟随发行版设置 */
  tags: seconds(siteConfig.github.releases),
  /** 提交记录：跟随发行版设置 */
  commits: seconds(siteConfig.github.releases),
  /** 贡献者：变化最慢，30 分钟 */
  contributors: seconds(siteConfig.github.contributors),
} as const

/** 供页面展示"数据新鲜度"与 API 缓存头使用 */
export const RELEASE_TTL_SECONDS = Math.round(TTL.releases / 1000)

export function getRepoMeta(event?: H3Event): Promise<RepoMeta> {
  return cached('repo', TTL.repo, async () => {
    const raw: any = await ghFetch(`/repos/${OWNER}/${REPO}`, event)
    return {
      name: raw.name,
      fullName: raw.full_name,
      description: raw.description ?? null,
      homepage: raw.homepage ?? null,
      htmlUrl: raw.html_url,
      stars: raw.stargazers_count ?? 0,
      forks: raw.forks_count ?? 0,
      openIssues: raw.open_issues_count ?? 0,
      watchers: raw.subscribers_count ?? raw.watchers_count ?? 0,
      language: raw.language ?? null,
      license: raw.license?.spdx_id ?? null,
      defaultBranch: raw.default_branch ?? 'main',
      createdAt: raw.created_at ?? '',
      pushedAt: raw.pushed_at ?? '',
      updatedAt: raw.updated_at ?? '',
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      avatarUrl: raw.owner?.avatar_url ?? '',
      archived: Boolean(raw.archived),
    }
  })
}

/** 仓库可能没有任何 Release（LiCore 当前就是这种情况），返回空数组而非报错 */
export function getReleases(event?: H3Event): Promise<GitHubRelease[]> {
  return cached('releases', TTL.releases, async () => {
    const raw: any = await ghFetch(
      `/repos/${OWNER}/${REPO}/releases?per_page=50`,
      event,
    )
    if (!Array.isArray(raw)) return []
    return raw.filter((r: any) => !r.draft).map(mapRelease)
  })
}

export function getTags(event?: H3Event): Promise<GitHubTag[]> {
  return cached('tags', TTL.tags, async () => {
    const raw: any = await ghFetch(`/repos/${OWNER}/${REPO}/tags?per_page=100`, event)
    if (!Array.isArray(raw)) return []
    return raw.map(mapTag)
  })
}

export function getCommits(limit = 60, event?: H3Event): Promise<GitHubCommit[]> {
  const perPage = Math.min(Math.max(limit, 1), 100)
  return cached(`commits:${perPage}`, TTL.commits, async () => {
    const raw: any = await ghFetch(
      `/repos/${OWNER}/${REPO}/commits?per_page=${perPage}`,
      event,
    )
    if (!Array.isArray(raw)) return []
    return raw.map(mapCommit)
  })
}

export interface Contributor {
  login: string
  avatarUrl: string
  htmlUrl: string
  contributions: number
}

export function getContributors(event?: H3Event): Promise<Contributor[]> {
  return cached('contributors', TTL.contributors, async () => {
    const raw: any = await ghFetch(
      `/repos/${OWNER}/${REPO}/contributors?per_page=50`,
      event,
    )
    if (!Array.isArray(raw)) return []
    return raw
      .filter((c: any) => c && c.type !== 'Bot')
      .map((c: any) => ({
        login: c.login,
        avatarUrl: c.avatar_url,
        htmlUrl: c.html_url,
        contributions: c.contributions ?? 0,
      }))
  })
}

/** 读取仓库内文件（如 README / docs），带短缓存 */
export function getRepoFile(path: string, event?: H3Event): Promise<string | null> {
  return cached(`file:${path}`, TTL.commits, async () => {
    try {
      const raw: any = await ghFetch(
        `/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}`,
        event,
      )
      if (!raw?.content) return null
      return Buffer.from(raw.content, raw.encoding === 'base64' ? 'base64' : 'utf-8').toString('utf-8')
    } catch {
      return null
    }
  })
}

/** 缓存与限流状态，供 /api/status 健康检查使用 */
export function cacheStats() {
  return {
    entries: [...store.entries()].map(([key, v]) => ({
      key,
      ageSeconds: Math.round((Date.now() - v.at) / 1000),
      ttlSeconds: Math.round(v.ttl / 1000),
      fresh: Date.now() - v.at <= v.ttl,
    })),
    inflight: [...inflight.keys()],
  }
}

/**
 * 清空数据缓存（后台面板的「清理缓存」用）。
 *
 * @param key 只清这一个键；不传则清空全部
 * @returns 实际被清掉的键名
 *
 * 注意只清 `store`，不动 `inflight`：正在飞的请求写回时还会填一次缓存，
 * 这是可接受的（下一次读取会拿到新数据），而去动 inflight 反而可能让
 * 等待中的调用者拿到被丢弃的 Promise。
 */
export function invalidateCache(key?: string): string[] {
  if (key) {
    const existed = store.delete(key)
    return existed ? [key] : []
  }
  const keys = [...store.keys()]
  store.clear()
  return keys
}
