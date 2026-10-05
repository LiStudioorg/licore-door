<script setup lang="ts">
import { Button, Card, Badge } from 'fuxsto-design'
import {
  Rss,
  Github,
  Info,
  Download,
  GitCommitHorizontal,
  Search,
  Filter,
  ExternalLink,
} from 'lucide-vue-next'
import { repo, site } from '~/config/site'
import type { ChangelogPayload, VersionEntry } from '~~/server/utils/changelog'

/** /api/changelog 在 ChangelogPayload 之外多带一个 ttlSeconds（页面展示"服务端缓存 N 分钟"） */
interface ChangelogApi extends ChangelogPayload {
  ttlSeconds: number
}

/**
 * 更新日志页。
 * 服务端每次请求都（经 5 分钟缓存）重新聚合 GitHub 上的 tag / Release / commit，
 * 所以无需重新部署，页面就会反映上游最新发布。
 *
 * 必须走 useAsyncData + server: true（同首页）：
 *   - 结果写进 SSR payload，客户端水合不会重跑 loader；
 *   - 原来直接 `await buildChangelog()` 没有 catch，一旦上游请求失败，
 *     setup 直接抛错，整页白屏。
 */
const FALLBACK_LOG: ChangelogApi = {
  versions: [],
  source: {
    mode: 'tags-and-commits',
    hasReleases: false,
    releaseCount: 0,
    tagCount: 0,
    note: '上游暂时无法访问，稍后刷新即可。',
  },
  fetchedAt: '',
  latestVersion: null,
  ttlSeconds: 300,
}

const { data: logData } = await useAsyncData<ChangelogApi | null>(
  'changelog-data',
  () => $fetch<ChangelogApi>('/api/changelog').catch(() => null),
  { server: true },
)

/** 生效的展示开关（后台面板可改）：changelogMaxItems 控制每个版本默认展开的条数 */
const siteRuntime = useDisplayConfig()

const log = logData.value ?? FALLBACK_LOG

const versions = log.versions
const allItems = versions.flatMap((v) => v.changes.items)

/** 兜底时间戳为空时 new Date('') 会得到 Invalid Date，模板里直接格式化会打印 "Invalid Date" */
const fetchedAtText = log.fetchedAt
  ? `${formatDate(log.fetchedAt)} ${new Date(log.fetchedAt).toLocaleTimeString('zh-CN')}`
  : '尚未同步'

const keyword = ref('')
const typeFilter = ref<string>('all')
const binaryOnly = ref(false)

/** 可筛选的提交类型 */
const typeOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const item of allItems) {
    const key = item.type ?? 'other'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const labels: Record<string, string> = {
    feat: '新特性',
    fix: '修复',
    docs: '文档',
    build: '构建',
    ci: '持续集成',
    perf: '性能',
    refactor: '重构',
    test: '测试',
    chore: '杂项',
    other: '其他',
  }
  return [
    { value: 'all', label: `全部类型（${allItems.length}）` },
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ value: k, label: `${labels[k] ?? k}（${n}）` })),
  ]
})

/** 应用筛选后的版本列表 */
const filtered = computed<VersionEntry[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return versions
    .filter((v) => (binaryOnly.value ? v.hasBinaries : true))
    .map((v) => {
      let items = v.changes.items
      if (typeFilter.value !== 'all') {
        items = items.filter((i) => (i.type ?? 'other') === typeFilter.value)
      }
      if (kw) {
        items = items.filter(
          (i) =>
            i.text.toLowerCase().includes(kw) ||
            (i.scope ?? '').toLowerCase().includes(kw),
        )
      }
      return { ...v, changes: { ...v.changes, items } }
    })
    .filter((v) => {
      if (typeFilter.value === 'all' && !keyword.value.trim()) return true
      // Release 正文型条目没有结构化 items，此时按版本号/摘要匹配
      if (v.changes.kind === 'raw') {
        const hay = `${v.version} ${v.name} ${v.summary}`.toLowerCase()
        const kw = keyword.value.trim().toLowerCase()
        return typeFilter.value === 'all' && (!kw || hay.includes(kw))
      }
      return v.changes.items.length > 0
    })
})

const isFiltering = computed(() => typeFilter.value !== 'all' || Boolean(keyword.value.trim()) || binaryOnly.value)

const latestVersion = versions.find((v) => !v.isPrerelease) ?? versions[0] ?? null

const sourceLabel: Record<string, string> = {
  'release-assets': 'GitHub Release 资产',
  'release-notes': 'GitHub Release 说明',
  'tags-and-commits': 'git tag + 提交记录',
}

/* ---------------- SEO ---------------- */
/** ⚠️ 控制在 80 个汉字以内，超出会被 Google 按像素截断（见 index.vue 的说明） */
const description = `LiCore 全部版本更新日志，共 ${versions.length} 个版本${latestVersion ? `，最新为 ${latestVersion.version}` : ''}，由服务端自动从 GitHub 聚合。`

usePageSeo(
  {
    title: '更新日志',
    description,
    ogTitle: `LiCore 更新日志 — 全部 ${versions.length} 个版本`,
    ogDescription: description,
    ogUrl: `${site.url}/changelog`,
    twitterTitle: 'LiCore 更新日志',
    twitterDescription: description,
  },
  { path: '/changelog' },
)

useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: site.url },
          { '@type': 'ListItem', position: 2, name: '更新日志', item: `${site.url}/changelog` },
        ],
      }),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'LiCore 版本列表',
        numberOfItems: versions.length,
        itemListElement: versions.slice(0, 30).map((v, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `${v.version}${v.date ? ` — ${formatDate(v.date)}` : ''}`,
          url: `${site.url}/changelog#${v.version}`,
        })),
      }),
    },
  ],
})
</script>

