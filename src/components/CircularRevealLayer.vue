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
 * 圆形揭露层（2026-10-23，变更-170 第三版）—— 顶栏两个按钮共用。
 *
 * ## 口径（使用方 2026-10-23 亲口定的）
 *
 *   「圆圈切换的时候，用**要切换的主题**去扩散」
 *
 * 上一版是"先画旧底色的圆 → 铺满 → 才切主题"，看起来就是"圈慢慢扩开、然后整屏跳一下"，
 * 感官上很卡。现在的两条路径都保证**圆里滚的是新主题**：
 *
 *   · 有 View Transitions（H5 / 新内核）：把 switchNow() 放进 VT 回调 ⇒ new 快照即新主题，
 *     再用 clip-path: circle() 裁 ⇒ 圆扩到哪，新主题露到哪，中间没有硬切。
 *   · 没有 VT（老 WebView / 小程序）：圆用**目标主题的底色**扩散，铺满后再 switchNow()
 *     （此刻整屏已被圆盖住，切换看不出来）。
 *
 * 几何仍是使用方口径：圆心 = 按钮中心；半径 = 到最远角。
 */
const revealing = ref(false)
const circleStyle = ref('')

async function playCircle(geo, targetColor) {
  circleStyle.value = circleStyleOf(geo, targetColor)
  revealing.value = true
  await nextFrame()
  await new Promise((r) => setTimeout(r, REVEAL_MS + 40))
  revealing.value = false
}

/**
 * @param {object} opts
 * @param {string} opts.selector 触发按钮选择器
 * @param {object} [opts.instance] 组件实例
 * @param {() => void} opts.switchNow 真正切主题/配色的动作（同步）
 * @param {string} [opts.targetColor] 没有 VT 时圆用什么颜色（目标主题的纸色）
 * @param {number} [opts.duration]
 * @returns {Promise<'view-transition' | 'overlay' | 'no-anim'>}
 */
async function revealFrom({ selector, instance, switchNow, targetColor, duration = REVEAL_MS }) {
  let applied = false
  const applyOnce = () => {
    if (applied) return
    applied = true
    try {
      switchNow?.()
    } catch {
      /* 切主题失败不影响动画收尾 */
    }
  }

  const mode = await startReveal({
    selector,
    instance,
    onReveal: (geo) => {
      revealGeometry(geo)
      void viewportSize()
      pending = playWithGeo(geo)
    },
  })
  if (mode === 'no-anim') {
    // 拿不到几何：无动画直接切（使用方要求：不能报错卡死）
    applyOnce()
    return 'no-anim'
  }
  return pending

  // ---- 内部 ----
  async function playWithGeo(geo) {
    // #ifdef H5
    const hasVT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
    if (hasVT) {
      try {
        // ★ switchNow 放在回调里：新快照 = 新主题
        const transition = document.startViewTransition(() => applyOnce())
        await transition.ready
        const from = `circle(0px at ${geo.cx}px ${geo.cy}px)`
        const to = `circle(${geo.radius}px at ${geo.cx}px ${geo.cy}px)`
        const anim = document.documentElement.animate(
          { clipPath: [from, to] },
          { duration, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' },
        )
        try {
          await anim?.finished
        } catch {
          /* 被打断也继续 */
        }
        return 'view-transition'
      } catch {
        // 掉到下面的放大圆（applyOnce 保证不会重复切）
      }
    }
    // #endif

    await playCircle(geo, targetColor)
    applyOnce()
    return 'overlay'
  }
}

let pending = Promise.resolve()

defineExpose({ revealFrom, revealing, REVEAL_MS })
</script>

<template>
  <view v-if="revealing" class="palette-reveal" :style="circleStyle"></view>
</template>

<!--
  这一块**故意不写 scoped**：揭露层是 v-if 动态插入的节点，uni 的 H5 渲染层
  不给它挂 data-v-*，scoped 规则一条都匹配不上（实测：类名加上了、scale 永远是 0）。
-->
<style lang="scss">
.palette-reveal {
  animation: palette-reveal-grow 480ms ease-out both;
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
