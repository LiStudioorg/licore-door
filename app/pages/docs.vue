<script setup lang="ts">
import { Card, Badge, Button } from 'fuxsto-design'
import {
  BookOpen,
  Terminal,
  Layers,
  Network,
  HardDrive,
  Boxes,
  Cpu,
  ShieldCheck,
  Cloud,
  Rocket,
  ArrowRight,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-vue-next'
import { repo, site } from '~/config/site'

const sections = [
  { id: 'install', label: '安装' },
  { id: 'quickstart', label: '快速开始' },
  { id: 'commands', label: '命令参考' },
  { id: 'boxfile', label: 'Boxfile 构建' },
  { id: 'images', label: '镜像格式' },
  { id: 'network', label: '网络' },
  { id: 'volumes', label: '卷' },
  { id: 'hub', label: 'Hub 分发' },
  { id: 'compose', label: 'Compose 编排' },
  { id: 'limits', label: '资源限制' },
  { id: 'boot', label: '开机自启' },
  { id: 'compat', label: '兼容性说明' },
]

/** .licore 镜像格式的设计原则 */
const imagePrinciples = [
  {
    t: '单一文件即完整镜像',
    d: '拉取、拷贝、校验都针对一个 .licore 文件，没有多文件目录约定。',
  },
  {
    t: '外层不压缩',
    d: '层本身已经是 gzip，外层再压缩只会让流式解析与随机读取变复杂。',
  },
  {
    t: 'index.json 是唯一元数据源',
    d: '任何字段缺失都视为镜像损坏，绝不靠猜测补全。',
  },
]

const copied = ref('')
async function copy(text: string, key: string) {  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => (copied.value = ''), 1800)
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

/* ---------------- SEO ---------------- */
const description =
  'LiCore 使用文档：安装与编译、快速开始、完整命令参考、Boxfile 镜像构建、.licore 镜像格式、容器网络、卷管理、Hub 分发、Compose 编排、资源限制与开机自启。'

useSeoMeta({
  title: '文档',
  description,
  ogTitle: 'LiCore 文档',
  ogDescription: description,
  ogUrl: `${site.url}/docs`,
  ogImage: `${site.url}/og.svg`,
  twitterTitle: 'LiCore 文档',
  twitterDescription: description,
  twitterImage: `${site.url}/og.svg`,
})

useHead({
  link: [{ rel: 'canonical', href: `${site.url}/docs` }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: site.url },
          { '@type': 'ListItem', position: 2, name: '文档', item: `${site.url}/docs` },
        ],
      }),
    },
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: 'LiCore 使用文档',
        description,
        inLanguage: 'zh-CN',
        url: `${site.url}/docs`,
        author: { '@type': 'Organization', name: site.author },
        about: { '@type': 'SoftwareApplication', name: site.name },
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
          <span class="text-foreground">文档</span>
        </nav>

        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">使用文档</h1>
        <p class="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
          LiCore 的完整使用说明。内容依据上游仓库的 README 与
          <code class="rounded bg-muted px-1.5 py-0.5 text-xs">docs/</code> 目录整理，
          更权威、更新的细节请以仓库内源文件为准。
        </p>

        <div class="mt-6 flex flex-wrap gap-2">
          <Badge variant="outline" size="md">命令树可执行 licore --help 查看</Badge>
          <Badge variant="outline" size="md">不兼容 Docker / OCI</Badge>
        </div>
      </div>
    </section>

    <div class="site-container py-10">
      <div class="grid gap-10 lg:grid-cols-[220px_1fr]">
        <!-- 侧栏目录 -->
        <aside class="lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="文档目录">
            <h2 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              目录
            </h2>
            <ul class="mt-3 space-y-0.5 border-l border-border">
              <li v-for="s in sections" :key="s.id">
                <a
                  :href="`#${s.id}`"
                  class="block border-l-2 border-transparent -ml-px py-1.5 pl-3 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {{ s.label }}
                </a>
              </li>
            </ul>
          </nav>
        </aside>

        <!-- 正文 -->
        <div class="min-w-0 space-y-14">
          <!-- 安装 -->
          <section id="install" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Rocket class="size-5 text-primary" aria-hidden="true" />
              安装
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              LiCore 是单二进制程序，没有安装器也没有依赖注入。
              从<NuxtLink to="/download" class="text-primary underline underline-offset-4">下载页</NuxtLink>
              获取对应平台的二进制，或从源码编译，然后放进 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">PATH</code> 即可。
            </p>
            <div class="relative mt-4">
              <pre class="code-block"><code># 方式一：源码编译并安装到 /usr/local/bin
