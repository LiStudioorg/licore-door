<script setup lang="ts">
import { Button } from 'fuxsto-design'
import { Home, RotateCw } from 'lucide-vue-next'
import { site } from '~/config/site'

const props = defineProps<{ error: { statusCode: number; statusMessage?: string; message?: string } }>()

const isNotFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (isNotFound.value ? '页面不存在' : '服务暂时不可用'))
const detail = computed(() =>
  isNotFound.value
    ? '你访问的地址在 LiCore 官网上找不到对应内容，可能是链接已失效或拼写有误。'
    : '官网需要从 GitHub 实时获取 LiCore 的版本数据，此刻上游暂时无法访问。请稍后重试，或直接前往 GitHub 仓库查看。',
)

useSeoMeta({
  title: `${props.error.statusCode} — ${title.value}`,
  description: detail.value,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <SiteHeader />
    <main class="flex flex-1 items-center justify-center px-4 py-24">
      <div class="mx-auto max-w-lg text-center">
        <p class="font-mono text-6xl font-bold tracking-tight text-primary">
          {{ error.statusCode }}
        </p>
        <h1 class="mt-4 text-2xl font-semibold tracking-tight">{{ title }}</h1>
        <p class="mt-3 text-sm leading-6 text-muted-foreground">{{ detail }}</p>

        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <LinkButton href="/" variant="primary">
            <Home class="mr-1.5 size-4" />
            返回首页
          </LinkButton>
          <Button variant="outline" @click="$router.back()">
            <RotateCw class="mr-1.5 size-4" />
            重新加载
          </Button>
          <LinkButton :href="`${site.url}/download`" variant="ghost">前往下载页</LinkButton>
        </div>

        <p class="mt-8 text-xs text-muted-foreground">
          若问题持续存在，请到
          <a
            href="https://github.com/LiStudioorg/licore/issues"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline underline-offset-4"
            >GitHub Issues</a
          >
          反馈。
        </p>
      </div>
    </main>
    <SiteFooter />
  </div>
</template>
