<script setup lang="ts">
import { site } from '~/config/site'

const { init } = useTheme()

// 页面级默认 SEO；各页面用 useSeoMeta 覆盖
useHead({
  titleTemplate: (title?: string) =>
    title ? `${title} | ${site.name}` : `${site.name} — ${site.tagline}`,
  link: [
    { rel: 'canonical', href: `${site.url}${useRoute().path}` },
    { rel: 'alternate', hreflang: 'zh-CN', href: `${site.url}${useRoute().path}` },
  ],
})

useSeoMeta({
  description: site.description,
  ogSiteName: site.name,
  ogType: 'website',
  ogLocale: site.locale,
  twitterCard: 'summary_large_image',
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
