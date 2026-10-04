<script setup lang="ts">
import { Card, Button } from 'fuxsto-design'
import {
  Github,
  ExternalLink,
  Heart,
  ShieldCheck,
  Zap,
  Users,
  GitCommitHorizontal,
  Star,
  GitFork,
  Scale,
  Server,
} from 'lucide-vue-next'
import { repo, site } from '~/config/site'
import type { Contributor, GitHubCommit, RepoMeta } from '~~/server/utils/github'
import type { ChangelogPayload } from '~~/server/utils/changelog'

/**
 * 同首页：走 useAsyncData + server: true，客户端水合不重跑 loader；
 * 数据一律走本站 /api/* 路由，不直接 import server/utils（见首页注释）。
 */
interface AboutData {
  meta: RepoMeta | null
  contributors: Contributor[]
  commits: GitHubCommit[]
  changelog: ChangelogPayload | null
}

const { data: aboutData } = await useAsyncData<AboutData>('about-data', async () => {
  const [repoApi, commitsApi, logApi] = await Promise.all([
    $fetch<{ ok: boolean; repo: RepoMeta; contributors: Contributor[] } | null>('/api/repo').catch(() => null),
    $fetch<{ ok: boolean; commits: GitHubCommit[] } | null>('/api/commits?limit=5').catch(() => null),
    $fetch<ChangelogPayload | null>('/api/changelog').catch(() => null),
  ])
  return {
    meta: repoApi?.repo ?? null,
    contributors: repoApi?.contributors ?? [],
    commits: commitsApi?.commits ?? [],
    changelog: logApi ?? null,
  }
}, { server: true })

const meta = aboutData.value?.meta ?? null
const contributors = aboutData.value?.contributors ?? []
const commits = aboutData.value?.commits ?? []
const changelog = aboutData.value?.changelog ?? null

const facts = computed(() => [
  { icon: Star, label: 'Stars', value: meta ? formatNumber(meta.stars) : '—' },
  { icon: GitFork, label: 'Forks', value: meta ? formatNumber(meta.forks) : '—' },
  { icon: GitCommitHorizontal, label: '已发布版本', value: changelog ? String(changelog.versions.length) : '—' },
  { icon: Users, label: '贡献者', value: contributors.length ? String(contributors.length) : '—' },
])

const designGoals = [
  {
    icon: Zap,
    title: '把资源占用压到最低',
    desc: '常驻内存目标 10–20 MiB 是硬指标，而不是宣传语。为了它，LiCore 没有采用 OCI 镜像体系，换取一条没有历史包袱的实现路径。',
  },
  {
    icon: ShieldCheck,
    title: '可审计优于功能多',
    desc: '.licore 镜像就是分层 gzip tar 加一份 index.json，没有任何字段是"尽力猜测"出来的。任何人都能用 tar 和 jq 逐层检查一个镜像。',
  },
  {
    icon: Server,
    title: '不假装成功',
    desc: '未实现的指令、不支持的资源能力都会显式报错。构建上下文必须显式给出，因为静默落到 cwd 会把敏感文件打进镜像。',
  },
]

/* ---------------- SEO ---------------- */
const description = `关于 LiCore：项目定位、设计取舍、更名历史与开源协议。LiCore 是 LiStudioorg 用 Go 编写的轻量级容器引擎，AGPL-3.0 开源，仓库位于 GitHub ${repo.slug}。`

