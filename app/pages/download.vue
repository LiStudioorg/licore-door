<script setup lang="ts">
import { Card, Badge } from 'fuxsto-design'
import {
  Download,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  HardDrive,
  Info,
  ExternalLink,
  Github,
  Copy,
  Check,
  Package,
} from 'lucide-vue-next'
import { repo, site, buildMatrix } from '~/config/site'
import type { ChangelogPayload, VersionEntry, VersionSummary } from '~~/server/utils/changelog'
import type { RepoMeta } from '~~/server/utils/github'

/**
 * /api/downloads 的返回结构（type import 会被擦除，不进客户端 bundle）。
 *
 * `latest` 字段完整（要渲染下载项与命令）；`versions` 是服务端裁剪过的瘦类型
 * `VersionSummary` —— 它不带 `changes` 明细，避免把 17 个版本的变更全塞进首屏。
 */
interface DownloadsPayload {
  latest: VersionEntry | null
  versions: VersionSummary[]
  source: ChangelogPayload['source']
  repo: RepoMeta | null
  fetchedAt: string
  ttlSeconds: number
}

/**
 * 下载页。服务端实时聚合上游可用的下载项：
 *   - 上游有 Release 资产 → 直接给官方二进制；
 *   - 没有 → 自动回退为源码归档 + 编译指引，并如实说明。
 *
 * 同首页：走 useAsyncData + server: true 且必须 catch。
 * 原来的 `await buildDownloads(event)` 没有 catch，上游失败会让 setup 抛错、整页白屏。
 */
const FALLBACK: DownloadsPayload = {
  latest: null,
  versions: [],
  source: {
    mode: 'tags-and-commits',
    hasReleases: false,
    releaseCount: 0,
    tagCount: 0,
    note: '上游暂时无法访问，稍后刷新即可。',
  },
  repo: null,
  fetchedAt: '',
  ttlSeconds: 300,
}

const { data: downloadsData } = await useAsyncData<DownloadsPayload | null>(
  'downloads-data',
  () => $fetch<DownloadsPayload>('/api/downloads').catch(() => null),
  { server: true },
)

const data = downloadsData.value ?? FALLBACK

const versions = data.versions
const latest = data.latest
const binaries = latest?.downloads.filter((d) => d.isBinary) ?? []
const sources = latest?.downloads.filter((d) => !d.isBinary) ?? []
const hasBinaries = binaries.length > 0

/** 选一个版本查看其下载项 */
const selectedVersion = ref(latest?.version ?? '')
const selected = computed(
  () => versions.find((v) => v.version === selectedVersion.value) ?? latest,
)
const selectedBinaries = computed(() => selected.value?.downloads.filter((d) => d.isBinary) ?? [])
const selectedSources = computed(() => selected.value?.downloads.filter((d) => !d.isBinary) ?? [])

const versionOptions = computed(() =>
  versions.map((v) => ({
    value: v.version,
    label: `${v.version}${v.date ? ` · ${formatDate(v.date, 'short')}` : ''}${v.hasBinaries ? ' · 含二进制' : ''}`,
  })),
)

/** 复制按钮状态 */
const copied = ref('')
async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => (copied.value = ''), 1800)
  } catch {
    copied.value = ''
  }
}

const buildSteps = computed(() => [
  {
    title: '安装 Go 工具链',
    desc: 'LiCore 使用纯 Go 编写，需要 Go 1.21 或更高版本。所有目标都是 CGO_ENABLED=0 的产物，不需要 C 工具链或 Android NDK。',
    code: 'go version   # 确认已安装 Go',
  },
  {
    title: '获取源码',
    desc: `下载 ${latest?.version ?? '最新版本'} 的源码归档，或直接克隆仓库。`,
    code: `git clone ${repo.url}.git\ncd licore\ngit checkout ${latest?.version ?? 'main'}`,
  },
  {
    title: '编译二进制',
    desc: '仓库自带 Makefile，一条命令产出全部目标平台产物到 dist/ 目录。',
    code: `make VERSION=${latest?.versionNumber ?? '0.0.0'} all\nls dist/`,
  },
  {
    title: '安装到系统路径',
    desc: '把编译好的二进制放进 PATH，或用 Makefile 的 install 目标直接安装。',
    code: 'sudo make install\nlicore --version',
  },
])