git clone {{ repo.url }}.git
cd licore
make VERSION=0.7.0 all
sudo make install

# 方式二：已拿到二进制，手动放置
install -m 0755 licore-linux-amd64 /usr/local/bin/licore

# 验证
licore --version</code></pre>
              <button
                type="button"
                class="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="复制安装命令"
                @click="copy(`git clone ${repo.url}.git && cd licore && make VERSION=0.7.0 all && sudo make install`, 'install')"
              >
                <Check v-if="copied === 'install'" class="size-3.5 text-primary" />
                <Copy v-else class="size-3.5" />
              </button>
            </div>
          </section>

          <!-- 快速开始 -->
          <section id="quickstart" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Terminal class="size-5 text-primary" aria-hidden="true" />
              快速开始
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              一组典型的日常操作，覆盖构建、运行、查看与进入容器。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore build -t demo:v1 .                                 # 根据 Boxfile 构建 .licore 并自动导入
licore run -p 8080:80 -v data:/data --memory 256 demo:v1  # 端口映射 + 卷挂载 + 内存限制（MiB）
licore ps                                                 # 查看运行中的容器
licore exec -it demo /bin/sh                              # 进入运行中容器的命名空间执行命令
licore network ls                                         # 查看容器网络
licore volume ls                                          # 查看卷
licore resource info                                      # 查看资源能力（cgroups 等）
licore stats                                              # 实时查看容器资源用量</code></pre>
            </div>
            <div
              class="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs leading-5"
            >
              <ShieldCheck class="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden="true" />
              <p>
                自 v0.4.0 起，容器网络 veth、cgroup 写入与
                <code class="rounded bg-muted px-1 py-0.5">licore exec</code>
                需要 <strong>root</strong> 权限（CAP_NET_ADMIN / CAP_SYS_ADMIN）。
                未实现的资源能力（<code class="rounded bg-muted px-1 py-0.5">--storage</code> /
                <code class="rounded bg-muted px-1 py-0.5">--gpu</code> /
                <code class="rounded bg-muted px-1 py-0.5">--npu</code> /
                <code class="rounded bg-muted px-1 py-0.5">--network-bandwidth</code>）
                会显式报错，而不是静默生效。
              </p>
            </div>
          </section>

          <!-- 命令参考 -->
          <section id="commands" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <BookOpen class="size-5 text-primary" aria-hidden="true" />
              命令参考
            </h2>
            <div class="mt-5 overflow-hidden rounded-xl border border-border">
              <table class="w-full text-sm">
                <thead class="bg-muted/50">
                  <tr>
                    <th scope="col" class="px-4 py-3 text-left font-medium">命令</th>
                    <th scope="col" class="px-4 py-3 text-left font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="c in [
                      { cmd: 'licore build', desc: '按 Boxfile 构建 .licore 镜像并自动导入本地' },
                      { cmd: 'licore run', desc: '创建并启动容器，支持端口映射、卷与资源限制' },
                      { cmd: 'licore ps', desc: '列出容器及其状态' },
                      { cmd: 'licore exec', desc: '在运行中容器的全部命名空间内执行命令' },
                      { cmd: 'licore stop / rm', desc: '停止与删除容器' },
                      { cmd: 'licore images', desc: '列出本地镜像' },
                      { cmd: 'licore tag / commit / save / load', desc: '镜像产物操作' },
                      { cmd: 'licore export / import', desc: '镜像导出为 .licore 与反向导入' },
                      { cmd: 'licore pull / push', desc: '从 Hub 拉取或推送镜像（也支持本地文件导入）' },
                      { cmd: 'licore login / search', desc: 'Hub 登录令牌与镜像搜索' },
                      { cmd: 'licore network', desc: '网络管理：ls / create / inspect / rm / connect' },
                      { cmd: 'licore volume', desc: '卷管理：ls / create / inspect / rm' },
                      { cmd: 'licore compose', desc: '编排：up / down / ps / logs / scale / config' },
                      { cmd: 'licore resource info', desc: '查看宿主机资源能力（cgroups 等）' },
                      { cmd: 'licore stats', desc: '实时查看容器资源用量' },
                      { cmd: 'licore doctor', desc: '环境自检，含 Android 环境检查' },
                      { cmd: 'licore boot enable / disable / status', desc: '配置开机自启（无全局守护进程）' },
                      { cmd: 'licore hub serve', desc: '启动自研分发服务端' },
                    ]"
                    :key="c.cmd"
                    class="border-t border-border"
                  >
                    <td class="whitespace-nowrap px-4 py-3 align-top">
                      <code class="font-mono text-xs">{{ c.cmd }}</code>
                    </td>
                    <td class="px-4 py-3 text-muted-foreground">{{ c.desc }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="mt-3 text-xs text-muted-foreground">
              完整命令树以本机 <code class="rounded bg-muted px-1 py-0.5">licore --help</code> 输出为准。
            </p>
          </section>

          <!-- Boxfile -->
          <section id="boxfile" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Boxes class="size-5 text-primary" aria-hidden="true" />
              Boxfile 构建
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              构建指令集为 <code class="rounded bg-muted px-1.5 py-0.5 text-xs">FROM</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">COPY</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">ENV</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">WORKDIR</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">ENTRYPOINT</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">CMD</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">EXPOSE</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">VOLUME</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">LABEL</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">USER</code> /
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">ARG</code>。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore build -t demo:v1 .                          # 用 ./Boxfile（或 ./boxfile）构建并导入
licore build -f path/to/Boxfile -t demo:v1 --context ./src
licore images                                      # 确认 demo:v1 已导入</code></pre>
            </div>
            <ul class="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  <strong class="text-foreground">构建上下文必须显式给出</strong>（末尾位置参数或
                  <code class="rounded bg-muted px-1 py-0.5 text-xs">--context</code>）。
                  上下文决定 COPY 的源目录，静默落到 cwd 会把错误的甚至敏感的文件打进镜像；
                  两者同时给出且不一致会直接报错。
                </span>
              </li>
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  <code class="rounded bg-muted px-1 py-0.5 text-xs">FROM scratch</code> 表示空基础镜像；
                  <code class="rounded bg-muted px-1 py-0.5 text-xs">FROM name:version</code>
                  需先在本地存在（或先 <code class="rounded bg-muted px-1 py-0.5 text-xs">licore pull</code>）。
                </span>
              </li>
              <li class="flex gap-2">
                <span aria-hidden="true" class="mt-2.5 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                <span>
                  未实现的指令（<code class="rounded bg-muted px-1 py-0.5 text-xs">RUN</code>、
                  远程 <code class="rounded bg-muted px-1 py-0.5 text-xs">ADD</code>）与资源能力会显式报错，不假装成功。
                </span>
              </li>
            </ul>
          </section>

          <!-- 镜像格式 -->
          <section id="images" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Layers class="size-5 text-primary" aria-hidden="true" />
              镜像格式（.licore）
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">.licore</code>
              是一个<strong class="text-foreground">未压缩的 POSIX tar 归档</strong>，
              内部自带清单文件。它与 Docker / OCI Image Spec 没有任何兼容关系，
              也不计划建立映射。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>myapp-1.0.licore (tar)
├── index.json          # 唯一入口：镜像清单（UTF-8 JSON）
├── layers/
│   ├── 000001.base.tar.gz
│   ├── 000002.app.tar.gz
│   └── 000003.conf.tar.gz
└── blobs/              # 小对象目录，条目名 = &lt;digest-algo&gt;-&lt;digest-hex&gt;
    └── sha256-9f2c…    # index.config.digest 指向的 blob</code></pre>
            </div>
            <div class="mt-5 grid gap-4 sm:grid-cols-3">
              <Card v-for="p in imagePrinciples" :key="p.t">
                <h3 class="text-sm font-semibold">{{ p.t }}</h3>
                <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ p.d }}</p>
              </Card>
            </div>
            <p class="mt-4 text-xs leading-5 text-muted-foreground">
              删除标记约定：层内 <code class="rounded bg-muted px-1 py-0.5">.wh.&lt;basename&gt;</code>
              空文件表示删除对应条目；目录内
              <code class="rounded bg-muted px-1 py-0.5">.wh..wh..opq</code>
              表示该目录整体屏蔽。
              <a
                :href="`${repo.url}/blob/main/docs/image-spec.md`"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary underline underline-offset-4"
                >完整规范见 docs/image-spec.md</a
              >。
            </p>
          </section>

          <!-- 网络 -->
          <section id="network" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Network class="size-5 text-primary" aria-hidden="true" />
              容器网络
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              LiCore 实现了自研容器网络，提供容器间通信与 NAT 出口。默认 bridge 网络为
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">licore0</code>。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore run --network licore0 myapp:v1    # 接入默认 bridge：licore0（自动分配 IP）
licore run --network host myapp:v1       # 宿主网络
licore run --network none myapp:v1       # 无网络
licore run -p 8080:80 myapp:v1           # 端口映射 HOST:CONTAINER[:PROTO]
licore network ls / create / inspect / rm
licore network connect NETWORK CONTAINER # 把容器接入某网络</code></pre>
            </div>
          </section>

          <!-- 卷 -->
          <section id="volumes" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <HardDrive class="size-5 text-primary" aria-hidden="true" />
              卷
            </h2>
            <div class="mt-4">
              <pre class="code-block"><code>licore run -v /data myapp:v1              # 匿名卷
