<script setup>
import { ref } from 'vue'
import {
  circleStyleOf,
  nextFrame,
  prefersReducedMotion,
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

/*
 * View Transitions 的伪元素规则必须**运行时注入**。
 *
 * 原因：`::view-transition-old/new(root)` 在构建期被当成未知选择器剥掉了
 * （写进 App.vue 或组件的 style 里，产物 CSS 里都查不到 —— 实测两次）。
 * 这两条规则又缺一不可：
 *   · animation: none —— 关掉默认交叉淡入淡出，否则盖住我们的圆形裁切
 *   · .theme-dark::view-transition-old(root) { z-index: 100 } ——
 *     切深色时裁的是 old(root)，它必须压在新快照上面（element-plus 同款细节）
 */
function ensureViewTransitionCss() {
  // #ifdef H5
  try {
    if (typeof document === 'undefined' || document.getElementById('hnd-vt-css')) return
    const style = document.createElement('style')
    style.id = 'hnd-vt-css'
    style.textContent = [
      '::view-transition-new(root),::view-transition-old(root){animation:none;mix-blend-mode:normal;}',
      '.theme-dark::view-transition-old(root){z-index:100;}',
    ].join('')
    document.head.appendChild(style)
  } catch {
    // 注不进去就退化成"有 VT 但没有自定义裁切"（至少主题会切）
  }
  // #endif
}

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
 * @param {boolean} [opts.goDark] 目标是深色 ⇒ 用"圆收起"（element-plus 的做法）
 * @param {number} [opts.duration]
 * @returns {Promise<'view-transition' | 'overlay' | 'no-anim'>}
 */
async function revealFrom({ selector, instance, switchNow, targetColor, goDark = false, duration = REVEAL_MS }) {
  ensureViewTransitionCss()
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

  // 减弱动效：不播，直接切（无障碍硬性要求）
  if (prefersReducedMotion()) {
    applyOnce()
    return 'no-anim'
  }

  /*
   * 看门狗（2026-10-23，变更-170 第七版）：200ms 内还没 apply 就强切。
   *
   * 为什么需要：切换动作现在是"在 VT 回调里执行"，这是**唯一能实现
   * '圆里滚新主题'** 的做法；但 VT 回调在某些内核/时序下可能迟迟不来。
   * 有这道保险，"点了没反应"这类问题从设计上就不会再出现（applyOnce 幂等）。
   */
  const watchdog = setTimeout(() => applyOnce(), 200)

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
    clearTimeout(watchdog)
    applyOnce()
    return 'no-anim'
  }
  try {
    const result = await pending
    return result
  } finally {
    // 动画收尾之后再清：保证 VT 迟迟不 ready 时看门狗仍然生效
    clearTimeout(watchdog)
    applyOnce()
  }

  // ---- 内部 ----
  async function playWithGeo(geo) {
    // #ifdef H5
    const hasVT = typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
    if (hasVT) {
      try {
        // ★ switchNow 放在回调里：新快照 = 新主题
        const transition = document.startViewTransition(() => applyOnce())
        await transition.ready
        const grow = [
          `circle(0px at ${geo.cx}px ${geo.cy}px)`,
          `circle(${geo.radius}px at ${geo.cx}px ${geo.cy}px)`,
        ]
        /*
         * element-plus 的细节（掘金 7361721559239524390）：**方向不对称**
         *   · 切到浅色 → 裁 new(root)，圆从 0 长大（新界面从按钮里长出来）
         *   · 切到深色 → 裁 old(root)、clipPath **反过来**（半径→0），
         *     即旧界面收成一个圆消失，露出底下已经变暗的新界面
         * 少了这条，切暗色时整屏会"一下子变暗"，观感就是使用方说的"卡"。
         * 配套 CSS：`.theme-dark::view-transition-old(root) { z-index: 100 }`
         */
        const anim = document.documentElement.animate(
          { clipPath: goDark ? grow.slice().reverse() : grow },
          {
            duration,
            easing: 'ease-out',
            pseudoElement: goDark ? '::view-transition-old(root)' : '::view-transition-new(root)',
          },
        )
        /*
         * ⚠️ 不要 `await anim.finished`：伪元素动画的 finished 可能永不 resolve，
         * 于是按钮的 busy 一直为 true ⇒ "第一次点有效、第二次点没反应"（实测踩过）。
         * 用定时器等一个确定的时长即可。
         */
        try {
          anim?.finished?.catch?.(() => {})
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, duration + 60))
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
  animation: palette-reveal-grow 320ms ease-out both;
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