usePageSeo(
  {
    title: '关于',
    description,
    ogTitle: '关于 LiCore',
    ogDescription: description,
    ogUrl: `${site.url}/about`,
    twitterTitle: '关于 LiCore',
    twitterDescription: description,
  },
  { path: '/about' },
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
          { '@type': 'ListItem', position: 2, name: '关于', item: `${site.url}/about` },
        ],
      }),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        name: '关于 LiCore',
        description,
        url: `${site.url}/about`,
        inLanguage: 'zh-CN',
        publisher: { '@id': `${site.url}/#organization` },
        mainEntity: {
          '@type': 'SoftwareApplication',
          '@id': `${site.url}/#software`,
          name: site.name,
          alternateName: 'Boxli',
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'Linux, Android, macOS, Windows (WSL2)',
          license: 'https://www.gnu.org/licenses/agpl-3.0.html',
          author: { '@id': `${site.url}/#organization` },
        },
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
          <span class="text-foreground">关于</span>
        </nav>

        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">关于 LiCore</h1>
        <p class="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          一个故意不走兼容路线的容器引擎。它不打算取代 Docker 的生态位，
          而是回答另一个问题：如果从零设计一个容器引擎，能有多轻？
        </p>
      </div>
    </section>

    <div class="site-container py-12">
      <div class="grid gap-12 lg:grid-cols-[1fr_320px]">
        <div class="space-y-14">
          <!-- 项目是什么 -->
          <section>
            <h2 class="text-2xl font-bold tracking-tight">项目定位</h2>
            <div class="mt-5 space-y-4 text-sm leading-7 text-muted-foreground">
              <p>
                LiCore 是一个用 <strong class="text-foreground">Go 编写的轻量级容器引擎</strong>，
                使用场景类似 Docker，但采用
                <strong class="text-foreground">完全自研的生态</strong>：
                自研镜像格式、自研分发方式、自研运行时与网络。
              </p>
              <p>
                目标平台为 <strong class="text-foreground">Linux 服务器、Android（有 Root）与 macOS</strong>，
                并可通过 <strong class="text-foreground">WSL2 或虚拟机</strong>在 Windows 上以 Linux 版运行，
                支持多 CPU 架构，引擎常驻内存目标为
                <strong class="text-foreground">10–20 MiB</strong>。
              </p>
              <p>
                它是单二进制分发的，全仓库零 CGO（
                <code class="rounded bg-muted px-1.5 py-0.5 text-xs">CGO_ENABLED=0</code>），
                Linux 产物为静态链接，运行时不依赖 Docker、containerd 或任何 OCI 组件。
              </p>
              <p>
                镜像格式与 OCI 互不兼容，但提供一条转换路径：用
                <code class="rounded bg-muted px-1.5 py-0.5 text-xs">licore convert</code>
                可以把现成的 Docker 镜像转成
                <code class="rounded bg-muted px-1.5 py-0.5 text-xs">.licore</code>
                （单向，需本机有 docker CLI）。
              </p>
            </div>
          </section>

          <!-- 设计取舍 -->
          <section>
            <h2 class="text-2xl font-bold tracking-tight">设计取舍</h2>
            <div class="mt-5 space-y-4">
              <Card v-for="g in designGoals" :key="g.title">
                <div class="flex gap-4">
                  <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <component :is="g.icon" class="size-5 text-primary" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 class="text-base font-semibold">{{ g.title }}</h3>
                    <p class="mt-2 text-sm leading-6 text-muted-foreground">{{ g.desc }}</p>
                  </div>
                </div>
              </Card>
            </div>
          </section>

          <!-- 更名历史 -->
          <section>
            <h2 class="text-2xl font-bold tracking-tight">更名历史</h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              项目在 v0.7.0 完成了一次彻底更名，这是理解本仓库历史时的关键背景。
            </p>

            <div class="mt-5 overflow-hidden rounded-xl border border-border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50">
                  <tr>
                    <th scope="col" class="px-4 py-3 text-left font-medium">版本区间</th>
                    <th scope="col" class="px-4 py-3 text-left font-medium">名称</th>
                    <th scope="col" class="px-4 py-3 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="border-t border-border">
                    <td class="px-4 py-3 font-mono text-xs">v0.1.0 ~ v0.6.1</td>
                    <td class="px-4 py-3 font-medium">Boxli</td>
                    <td class="px-4 py-3 text-muted-foreground">
                      早期名称。模块路径 github.com/LiStudioorg/boxli，二进制 boxli，
                      镜像后缀 .boxli，数据目录 ~/.boxli，环境变量 BOXLI_*
                    </td>
                  </tr>
                  <tr class="border-t border-border">
                    <td class="px-4 py-3 font-mono text-xs">v0.7.0 起</td>
                    <td class="px-4 py-3 font-medium text-primary">LiCore</td>
                    <td class="px-4 py-3 text-muted-foreground">
                      现用名称。模块路径 github.com/LiStudioorg/licore，二进制 licore，
                      镜像后缀 .licore，数据目录 ~/.licore，环境变量 LICORE_*
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ul class="mt-5 space-y-2.5 text-sm leading-6 text-muted-foreground">
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  GitHub 旧仓库地址 <code class="rounded bg-muted px-1 py-0.5 text-xs">LiStudioorg/boxli</code>
                  会自动重定向到新地址。
                </span>
              </li>
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  <strong class="text-foreground">不提供数据迁移</strong>：改名时项目尚未正式发布、
                  没有用户，因此没有 <code class="rounded bg-muted px-1 py-0.5 text-xs">~/.boxli</code> →
                  <code class="rounded bg-muted px-1 py-0.5 text-xs">~/.licore</code> 的自动迁移，
                  也不保留旧路径与旧环境变量的兼容层。
                </span>
              </li>
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>历史 tag（v0.1.0 ~ v0.6.1）保留，仍可拉取。</span>
              </li>
            </ul>
          </section>

          <!-- 开源协议 -->
          <section>
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Scale class="size-5 text-primary" aria-hidden="true" />
              开源协议
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              LiCore 以 <strong class="text-foreground">AGPL-3.0-only</strong> 分发。
              这意味着如果你修改了 LiCore 并通过网络向他人提供服务，
              需要按该协议向使用者开放对应源码。
            </p>
            <p class="mt-3 text-sm leading-7 text-muted-foreground">
              仓库内每个 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">.go</code>
              文件头部都带有版权声明：
            </p>
            <pre class="code-block mt-4"><code>// Copyright (C) 2026 LiStudioorg
