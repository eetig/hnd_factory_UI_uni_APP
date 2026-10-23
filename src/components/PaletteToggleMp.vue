<script setup>
import { computed, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import { getCurrentInstance } from 'vue'
import { APP_PALETTES, REVEAL_MS, revealGeometry, startReveal, usePalette, viewportSize } from '../composables/usePaletteReveal'

/*
 * 配色切换按钮 + 圆形揭露（2026-10-23，变更-170）。
 *
 * 三端各走各的路（详见 composables/usePaletteReveal.js 的头注）：
 *   H5        优先 View Transitions；不支持则用这里的"放大的圆"层
 *   APP-PLUS  直接"放大的圆"（WebView 版本不可控）
 *   MP-WEIXIN "放大的圆"（小程序没有 VT），圆心靠 SelectorQuery 取
 *
 * 视觉统一：圆从按钮中心长出来，ease-out 520ms，铺满后切配色。
 */

const toast = useToast()
const { palette, togglePalette } = usePalette()

const instance = getCurrentInstance()?.proxy

/** 揭露层：位置/直径由几何算出，动画靠 transition: transform */
const revealing = ref(false)
const circleStyle = ref('')
const busy = ref(false)

const current = computed(() => APP_PALETTES.find((p) => p.key === palette.value) || APP_PALETTES[0])
const next = computed(() => APP_PALETTES[(APP_PALETTES.findIndex((p) => p.key === palette.value) + 1) % APP_PALETTES.length])

/**
 * 圆的几何（位置、直径、圆角、底色）。**只写静态部分**：
 * 放大由非 scoped 的 keyframes 负责（见文件末尾）。
 *
 * 为什么不靠 scoped CSS：这个层是 `v-if` 动态插入的节点，uni 的 H5 渲染层
 * 没给它挂 `data-v-*`，`.palette-reveal[...]` 一条都匹配不上。
 */
function circleStyleOf(geo) {
  const { cx, cy, radius } = geo
  const size = radius * 2
  return [
    `position:fixed`,
    `z-index:9999`,
    `left:${cx - radius}px`,
    `top:${cy - radius}px`,
    `width:${size}px`,
    `height:${size}px`,
    `border-radius:50%`,
    `background-color:var(--ui-scene-bg)`,
    `pointer-events:none`,
    `transform-origin:center center`,
  ].join(';')
}

/**
 * 等一帧再展开。
 *
 * ⚠️ 不要用 requestAnimationFrame：**后台标签页 / 未激活的 WebView 里 rAF 会被暂停**，
 *    回调永远不来 —— 表现就是"点了以后圆一直停在 scale(0)、配色也不切"
 *    （2026-10-23 实测踩过一次，排查了很久）。定时器在任何情况下都会到。
 */
function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

async function withScaleCircle(geo) {
  /*
   * 圆的放大交给**非 scoped 的 keyframes**（见文件末尾第二个 <style>）。
   *
   * 这一路是被现实逼出来的，三次实测记录：
   *   ① scoped `.palette-reveal.is-open { transform: scale(1) }` → 不生效，
   *      因为 v-if 动态插入的节点没挂 data-v-*，scoped 选择器一条都匹配不上；
   *   ② inline 二次赋值 + `transition` → 停在 scale(0)，uni 渲染层不触发过渡；
   *   ③ 定时器分步写 inline transform → 依旧停在 scale(0)。
   * → 结论：位置/尺寸走 inline（这部分确实生效），**动画本身必须走 keyframes**，
   *   而且必须写在**非 scoped** 的样式块里（keyframes 不依赖 data-v，三端都认）。
   */
  circleStyle.value = circleStyleOf(geo)
  revealing.value = true
  await new Promise((r) => setTimeout(r, REVEAL_MS + 40))
  revealing.value = false
  togglePalette()
}

/** H5：VT 可用时走原生；不可用或抛错时退到放大圆 */
async function withViewTransition(geo) {
  // #ifdef H5
  const hasVT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
  if (hasVT) {
    try {
      const transition = document.startViewTransition(() => togglePalette())
      await transition.ready
      const from = `circle(0px at ${geo.cx}px ${geo.cy}px)`
      const to = `circle(${geo.radius}px at ${geo.cx}px ${geo.cy}px)`
      const anim = document.documentElement.animate(
        { clipPath: [from, to] },
        { duration: REVEAL_MS, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
      )
      anim?.finished?.catch?.(() => {})
      return
    } catch {
      // 落到下面的放大圆（配色可能已经切过，重复切一次是幂等的）
    }
  }
  // #endif
  await withScaleCircle(geo)
}

async function onClick() {
  if (busy.value) return
  busy.value = true
  try {
    const mode = await startReveal({
      selector: '.palette-toggle',
      instance,
      onReveal: (geo) => {
        withViewTransition(geo)
      },
    })
    // 拿不到几何 ⇒ 无动画直接切（使用方要求：不能报错卡死）
    if (mode === 'no-anim') {
      togglePalette()
      toast.show(`已切到${next.value.label}`)
    }
    // 几何校验也在这里复跑一次，便于单测与排查
    void revealGeometry
    void viewportSize
  } catch {
    togglePalette()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <view class="palette-wrap">
    <button
      class="palette-toggle"
      :aria-label="`切换配色：当前${current.label}，点击切到${next.label}`"
      @click="onClick"
    >
      <view class="palette-dots">
        <view v-for="dot in current.dots" :key="dot" class="palette-dot" :style="{ backgroundColor: dot }"></view>
      </view>
    </button>

    <!-- 圆形揭露层：只在动画期间存在；pointer-events:none 不挡操作 -->
    <view v-if="revealing" class="palette-reveal" :style="circleStyle"></view>
  </view>
</template>

<style lang="scss" scoped>
.palette-wrap {
  position: relative;
  flex-shrink: 0;
}

.palette-toggle {
  display: flex;
  align-items: center;
  gap: 6rpx;
  height: 56rpx;
  padding: 0 16rpx;
  border-radius: 28rpx;
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.palette-dots {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.palette-dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
}

/* 放大的圆：从按钮中心长出来把整屏盖住（ease-out，与 PC 一致） */
.palette-reveal {
  position: fixed;
  z-index: 9999;
  border-radius: 50%;
  background-color: var(--ui-scene-bg);
  transform: scale(0);
  transform-origin: center center;
  transition: transform 520ms ease-out;
  pointer-events: none;
  will-change: transform;
}
</style>

<!--
  这一块**故意不写 scoped**（2026-10-23，变更-170）：
  圆形揭露层是 `v-if` 动态插入的节点，uni 的 H5 渲染层不给它挂 data-v-*，
  scoped 规则一条都匹配不上（实测：类名加上了、scale 永远是 0）。
  非 scoped 的选择器只作用于本组件模板里的 .palette-reveal，风险可控。
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
