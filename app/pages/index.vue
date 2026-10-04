<script setup lang="ts">
import { Button, Card, Badge, Skeleton } from 'fuxsto-design'
import {
  ArrowRight,
  Download,
  Feather,
  Layers,
  Smartphone,
  Cpu,
  ShieldCheck,
  Zap,
  Boxes,
  GitCommitHorizontal,
  Star,
  GitFork,
  ExternalLink,
  CheckCircle2,
} from 'lucide-vue-next'
import { repo, site } from '~/config/site'
import type { ChangelogPayload } from '~~/server/utils/changelog'
import type { GitHubCommit, RepoMeta } from '~~/server/utils/github'

/**
 * 首页由服务端渲染，数据在每次请求时（经缓存）从 GitHub 拉取，
 * 因此页面上展示的版本号、提交、star 数始终是上游最新的。
 *
 * 走 useAsyncData + server: true，原因：
 *   1. 结果写进 SSR payload 再转移给客户端，水合时不再重新执行 loader。
 *      若像普通顶层 await 那样写，客户端水合会再次执行 loader，
 *      在访客浏览器里直连 api.github.com，消耗该访客 IP 的匿名配额（60 次/小时）；
 *   2. 客户端那次请求一旦失败，页面会从服务端渲染好的完整数据闪回空状态。
 *
 * 数据一律走本站自己的 /api/* 路由，**不直接 import server/utils**：
 * server/utils 里有 node:fs / process.cwd，一旦被静态引入就会被打进客户端
 * bundle（即使永远不执行），既是体积浪费，也让 Vite 报 externalized 警告。
 * 这里的 type import 会被编译器完全擦除，不产生客户端代码。
 */
interface HomeData {
  meta: RepoMeta | null
  changelog: ChangelogPayload | null
  commits: GitHubCommit[]
}

const { data: homeData } = await useAsyncData<HomeData>('home-data', async () => {
  const [repoApi, logApi, commitsApi] = await Promise.all([
    $fetch<{ ok: boolean; repo: RepoMeta } | null>('/api/repo').catch(() => null),
    $fetch<ChangelogPayload | null>('/api/changelog').catch(() => null),
    $fetch<{ ok: boolean; commits: GitHubCommit[] } | null>('/api/commits?limit=8').catch(() => null),
  ])
  return {
    meta: repoApi?.repo ?? null,
    changelog: logApi ?? null,
    commits: commitsApi?.commits ?? [],
  }
}, { server: true })

const meta = homeData.value?.meta ?? null
const changelog = homeData.value?.changelog ?? null
const commits = homeData.value?.commits ?? []

const latest = changelog?.versions?.[0] ?? null
const releaseCount = changelog?.source.releaseCount ?? 0
const tagCount = changelog?.source.tagCount ?? 0

/* ---------------- SEO ---------------- */
/** 首页标题即站名，用绝对标题避免 titleTemplate 再拼一次 LiCore */
const title = `${site.name} — ${site.tagline}`
/**
 * 注意：不要再把整段 site.description 拼上版本信息 —— 那样总长会到 180+ 字符，
 * 超出 Google 截断线（约 155–160），搜索摘要会被直接砍掉后半句。
 * 这里单独写一版短描述，版本信息只占一行。
 */
const description = latest
  ? `LiCore — 用 Go 编写的轻量级容器引擎：无守护进程、单二进制分发、运行时内存目标 10–20 MiB、自研 .licore 镜像格式。最新版本 ${latest.version}${latest.date ? `（${formatDate(latest.date)} 发布）` : ''}，更新日志与下载链接自动同步自 GitHub。`
  : site.description

useSeoMeta({
  title,
  description,
  ogTitle: `${site.name} — 轻量级容器引擎`,
  ogDescription: description,
  ogUrl: site.url,
  ogImage: `${site.url}/og.svg`,
  twitterTitle: `${site.name} — 轻量级容器引擎`,
  twitterDescription: description,
  twitterImage: `${site.url}/og.svg`,
})

