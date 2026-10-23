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

function paintCircle(geo) {
  const { cx, cy, radius } = geo
  // 用直径 + 圆心定位：圆是 scale(0→1)，所以初始尺寸就是最终大小的 1 倍，缩放即可
  const size = radius * 2
  circleStyle.value = [
    `left:${cx - radius}px`,
    `top:${cy - radius}px`,
    `width:${size}px`,
    `height:${size}px`,
  ].join(';')
}

async function withScaleCircle(geo) {
  paintCircle(geo)
  revealing.value = true
  // 下一帧再放大，否则初始 scale(0) 与后续值同帧、过渡不触发（踩过）
  await new Promise((r) => setTimeout(r, 16))
  circleStyle.value += ';transform:scale(1)'
  await new Promise((r) => setTimeout(r, REVEAL_MS))
  togglePalette()
  revealing.value = false
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
