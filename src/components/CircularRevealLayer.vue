<script setup>
import { ref } from 'vue'
import {
  circleStyleOf,
  nextFrame,
  REVEAL_MS,
  revealGeometry,
  startReveal,
  viewportSize,
} from '../composables/usePaletteReveal'

/*
 * 圆形揭露层（2026-10-23，变更-170 续）。
 *
 * 顶栏上有**两个**按钮都用这套转场：
 *   ① 配色（粉橙 ⇄ 粉紫）        ② 深浅色（浅 ⇄ 深）
 * 使用方 2026-10-23 要求 ② 也做成扩散（微信小程序同样），所以把动画抽成这个公用件。
 *
 * ## 契约（刻意的选择，踩过两次坑才定下来）
 *
 *   `revealFrom()` **等到动画播完才 resolve**，返回值：
 *     'reveal'  动画已播完，屏幕已被圆盖住 —— 调用方此时切主题即可
 *     'no-anim' 拿不到几何 / 不支持 —— 调用方立即切
 *
 * 为什么不回调父组件：试过 `:on-covered`（Vue 把 on* 当事件监听器，prop 收不到）
 * 和自定义 emit（组件 ref 转发链路容易断）。"await 一个 Promise"没有歧义。
 *
 * 三端分工见 composables/usePaletteReveal.js 头注。
 */
const revealing = ref(false)
const circleStyle = ref('')

async function playCircle(geo) {
  circleStyle.value = circleStyleOf(geo)
  revealing.value = true
  await nextFrame()
  await new Promise((r) => setTimeout(r, REVEAL_MS + 40))
  revealing.value = false
}

/** H5 有 View Transitions 时走原生；否则走放大的圆 */
async function playViewTransition(geo) {
  // #ifdef H5
  const hasVT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
  if (hasVT) {
    try {
      // 用空回调开转场：等 ready 之后自己 animate clip-path，动画结束再让调用方切主题
      const transition = document.startViewTransition(() => {})
      await transition.ready
      const from = `circle(0px at ${geo.cx}px ${geo.cy}px)`
      const to = `circle(${geo.radius}px at ${geo.cx}px ${geo.cy}px)`
      const anim = document.documentElement.animate(
        { clipPath: [from, to] },
        { duration: REVEAL_MS, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
      )
      try {
        await anim?.finished
      } catch {
        /* 被打断也继续 */
      }
      return
    } catch {
      // 落到放大的圆
    }
  }
  // #endif
  await playCircle(geo)
}

/**
 * 从某个按钮开始做圆形揭露，**动画结束后** resolve。
 * @param {string} selector 触发按钮的选择器
 * @param {object} [instance] 组件实例（模板里传 getCurrentInstance().proxy）
 * @returns {Promise<'reveal' | 'no-anim'>}
 */
async function revealFrom(selector, instance) {
  const mode = await startReveal({
    selector,
    instance,
    onReveal: (geo) => {
      // 故意不 await：startReveal 只负责"有没有几何"，播动画是接下来这句
      revealGeometry(geo)
      void viewportSize()
      playQueue = playViewTransition(geo)
    },
  })
  if (mode === 'no-anim') return 'no-anim'
  await playQueue
  return 'reveal'
}

/** 当前在播的那段（revealFrom 里等它） */
let playQueue = Promise.resolve()

defineExpose({ revealFrom, revealing, REVEAL_MS })
</script>

<template>
  <view v-if="revealing" class="palette-reveal" :style="circleStyle"></view>
</template>

<!--
  这一块**故意不写 scoped**（2026-10-23，变更-170）：
  揭露层是 v-if 动态插入的节点，uni 的 H5 渲染层不给它挂 data-v-*，
  scoped 规则一条都匹配不上（实测：类名加上了、scale 永远是 0）。
-->
<style lang="scss">
.palette-reveal {
  animation: palette-reveal-grow 520ms ease-out both;
}

@keyframes palette-reveal-grow {
  from {
    transform: scale(0);
  }
  to {
    transform: scale(1);
  }
}
</style>