useHead({
  // 首页标题已是完整站名，不再套用 "xxx | LiCore"
  titleTemplate: () => title,
  link: [{ rel: 'canonical', href: site.url }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'SoftwareApplication',
            name: site.name,
            alternateName: 'Boxli',
            applicationCategory: 'DeveloperApplication',
            applicationSubCategory: 'Container Engine',
            operatingSystem: 'Linux, Android, macOS',
            description: site.description,
            url: site.url,
            downloadUrl: `${site.url}/download`,
            softwareVersion: latest?.versionNumber ?? undefined,
            datePublished: latest?.date || undefined,
            license: `https://www.gnu.org/licenses/agpl-3.0.html`,
            programmingLanguage: 'Go',
            author: { '@type': 'Organization', name: site.author, url: repo.url },
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
            ...(meta
              ? {
                  aggregateRating: undefined,
                  interactionStatistic: {
                    '@type': 'InteractionCounter',
                    interactionType: 'https://schema.org/LikeAction',
                    userInteractionCount: meta.stars,
                  },
                }
              : {}),
          },
          {
            '@type': 'WebSite',
            name: `${site.name} 官网`,
            url: site.url,
            inLanguage: 'zh-CN',
            description: site.description,
          },
        ],
      }),
    },
  ],
})

useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: site.url },
        ],
      }),
    },
  ],
})

/* ---------------- 内容 ---------------- */
const features = [
  {
    icon: Feather,
    title: '极轻运行时',
    desc: '常驻内存目标 10–20 MiB，单个二进制。全仓库零 CGO（CGO_ENABLED=0），Linux 产物为静态链接。',
  },
  {
    icon: Layers,
    title: '自研镜像格式',
    desc: '.licore = 分层 gzip tar + 自研 index.json 清单，结构简单、可逐层审计。与 OCI 是两套格式，互不兼容。',
  },
  {
    icon: Smartphone,
    title: '覆盖 Android',
    desc: 'Linux 服务器、Android（有 Root）、macOS 三大平台。Android 无 Root 场景官方明确不支持。',
  },
  {
    icon: Cpu,
    title: '多架构交叉编译',
    desc: 'amd64 / arm64 / 386 / riscv64 等目标同一条命令交叉编译，构建矩阵在发布前逐平台验证。',
  },
  {
    icon: Boxes,
    title: '零外部依赖',
    desc: '运行时不需要 Docker、containerd 或任何 OCI 组件。装一个 licore 就能跑，宿主机保持干净。',
  },
  {
    icon: ShieldCheck,
    title: '资源限制内置',
    desc: 'CPU / 内存 / PID 限额内置于引擎，未实现的能力会显式报错，绝不静默生效。',
  },
  {
    icon: Zap,
    title: '开机自启',
    desc: 'licore boot enable 一条命令完成系统服务配置。无全局守护进程，每个容器由轻量 shim 独立守护。',
  },
  {
    icon: CheckCircle2,
    title: 'Compose 编排',
    desc: 'compose up / down / ps / logs / scale / config 完整落地，真实创建容器而非只做解析。',
  },
]

const quickstart = `# 构建镜像并自动导入本地
licore build -t demo:v1 .

# 端口映射 + 卷挂载 + 内存限制（MiB）
licore run -p 8080:80 -v data:/data --memory 256 demo:v1

# 查看运行中的容器
licore ps

# 进入运行中容器的命名空间执行命令
licore exec -it demo /bin/sh`

const stats = computed(() => [
  { icon: Star, label: 'Stars', value: meta ? formatNumber(meta.stars) : '—' },
  { icon: GitFork, label: 'Forks', value: meta ? formatNumber(meta.forks) : '—' },
  { icon: Layers, label: '已发布 Tag', value: tagCount ? String(tagCount) : '—' },
  { icon: Boxes, label: 'GitHub Release', value: releaseCount ? String(releaseCount) : '0' },
])

/** 提交类型 → 圆点颜色，帮助访客快速分辨改动性质 */
const TYPE_COLORS: Record<string, string> = {
  feat: 'oklch(0.72 0.19 152)',
  fix: 'oklch(0.64 0.21 25)',
  docs: 'oklch(0.6 0.02 250)',
  build: 'oklch(0.75 0.16 75)',
  refactor: 'oklch(0.68 0.13 235)',
  test: 'oklch(0.65 0.18 300)',
  perf: 'oklch(0.7 0.15 190)',
  chore: 'oklch(0.6 0.02 250)',
}
</script>

