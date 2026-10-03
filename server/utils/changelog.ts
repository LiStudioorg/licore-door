/**
 * 更新日志与下载项的聚合层。
 *
 * 上游现状（2026-10 核查）：LiCore 仓库**没有任何 GitHub Release**，
 * 只有 git tag（v0.1.0 ~ v0.7.0），且没有 CI 上传二进制。
 * 因此这里做"自动适配 + 回退"：
 *
 *   1. 有 Release 资产  → 直接用官方二进制下载链接；
 *   2. 有 Release 无资产 → 用 Release 的正文作为更新日志，下载回退到源码包；
 *   3. 完全没有 Release  → 以 tag 为版本轴，用该 tag 到上一个 tag 之间的
 *                          commit 自动合成更新日志，下载用 codeload 源码包。
 *
 * 一旦上游补上 Release / CI 产物，站点会**无需改代码**自动切换到真实资产。
 */
import type { H3Event } from 'h3'
import {
  getCommits,
  getReleases,
  getRepoMeta,
  getTags,
  type GitHubCommit,
  type GitHubRelease,
  type GitHubTag,
} from './github'

export interface DownloadItem {
  label: string
  os: string
  arch: string
  /** 直接下载地址 */
  url: string
  /** 文件体积，未知为 null */
  size: number | null
  /** 是否为真正的二进制产物；false 表示源码包 */
  isBinary: boolean
  recommended: boolean
  note: string
}

export interface ChangeGroup {
  /** raw = 直接来自 Release 正文；generated = 由 commit 合成 */
  kind: 'raw' | 'generated'
  title: string
  /** 结构化条目（generated 时可用） */
  items: { type: string | null; scope: string | null; text: string; sha?: string }[]
  /** 原始 markdown（raw 时可用） */
  markdown: string | null
}

export interface VersionEntry {
  /** 版本号，如 v0.7.0 */
  version: string
  /** 版本号不含 v 前缀 */
  versionNumber: string
  name: string
  /** ISO 时间 */
  date: string
  isPrerelease: boolean
  /** 该版本是否来自真实 Release */
  hasRelease: boolean
  /** 是否有官方二进制资产 */
  hasBinaries: boolean
  htmlUrl: string
  summary: string
  changes: ChangeGroup
  downloads: DownloadItem[]
  commits: GitHubCommit[]
  commitCount: number
  tags: GitHubTag
}

export interface ChangelogPayload {
  versions: VersionEntry[]
  /** 数据来源说明，用于页面上如实告知访客 */
  source: {
    mode: 'release-assets' | 'release-notes' | 'tags-and-commits'
    hasReleases: boolean
    releaseCount: number
    tagCount: number
    note: string
  }
  fetchedAt: string
  latestVersion: string | null
}

/* ------------------------------------------------------------------ */

const OWNER = 'LiStudioorg'
const REPO = 'licore'

/** 把 tag 名转成可比较的版本数组：v0.7.1 -> [0,7,1] */
function versionParts(tag: string): number[] {
  const cleaned = tag.replace(/^v/i, '').split('-')[0] ?? ''
  return cleaned.split('.').map((n) => Number.parseInt(n, 10) || 0)
}