// SPDX-License-Identifier: AGPL-3.0-only</code></pre>
            <LinkButton
              :href="`${repo.url}/blob/main/LICENSE`"
              target="_blank"
              rel="noopener noreferrer"
              variant="outline"
              size="sm"
              class="mt-5"
            >
              阅读完整协议
              <ExternalLink class="ml-1.5 size-3.5" />
            </LinkButton>
          </section>

          <!-- 参与贡献 -->
          <section>
            <h2 class="text-2xl font-bold tracking-tight">参与贡献</h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              仓库内的 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">AGENTS.md</code>
              是面向所有协作者（包括 AI 代理）的指南，动手前建议先通读。
              发布流程见
              <a
                :href="`${repo.url}/blob/main/docs/release-checklist.md`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline underline-offset-4"
                >发布检查清单</a
              >。
            </p>
            <div class="mt-5 flex flex-wrap gap-3">
              <LinkButton
                :href="`${repo.url}/issues`"
                target="_blank"
                rel="noopener noreferrer"
                variant="primary"
              >
                提交 Issue
              </LinkButton>
              <LinkButton
                :href="`${repo.url}/blob/main/AGENTS.md`"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
              >
                协作者指南
              </LinkButton>
            </div>
          </section>

          <!-- 最近提交 -->
          <section v-if="commits.length">
            <h2 class="text-2xl font-bold tracking-tight">最近提交</h2>
            <ol class="mt-5 space-y-1">
              <li v-for="c in commits" :key="c.sha">
                <a
                  :href="c.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/50"
                >
                  <span class="min-w-0 truncate text-sm">{{ c.subject }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ formatRelative(c.date) }}</span>
                </a>
              </li>
            </ol>
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <h2 class="text-sm font-semibold">仓库概况</h2>
            <dl class="mt-4 grid grid-cols-2 gap-4">
              <div v-for="f in facts" :key="f.label">
                <component :is="f.icon" class="size-3.5 text-primary" aria-hidden="true" />
                <dd class="mt-1.5 text-lg font-bold tabular-nums">{{ f.value }}</dd>
                <dt class="text-xs text-muted-foreground">{{ f.label }}</dt>
              </div>
            </dl>

            <dl class="mt-5 space-y-2 border-t border-border pt-4 text-xs">
              <div class="flex items-center justify-between">
                <dt class="text-muted-foreground">主要语言</dt>
                <dd class="font-medium">{{ meta?.language ?? 'Go' }}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="text-muted-foreground">许可证</dt>
                <dd class="font-medium">{{ meta?.license ?? 'AGPL-3.0' }}</dd>
              </div>
              <div class="flex items-center justify-between">
                <dt class="text-muted-foreground">默认分支</dt>
                <dd class="font-mono">{{ meta?.defaultBranch ?? 'main' }}</dd>
              </div>
              <div v-if="meta?.pushedAt" class="flex items-center justify-between">
                <dt class="text-muted-foreground">最近推送</dt>
                <dd class="font-medium">{{ formatRelative(meta.pushedAt) }}</dd>
              </div>
            </dl>
          </Card>

          <Card v-if="contributors.length">
            <h2 class="text-sm font-semibold">贡献者</h2>
            <ul class="mt-4 space-y-2.5">
              <li v-for="c in contributors.slice(0, 8)" :key="c.login">
                <a
                  :href="c.htmlUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex items-center gap-3 rounded-md p-1.5 transition-colors hover:bg-accent/50"
                >
                  <img
                    :src="c.avatarUrl"
                    :alt="c.login"
                    width="28"
                    height="28"
                    class="size-7 rounded-full"
                    loading="lazy"
                  />
                  <span class="min-w-0 flex-1 truncate text-sm">{{ c.login }}</span>
                  <span class="shrink-0 text-xs text-muted-foreground">{{ c.contributions }}</span>
                </a>
              </li>
            </ul>
          </Card>

          <Card variant="muted">
            <h2 class="text-sm font-semibold">本站说明</h2>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              本站是 LiCore 的非商业官方站点，由 Node.js + Nuxt 4 驱动，
              界面基于 fuxsto-design 组件库构建。
              所有版本数据、提交记录与下载链接均由服务端
              <strong class="text-foreground">实时从 GitHub 拉取</strong>，
              本站不缓存副本、不人工维护版本信息。
            </p>
            <a
              :href="repo.url"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:opacity-80"
            >
              <Github class="size-3" />
              {{ repo.slug }}
            </a>
          </Card>

          <Card>
            <h2 class="flex items-center gap-1.5 text-sm font-semibold">
              <Heart class="size-3.5 text-primary" />
              支持项目
            </h2>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              给仓库点个 Star 是最直接的支持方式，也能让更多人发现这个项目。
            </p>
            <LinkButton
              :href="repo.url"
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              class="mt-4 w-full"
            >
              <Star class="mr-1.5 size-3.5" />
              去 GitHub 加 Star
            </LinkButton>
          </Card>
        </aside>
      </div>
    </div>
  </div>
</template>