<template>
  <div>
    <!-- 页头 -->
    <section class="border-b border-border">
      <div class="site-container py-14">
        <nav aria-label="面包屑" class="mb-4 text-xs text-muted-foreground">
          <NuxtLink to="/" class="transition-colors hover:text-foreground">首页</NuxtLink>
          <span class="mx-2" aria-hidden="true">/</span>
          <span class="text-foreground">更新日志</span>
        </nav>

        <div class="flex flex-wrap items-end justify-between gap-6">
          <div class="max-w-2xl">
            <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">更新日志</h1>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              LiCore 的全部版本记录。版本轴、变更明细与下载链接都由本站服务端
              <strong class="text-foreground">自动从 GitHub 仓库拉取并聚合</strong>，
              上游一发布新 tag 或 Release，本页刷新即可看到。
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="md">
              <Rss class="mr-1 size-3" />
              数据源：{{ sourceLabel[log.source.mode] }}
            </Badge>
            <Badge variant="secondary" size="md">{{ versions.length }} 个版本</Badge>
          </div>
        </div>

        <!-- 数据源说明 -->
        <div
          class="mt-6 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5 text-xs leading-5 text-muted-foreground"
        >
          <Info class="mt-0.5 size-3.5 shrink-0 text-primary" />
          <p>
            {{ log.source.note }}
            <span class="mt-1 block">
              最近一次同步：{{ fetchedAtText }}
              · 服务端缓存 {{ Math.round(log.ttlSeconds / 60) }} 分钟
            </span>
          </p>
        </div>
      </div>
    </section>

    <div class="site-container py-10">
      <div class="grid gap-10 lg:grid-cols-[1fr_280px]">
        <!-- 主列表 -->
        <div>
          <!-- 筛选栏 -->
          <div class="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
            <div class="relative min-w-[200px] flex-1">
              <Search
                class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                v-model="keyword"
                type="search"
                placeholder="搜索版本号、作用域或改动内容…"
                aria-label="搜索变更内容"
                class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
              />
            </div>

            <div class="flex items-center gap-2">
              <Filter class="size-4 text-muted-foreground" aria-hidden="true" />
              <select
                v-model="typeFilter"
                aria-label="按改动类型筛选"
                class="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              >
                <option v-for="opt in typeOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <label class="flex cursor-pointer items-center gap-2 text-sm">
              <input
                v-model="binaryOnly"
                type="checkbox"
                class="size-4 rounded border-border accent-[var(--primary)]"
              />
              仅看含二进制的版本
            </label>

            <Button
              v-if="isFiltering"
              variant="ghost"
              size="sm"
              @click="
                () => {
                  keyword = ''
                  typeFilter = 'all'
                  binaryOnly = false
                }
              "
            >
              清除筛选
            </Button>
          </div>

          <!-- 版本时间线 -->
          <div v-if="filtered.length" class="space-y-0">
            <VersionCard
              v-for="(v, i) in filtered"
              :id="v.version"
              :key="v.version"
              :entry="v"
              :latest="i === 0 && v.version === latestVersion?.version"
              :max-items="siteRuntime.display.changelogMaxItems"
              class="scroll-mt-24"
            />
          </div>

          <Card v-else class="py-14 text-center">
            <p class="text-sm font-medium">没有匹配的变更记录</p>
            <p class="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              换个关键词，或清除筛选条件查看全部版本。
            </p>
            <Button
              class="mt-5"
              variant="outline"
              size="sm"
              @click="
                () => {
                  keyword = ''
                  typeFilter = 'all'
                  binaryOnly = false
                }
              "
            >
              清除筛选
            </Button>
          </Card>
        </div>

        <!-- 侧栏 -->
        <aside class="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <!-- 版本索引 -->
          <Card>
            <h2 class="text-sm font-semibold">版本索引</h2>
            <ol class="mt-4 max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
              <li v-for="v in versions" :key="v.version">
                <a
                  :href="`#${v.version}`"
                  class="flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-accent/60"
                >
                  <span class="flex items-center gap-2">
                    <span class="font-mono text-xs font-medium">{{ v.version }}</span>
                    <Badge v-if="v.hasBinaries" variant="primary" size="sm">二进制</Badge>
                  </span>
                  <span v-if="v.date" class="shrink-0 text-xs text-muted-foreground">
                    {{ formatDate(v.date, 'short') }}
                  </span>
                </a>
              </li>
            </ol>
          </Card>

          <!-- 下载入口 -->
          <Card variant="muted">
            <h2 class="text-sm font-semibold">获取 LiCore</h2>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              当前最新版本为
              <strong class="text-foreground">{{ log.latestVersion ?? '未知' }}</strong
              >。
            </p>
            <LinkButton href="/download" variant="primary" size="sm" class="mt-4 w-full">
              <Download class="mr-1.5 size-3.5" />
              前往下载页
            </LinkButton>
            <LinkButton
              :href="`${repo.url}/releases`"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="sm"
              class="mt-2 w-full"
            >
              <Github class="mr-1.5 size-3.5" />
              GitHub Releases
            </LinkButton>
          </Card>

          <!-- 上游提交 -->
          <Card>
            <h2 class="flex items-center gap-1.5 text-sm font-semibold">
              <GitCommitHorizontal class="size-4 text-primary" />
              上游仓库
            </h2>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              本页数据全部来自公开仓库
              <a
                :href="repo.url"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline underline-offset-4"
                >{{ repo.slug }}</a
              >，本站不额外维护版本信息。
            </p>
            <a
              :href="`${repo.url}/commits/main`"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80"
            >
              查看提交历史
              <ExternalLink class="size-3" />
            </a>
          </Card>
        </aside>
      </div>
    </div>
  </div>
</template>
