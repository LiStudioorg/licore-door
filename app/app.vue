<script setup lang="ts">
import { repo, site } from '~/config/site'

const { init } = useTheme()
const route = useRoute()

/**
 * canonical 必须是响应式的。
 * 早先写成 `href: ${site.url}${useRoute().path}` —— 字符串在 setup 时求值一次，
 * 服务端渲染每页都是对的，但客户端路由切换后 app.vue 的 setup 不会重跑，
 * 于是 <link rel="canonical"> 一直指向进入本站时的那个路径。
 */
const canonicalUrl = computed(() => `${site.url}${route.path}`)

// 页面级默认 SEO；各页面用 useSeoMeta 覆盖
useHead({
  titleTemplate: (title?: string) =>
    title ? `${title} | ${site.name}` : `${site.name} — ${site.tagline}`,
  link: computed(() => [
    { rel: 'canonical', href: canonicalUrl.value },
    { rel: 'alternate', hreflang: 'zh-CN', href: canonicalUrl.value },
  ]),
})

useSeoMeta({
  description: site.description,
  ogSiteName: site.name,
  ogType: 'website',
  ogLocale: site.locale,
  twitterCard: 'summary_large_image',
})

/**
 * 全站兜底的结构化数据。
 *
 * 首页会再声明一份更完整的 `@graph`（同一组 @id），两处指向同一实体，
 * 因此不冲突；这样做的价值在于：**任何一页被单独抓取时**，
 * 搜索引擎都能拿到「站点是谁、谁是发布者」，而不必依赖首页被发现。
 * 页面级 JSON-LD 通过 `@id` 引用这里的节点。
 */
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': `${site.url}/#organization`,
            name: site.author,
            url: repo.url,
            logo: `${site.url}/logo.svg`,
            sameAs: [repo.url],
          },
          {
            '@type': 'WebSite',
            '@id': `${site.url}/#website`,
            name: `${site.name} 官网`,
            url: site.url,
            inLanguage: site.lang,
            description: site.description,
            publisher: { '@id': `${site.url}/#organization` },
          },
        ],
      }),
    },
  ],
})

// 首屏前同步主题，避免闪白
useHead({
  script: [
    {
      innerHTML: `(function(){try{var s=localStorage.getItem('licore-theme');var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})()`,
      tagPosition: 'head',
      tagPriority: 'critical',
    },
  ],
})

onMounted(init)
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <a
      href="#main"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
    >
      跳到主要内容
    </a>
    <SiteHeader />
    <main id="main" class="flex-1">
      <NuxtPage />
    </main>
    <SiteFooter />
  </div>
</template>