licore run -v data:/data myapp:v1         # 命名卷
licore run -v data:/data:ro myapp:v1      # 只读挂载（v0.6.0 落地）
licore volume ls / create / inspect / rm</code></pre>
            </div>
            <p class="mt-3 text-xs leading-5 text-muted-foreground">
              卷驱动支持 volume / tmpfs / snapshot，并带配额能力。
            </p>
          </section>

          <!-- Hub -->
          <section id="hub" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Cloud class="size-5 text-primary" aria-hidden="true" />
              Hub 分发
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              LiCore 自带自研分发服务，<strong class="text-foreground">不兼容 Docker Distribution API</strong>。
              服务端地址按 <code class="rounded bg-muted px-1 py-0.5 text-xs">--hub</code> &gt;
              <code class="rounded bg-muted px-1 py-0.5 text-xs">$LICORE_HUB</code> &gt;
              <code class="rounded bg-muted px-1 py-0.5 text-xs">http://127.0.0.1:3727</code> 顺序解析。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore hub serve                           # 启动服务端
licore login                               # 交互式换取令牌
licore push alice/myapp:v1 ./myapp.licore  # 上传本地 .licore 到 Hub
licore pull alice/myapp:v1                 # 从 Hub 拉取并落地为本地镜像
licore search myapp                        # 在 Hub 上搜索镜像