/* ---------------- SEO ---------------- */
/**
 * 描述必须控制在 155 字符以内，否则 Google 会在搜索结果里直接截断。
 * 平台清单只取不重复的 OS 名，不要把每个 os/arch 组合都拼进去（会轻松到 230+ 字符）。
 */
const platforms = [...new Set(binaries.map((b) => b.os))].join(' / ')
const description = hasBinaries
  ? `下载 LiCore ${latest?.version} 官方构建产物，支持 ${platforms}。下载链接自动同步自 GitHub Release，同时提供源码编译指引与完整构建矩阵说明。`
  : `下载 LiCore ${latest?.version ?? '最新版'}。上游当前未提供预编译二进制，本页提供官方源码归档下载与本地编译指引（Linux amd64/arm64、Android arm64）。`

usePageSeo(
  {
    title: '下载',
    description,
    ogTitle: `下载 LiCore ${latest?.version ?? ''}`.trim(),
    ogDescription: description,
    ogUrl: `${site.url}/download`,
    twitterTitle: `下载 LiCore ${latest?.version ?? ''}`.trim(),
    twitterDescription: description,
  },
  { path: '/download' },
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
          { '@type': 'ListItem', position: 2, name: '下载', item: `${site.url}/download` },
        ],
      }),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: site.name,
        softwareVersion: latest?.versionNumber ?? undefined,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, Android, macOS, Windows (WSL2)',
        url: site.url,
        downloadUrl: `${site.url}/download`,
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
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
          <span class="text-foreground">下载</span>
        </nav>

        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">下载 LiCore</h1>
        <p class="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          本站的下载链接由服务端
          <strong class="text-foreground">自动从 GitHub 仓库读取并聚合</strong>，
          上游发布新版本后无需改动本站代码。
        </p>

        <div class="mt-6 flex flex-wrap items-center gap-2">
          <Badge v-if="latest" variant="primary" size="md">最新 {{ latest.version }}</Badge>
          <Badge v-if="latest?.date" variant="outline" size="md">{{ formatDate(latest.date) }}</Badge>
          <Badge :variant="hasBinaries ? 'default' : 'secondary'" size="md">
            {{ hasBinaries ? '官方二进制可用' : '仅源码可用' }}
          </Badge>
        </div>
      </div>
    </section>

    <div class="site-container py-12">
      <!-- 上游无二进制时的高亮提示 -->
      <div
        v-if="!hasBinaries"
        class="mb-10 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"
        role="status"
      >
        <AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
        <div class="text-sm leading-6">
          <p class="font-medium">上游仓库当前未提供预编译二进制</p>
          <p class="mt-1 text-muted-foreground">
            经核查，{{ repo.slug }} 尚未创建任何 GitHub Release，也未配置上传构建产物的 CI。
            因此本页自动回退为<strong class="text-foreground">官方源码归档下载 + 本地编译指引</strong>。
            一旦上游补齐 Release 资产，本页会在缓存过期后
            <strong class="text-foreground">自动切换为直接下载</strong>，无需人工干预。
          </p>
          <a
            :href="`${repo.url}/releases`"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80"
          >
            查看 GitHub Releases 页面
            <ExternalLink class="size-3" />
          </a>
        </div>
      </div>

      <div class="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div class="space-y-10">
          <!-- 版本选择 + 下载项 -->
          <section aria-labelledby="downloads-heading">
            <div class="flex flex-wrap items-end justify-between gap-4">
              <h2 id="downloads-heading" class="text-xl font-bold tracking-tight">
                {{ hasBinaries ? '选择你的平台' : '下载源码' }}
              </h2>

              <label class="flex items-center gap-2 text-sm">
                <span class="text-muted-foreground">版本</span>
                <select
                  v-model="selectedVersion"
                  aria-label="选择版本"
                  class="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option v-for="opt in versionOptions" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
            </div>

            <!-- 二进制列表 -->
            <div v-if="selectedBinaries.length" class="mt-5 grid gap-3 sm:grid-cols-2">
              <a
                v-for="dl in selectedBinaries"
                :key="dl.url"
                :href="dl.url"
                class="lift group flex flex-col rounded-xl border border-border p-5"
                :class="dl.recommended ? 'border-primary/50 bg-primary/5' : ''"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <Cpu class="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <Badge v-if="dl.recommended" variant="primary" size="sm">推荐</Badge>
                </div>
                <p class="mt-3 font-semibold">{{ dl.os }} / {{ dl.arch }}</p>
                <p class="mt-1 break-all text-xs text-muted-foreground">{{ dl.label }}</p>
                <div class="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{{ dl.size ? formatBytes(dl.size) : '' }}</span>
                  <span class="inline-flex items-center gap-1 font-medium text-primary">
                    <Download class="size-3.5" />
                    下载
                  </span>
                </div>
              </a>
            </div>

            <!-- 源码列表 -->
            <div v-if="selectedSources.length" class="mt-5 grid gap-3 sm:grid-cols-2">
              <a
                v-for="dl in selectedSources"
                :key="dl.url"
                :href="dl.url"
                class="lift flex items-center gap-4 rounded-xl border border-border p-5"
              >
                <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Package class="size-5 text-muted-foreground" aria-hidden="true" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">
                    {{ dl.arch === 'zip' ? '源码归档 (.zip)' : '源码归档 (.tar.gz)' }}
                  </p>
                  <p class="mt-0.5 text-xs text-muted-foreground">{{ dl.label }}</p>
                </div>
                <Download class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </a>
            </div>

            <p v-if="selected && !selected.hasRelease" class="mt-4 text-xs leading-5 text-muted-foreground">
              {{ selected.version }} 是历史 tag 存档，上游未为其创建 Release，仅提供源码归档。
            </p>
          </section>

          <!-- 构建矩阵 -->
          <section aria-labelledby="matrix-heading">
            <h2 id="matrix-heading" class="text-xl font-bold tracking-tight">构建矩阵</h2>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">
              上游 Makefile 可交叉编译下列目标。全部是 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">CGO_ENABLED=0</code>
              的纯 Go 产物，<strong class="text-foreground">不需要任何 C 工具链或 NDK</strong>。
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">licore exec</code> 是否可用取决于
              <strong class="text-foreground">运行环境有没有 nsenter</strong>，与编译方式无关：
              探测顺序为 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">nsenter</code> →
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">busybox nsenter</code>，
              都没有时返回带安装指引的错误，其余功能不受影响。
            </p>

            <div class="mt-5 overflow-hidden rounded-xl border border-border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50">
                  <tr>
                    <th scope="col" class="px-4 py-3 text-left font-medium">产物</th>
                    <th scope="col" class="px-4 py-3 text-left font-medium">平台</th>
                    <th scope="col" class="px-4 py-3 text-left font-medium">架构</th>
                    <th scope="col" class="hidden px-4 py-3 text-left font-medium sm:table-cell">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in buildMatrix" :key="m.name" class="border-t border-border">
                    <td class="px-4 py-3">
                      <code class="font-mono text-xs">dist/licore-{{ m.name }}</code>
                      <Badge v-if="m.recommended" variant="primary" size="sm" class="ml-2">推荐</Badge>
                    </td>
                    <td class="px-4 py-3">{{ m.os }}</td>
                    <td class="px-4 py-3 font-mono text-xs">{{ m.arch }}</td>
                    <td class="hidden px-4 py-3 text-muted-foreground sm:table-cell">{{ m.note }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- 从源码构建 -->
          <section aria-labelledby="build-heading">
            <h2 id="build-heading" class="text-xl font-bold tracking-tight">从源码构建</h2>

            <ol class="mt-6 space-y-6">
              <li v-for="(step, i) in buildSteps" :key="step.title" class="flex gap-4">
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                  aria-hidden="true"
                >
                  {{ i + 1 }}
                </span>
                <div class="min-w-0 flex-1">
                  <h3 class="text-sm font-semibold">{{ step.title }}</h3>
                  <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ step.desc }}</p>
                  <div class="relative mt-3">
                    <pre class="code-block pr-12 text-xs"><code>{{ step.code }}</code></pre>
                    <button
                      type="button"
                      class="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      :aria-label="`复制第 ${i + 1} 步命令`"
                      @click="copy(step.code, String(i))"
                    >
                      <Check v-if="copied === String(i)" class="size-3.5 text-primary" />
                      <Copy v-else class="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            </ol>
          </section>

          <!-- 系统要求 -->
          <section aria-labelledby="req-heading">
            <h2 id="req-heading" class="text-xl font-bold tracking-tight">系统要求</h2>
            <div class="mt-5 grid gap-4 sm:grid-cols-2">
              <Card>
                <div class="flex items-center gap-2">
                  <HardDrive class="size-4 text-primary" aria-hidden="true" />
                  <h3 class="text-sm font-semibold">运行 LiCore</h3>
                </div>
                <ul class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li class="flex gap-2">
                    <CheckCircle2 class="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Linux 服务器 / Android（需 Root）/ macOS / Windows（WSL2 或虚拟机）
                  </li>
                  <li class="flex gap-2">
                    <CheckCircle2 class="mt-0.5 size-3.5 shrink-0 text-primary" />
                    v0.4.0 起网络 veth、cgroup 写入与 exec 需 root 权限
                  </li>
                  <li class="flex gap-2">
                    <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    Android 无 Root 场景官方不支持
                  </li>
                  <li class="flex gap-2">
                    <AlertTriangle class="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    与 Docker / OCI 镜像互不兼容
                  </li>
                </ul>
              </Card>

              <Card>
                <div class="flex items-center gap-2">
                  <Terminal class="size-4 text-primary" aria-hidden="true" />
                  <h3 class="text-sm font-semibold">从源码编译</h3>
                </div>
                <ul class="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li class="flex gap-2">
                    <CheckCircle2 class="mt-0.5 size-3.5 shrink-0 text-primary" />
                    Go 工具链（Makefile 默认调用 go）
                  </li>
                  <li class="flex gap-2">
                    <CheckCircle2 class="mt-0.5 size-3.5 shrink-0 text-primary" />
                    make、gofmt（用于 make fmt 检查）
                  </li>
                  <li class="flex gap-2">
                    <Info class="mt-0.5 size-3.5 shrink-0 text-primary" />
                    全平台无需 C 工具链或 NDK（CGO_ENABLED=0）
                  </li>
                </ul>
              </Card>
            </div>
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card variant="primary">
            <h2 class="text-sm font-semibold">当前最新版本</h2>
            <p class="mt-2 font-mono text-2xl font-bold tracking-tight">
              {{ latest?.version ?? '—' }}
            </p>
            <p v-if="latest?.date" class="mt-1 text-xs opacity-80">
              {{ formatDate(latest.date) }}
            </p>
            <ul class="mt-4 space-y-2 text-xs">
              <li class="flex items-center justify-between">
                <span class="opacity-80">版本总数</span>
                <span class="font-medium">{{ versions.length }}</span>
              </li>
              <li class="flex items-center justify-between">
                <span class="opacity-80">含二进制版本</span>
                <span class="font-medium">{{ versions.filter((v) => v.hasBinaries).length }}</span>
              </li>
              <li class="flex items-center justify-between">
                <span class="opacity-80">数据源</span>
                <span class="font-medium">
                  {{ data.source.mode === 'release-assets' ? 'Release 资产' : '源码归档' }}
                </span>
              </li>
            </ul>
          </Card>

          <Card>
            <h2 class="text-sm font-semibold">其他获取方式</h2>
            <div class="mt-4 space-y-2">
              <LinkButton
                :href="repo.url"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                size="sm"
                class="w-full"
              >
                <Github class="mr-1.5 size-3.5" />
                克隆源码仓库
              </LinkButton>
              <LinkButton href="/changelog" variant="ghost" size="sm" class="w-full">
                查看全部版本
              </LinkButton>
            </div>
            <p class="mt-4 text-xs leading-5 text-muted-foreground">
              LiCore 目前未发布到任何包管理器，唯一的官方分发渠道是 GitHub 仓库。
            </p>
          </Card>

          <Card variant="muted">
            <h2 class="text-sm font-semibold">许可证</h2>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              以
              <strong class="text-foreground">AGPL-3.0-only</strong>
              分发。若你通过网络向他人提供服务，需按该协议开放对应源码。
            </p>
            <a
              :href="`${repo.url}/blob/main/LICENSE`"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80"
            >
              阅读完整协议
              <ExternalLink class="size-3" />
            </a>
          </Card>
        </aside>
      </div>
    </div>
  </div>
</template>
