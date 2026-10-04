<script setup lang="ts">
import { computed } from 'vue'
import { cn } from 'fuxsto-design'

/**
 * 链接形态的按钮 —— 用与 <Button> 完全相同的视觉类名渲染真正的 <a> / <NuxtLink>。
 *
 * ⚠️ 为什么需要这个组件
 * fuxsto-design 的 <Button> 渲染函数里写死了 `createElementBlock("button", ...)`，
 * props 里也没有 `as`。所以 `<Button as="a" href="/download">` 实际渲染成
 * `<button type="button" as="a" href="/download">` —— `<button>` 不识别 href，
 * 点击没有任何反应。本站原来有 22 处这样写，等于所有导航入口全是死按钮。
 * 现在统一改用本组件。
 *
 * 与 Button 的区别：
 *   - 没有默认 `animate` 入场动画（Button 默认 opacity-0 + pointer-events-none，
 *     依赖客户端 JS 才可见；链接应在 SSR 输出里就是可用的）
 *   - 渲染真正的 <a> / <NuxtLink>，href / target / rel 生效
 */
const props = withDefaults(
  defineProps<{
    /** 站内路径 —— 走 <NuxtLink>（客户端路由，保留刷新按钮历史） */
    to?: string
    /** 绝对地址（或需跳转外部）—— 走 <a> */
    href?: string
    target?: string
    rel?: string
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'glass'
    size?: 'sm' | 'md' | 'lg'
    danger?: boolean
    round?: boolean
  }>(),
  {
    to: undefined,
    href: undefined,
    variant: 'primary',
    size: 'md',
  },
)

/** 类名与 Button.vue L139-L162 保持一致，避免视觉不一致 */
const classes = computed(() => {
  const v = props.variant
  const danger = props.danger

  return cn(
    'relative inline-flex items-center justify-center h-fit w-fit select-none font-bold overflow-hidden border',
    'transition-all duration-300 ease-smooth will-change-[border-radius,width]',
    props.round ? 'rounded-full' : 'rounded-base',
    {
      'bg-primary text-primary-foreground border-transparent hover:opacity-90': v === 'primary' && !danger,
      'bg-destructive text-destructive-foreground border-transparent hover:opacity-90': v === 'primary' && danger,
      'bg-secondary text-secondary-foreground hover:bg-secondary/80 border-border/40': v === 'secondary' && !danger,
      'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20': v === 'secondary' && danger,
      'bg-background text-foreground border-border hover:bg-muted/80 hover:border-border/80': v === 'outline' && !danger,
      'bg-destructive/5 text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/60': v === 'outline' && danger,
      'bg-transparent text-foreground border-transparent hover:bg-muted/50': v === 'ghost' && !danger,
      'bg-transparent text-destructive border-transparent hover:bg-destructive/10': v === 'ghost' && danger,
      'bg-background/40 backdrop-blur-md text-foreground border-white/20 dark:border-white/10 hover:bg-white/10':
        v === 'glass' && !danger,
    },
    {
      'px-3.5 py-1.5 text-xs': props.size === 'sm',
      'px-5 py-2.5 text-sm': props.size === 'md',
      'px-7 py-3 text-base': props.size === 'lg',
    },
    'cursor-pointer active:scale-[0.96]',
  )
})

const isInternal = computed(() => Boolean(props.to))
</script>

<template>
  <NuxtLink
    v-if="isInternal"
    :to="to"
    :target="target"
    :rel="rel"
    :class="classes"
  >
    <slot />
  </NuxtLink>
  <a
    v-else
    :href="href"
    :target="target"
    :rel="rel"
    :class="classes"
  >
    <slot />
  </a>
</template>
