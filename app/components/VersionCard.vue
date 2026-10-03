/**
 * 一条版本记录：版本号、日期、变更明细、下载项。
 * 变更明细由服务端预先聚合（Release 正文 或 tag 区间提交合成）。
 */
<script setup lang="ts">
import { Chip, Badge, Button } from 'fuxsto-design'
import {
  Download,
  ExternalLink,
  GitCommitHorizontal,
  Package,
  Info,
  Tag,
} from 'lucide-vue-next'
import type { VersionEntry } from '~~/server/utils/changelog'

const props = defineProps<{
  entry: VersionEntry
  /** 是否为最新版本（默认展开） */
  latest?: boolean
  /** 页面上最多展示几条变更 */
  maxItems?: number
}>()

const open = ref(Boolean(props.latest))

/** Chip 组件支持的变体（注意：Chip 没有 destructive，那只有 Badge 才有） */
type ChipVariant = 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'glass'

const TYPE_META: Record<string, { label: string; variant: ChipVariant }> = {
  feat: { label: '新特性', variant: 'primary' },
  fix: { label: '修复', variant: 'secondary' },
  perf: { label: '性能', variant: 'secondary' },
  refactor: { label: '重构', variant: 'secondary' },
  build: { label: '构建', variant: 'outline' },
  ci: { label: '持续集成', variant: 'outline' },
  docs: { label: '文档', variant: 'outline' },
  test: { label: '测试', variant: 'outline' },
  chore: { label: '杂项', variant: 'default' },
  style: { label: '样式', variant: 'default' },
  revert: { label: '回滚', variant: 'ghost' },
}

/** 把条目按类型分组，便于阅读 */
const grouped = computed(() => {
  const map = new Map<string, { type: string | null; scope: string | null; text: string; sha?: string }[]>()
  for (const item of props.entry.changes.items) {
    const key = item.type && TYPE_META[item.type] ? item.type : 'other'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  const order = ['feat', 'fix', 'perf', 'refactor', 'build', 'ci', 'docs', 'test', 'chore', 'style', 'revert', 'other']
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, items]) => ({
      key,
      label: key === 'other' ? '其他改动' : TYPE_META[key]!.label,
      variant: key === 'other' ? ('default' as const) : TYPE_META[key]!.variant,
      items,
    }))
})

const visibleGroups = computed(() => {
  if (!props.maxItems) return grouped.value
  let budget = props.maxItems
  const out: typeof grouped.value = []
  for (const g of grouped.value) {
    if (budget <= 0) break
    out.push({ ...g, items: g.items.slice(0, budget) })
    budget -= g.items.length
  }
  return out
})

const hiddenCount = computed(() =>
  props.maxItems ? Math.max(0, props.entry.changes.items.length - props.maxItems) : 0,
)

/** 渲染 Release 正文的极简 markdown（只处理标题/列表/代码/粗体/链接） */
const rendered = computed(() => {
  const md = props.entry.changes.markdown
  if (!md) return ''
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _l, code) => `<pre><code>${code.trim()}</code></pre>`)
    .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
    .replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[huop])(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
})

const releaseDate = computed(() =>
  props.entry.date ? formatDate(props.entry.date) : '日期未知',
)

const binaries = computed(() => props.entry.downloads.filter((d) => d.isBinary))
const sources = computed(() => props.entry.downloads.filter((d) => !d.isBinary))
</script>

