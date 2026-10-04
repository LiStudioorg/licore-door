# 开发文档

面向**改代码的人**。讲清楚这个站点是怎么搭起来的、每个文件负责什么、
改哪里、为什么这么写。

- 想了解站点功能和本地启动 → [README.md](./README.md)
- 想部署到服务器 → [DEPLOY.md](./DEPLOY.md)
- 想改页面文案与内容 → [MAINTENANCE.md](./MAINTENANCE.md)

---

## 目录

1. [架构总览](#1-架构总览)
2. [一次请求的完整链路](#2-一次请求的完整链路)
3. [目录结构与职责](#3-目录结构与职责)
4. [服务端数据层](#4-服务端数据层)
5. [API 路由](#5-api-路由)
6. [前端页面](#6-前端页面)
7. [组件与 composables](#7-组件与-composables)
8. [后台面板与鉴权](#8-后台面板与鉴权)
9. [配置系统](#9-配置系统)
10. [SEO 实现](#10-seo-实现)
11. [样式与设计系统](#11-样式与设计系统)
12. [常见改造任务](#12-常见改造任务)
13. [踩过的坑](#13-踩过的坑)
14. [测试与校验](#14-测试与校验)

---

## 1. 架构总览

```
浏览器
  │  HTTP
  ▼
Nginx（反代，可选）
  │
  ▼
Nitro SSR 服务（Node 22+，单进程）
  │
  ├─ 页面渲染：app/pages/*.vue  →  服务端渲染成 HTML
  │
  └─ /api/* 路由：server/api/*.ts
        │
        ▼
     server/utils/github.ts（TTL 缓存 + 并发去重 + stale-while-error）
        │
        ▼
     api.github.com
```

**核心约束：页面不直接碰 GitHub。**

页面通过自己的 `/api/*` 路由取数。这样做有两个原因：

1. **不在客户端泄露服务端逻辑**。tar 里的服务端依赖（`node:fs`、`smol-toml`）
   一旦被打进客户端 bundle，浏览器里会直接抛错，整站水合失败。
2. **不消耗访客的配额**。GitHub 匿名配额按 IP 算，如果客户端直连，
   每个访客都在烧自己 IP 的 60 次/小时。

> 这条约束不是"最佳实践建议"，是**硬性要求**。违反它的后果见
> [§13 踩过的坑](#13-踩过的坑)。

---

## 2. 一次请求的完整链路

以访问首页 `/` 为例：

```
1. 浏览器 GET /
2. Nitro 匹配到 app/pages/index.vue
3. 页面 setup 里执行：
     useAsyncData('home-data', async () => {
       const [repo, log, commits] = await Promise.all([
         $fetch('/api/repo'),          ← 服务端内部调用，不走网络
         $fetch('/api/changelog'),
         $fetch('/api/commits?limit=8'),
       ])
     })
4. 每个 /api/* 路由调用 server/utils/github.ts 的取数函数
5. github.ts 先查进程内缓存：
     ├─ 命中且未过期 → 直接返回（latencyMs 通常为 0~1）
     ├─ 未命中但有旧数据 → 发起上游请求；失败则回退旧数据（stale-while-error）
     └─ 未命中且无旧数据 → 发起上游请求；失败则抛错
6. 数据回到页面，Vue 渲染成 HTML 字符串
7. HTML 里同时写入 <script id="__NUXT__"> 承载 SSR 数据（payload）
8. 浏览器收到 HTML，先显示完整页面（此时已可交互前的最后一步）
9. 客户端水合：读 __NUXT__ 里的数据，**不重新执行 loader**
```

第 7~9 步是关键。`useAsyncData` 的 `{ server: true }` + Nuxt 的 payload 机制
保证了客户端水合**不会**重跑数据请求。

---

## 3. 目录结构与职责

```
app/                          # 前端（会被打进客户端 bundle）
├── app.vue                   # 根组件：全局 head、canonical、JSON-LD 兜底、主题初始化
├── error.vue                 # 错误页（4xx/5xx）
├── assets/css/main.css       # Tailwind 入口 + 设计令牌
├── components/
│   ├── SiteHeader.vue        # 顶栏 + 移动端菜单 + 主题切换
│   ├── SiteFooter.vue        # 页脚
│   ├── LinkButton.vue        # ★ 链接型按钮（见 §13）
│   └── VersionCard.vue       # 版本卡片（含内置 markdown 渲染器）
├── composables/
│   ├── useFormat.ts          # 字节/日期/相对时间/数字格式化
│   ├── useTheme.ts           # 明暗主题（localStorage + prefers-color-scheme）
│   └── usePageSeo.ts         # ★ 页面 SEO 统一入口（补全分享图字段）
├── config/site.ts            # ★ 站点文案常量（不依赖服务端）
└── pages/
    ├── index.vue             # 首页
    ├── changelog.vue         # 更新日志
    ├── download.vue          # 下载
    ├── docs.vue              # 文档（纯静态内容）
    ├── about.vue             # 关于
    └── admin.vue             # 后台面板（noindex，不在导航里）

server/                       # 服务端（绝不进客户端 bundle）
├── api/
│   ├── status.get.ts         # 健康检查 + 缓存状态
│   ├── repo.get.ts           # 仓库元信息
│   ├── changelog.get.ts      # 更新日志
│   ├── commits.get.ts        # 提交列表
│   ├── releases.get.ts       # 发行版列表
│   ├── downloads.get.ts      # 下载页数据
│   └── admin/
│       ├── login.post.ts
│       ├── logout.post.ts
│       ├── status.get.ts
│       ├── token.set.post.ts # 运行时配置 GitHub Token
│       └── cache/clear.post.ts
└── utils/
    ├── github.ts             # ★ 上游访问层：缓存/TTL/去重/超时
    ├── changelog.ts          # ★ 业务聚合：版本、下载项、变更日志
    ├── config.ts             # TOML 配置加载 + 运行时 token
    ├── auth.ts               # HMAC 无状态会话
    └── upstream.ts           # 上游失败统一降级为 503

deploy/                       # 部署脚本（三层，各管一件事）
├── bootstrap.sh              # 取脚本 + 校验 + 转交
├── deploy-latest.sh          # 从 Release 下载产物
└── deploy-pm2.sh             # 发布：版本目录 + 切链 + 重载 + 回滚

public/                       # 静态资源（原样拷进产物根目录）
                              # og.png（分享图）/ og.svg（源文件）/ logo / favicon
                              # robots.txt / BingSiteAuth.xml（Bing 验证）/ manifest
.github/workflows/
├── ci.yml                    # 类型检查 + 构建 + 冒烟 + 鉴权断言
└── release.yml               # 打 tag + 发布 Release
```

> 三个 `★` 文件是最常改的：文案改 `app/config/site.ts`，
> 数据逻辑改 `server/utils/changelog.ts`，上游访问改 `server/utils/github.ts`。

---

## 4. 服务端数据层

### 4.1 `server/utils/github.ts` —— 上游访问

所有对 `api.github.com` 的请求都经过 `cached()` 包装：

```ts
export async function cached<T>(
  key: string,           // 缓存键，如 'releases' / 'commits:8'
  ttl: number,           // 新鲜期（秒）
  loader: () => Promise<T>,
): Promise<T>
```

四个机制：

| 机制 | 行为 | 为什么需要 |
| --- | --- | --- |
| **TTL 缓存** | 过期前直接返回内存里的值 | 减少上游调用，匿名配额只有 60 次/小时 |
| **并发去重** | 同一 key 的并发请求合并成一次上游调用 | 首页一次要发 3 个请求，不合并会瞬间打满 |
| **stale-while-error** | 上游失败时返回**上次成功的旧数据** | 上游抖一下不该让页面变空 |
| **超时保护** | 单次请求 8 秒 | 上游卡住不能拖死 SSR |

导出的取数函数：

```ts
getRepoMeta(event?)                  // 仓库元信息
getReleases(event?)                  // Release 列表
getTags(event?)                      // tag 列表
getCommits(limit = 60, event?)       // 提交列表
getContributors(event?)              // 贡献者
getRepoFile(path, event?)            // 仓库内单个文件（读 README 用）
cacheStats()                         // 缓存快照（后台面板用）
invalidateCache(key?)                // 清缓存，key 省略则全清
```

TTL 定义在 `TTL` 常量里，**值来自 `licore-site.toml` 的 `[github]` 段**，
不是硬编码。改缓存时长请改配置：

```toml
[github]
releases = 300       # 秒
repo = 600
contributors = 1800
```

### 4.2 `server/utils/changelog.ts` —— 业务聚合

把 GitHub 的原始数据加工成页面能直接用的结构。

**三级自动适配**是本文件的核心。上游可能处于三种状态，代码自动切换，
不需要人工干预：

| 上游状态 | 站点行为 |
| --- | --- |
| 有 Release **且**有二进制资产 | 展示官方二进制下载链接 |
| 有 Release 但**无**资产 | 用 Release 正文作更新日志，下载回退源码包 |
| **完全没有 Release** | 以 tag 为版本轴，用相邻 tag 间的提交按 Conventional Commits 自动合成日志 |

主要导出：

```ts
buildChangelog(event?)               // → ChangelogPayload（更新日志页数据）
buildDownloads(event?)               // → 最新版可下载项 + 全部版本
getLatestVersion(event?)             // 只取最新版本
compareVersionDesc(a, b)             // 版本号降序比较（semver 感知）
formatBytes(bytes)                   // 人类可读的字节数
```

数据结构：

```ts
interface ChangelogPayload {
  ok: boolean
  versions: VersionEntry[]
  source: { ... }        // 数据来源说明，页面上会展示"数据从哪来"
}

interface VersionEntry {
  version: string        // v0.7.1
  versionNumber: string  // 0.7.1
  date: string
  isLatest: boolean
  downloads: DownloadItem[]
  changes: ChangeGroup[] // 按 feat/fix/docs... 分组的变更
  body: string           // Release 正文（markdown）
}
```

### 4.3 `server/utils/upstream.ts` —— 失败降级

只有一个函数：

```ts
upstreamUnavailable(event, err)  // → { ok: false, error: 'upstream unavailable' }
```

所有公开 API 路由都用它兜底。上游彻底不可用（且无旧数据可回退）时：

```ts
try {
  data = await buildChangelog(event)
} catch (err) {
  return upstreamUnavailable(event, err)   // 503 + 结构化响应
}
```

**为什么必须这样做**：不捕获的话错误会冒泡到 Nitro，被记成
`[request error] [unhandled]` 并返回 500。日志里堆满栈，看起来像应用崩了，
实际只是上游抖了一下。改成 503 后前端 `$fetch(...).catch(() => null)`
能正常走降级分支。

---

## 5. API 路由

公开接口（无需鉴权）：

| 路由 | 说明 | 降级 |
| --- | --- | --- |
| `GET /api/status` | 健康检查 + 缓存状态 | 200，`reachable: false` |
| `GET /api/repo` | 仓库元信息 | 503 |
| `GET /api/changelog` | 更新日志 | 503 |
| `GET /api/commits?limit=N` | 提交列表 | 503 |
| `GET /api/releases` | 发行版列表 | 503 |
| `GET /api/downloads` | 下载页数据 | 503 |

后台接口（需要会话 cookie）：

| 路由 | 说明 |
| --- | --- |
| `POST /api/admin/login` | 登录，成功则下发 HMAC 会话 cookie |
| `POST /api/admin/logout` | 登出（幂等，未登录也返回 200） |
| `GET  /api/admin/status` | 面板数据：上游可达性 + 缓存明细 + 生效配置 |
| `POST /api/admin/token.set` | 设置/清除运行时 GitHub Token |
| `POST /api/admin/cache/clear` | 清缓存，body `{ key? }`，省略则全清 |

`admin.enabled = false` 时，后台接口一律返回 404（连登录接口都不存在）。

### 新增一个 API 路由

```ts
// server/api/foo.get.ts  →  GET /api/foo
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  try {
    return { ok: true, data: await getRepoMeta(event) }
  } catch (err) {
    return upstreamUnavailable(event, err)
  }
})
```

文件名的**后缀决定 HTTP 方法**：`.get.ts` / `.post.ts` / `.put.ts` /
`.delete.ts` / `.patch.ts`。

> ⚠️ 后缀必须是这几个之一。`token.set.post.ts` 里的 `.set` 是**路径段**
> （路由为 `/api/admin/token.set`），方法由结尾的 `.post` 决定。
> 如果写成 `token.set.ts`，Nitro 会把它当成 `/api/admin/token.set` 的
> **GET** 路由，`method: undefined`，前端 POST 过去就是 404。

---

## 6. 前端页面

### 数据获取的统一写法

每个需要数据的页面都长这样：

```vue
<script setup lang="ts">
import type { RepoMeta } from '~~/server/utils/github'

interface PageData {
  repo: RepoMeta | null
  // ...
}

const FALLBACK: PageData = { repo: null }

const { data } = await useAsyncData<PageData>('page-data', async () => {
  const [repo] = await Promise.all([
    $fetch<{ ok: boolean; repo: RepoMeta } | null>('/api/repo').catch(() => null),
  ])
  return { repo: repo?.repo ?? null }
}, { server: true })

const page = computed(() => data.value ?? FALLBACK)
</script>
```

五个必须遵守的点：

1. **`await useAsyncData(...)`** —— 服务端 await 才能拿到数据渲染首屏。
2. **`{ server: true }`** —— 明确只在服务端执行 loader。
3. **每个 `$fetch` 都要 `.catch(() => null)`** —— 少一个，上游失败时
   整个 setup 抛错，页面 500。
4. **提供 `FALLBACK` 常量** —— 模板里永远不用写 `data?.x?.y ?? ''`。
5. **只 `import type`** —— 从 `~~/server/utils/*` 导入类型是安全的
   （编译期擦除）；导入**函数**会把服务端代码打进客户端。

### 已有页面

| 页面 | 数据来源 | 备注 |
| --- | --- | --- |
| `index.vue` | repo + changelog + commits | 首屏统计卡 + 活动流 |
| `changelog.vue` | changelog | 版本时间线 + 筛选 |
| `download.vue` | downloads | 平台筛选 + 复制命令 |
| `about.vue` | repo + commits + changelog | 贡献者 + 技术栈 |
| `docs.vue` | 无 | 纯静态内容，不取数 |
| `admin.vue` | admin API | 客户端渲染，不 SSR 数据 |

> `docs.vue` 不取数，所以没有 `useAsyncData` —— 这是正常的，不是遗漏。

---

## 7. 组件与 composables

### `LinkButton.vue`（重要）

**渲染真实链接的按钮。** 所有指向别处的"按钮"都必须用它，
不能用 `<Button as="a">`。

```vue
<LinkButton href="/download" variant="primary" size="sm">
  下载
</LinkButton>

<LinkButton :href="repo.url" target="_blank" rel="noopener noreferrer">
  上游仓库
</LinkButton>
```

Props：

| Prop | 类型 | 说明 |
| --- | --- | --- |
| `href` | `string` | 外部链接，渲染 `<a>` |
| `to` | `string` | 内部路由，渲染 `<NuxtLink>` |
| `target` / `rel` | `string` | 外部链接属性 |
| `variant` | `'primary' \| 'outline' \| 'ghost'` | 视觉样式 |
| `size` | `'sm' \| 'md' \| 'lg'` | 尺寸 |
| `danger` / `round` | `boolean` | 变体 |

**为什么不能用 `fuxsto-design` 的 `Button`**：见 [§13](#13-踩过的坑)。

### `VersionCard.vue`

版本卡片，内置一个**行级 markdown 渲染器**（不引第三方库）。
支持标题、列表、段落、代码块、行内 `**粗体**`、`` `代码` ``、`[链接](url)`。

改渲染逻辑前先看 [§13](#13-踩过的坑) 里关于列表和代码块的坑。

### `useFormat.ts`

```ts
formatBytes(bytes)              // 2.3 MiB / 1.5 GB
formatDate(iso, 'long'|'short') // 2026年10月4日 / 10-04
formatRelative(iso)             // 3 分钟前
formatNumber(n)                 // 1,234
```

### `useTheme.ts`

```ts
const { isDark, init, toggle, apply } = useTheme()
```

读 `localStorage` 的 `licore-theme`，无值时跟随 `prefers-color-scheme`，
并监听系统主题变化（仅在用户未显式选择时跟随）。

`app.vue` 在 head 内联脚本里**尽早**调用 `init()` 以避免首屏闪烁。
模板里需要直接绑事件时可用导出的兜底函数 `toggleTheme()`。

### `usePageSeo.ts`

所有页面的 SEO 统一入口，**新页面一律用它，不要再直接写 `useSeoMeta`**：

```ts
usePageSeo(
  {
    title: '更新日志',
    description,
    ogTitle: '…',
    ogDescription: description,
    ogUrl: `${site.url}/changelog`,
    twitterTitle: '…',
    twitterDescription: description,
  },
  { path: '/changelog' },   // 可选：显式声明 canonical
)
```

它替页面补全分享图的四个字段（`og:image` 与 `twitter:image` 的
绝对地址、宽高、alt、type）。这样做的原因是这些字段**必须每页都带全**，
漏一个就会让某些平台拒绝渲染大图卡片；散在 5 个页面里手写，换图时必然漏改。

其余字段与 `useSeoMeta` 完全一致，直接透传。

---

## 8. 后台面板与鉴权

### `server/utils/auth.ts` —— 无状态 HMAC 会话

```
登录成功 → createSession(username)
         → payload = base64({ u: username, exp: 时间戳 })
         → token   = payload + '.' + HMAC-SHA256(payload, secret)
         → 写进 cookie licore_admin_session（HttpOnly / SameSite=Lax）

后续请求 → verifySession(cookie)
         → 重算 HMAC 比对 + 检查 exp
```

**设计取舍**：没有服务端会话存储，因此**无法单点撤销**某个会话。
登出靠删 cookie 实现；如果 cookie 被窃取，在过期前仍然有效。

这是刻意的权衡 —— 单机部署的运维面板，换来的是零存储依赖。
如果需要撤销能力，得引入会话表（或把 secret 轮换当作全局登出）。

其他安全措施：

- 密码比较用**定时安全比较**，避免时序侧信道
- 登录失败不区分"用户名错"和"密码错"，避免帮攻击者缩小范围
- cookie 的 `Secure` 标志按请求协议自动判断（HTTPS 才加），
  这样本地 HTTP 调试也能登录
- 后台页面 `noindex, nofollow`，且从 sitemap 排除

### 运行时 GitHub Token

后台面板可以直接配置 token，**无需重启**：

```
面板输入 → POST /api/admin/token.set
        → 写入工作目录的 licore-runtime-token（权限 0600）
        → authHeaders() 每次调用重新读取 → 立即生效
```

生效优先级（`effectiveGitHubToken()`）：

```
环境变量 GITHUB_TOKEN / GH_TOKEN
  > licore-runtime-token 文件
    > licore-site.toml 的 [github].token
```

`licore-runtime-token` 已在 `.gitignore` 里。

---

## 9. 配置系统

### `server/utils/config.ts`

- **只读一次**：模块首次导入时同步读取解析，缓存在模块作用域。
  改配置后重启生效（运行时 token 除外，它每次读文件）。
- **容错优先**：文件不存在、语法错误、字段类型不对，一律退回默认值
  并打印告警 —— 官网因为一个手滑的 TOML 就 500 是不可接受的。
- **环境变量优先**：便于容器化部署与 CI 覆盖。

查找顺序：`LICORE_SITE_CONFIG` → `process.cwd()` → 项目根目录。

### ⚠️ 客户端安全守卫

`config.ts` 里的所有 Node 专属调用（`node:fs`、`process.cwd()`）
都包在 `IS_SERVER` 判断里：

```ts
const IS_SERVER = import.meta.server

export function readRuntimeToken(): string {
  if (!IS_SERVER) return ''
  // ...
}
```

**为什么**：这个模块历史上被页面静态引入过，于是也被打进了客户端 bundle。
浏览器里 `node:fs` 被 Vite stub 成空对象、`process.cwd()` 根本不存在，
一调用就在**模块求值阶段**抛 `TypeError`，整个 chunk 崩溃、水合全废。

即使现在已经没有页面直接引入它了，**守卫也必须保留** ——
这是防止同类事故的最后一道闸。

---

## 10. SEO 实现

### 10.1 一张表看懂 SEO 落点

| 项 | 位置 | 说明 |
| --- | --- | --- |
| `title` / `description` | 各页面 `usePageSeo` | 每页独立撰写，`app.vue` 提供 titleTemplate |
| `og:*` / `twitter:*` | `usePageSeo`（页面）+ `app.vue`（全站默认） | 分享图四字段由 composable 统一补全 |
| `canonical` | `app/app.vue`（computed）+ 各页 | 两处取值一致，见 §10.2 |
| `hreflang` | `app/app.vue` | 单语言站，声明 `zh-CN` |
| 结构化数据（兜底） | `app/app.vue` | `Organization` + `WebSite`，全站每页都有 |
| 结构化数据（页面级） | 各页面 | `SoftwareApplication` / `ItemList` / `TechArticle` / `AboutPage` / `BreadcrumbList` |
| `sitemap.xml` | `nuxt.config.ts` 的 `sitemap` | 排除 `/admin`，含 `lastmod` |
| `robots.txt` | `public/robots.txt` | 静态文件，屏蔽 `/api/` 与 `/admin` |
| 搜索引擎验证 | `public/BingSiteAuth.xml` | Bing 站点所有权验证，见 §10.5 |
| 404 | `app/error.vue` | 真实 404 状态码 + `noindex` |

### 10.2 canonical 必须是响应式的

```ts
const route = useRoute()
const canonicalUrl = computed(() => `${site.url}${route.path}`)
useHead({ link: computed(() => [{ rel: 'canonical', href: canonicalUrl.value }]) })
```

如果写成 `useRoute().path` 直接取值，setup 只算一次，
客户端路由切换后 canonical 会一直停留在进入站点时的旧路径。

页面级还会通过 `usePageSeo(meta, { path })` 再声明一份同值的 canonical。
两处取值一致，后者覆盖前者，**不会产生重复标签**；页面级显式声明的好处是
未来出现 query 参数或尾斜杠差异时，页面有自己的决定权。

### 10.3 分享图：必须 PNG，字段必须带全

**这是历史上真实踩过的坑，细节见 [§13.7.1](#1371-分享图不能用-svg)。**
两条硬性要求：

1. **图片只能是 PNG/JPEG**。SVG 不被任何主流社交抓取器支持，
   分享出去会静默退化成纯文本链接（不报错，极难发现）。
2. **四个字段必须带全**：`og:image`（绝对 URL）、`og:image:width`、
   `og:image:height`、`og:image:alt`，外加 `og:image:type`。
   部分平台拿不到宽高会拒绝渲染大图卡片。

这两条**不要在各页面手写** —— 统一由 `app/composables/usePageSeo.ts` 补全。
新增页面用它即可，分享图相关字段一个都不用写。

分享图的源文件是 `public/og.svg`，产物是 `public/og.png`（1200×630）。
**改了 SVG 必须重新栅格化**，命令行见 §13.7.1。

### 10.4 结构化数据：用 `@id` 串成一张图

`app.vue` 声明全站兜底的 `Organization` 与 `WebSite`，每个页面都会带上。
页面级 JSON-LD **通过 `@id` 引用它们**，而不是各自复制一份孤立对象：

```ts
author:    { '@id': `${site.url}/#organization` },
publisher: { '@id': `${site.url}/#organization` },
about:     { '@id': `${site.url}/#software` },
```

三个固定锚点：`#organization`（LiStudioorg）、`#website`（本站）、
`#software`（LiCore 本体，首页声明）。

**为什么要这样**：搜索引擎借此理解「这些是同一实体的不同侧面」，
而不是一堆互不相干的孤立对象；也是 Google 软件下载富结果识别
publisher 的前提。全站兜底的价值在于 —— **任何一页被单独抓取时**
都能拿到发布者信息，不必依赖首页先被发现。

校验方式（每个页面都应 0 错误）：

```bash
curl -s http://127.0.0.1:3000/ > /tmp/p.html
node -e '
const html=require("fs").readFileSync("/tmp/p.html","utf8");
const re=/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
let m,i=0;
while((m=re.exec(html))){i++;try{JSON.parse(m[1])}catch(e){console.log("block",i,"PARSE ERROR",e.message)}}
console.log("blocks:",i,"— 无输出即全部通过")'
```

### 10.5 搜索引擎验证文件

| 文件 | 用途 |
| --- | --- |
| `public/BingSiteAuth.xml` | Bing Webmaster Tools 站点验证 |

放在 `public/` 下即可 —— Nuxt 构建时原样拷到产物根目录，
以站点根路径对外提供（Bing 正是从这个固定路径读取）。
Google 的验证通常走 DNS TXT 或 GSC 导入，目前没有对应的 HTML 文件。

> ⚠️ **从外部拿到的验证文件注意权限**。附件/下载来源的文件常见权限是 `400`
> （仅属主可读），直接提交会让服务器上的运行用户读不到，验证失败且报错含糊。
> 提交前 `chmod 644`，与其他静态资源保持一致。

### 10.6 description 长度控制

**控制在 155~160 字符内**。超出会被 Google 截断，后半句等于白写。
写完用这个检查：

```bash
curl -s http://127.0.0.1:3000/ | grep -o 'name="description" content="[^"]*"' \
  | awk -F'"' '{print length($4)}'
```

注意站点主要用**中文字符**，Google 的截断按像素宽度而非字符数计算，
中文约 2 倍宽 —— 中文描述实际控制在 **75~80 个汉字**左右更稳妥。

---

## 11. 样式与设计系统

- **Tailwind 4**，通过 `@tailwindcss/vite` 插件接入，配置在
  `app/assets/css/main.css` 的 `@theme` 块里（Tailwind 4 不再用
  `tailwind.config.js`）。
- **`fuxsto-design`** 提供组件（Button / Card / Chip / Badge / Input 等）。
  在 `nuxt.config.ts` 里**不自动导入**，各文件显式 `import`。
- **`lucide-vue-next`** 提供图标。
- 自定义组件走自动导入（`components: [{ path: '~/components', pathPrefix: false }]`），
  因为 `pathPrefix: false`，用 `<LinkButton>` 而不是 `<ComponentsLinkButton>`。

设计令牌用语义化 CSS 变量（`bg-background`、`text-muted-foreground`、
`border-border` 等），**不要写死颜色值**，否则暗色模式会失效。

---

## 12. 常见改造任务

### 改站点文案（标题、副标题、描述）

改 `app/config/site.ts`，然后检查各页面的 `usePageSeo` 有没有跟着变。

> `site.description` 在全站有三处消费：`app.vue` 的兜底 description、
> `nuxt.config.ts` 的 `site.description`（喂给 sitemap 模块）、
> 以及首页/关于页文案。改完记得扫一眼。

### 加一个页面

```bash
# 1. 建文件
touch app/pages/faq.vue
```

```vue
<script setup lang="ts">
usePageSeo(
  {
    title: '常见问题',
    description: '……（中文控制在 75~80 字内，见 §10.6）',
    ogTitle: 'LiCore 常见问题',
    ogDescription: '……',
    ogUrl: `${site.url}/faq`,
    twitterTitle: 'LiCore 常见问题',
    twitterDescription: '……',
  },
  { path: '/faq' },
)
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
    <h1 class="text-3xl font-bold tracking-tight">常见问题</h1>
  </div>
</template>
```

**用 `usePageSeo` 而不是 `useSeoMeta`** —— 它会自动补全
`og:image` / `twitter:image` 的绝对地址、宽高、alt、type 四个字段。
直接写 `useSeoMeta` 会漏掉它们，分享卡片会退化（见 §10.3）。

然后：

1. `nuxt.config.ts` 的 `sitemap.urls` 里加一条
2. `app/components/SiteHeader.vue` 的导航里加链接（如果需要）
3. 建议补一个页面级 JSON-LD（`BreadcrumbList` 至少要有），
   并用 `@id` 引用 `#organization`，见 §10.4
4. 跑一遍 §14 的验证；CI 只断言首页的 SEO 标签，
   **新页面的标签不会被 CI 覆盖**，要自己 curl 确认

### 改分享图

改 `public/og.svg` 后**必须重新栅格化** `public/og.png`：

```bash
rsvg-convert -w 1200 -h 630 public/og.svg -o public/og.png
```

注意 CJK 字体 fallback 的坑，见 [§13.7.1](#1371-分享图不能用-svg)。

### 改缓存时长

改 `licore-site.toml` 的 `[github]` 段，重启服务。**不要改代码里的常量**。

### 加一个 API 路由

见 [§5](#5-api-路由)。

### 调整更新日志的分组规则

`server/utils/changelog.ts` 里负责把提交按 Conventional Commits
前缀（feat / fix / docs / perf / refactor …）分组。改分组标题和顺序在
`ChangeGroup` 的构造处。

### 改下载项的展示逻辑

`server/utils/changelog.ts` 的 `buildDownloads()`。它会根据 Release
有没有二进制资产自动决定展示什么，改之前先读 [§4.2](#42-serverutilschangelogts--业务聚合)。

---

## 13. 踩过的坑

这一节记录**已经踩过并修复**的真实问题。改相关代码前务必读一遍。

### 13.1 `<Button as="a">` 是死按钮

`fuxsto-design` 的 `Button` 组件渲染函数里写死了
`createElementBlock("button")`，**没有 `as` prop**。所以：

```vue
<Button as="a" href="/download">下载</Button>
```

实际渲染成：

```html
<button as="a" href="/download">下载</button>
```

`<button>` 不识别 `href`，点击毫无反应。全站曾有 **22 个**导航入口
是死按钮。

**规则：任何跳转用途的按钮，一律用 `<LinkButton>`。**

另外 `Button` 默认带入场动画（`animate: true`），初始 `opacity-0` +
`pointer-events-none`，依赖客户端 JS 才可见。`LinkButton` 刻意去掉了动画类
—— 链接在 SSR 输出里就应该是可用的。

### 13.2 `grep -q` 在管道里会假阴性

```bash
# ❌ 会失败
set -euo pipefail
tar -tzf pkg.tar.gz | grep -q 'entry'

# ✅ 正确
tar -tzf pkg.tar.gz > /tmp/list.txt
grep -qx 'entry' /tmp/list.txt
```

`grep -q` 匹配到第一条就退出并关闭管道，而 `tar` / `echo` 还在往里写，
触发 **SIGPIPE** 以非 0 退出，叠加 `set -o pipefail` 整个 pipeline 被判失败。

实测退出码 **141**，改成落盘后再 grep 则为 **0**。

同样的坑在 `ci.yml` 的 SEO 断言里也遇到过（`echo "$HTML" | grep -q`），
当时的现象是"CI 报缺少 `<title>` 但页面明明正常"。

### 13.3 客户端 bundle 不能含服务端代码

**症状**：整站水合失败 —— 主题切换、移动端菜单、后台登录、复制按钮、
筛选全部无效，但 HTML 看起来完全正常。

**原因**：页面静态 `import` 了 `~~/server/utils/config.ts`，
于是 `node:fs` / `smol-toml` / `process.cwd()` 都被打进客户端。
浏览器里这些不存在，模块求值阶段就抛 `TypeError`。

**规则**：
- 页面取数一律走 `$fetch('/api/*')`
- 从 `~~/server/utils/*` **只允许 `import type`**（编译期擦除）

**检查方法**：

```bash
npm run build
for p in "api.github.com" "existsSync" "readFileSync" "process.cwd" "node:fs" "smol-toml"; do
  echo "$p → $(grep -rl -F "$p" .output/public/_nuxt/ 2>/dev/null | wc -l)"
done
# 全部应为 0
```

### 13.4 不要关掉 `payloadExtraction`

`nuxt.config.ts` 里曾设过 `payloadExtraction: false`，导致页面 HTML 里
**完全没有 `__NUXT__` 脚本**（实测 0 处）。客户端水合拿不到服务端数据，
只能重跑 loader 直连 GitHub，数据取不到就白屏。

现在该配置已移除，`experimental` 块里留了注释说明原因。
**不要加回来。**

### 13.5 markdown 渲染器的列表与代码块

早期用正则链渲染 markdown，有两个 bug：

```js
// ❌ 每条 <li> 各自包一个 <ul>，产出非法嵌套
html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')

// ❌ 换行替换后再包 <p>，产出孤立的 </p>
html.replace(/\n{2,}/g, '</p><p>').replace(/^(?!<[huop])/gm, '<p>')
```

现已重写为**行级状态机**（列表归并、段落归并、代码块先抽成占位符）。
改这部分前请先在隔离环境测输出结构。

### 13.6 上游失败不要抛 500

未捕获的上游错误会被 Nitro 记成 `[request error] [unhandled]` 并返回 500，
日志堆栈看起来像应用崩溃。所有公开 API 路由都必须用
`upstreamUnavailable()` 降级为 503。见 [§4.3](#43-serverutilsupstreamts--失败降级)。

### 13.7 API 路由文件名的后缀

`token.set.post.ts` → 路由 `/api/admin/token.set`，方法 POST。
写成 `token.set.ts` 会变成 GET + `method: undefined`，POST 过去是 404。
后缀只能是 `.get` / `.post` / `.put` / `.delete` / `.patch`。

### 13.7.1 分享图不能用 SVG

`og:image` / `twitter:image` 曾全部指向 `/og.svg`。**SVG 不被任何主流社交
抓取器支持** —— Facebook、X、LinkedIn、微信、Slack、Discord 拿到 SVG 会直接
放弃渲染大图卡片，分享出去退化成一条纯文本链接。

现已改为 `/og.png`（1200×630，OG 推荐尺寸），由 `og.svg` 栅格化而来：

```bash
rsvg-convert -w 1200 -h 630 public/og.svg -o public/og.png
```

**注意两个细节**：

1. **必须显式指定 CJK 字体**。`og.svg` 里的 `font-family` 原本是
   `ui-sans-serif,system-ui,sans-serif`，在没有中文默认字体的构建机上会
   fallback 到 DejaVu（无中文字形），中文渲染成豆腐块。栅格化时要把
   `Noto Sans CJK SC` 加进 fallback 链。
2. **改了 `og.svg` 必须重新生成 `og.png`**，两者不会自动同步。

另外 `og:image:width` / `og:image:height` / `og:image:alt` / `og:image:type`
四个字段必须带全：部分平台拿不到宽高会拒绝渲染大图卡片或延迟抓取。
这四项目前由 `app/composables/usePageSeo.ts` 统一补全，页面不再各写一遍
（历史上有 5 个页面各自手写，换图时很容易漏改其中一两个）。

### 13.8 GitHub Token 前缀写错，导致后台永远保存不上

`server/api/admin/token.set.post.ts` 里曾有一句：

```ts
if (raw && !raw.startsWith('gh_')) throw createError({ statusCode: 400, … })
```

**`gh_` 这个前缀任何真实 token 都不满足。** GitHub 的 token 在第 4 个字符
才是下划线：`ghp_`（classic PAT）、`github_pat_`（fine-grained PAT）、
`gho_` / `ghu_` / `ghs_` / `ghr_`。

现象是**后台面板粘贴任何合法 token 都提示"必须以 gh_ 开头"**，
`licore-runtime-token` 永远写不出来，token 永远不生效。

**教训**：不要断言一个我们无法穷举、且上游会随时新增的格式。
现在的校验只拦「明显像被截断」的输入（长度 < 20 或含空白/非法字符），
真正的有效性交给 GitHub —— token 错了 `api.github.com` 会返回 401，
面板的「上游状态」卡片会如实显示不可达。

> 排查同类问题时注意：`curl` 的 cookie jar 是**按文件名复用**的。
> 如果复用了别的项目的 jar（例如里面已有 `lipanel_token`），
> 登录写不进去，后续请求会全部 401，看着像鉴权坏了，其实是测试脚本的问题。
> 每次都 `rm -f` 一个新 jar 再登录。

---

## 14. 测试与校验

### 本地

```bash
npm run typecheck    # vue-tsc，必须 0 错误
npm run build        # 生产构建
npm run dev          # 开发服务器
```

### 构建后手动验证

```bash
PORT=3000 node .output/server/index.mjs &

# 全部页面应 200（上游不可达时也必须 200，页面降级渲染）
for p in / /changelog /download /docs /about /admin /sitemap.xml /robots.txt; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000$p)  $p"
done

# 后台鉴权底线：未登录必须 401
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/admin/status
```

### CI 做什么

`.github/workflows/ci.yml` 在每次 push / PR 时：

1. `npm run typecheck`
2. `npm run build`
3. 启动产物，断言 8 条路由 **200**
4. 断言后台未登录访问为 **401**（鉴权被改坏必须让 CI 变红）
5. 断言 5 个 SEO 标签存在

### 提交前自查清单

- [ ] `npm run typecheck` 无错误
- [ ] `npm run build` 成功
- [ ] 没有页面静态引入 `~~/server/utils/*` 的**函数**（只能 `import type`）
- [ ] 新增的 `$fetch` 都带了 `.catch(() => null)`
- [ ] 跳转用途的按钮用的是 `LinkButton` 而不是 `Button`
- [ ] 客户端 bundle 检查全为 0（见 [§13.3](#133-客户端-bundle-不能含服务端代码)）
- [ ] 新增页面已加入 `sitemap.urls` 和导航
- [ ] 新增/改动的页面用的是 **`usePageSeo`** 而不是裸 `useSeoMeta`（§10.3）
- [ ] 页面 JSON-LD 能 `JSON.parse` 通过，且用 `@id` 引用 `#organization`（§10.4）
- [ ] 改了 `og.svg` 的话，`og.png` 已重新生成（§10.3）
- [ ] 从外部拿到的验证文件已 `chmod 644`（§10.5）

---

## 附：技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | Nuxt 4（`ssr: true`，纯动态 SSR） |
| UI | Vue 3.5 + `fuxsto-design` 1.0.5 |
| 样式 | Tailwind 4（`@tailwindcss/vite`） |
| 图标 | `lucide-vue-next` |
| 服务端 | Nitro（Node 22+） |
| 配置 | `smol-toml` |
| SEO | `@nuxtjs/sitemap` |
| 类型 | TypeScript 5.9（`strict: true`） |
| CI/CD | GitHub Actions（校验 + 发行，**不含自动部署**） |
