<script setup lang="ts">
import { Github, Heart } from 'lucide-vue-next'
import { repo, site, navLinks } from '~/config/site'

const year = new Date().getFullYear()

const resourceLinks = [
  { label: 'GitHub 仓库', href: repo.url, external: true },
  { label: 'Issues 反馈', href: `${repo.url}/issues`, external: true },
  { label: '镜像格式规范', href: `${repo.url}/blob/main/docs/image-spec.md`, external: true },
  { label: '发布检查清单', href: `${repo.url}/blob/main/docs/release-checklist.md`, external: true },
]
</script>

<template>
  <footer class="border-t border-border bg-muted/30">
    <div class="site-container py-12">
      <div class="grid gap-10 md:grid-cols-4">
        <!-- 品牌 -->
        <div class="md:col-span-2">
          <div class="flex items-center gap-2.5">
            <img src="/logo.svg" alt="LiCore" width="28" height="28" class="size-7" />
            <span class="text-base font-semibold">{{ site.name }}</span>
          </div>
          <p class="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            {{ site.description }}
          </p>
          <p class="mt-4 text-xs text-muted-foreground">
            开源协议
            <a
              :href="`${repo.url}/blob/main/LICENSE`"
              target="_blank"
              rel="noopener noreferrer"
              class="font-medium text-foreground underline underline-offset-4"
              >{{ site.license }}</a
            >
            · 版权归 {{ site.author }} 所有
          </p>
        </div>

        <!-- 站内导航 -->
        <div>
          <h2 class="text-sm font-semibold">站内导航</h2>
          <ul class="mt-4 space-y-2.5">
            <li v-for="link in navLinks" :key="link.to">
              <NuxtLink
                :to="link.to"
                class="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <!-- 相关资源 -->
        <div>
          <h2 class="text-sm font-semibold">相关资源</h2>
          <ul class="mt-4 space-y-2.5">
            <li v-for="link in resourceLinks" :key="link.href">
              <a
                :href="link.href"
                target="_blank"
                rel="noopener noreferrer"
                class="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {{ link.label }}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div
        class="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
      >
        <p>© {{ year }} {{ site.author }} · {{ site.license }}</p>
        <p class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a
            :href="repo.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Github class="size-3.5" />
            {{ repo.slug }}
          </a>
          <span class="inline-flex items-center gap-1.5">
            <Heart class="size-3.5 text-primary" />
            本站版本数据实时同步自 GitHub
          </span>
        </p>
      </div>
    </div>
  </footer>
</template>
