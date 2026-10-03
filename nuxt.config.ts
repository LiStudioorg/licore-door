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
    autoLastmod: true,
    // 后台面板会被 sitemap 模块自动发现，必须显式排除：
    // 该页面本身已是 noindex，若再出现在 sitemap 里会给爬虫互相矛盾的信号。
    exclude: ['/admin'],
    // changefreq / priority 属于"每条 URL 的默认值"，需放在 defaults 里
    defaults: { changefreq: 'daily', priority: 0.8 },
    urls: [
      { loc: '/', changefreq: 'daily', priority: 1.0 },
      { loc: '/changelog', changefreq: 'daily', priority: 0.9 },
      { loc: '/download', changefreq: 'weekly', priority: 0.9 },
      { loc: '/docs', changefreq: 'weekly', priority: 0.8 },
      { loc: '/about', changefreq: 'monthly', priority: 0.6 },
    ],
  },

  nitro: {
    compressPublicAssets: true,
    routeRules: {
      /**
       * 页面是动态 SSR，交给 CDN/反代做短暂缓存即可；
       * API 允许跨域读取，并设置 60 秒浏览器 / 300 秒共享缓存，
       * 与 server/utils/github.ts 的内部缓存配合，避免打爆 GitHub 配额。
       */
      '/**': { headers: { 'x-content-type-options': 'nosniff' } },
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  experimental: {
    // 让 payload 更小，SSR 传输更快
    payloadExtraction: false,
  },

  alias: {
    '~': fileURLToPath(new URL('./app', import.meta.url)),
    '@': fileURLToPath(new URL('./app', import.meta.url)),
  },
})