licore pull ./x.licore                     # 保留本地文件导入语义</code></pre>
            </div>
          </section>

          <!-- Compose -->
          <section id="compose" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Boxes class="size-5 text-primary" aria-hidden="true" />
              Compose 编排
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              <code class="rounded bg-muted px-1.5 py-0.5 text-xs">compose up / scale</code>
              会<strong class="text-foreground">真正创建容器</strong>，不是只做配置解析。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore compose up -d
licore compose ps
licore compose logs -f
licore compose scale web=3
licore compose config
licore compose down</code></pre>
            </div>
          </section>

          <!-- 资源限制 -->
          <section id="limits" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Cpu class="size-5 text-primary" aria-hidden="true" />
              资源限制
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              CPU / 内存 / PID 限额内置于引擎，v0.6.0 起 cgroup 限额真正生效。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore run --memory 256 demo:v1      # 内存上限（MiB）
licore run --cpus 1.5 demo:v1        # CPU 配额
licore run --pids-limit 100 demo:v1  # 进程数上限
licore resource info                 # 查看宿主机支持的能力
licore stats                         # 实时用量</code></pre>
            </div>
          </section>

          <!-- 开机自启 -->
          <section id="boot" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Rocket class="size-5 text-primary" aria-hidden="true" />
              开机自启
            </h2>
            <p class="mt-4 text-sm leading-7 text-muted-foreground">
              一条命令完成系统服务配置。<strong class="text-foreground">没有全局守护进程</strong>：
              每个容器由轻量 shim 独立守护，并支持 restart 策略。
            </p>
            <div class="mt-4">
              <pre class="code-block"><code>licore boot enable     # 配置开机自启