/** 语义化版本降序（新版本在前） */
export function compareVersionDesc(a: string, b: string): number {
  const pa = versionParts(a)
  const pb = versionParts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function isPrereleaseTag(tag: string): boolean {
  return /-(alpha|beta|rc|pre|dev|next)/i.test(tag)
}

function humanSize(bytes: number): string {
  if (!bytes) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatBytes(bytes: number | null): string {
  return bytes === null ? '' : humanSize(bytes)
}

/** 从 Release 资产文件名里识别目标平台 */
function classifyAsset(name: string): { os: string; arch: string } | null {
  const n = name.toLowerCase()
  const os = n.includes('android')
    ? 'Android'
    : n.includes('darwin') || n.includes('macos') || n.includes('mac')
      ? 'macOS'
      : n.includes('linux')
        ? 'Linux'
        : n.includes('windows') || n.includes('win')
          ? 'Windows'
          : null
  if (!os) return null
  const arch = n.includes('arm64') || n.includes('aarch64')
    ? 'arm64'
    : n.includes('amd64') || n.includes('x86_64')
      ? 'amd64'
      : n.includes('riscv64')
        ? 'riscv64'
        : n.includes('386') || n.includes('i386')
          ? '386'
          : n.includes('arm')
            ? 'arm'
            : '通用'
  return { os, arch }
}

/** 源码包下载项（回退路径） */
function sourceDownloads(tag: GitHubTag, recommended: boolean): DownloadItem[] {
  return [
    {
      label: `${tag.name} 源码包 (.tar.gz)`,
      os: '源码',
      arch: 'tar.gz',
      url: tag.tarUrl,
      size: null,
      isBinary: false,
      recommended,
      note: '完整源码归档，需自行用 Go 编译',
    },
    {
      label: `${tag.name} 源码包 (.zip)`,
      os: '源码',
      arch: 'zip',
      url: tag.zipUrl,
      size: null,
      isBinary: false,
      recommended: false,
      note: '完整源码归档，需自行用 Go 编译',
    },
  ]
}

/** 由 Release 资产构造下载项 */
function assetDownloads(release: GitHubRelease): DownloadItem[] {
  return release.assets
    .map((asset) => {
      const cls = classifyAsset(asset.name)
      return {
        label: asset.name,
        os: cls?.os ?? '其他',
        arch: cls?.arch ?? '—',
        url: asset.browserDownloadUrl,
        size: asset.size,
        isBinary: true,
        recommended: /linux[-_]amd64/i.test(asset.name),
        note: `官方构建产物 · 已下载 ${asset.downloadCount} 次`,
      }
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended))
}

/** 把 commit 列表按 Conventional Commits 类型分组 */
const TYPE_LABELS: Record<string, string> = {
  feat: '新特性',
  fix: '修复',
  docs: '文档',
  build: '构建',
  ci: '持续集成',
  perf: '性能',
  refactor: '重构',
  test: '测试',
  chore: '杂项',
  style: '样式',
  revert: '回滚',
}

const TYPE_ORDER = ['feat', 'fix', 'perf', 'refactor', 'build', 'ci', 'docs', 'test', 'chore', 'style', 'revert']

function groupCommits(commits: GitHubCommit[]) {
  const buckets = new Map<string, { type: string | null; scope: string | null; text: string; sha?: string }[]>()
  for (const c of commits) {
    const key = c.type && TYPE_LABELS[c.type] ? c.type : 'other'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push({
      type: c.type,
      scope: c.scope,
      text: c.subject,
      sha: c.shortSha,
    })
  }
  return [...buckets.entries()]
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0])
      const ib = TYPE_ORDER.indexOf(b[0])
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([key, items]) => ({
      key,
      title: TYPE_LABELS[key] ?? '其他改动',
      items,
    }))
}

/** 取 Release 正文里的第一段有意义的文字作为摘要 */
function summarize(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  const firstSentence = plain.split(/(?<=[。！？.!?])\s/)[0] ?? plain
  return firstSentence.slice(0, 160)
}

/* ------------------------------------------------------------------ */

/**
 * 汇总更新日志。这是"自动拉取更新日志和发行版下载链接"的核心实现。
 */