<template>
  <article class="timeline-rail pb-10">
    <!-- 版本头 -->
    <header class="flex flex-wrap items-center gap-2">
      <h2 class="text-lg font-semibold tracking-tight">
        <a
          :href="entry.htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 transition-colors hover:text-primary"
        >
          <Tag class="size-4 text-primary" />
          {{ entry.version }}
        </a>
      </h2>

      <Badge v-if="latest" variant="primary" size="sm">最新版本</Badge>
      <Badge v-if="entry.isPrerelease" variant="secondary" size="sm">预发布</Badge>
      <Badge v-if="!entry.hasRelease" variant="outline" size="sm">tag 存档</Badge>
      <Badge v-if="entry.hasBinaries" variant="default" size="sm">含二进制</Badge>

      <time class="text-xs text-muted-foreground" :datetime="entry.date">{{ releaseDate }}</time>
    </header>

    <p v-if="entry.commitCount > 0" class="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
      <GitCommitHorizontal class="size-3.5" />
      由 {{ entry.commitCount }} 次提交自动聚合
    </p>

    <p class="mt-3 text-sm leading-6 text-muted-foreground">{{ entry.summary }}</p>

    <!-- 展开/收起 -->
    <button
      type="button"
      class="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-opacity hover:opacity-80"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ open ? '收起变更明细' : '查看变更明细' }}
    </button>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="mt-4 space-y-4">
        <!-- Release 原始正文 -->
        <div
          v-if="entry.changes.kind === 'raw' && entry.changes.markdown"
          class="prose-licore rounded-lg border border-border bg-muted/30 p-4"
          v-html="rendered"
        />

        <!-- 由提交合成的明细 -->
        <template v-else-if="entry.changes.items.length > 0">
          <div v-for="group in visibleGroups" :key="group.key">
            <h3 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Chip :variant="group.variant" size="sm">{{ group.label }}</Chip>
              <span class="font-normal normal-case">{{ group.items.length }} 项</span>
            </h3>
            <ul class="space-y-1.5">
              <li
                v-for="(item, i) in group.items"
                :key="i"
                class="flex gap-2 text-sm leading-6"
              >
                <span aria-hidden="true" class="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  <code v-if="item.scope" class="mr-1 rounded bg-muted px-1 py-0.5 text-[0.8em] text-muted-foreground">{{ item.scope }}</code>
                  {{ item.text }}
                  <a
                    v-if="item.sha"
                    :href="`https://github.com/LiStudioorg/licore/commit/${item.sha}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="ml-1 font-mono text-xs text-muted-foreground underline underline-offset-4 hover:text-primary"
                    >{{ item.sha }}</a
                  >
                </span>
              </li>
            </ul>
          </div>

          <p v-if="hiddenCount > 0" class="text-xs text-muted-foreground">
            另有 {{ hiddenCount }} 项改动未在此处显示，可前往版本详情页查看完整列表。
          </p>
        </template>

        <p v-else class="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info class="mt-0.5 size-3.5 shrink-0" />
          该版本未提供可解析的变更说明。上游仓库既没有 Release 正文，也没有可关联的提交区间记录。
        </p>

        <!-- 下载 -->
        <div class="rounded-lg border border-border p-4">
          <h3 class="flex items-center gap-2 text-sm font-semibold">
            <Package class="size-4 text-primary" />
            {{ entry.hasBinaries ? '本版本下载' : '本版本下载（源码）' }}
          </h3>

          <div v-if="binaries.length" class="mt-3 grid gap-2 sm:grid-cols-2">
            <a
              v-for="dl in binaries"
              :key="dl.url"
              :href="dl.url"
              class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:border-primary/50 hover:bg-accent/50"
            >
              <span class="min-w-0">
                <span class="block truncate font-medium">{{ dl.os }} / {{ dl.arch }}</span>
                <span class="block truncate text-xs text-muted-foreground">{{ dl.label }}</span>
              </span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ dl.size ? formatBytes(dl.size) : '' }}
              </span>
            </a>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <Button
              v-for="dl in sources"
              :key="dl.url"
              as="a"
              :href="dl.url"
              variant="outline"
              size="sm"
            >
              <Download class="mr-1.5 size-3.5" />
              {{ dl.arch === 'zip' ? '源码 .zip' : '源码 .tar.gz' }}
            </Button>
            <Button as="a" :href="entry.htmlUrl" variant="ghost" size="sm">
              <ExternalLink class="mr-1.5 size-3.5" />
              GitHub 版本页
            </Button>
          </div>

          <p v-if="!entry.hasBinaries" class="mt-3 text-xs leading-5 text-muted-foreground">
            上游未为该版本上传二进制产物，请下载源码后按
            <NuxtLink to="/docs" class="text-primary underline underline-offset-4">构建文档</NuxtLink>
            自行编译。一旦上游补齐 Release 资产，本页会自动切换为直接下载。
          </p>
        </div>
      </div>
    </Transition>
  </article>
</template>