licore boot status     # 查看当前状态
licore boot disable    # 取消自启</code></pre>
            </div>
          </section>

          <!-- 兼容性 -->
          <section id="compat" class="scroll-mt-24">
            <h2 class="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <ShieldCheck class="size-5 text-primary" aria-hidden="true" />
              兼容性说明
            </h2>

            <div
              class="mt-5 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
            >
              <ShieldCheck class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <div class="text-sm leading-6">
                <p class="font-medium">LiCore 不兼容 Docker / OCI</p>
                <p class="mt-1 text-muted-foreground">
                  镜像格式、分发协议、运行时与网络全部自研。不要尝试把 OCI 镜像转成
                  <code class="rounded bg-muted px-1 py-0.5 text-xs">.licore</code>，或反向转换——
                  这类设计提案不会进入 LiCore 仓库。
                </p>
              </div>
            </div>

            <Card class="mt-5">
              <h3 class="text-sm font-semibold">项目更名说明</h3>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">
                本项目原名 <strong class="text-foreground">Boxli</strong>，自 v0.7.0 起更名为
                <strong class="text-foreground">LiCore</strong>。二进制由
                <code class="rounded bg-muted px-1 py-0.5">boxli</code> 改为
                <code class="rounded bg-muted px-1 py-0.5">licore</code>，镜像后缀由
                <code class="rounded bg-muted px-1 py-0.5">.boxli</code> 改为
                <code class="rounded bg-muted px-1 py-0.5">.licore</code>，数据目录由
                <code class="rounded bg-muted px-1 py-0.5">~/.boxli</code> 改为
                <code class="rounded bg-muted px-1 py-0.5">~/.licore</code>，环境变量由
                <code class="rounded bg-muted px-1 py-0.5">BOXLI_*</code> 改为
                <code class="rounded bg-muted px-1 py-0.5">LICORE_*</code>。
              </p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">
                <strong class="text-foreground">无数据迁移</strong>：改名时项目尚未正式发布、
                无用户，因此不提供自动迁移，也不保留旧路径与旧环境变量的兼容层。
                历史 tag（v0.1.0 ~ v0.6.1）保留，仍可拉取。
              </p>
            </Card>

            <div class="mt-5 flex flex-wrap gap-3">
              <Button
                as="a"
                :href="`${repo.url}/blob/main/README.md`"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
              >
                上游 README
                <ExternalLink class="ml-1.5 size-3.5" />
              </Button>
              <Button as="a" href="/changelog" variant="ghost">
                查看更新日志
                <ArrowRight class="ml-1.5 size-3.5" />
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
