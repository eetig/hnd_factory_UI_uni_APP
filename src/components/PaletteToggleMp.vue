<script setup>
import { computed, getCurrentInstance, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import { APP_PALETTES, usePalette } from '../composables/usePaletteReveal'
import CircularRevealLayer from './CircularRevealLayer.vue'

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

/** 圆形揭露层（公用件，见 CircularRevealLayer.vue） */
const layerRef = ref(null)

const current = computed(() => APP_PALETTES.find((p) => p.key === palette.value) || APP_PALETTES[0])
const next = computed(() => APP_PALETTES[(APP_PALETTES.findIndex((p) => p.key === palette.value) + 1) % APP_PALETTES.length])

/** 动画期间不响应重复点击 */
const busy = ref(false)

async function onClick() {
  if (busy.value) return
  busy.value = true
  try {
    await layerRef.value?.revealFrom({
      selector: '.palette-toggle',
      instance,
      switchNow: togglePalette,
      targetColor: next.value.key === 'violet' ? '#FBFAFF' : '#FFFAF6',
    })
    toast.show(`已切到${next.value.label}`)
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

    <!-- 圆形揭露层（公用件）：动画期间存在，pointer-events:none 不挡操作 -->
    <CircularRevealLayer ref="layerRef" />
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
</style>
