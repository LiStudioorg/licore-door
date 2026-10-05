import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { site } from './app/config/site'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-03',
  devtools: { enabled: process.env.NODE_ENV === 'development' },

  // 纯 SSR 动态站点：不做预渲染，每次请求都走服务端（数据实时来自 GitHub）
  ssr: true,

  modules: ['@nuxtjs/sitemap'],

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [tailwindcss()],
    // fuxsto-design 是 ESM 产物，预打包可避免 SSR 期间重复解析
    optimizeDeps: {
      include: ['fuxsto-design', 'lucide-vue-next'],
    },
  },

  // 组件自动导入：只有我们自己写的组件，fuxsto-design 走显式导入
  components: [{ path: '~/components', pathPrefix: false }],

  imports: {
    dirs: ['composables', 'config'],
  },

  // Nuxt Site 配置：sitemap、canonical 等都以这里为准
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || site.url,
    name: site.name,
    description: site.description,
    defaultLocale: site.lang,
  },

  runtimeConfig: {
    /** 服务端专用，永不下发到客户端 */
    githubToken: process.env.GITHUB_TOKEN || '',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || site.url,
    },
  },

  app: {
    head: {
      htmlAttrs: { lang: site.lang },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: site.themeColor },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/favicon.svg' },
      ],
    },
  },

  /**
   * SEO：sitemap 自动包含全部页面。
   * 注意：模块本身没有 siteUrl 选项，站点域名由上面的 `site.url` 提供
   * （生产环境下 sitemap 里的绝对地址即取自该值）。
   */
  sitemap: {
    /**
     * ⚠️ 必须关掉 autoLastmod。
     *
     * 它给每条 URL 打上"当前时间"作为 lastmod，于是每次抓取 sitemap 时
     * 所有页面的 lastmod 都是刚刚 —— 搜索引擎会识别并**忽略**这种
     * "每次抓取都变"的 lastmod，等于白写。
     *
     * 真实时间改由下面 `sources` 指向的 `/api/sitemap-urls` 提供。
     */
    autoLastmod: false,
    // 后台面板会被 sitemap 模块自动发现，必须显式排除：
    // 该页面本身已是 noindex，若再出现在 sitemap 里会给爬虫互相矛盾的信号。
    exclude: ['/admin'],
    /**
     * 动态 lastmod 来源。
     *
     * ⚠️ 这里用 `sources.fetch` 指向**自己的 API 路由**，而不是把 `urls`
     * 写成函数 —— 模块会把 `urls` 在**构建期求值并序列化**进
     * `.output/server/chunks/virtual/global-sources.mjs`，运行期不再调用，
     * 于是 lastmod 会固化在构建那一刻（实测过，函数写法的产物里
     * urls 是一份静态数组）。`fetch` 形式的源则是在**每次请求 sitemap 时**
     * 通过 `event.$fetch` 拉取，才是真正的运行时取值。
     *
     * `/api/sitemap-urls` 会从数据层取仓库 `pushed_at` 作为 lastmod；
     * 上游不可达时它省略 lastmod（缺失比假时间安全）。
     */
    sources: ['/api/sitemap-urls'],
  },

  nitro: {
    compressPublicAssets: true,
    /**
     * 预渲染**纯静态**页面。
     *
     * /docs 的正文全部写死在 docs.vue 里，没有任何 useAsyncData / 配置开关依赖
     * （唯一带 async 的是剪贴板按钮的处理函数）。它每次请求都走一遍 SSR 是纯浪费，
     * 而且和动态页一样要等 Nitro 渲染完才能吐出第一个字节。
     *
     * 预渲染后构建期就产出静态 HTML，首字节几乎只受静态文件读取速度影响。
     *
     * ⚠️ 只放 /docs。其余页面（/ /changelog /download /about）的数据实时来自
     * GitHub，**绝不能**预渲染 —— 否则版本号会固化在构建产物里，
     * 上游发新版必须重新部署，与本站"动态 SSR"的核心设计相悖。
     * /admin 也不预渲染（客户端渲染 + noindex）。
     */
    prerender: {
      routes: ['/docs'],
      crawlLinks: false,
    },
    routeRules: {
      /**
       * 页面是动态 SSR，交给 CDN/反代做短暂缓存即可；
       * API 允许跨域读取，并设置 60 秒浏览器 / 300 秒共享缓存，
       * 与 server/utils/github.ts 的内部缓存配合，避免打爆 GitHub 配额。
       */
      '/**': { headers: { 'x-content-type-options': 'nosniff' } },
      /**
       * 静态资源带内容哈希，可以放心长期强缓存 ——
       * 文件名一变 URL 就变，不存在更新不到的问题。
       * 不做这一步的话，每次访问都要回源校验这些 JS/CSS。
       */
      '/_nuxt/**': {
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
      },
      '/docs': {
        // 预渲染出的静态页：短期共享缓存，兼顾"能被 CDN 收"与"改动及时生效"
        headers: { 'cache-control': 'public, max-age=300, s-maxage=3600' },
      },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  experimental: {
    // 不要把 payloadExtraction 设为 false：
    // 页面用 useAsyncData 把 SSR 结果写进 payload 再转移给客户端，
    // 关掉提取会让客户端水合时重新执行 loader（在浏览器里直连 api.github.com，
    // 消耗访客 IP 的匿名配额），且没有 __NUXT__ 脚本兜底，数据一旦取不到就白屏。
  },

  alias: {
    '~': fileURLToPath(new URL('./app', import.meta.url)),
    '@': fileURLToPath(new URL('./app', import.meta.url)),
  },
})