<template>
  <div>
    <!-- ================= Hero ================= -->
    <section class="relative overflow-hidden border-b border-border">
      <div class="hero-glow absolute inset-0 -z-10" aria-hidden="true" />
      <div class="grid-pattern absolute inset-0 -z-10" aria-hidden="true" />

      <div class="site-container py-20 sm:py-28">
        <div class="mx-auto max-w-3xl text-center">
          <div class="mb-6 flex flex-wrap items-center justify-center gap-2">
            <Badge v-if="latest" variant="primary" size="md">
              最新版本 {{ latest.version }}
            </Badge>
            <Badge variant="outline" size="md">AGPL-3.0</Badge>
            <Badge variant="secondary" size="md">Go 编写</Badge>
          </div>

          <h1 class="text-4xl font-bold tracking-tight sm:text-6xl">
            用 Go 重写的
            <span class="text-primary">轻量容器引擎</span>
          </h1>

          <p class="mx-auto mt-6 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
            LiCore 常驻内存仅 <strong class="text-foreground">10–20 MiB</strong>，单二进制分发，
            覆盖 Linux / Android / macOS。它拥有自研镜像格式与分发体系，
            <strong class="text-foreground">运行时不需要 Docker / OCI</strong>，
            同时支持用 <strong class="text-foreground">licore convert</strong> 把现成 Docker 镜像转成 .licore。
          </p>

          <div class="mt-9 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/download" size="lg">
              <Download class="mr-2 size-4" />
              下载 LiCore
            </LinkButton>
            <LinkButton href="/docs" variant="outline" size="lg">
              阅读文档
              <ArrowRight class="ml-2 size-4" />
            </LinkButton>
            <LinkButton
              :href="repo.url"
              target="_blank"
              rel="noopener noreferrer"
              variant="ghost"
              size="lg"
            >
              GitHub
              <ExternalLink class="ml-2 size-4" />
            </LinkButton>
          </div>

          <p v-if="latest?.date" class="mt-5 text-xs text-muted-foreground">
            {{ latest.version }} 发布于 {{ formatDate(latest.date) }}
            <span class="mx-1.5">·</span>
            版本数据实时同步自 GitHub
          </p>

          <div
            class="mx-auto mt-8 flex max-w-2xl items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left text-xs leading-6"
          >
            <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>
              <strong class="text-foreground">v0.8.0 之前没有 capability 隔离</strong>，
              root 下容器内进程即宿主 root。仍在用 v0.7.x 或更早版本的话，请不要运行不可信镜像。
              <NuxtLink to="/docs#isolation" class="text-primary underline underline-offset-2">查看隔离说明</NuxtLink>
            </span>
          </div>
        </div>

        <!-- 统计 -->
        <dl class="mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          <div
            v-for="s in stats"
            :key="s.label"
            class="rounded-xl border border-border bg-background/60 p-4 text-center backdrop-blur"
          >
            <component :is="s.icon" class="mx-auto size-4 text-primary" aria-hidden="true" />
            <dd class="mt-2 text-2xl font-bold tabular-nums tracking-tight">{{ s.value }}</dd>
            <dt class="mt-0.5 text-xs text-muted-foreground">{{ s.label }}</dt>
          </div>
        </dl>
      </div>
    </section>

    <!-- ================= 快速开始 ================= -->
    <section class="border-b border-border py-20">
      <div class="site-container grid gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 class="text-3xl font-bold tracking-tight">四条命令跑起来</h2>
          <p class="mt-4 text-sm leading-7 text-muted-foreground">
            LiCore 的命令行贴近 Docker 的使用习惯，但底层是完全自研的镜像与运行时。
            构建上下文必须显式给出，未实现的指令会直接报错，而不是假装成功。
          </p>
          <ul class="mt-6 space-y-3">
            <li
              v-for="item in [
                '自研 .licore 镜像：分层 gzip tar + index.json',
                '端口映射、卷挂载、资源限制一条命令搞定',
                'exec 真正进入容器的全部命名空间',
                'Hub 分发：login / pull / push / search',
              ]"
              :key="item"
              class="flex items-start gap-2.5 text-sm"
            >
              <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <div class="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/docs" variant="primary">查看完整命令树</LinkButton>
            <LinkButton href="/changelog" variant="outline">浏览更新日志</LinkButton>
          </div>
        </div>

        <div class="relative">
          <div class="overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm">
            <div class="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
              <span class="size-2.5 rounded-full bg-red-500/70" />
              <span class="size-2.5 rounded-full bg-amber-500/70" />
              <span class="size-2.5 rounded-full bg-green-500/70" />
              <span class="ml-2 font-mono text-xs text-muted-foreground">terminal</span>
            </div>
            <pre class="overflow-x-auto p-5 text-[13px] leading-7"><code>{{ quickstart }}</code></pre>
          </div>
        </div>
      </div>
    </section>

    <!-- ================= 特性 ================= -->
    <section class="border-b border-border py-20">
      <div class="site-container">
        <div class="mx-auto max-w-2xl text-center">
          <h2 class="text-3xl font-bold tracking-tight">为极致轻量而设计</h2>
          <p class="mt-4 text-sm leading-7 text-muted-foreground">
            LiCore 不是另一个 Docker 包装器。它从镜像格式、分发协议到运行时与网络全部自研，
            换来的是可审计的简洁结构与极低的资源占用。
          </p>
        </div>

        <div class="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            v-for="f in features"
            :key="f.title"
            class="lift h-full"
          >
            <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <component :is="f.icon" class="size-5 text-primary" aria-hidden="true" />
            </div>
            <h3 class="mt-4 text-base font-semibold">{{ f.title }}</h3>
            <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ f.desc }}</p>
          </Card>
        </div>
      </div>
    </section>

    <!-- ================= 最新动态 ================= -->
    <section class="border-b border-border py-20">
      <div class="site-container grid gap-10 lg:grid-cols-5">
        <!-- 更新日志预览 -->
        <div class="lg:col-span-3">
          <div class="flex items-center justify-between gap-4">
            <h2 class="text-2xl font-bold tracking-tight">最新更新</h2>
            <NuxtLink
              to="/changelog"
              class="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80"
            >
              全部版本
              <ArrowRight class="size-4" />
            </NuxtLink>
          </div>

          <div v-if="changelog?.versions?.length" class="mt-6 space-y-3">
            <NuxtLink
              v-for="v in changelog.versions.slice(0, 4)"
              :key="v.version"
              :to="`/changelog#${v.version}`"
              class="lift block rounded-xl border border-border p-4"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-sm font-semibold">{{ v.version }}</span>
                <Badge v-if="v.hasBinaries" variant="primary" size="sm">含二进制</Badge>
                <Badge v-else variant="outline" size="sm">源码</Badge>
                <time
                  v-if="v.date"
                  class="ml-auto text-xs text-muted-foreground"
                  :datetime="v.date"
                >
                  {{ formatRelative(v.date) }}
                </time>
              </div>
              <p class="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {{ v.summary }}
              </p>
              <p v-if="v.commitCount" class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <GitCommitHorizontal class="size-3.5" />
                {{ v.commitCount }} 次提交
              </p>
            </NuxtLink>
          </div>

          <div v-else class="mt-6 space-y-3">
            <Skeleton v-for="i in 3" :key="i" class="h-24 w-full rounded-xl" />
          </div>

          <p v-if="changelog && !changelog.source.hasReleases" class="mt-4 text-xs leading-5 text-muted-foreground">
            {{ changelog.source.note }}
          </p>
        </div>

        <!-- 最近提交 -->
        <div class="lg:col-span-2">
          <h2 class="text-2xl font-bold tracking-tight">开发动态</h2>

          <ol v-if="commits.length" class="mt-6 space-y-1">
            <li v-for="c in commits" :key="c.sha">
              <a
                :href="c.url"
                target="_blank"
                rel="noopener noreferrer"
                class="group flex gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
              >
                <span
                  class="mt-1.5 size-1.5 shrink-0 rounded-full"
                  :style="{
                    backgroundColor: TYPE_COLORS[c.type ?? ''] ?? 'oklch(0.6 0.02 250 / 0.5)',
                  }"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm" :title="c.subject">{{ c.subject }}</span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">
                    {{ c.authorLogin ?? c.authorName }} · {{ formatRelative(c.date) }}
                  </span>
                </span>
                <code class="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">{{ c.shortSha }}</code>
              </a>
            </li>
          </ol>

          <div v-else class="mt-6 space-y-2">
            <Skeleton v-for="i in 6" :key="i" class="h-12 w-full rounded-lg" />
          </div>

          <a
            :href="`${repo.url}/commits/main`"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80"
          >
            查看全部提交
            <ExternalLink class="size-3.5" />
          </a>
        </div>
      </div>
    </section>

    <!-- ================= CTA ================= -->
    <section class="py-20">
      <div class="site-container">
        <div
          class="relative overflow-hidden rounded-2xl border border-border bg-muted/40 px-6 py-14 text-center sm:px-12"
        >
          <div class="hero-glow absolute inset-0 -z-10" aria-hidden="true" />
          <h2 class="text-3xl font-bold tracking-tight">开始使用 LiCore</h2>
          <p class="mx-auto mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
            下载适合你平台的构建产物，或直接从源码编译。
            全部版本与下载链接均自动同步自 GitHub 仓库。
          </p>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href="/download" size="lg">
              <Download class="mr-2 size-4" />
              前往下载
            </LinkButton>
            <LinkButton href="/changelog" variant="outline" size="lg">查看更新日志</LinkButton>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
