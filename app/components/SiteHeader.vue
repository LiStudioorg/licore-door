/**
 * 站点头部导航。SSR 渲染，含主题切换与移动端菜单。
 */
<script setup lang="ts">
import { Menu as MenuIcon, X, Github, Moon, Sun, Download } from 'lucide-vue-next'
import { navLinks, repo, site } from '~/config/site'

const route = useRoute()
const mobileOpen = ref(false)
const scrolled = ref(false)
const { toggle } = useTheme()

const isActive = (to: string) =>
  to === '/' ? route.path === '/' : route.path.startsWith(to)

function onScroll() {
  scrolled.value = window.scrollY > 8
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))

// 路由变化时收起移动端菜单
watch(() => route.path, () => (mobileOpen.value = false))
</script>

<template>
  <header
    class="sticky top-0 z-50 w-full border-b transition-colors duration-200"
    :class="
      scrolled
        ? 'border-border bg-background/80 backdrop-blur-lg'
        : 'border-transparent bg-background/40 backdrop-blur-sm'
    "
  >
    <div class="site-container flex h-16 items-center justify-between gap-4">
      <!-- Logo -->
      <NuxtLink to="/" class="flex shrink-0 items-center gap-2.5" aria-label="LiCore 首页">
        <img src="/logo.svg" alt="LiCore" width="30" height="30" class="size-[30px]" />
        <span class="text-lg font-semibold tracking-tight">{{ site.name }}</span>
      </NuxtLink>

      <!-- 桌面导航 -->
      <nav class="hidden items-center gap-1 md:flex" aria-label="主导航">
        <NuxtLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
          :class="
            isActive(link.to)
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          "
          :aria-current="isActive(link.to) ? 'page' : undefined"
        >
          {{ link.label }}
        </NuxtLink>
      </nav>

      <div class="flex items-center gap-2">
        <ClientOnly>
          <button
            type="button"
            class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="切换深色/浅色主题"
            @click="toggle()"
          >
            <Sun class="size-4 dark:hidden" />
            <Moon class="hidden size-4 dark:block" />
          </button>
          <template #fallback>
            <div class="size-9" />
          </template>
        </ClientOnly>

        <a
          :href="repo.url"
          target="_blank"
          rel="noopener noreferrer"
          class="hidden size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          aria-label="GitHub 仓库"
        >
          <Github class="size-4" />
        </a>

        <LinkButton href="/download" size="sm" class="hidden sm:inline-flex">
          <Download class="mr-1.5 size-3.5" />
          下载
        </LinkButton>

        <!-- 移动端菜单按钮 -->
        <button
          type="button"
          class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          :aria-expanded="mobileOpen"
          aria-controls="mobile-nav"
          aria-label="打开导航菜单"
          @click="mobileOpen = !mobileOpen"
        >
          <X v-if="mobileOpen" class="size-5" />
          <MenuIcon v-else class="size-5" />
        </button>
      </div>
    </div>

    <!-- 移动端导航面板 -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <nav
        v-if="mobileOpen"
        id="mobile-nav"
        class="border-t border-border bg-background md:hidden"
        aria-label="移动端导航"
      >
        <div class="site-container flex flex-col py-3">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="rounded-md px-3 py-2.5 text-sm font-medium transition-colors"
            :class="
              isActive(link.to)
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            "
          >
            {{ link.label }}
          </NuxtLink>
          <a
            :href="repo.url"
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent/50"
          >
            <Github class="size-4" />
            GitHub 仓库
          </a>
        </div>
      </nav>
    </Transition>
  </header>
</template>