export async function buildChangelog(event?: H3Event): Promise<ChangelogPayload> {
  const [releases, tags, commits, meta] = await Promise.all([
    getReleases(event).catch(() => [] as GitHubRelease[]),
    getTags(event).catch(() => [] as GitHubTag[]),
    getCommits(100, event).catch(() => [] as GitHubCommit[]),
    getRepoMeta(event).catch(() => null),
  ])

  const sortedTags = [...tags].sort((a, b) => compareVersionDesc(a.name, b.name))
  const releasesByTag = new Map(releases.map((r) => [r.tagName, r]))

  const versions: VersionEntry[] = []
  const usedTags = new Set<string>()

  // 1) 以真实 Release 为最高优先级
  for (const release of releases) {
    const tag =
      sortedTags.find((t) => t.name === release.tagName) ??
      ({
        name: release.tagName,
        sha: '',
        zipUrl: release.zipballUrl || `https://codeload.github.com/${OWNER}/${REPO}/zip/refs/tags/${release.tagName}`,
        tarUrl: release.tarballUrl || `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/tags/${release.tagName}`,
      } satisfies GitHubTag)
    usedTags.add(release.tagName)

    const binaries = assetDownloads(release)
    versions.push({
      version: release.tagName,
      versionNumber: release.tagName.replace(/^v/i, ''),
      name: release.name,
      date: release.publishedAt || release.createdAt,
      isPrerelease: release.prerelease || isPrereleaseTag(release.tagName),
      hasRelease: true,
      hasBinaries: binaries.length > 0,
      htmlUrl: release.htmlUrl,
      summary: summarize(release.body || release.name),
      changes: {
        kind: 'raw',
        title: release.name || release.tagName,
        items: [],
        markdown: release.body || '',
      },
      downloads: binaries.length > 0 ? binaries : sourceDownloads(tag, true),
      commits: [],
      commitCount: 0,
      tags: tag,
    })
  }

  // 2) 没有 Release 的 tag：用 tag 区间内的 commit 合成更新日志
  for (let i = 0; i < sortedTags.length; i++) {
    const tag = sortedTags[i]!
    if (usedTags.has(tag.name)) continue

    const prevTag = sortedTags[i + 1]
    const newerCommitIdx = commits.findIndex((c) => c.sha === tag.sha)

    // 该 tag 与上一个 tag 之间的提交
    let rangeCommits: GitHubCommit[] = []
    if (newerCommitIdx >= 0) {
      const end = prevTag ? commits.findIndex((c) => c.sha === prevTag.sha) : -1
      rangeCommits = commits.slice(newerCommitIdx, end === -1 ? commits.length : end)
    }

    // 靠 commit 时间推断发布日期（tag API 不返回时间）
    const date = rangeCommits[0]?.date ?? ''

    const groups = groupCommits(rangeCommits)
    versions.push({
      version: tag.name,
      versionNumber: tag.name.replace(/^v/i, ''),
      name: tag.name,
      date,
      isPrerelease: isPrereleaseTag(tag.name),
      hasRelease: false,
      hasBinaries: false,
      htmlUrl: `${meta?.htmlUrl ?? `https://github.com/${OWNER}/${REPO}`}/releases/tag/${tag.name}`,
      summary:
        rangeCommits.length > 0
          ? `本版本包含 ${rangeCommits.length} 次提交。点击展开查看按类型归类的完整改动明细。`
          : '该版本为历史存档 tag，未发布对应的 GitHub Release。',
      changes: {
        kind: 'generated',
        title: tag.name,
        items: groups.flatMap((g) => g.items),
        markdown: null,
      },
      downloads: sourceDownloads(tag, i === 0 && releases.length === 0),
      commits: rangeCommits,
      commitCount: rangeCommits.length,
      tags: tag,
    })
  }

  // 3) 兜底：仓库连 tag 都没有时，用最近提交合成一个"开发中"条目
  if (versions.length === 0 && commits.length > 0) {
    const head = commits[0]!
    const groups = groupCommits(commits)
    versions.push({
      version: '开发版',
      versionNumber: 'dev',
      name: 'main 分支最新改动',
      date: head.date,
      isPrerelease: true,
      hasRelease: false,
      hasBinaries: false,
      htmlUrl: `${meta?.htmlUrl ?? `https://github.com/${OWNER}/${REPO}`}/commits/${meta?.defaultBranch ?? 'main'}`,
      summary: `上游尚未发布任何版本号，此处展示 ${meta?.defaultBranch ?? 'main'} 分支最近的 ${commits.length} 次提交。`,
      changes: {
        kind: 'generated',
        title: 'main 分支改动',
        items: groups.flatMap((g) => g.items),
        markdown: null,
      },
      downloads: [
        {
          label: 'main 分支源码包 (.tar.gz)',
          os: '源码',
          arch: 'tar.gz',
          url: `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/heads/${meta?.defaultBranch ?? 'main'}`,
          size: null,
          isBinary: false,
          recommended: true,
          note: '开发版源码，功能可能不稳定',
        },
        {
          label: 'main 分支源码包 (.zip)',
          os: '源码',
          arch: 'zip',
          url: `https://codeload.github.com/${OWNER}/${REPO}/zip/refs/heads/${meta?.defaultBranch ?? 'main'}`,
          size: null,
          isBinary: false,
          recommended: false,
          note: '开发版源码，功能可能不稳定',
        },
      ],
      commits,
      commitCount: commits.length,
      tags: {
        name: meta?.defaultBranch ?? 'main',
        sha: head.sha,
        zipUrl: '',
        tarUrl: '',
      },
    })
  }

  const hasReleases = releases.length > 0
  const hasAnyBinary = versions.some((v) => v.hasBinaries)
  const mode: ChangelogPayload['source']['mode'] = hasAnyBinary
    ? 'release-assets'
    : hasReleases
      ? 'release-notes'
      : 'tags-and-commits'

  const note =
    mode === 'release-assets'
      ? '版本信息与二进制下载链接均来自 GitHub Release，由站点服务端实时拉取并缓存。'
      : mode === 'release-notes'
        ? '版本说明来自 GitHub Release 正文；上游暂未上传二进制产物，下载区自动回退为源码包。'
        : '上游仓库当前尚未创建任何 GitHub Release，版本轴与更新日志由 git tag 与提交记录自动合成，下载区提供官方源码归档及本地编译指引。'

  return {
    versions,
    source: {
      mode,
      hasReleases,
      releaseCount: releases.length,
      tagCount: tags.length,
      note,
    },
    fetchedAt: new Date().toISOString(),
    latestVersion: sortedTags[0]?.name ?? versions[0]?.version ?? null,
  }
}

/** 只取最新版本，首页用 */
export async function getLatestVersion(event?: H3Event): Promise<VersionEntry | null> {
  const log = await buildChangelog(event)
  return log.versions.find((v) => !v.isPrerelease) ?? log.versions[0] ?? null
}

/**
 * 汇总所有可下载项，去重后返回（下载页用）。
 * 优先返回最新版本的产物。
 */
export async function buildDownloads(event?: H3Event) {
  const [log, meta] = await Promise.all([buildChangelog(event), getRepoMeta(event).catch(() => null)])
  const latest = log.versions.find((v) => v.hasBinaries) ?? log.versions[0] ?? null

  return {
    latest,
    versions: log.versions,
    source: log.source,
    repo: meta,
    fetchedAt: log.fetchedAt,
  }
}
