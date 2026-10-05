/**
 * sitemap 的动态 URL 源（供 @nuxtjs/sitemap 的 `sources` 消费）。
 *
 * 为什么要有这个路由：sitemap 模块的 `urls` 配置会在**构建期求值并序列化**
 * 进产物（`.output/server/chunks/virtual/global-sources.mjs`），运行期不再调用，
 * 于是 lastmod 会定格在构建那一刻。而 `autoLastmod: true` 又会在**每次请求**
 * 打上"当前时间"，让所有页面的 lastmod 永远等于现在 —— 搜索引擎会把这种
 * "每次抓取都变"的 lastmod 判定为不可信并忽略。
 *
 * 因此这里在**请求时**从数据层取真实的最后变更时间：
 * 上游仓库的 `pushed_at`（发行版、tag、提交都随它变化）。
 *
 * 取不到时**省略 lastmod**，而不是回退到当前时间 ——
 * 缺失的值爬虫会自行判断，错误的值会被直接忽略甚至降权。
 */
export default defineEventHandler(async (event) => {
  // 页面的 lastmod 语义是"内容最后一次变化"，上游发版才会变。
  // 用与发行数据一致的 TTL 做 HTTP 缓存，避免每次抓取都打 GitHub。
  setResponseHeader(event, 'cache-control', 'public, max-age=300, s-maxage=300')

  const base = [
    { loc: '/', changefreq: 'daily', priority: 1.0 },
    { loc: '/changelog', changefreq: 'daily', priority: 0.9 },
    { loc: '/download', changefreq: 'weekly', priority: 0.9 },
    { loc: '/docs', changefreq: 'weekly', priority: 0.8 },
    { loc: '/about', changefreq: 'monthly', priority: 0.6 },
  ]

  let lastmod: string | undefined
  try {
    const meta = await getRepoMeta(event)
    // 只有能解析成合法时间才带上，避免写出 "Invalid Date"
    if (meta?.pushedAt && !Number.isNaN(Date.parse(meta.pushedAt))) {
      lastmod = new Date(meta.pushedAt).toISOString()
    }
  } catch {
    // 上游不可达：不写 lastmod（sitemap 本身仍要正常产出，不能因此报错）
  }

  return base.map((u) => (lastmod ? { ...u, lastmod } : u))
})
