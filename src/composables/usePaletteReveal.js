/**
 * 配色（调色板）+ 圆形揭露 —— App / 小程序端（2026-10-23，变更-170）。
 *
 * 使用方要求三端一致：点配色按钮 → 以**按钮中心**为圆心，圆形遮罩向外蔓延铺满全屏，
 * 换成另一套弥散三色。
 *
 * ## 三端怎么分工（都在这个文件里，靠条件编译区分）
 *
 *   #ifdef H5       优先 `document.startViewTransition`（真浏览器 / 新版 WebView）；
 *                   不支持时退回"放大的圆"层 —— 与小程序同一套视觉。
 *   #ifdef APP-PLUS 走"放大的圆"（WebView 版本不可控，VT 只有部分内核有；
 *                   这里不在运行时探测，直接走稳的那条，视觉一样）。
 *   #ifdef MP-WEIXIN 小程序**没有** View Transitions，只能用 CSS 动画：
 *                   绝对定位的圆 + `transform: scale()`，圆心由 SelectorQuery 取。
 *
 * ## 为什么"放大的圆"而不是 `clip-path: circle()`
 *
 * 小程序与部分 iOS WebView 对 clip-path 的支持参差（低版本基础库直接不渲染），
 * 而"圆角 50% + scale" 是十几年都稳的组合，视觉上等价（圆边向外推）。
 *
 * ## 容错（使用方明确要求"不能报错卡死"）
 *
 *   取不到节点 / 坐标为 NaN / 半径为 0 → **无动画直接切**，返回值 tell 调用方；
 *   任何一步抛错都被吞掉，配色切换本身永远会执行一次。
 */
import { ref } from 'vue'
import { getItem, setItem } from '../api/storage'

export const PALETTE_KEY = 'hnd-palette'
/*
 * 时长 320ms —— 按 `ui-taste` §4 的区间定的：
 *   状态切换 200–300ms / 页面级 300–500ms；主题切换是**状态切换**，取交界 320ms。
 * 历史：520 → 420 → 320（使用方连续反馈"卡"；全屏裁切每多 100ms 就是几帧掉帧）。
 */
export const REVEAL_MS = 320

/**
 * 是否尊重"减弱动效"。
 * `ui-taste` §2 把这条列为**硬性**：超出 hover/press 的动效必须可退化为静止。
 * 这里动的是全屏裁切，量级远超 hover ⇒ 必须遵守。三端都用 uni 的 API 判断。
 */
export function prefersReducedMotion() {
  try {
    const info = uni.getSystemInfoSync?.()
    // uni 的 getSystemInfoSync 在部分端不返回这个字段，返回 undefined 就当 false
    if (info && typeof info.reduceMotion === 'boolean') return info.reduceMotion
  } catch {
    /* 走下面的媒体查询 */
  }
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

export const APP_PALETTES = [
  { key: 'warm', label: '粉橙暖调', dots: ['#BBADE6', '#FEC96D', '#E2ADB4'] },
  { key: 'violet', label: '粉紫元气', dots: ['#945FFA', '#F698B8', '#F7DFD9'] },
]

const KNOWN = new Set(APP_PALETTES.map((p) => p.key))
export const DEFAULT_PALETTE = 'warm'

function readStored() {
  const raw = getItem(PALETTE_KEY)
  return KNOWN.has(raw) ? raw : DEFAULT_PALETTE
}

/** 挂在页面根 view 上的类名：**只有粉紫才加类**（粉橙是 uni.scss 的默认套） */
export function paletteClassOf(key) {
  return key === 'violet' ? 'palette-violet' : ''
}

/**
 * 等一帧（定时器，不用 rAF —— 后台标签页/未激活 WebView 里 rAF 会被暂停，
 * 回调永远不来，表现是圆停在 scale(0)、主题也不切）。
 */
export function nextFrame() {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

/**
 * 圆的几何（位置、直径、圆角、底色）→ 内联样式。
 * 放大交给非 scoped 的 keyframes（见 components/CircularRevealLayer.vue）。
 */
export function circleStyleOf(geo, targetColor) {
  const { cx, cy, radius } = geo
  const size = radius * 2
  return [
    'position:fixed',
    'z-index:9999',
    `left:${cx - radius}px`,
    `top:${cy - radius}px`,
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    // ★ 用**目标主题**的底色：圆里滚进来的就是新主题，而不是旧底色铺满后再硬切
    `background-color:${targetColor || 'var(--ui-scene-bg)'}`,
    'pointer-events:none',
    'transform-origin:center center',
    // 合成层：不写这两条，全屏实色圆每帧重绘整屏 —— 使用方说的"特别卡"就是这个
    'will-change:transform',
    'backface-visibility:hidden',
  ].join(';')
}

/** 圆心与半径：到四个角的最远距离（纯函数，单测钉住） */
export function revealGeometry(rect, viewport) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width)
  const height = Number(rect.height)
  if (![left, top, width, height].every((n) => Number.isFinite(n))) return null
  if (width <= 0 || height <= 0) return null

  const vw = Number(viewport?.width) || 0
  const vh = Number(viewport?.height) || 0
  if (!(vw > 0) || !(vh > 0)) return null

  const cx = left + width / 2
  const cy = top + height / 2
  const radius = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy))
  if (!Number.isFinite(radius) || radius <= 0) return null

  return { cx, cy, radius }
}

/**
 * 取节点矩形。**三段依次尝试**，任一成功即返回：
 *   ① uni.createSelectorQuery（三端通用；组件内要 .in(instance)）
 *   ② H5 的 document.querySelector（uni 的 query 在 H5 上给 null 时用这条）
 *   ③ 都不行 → null（调用方降级为"无动画直接切"）
 *
 * ⚠️ 2026-10-23 实测踩过：selectorQuery 在 H5 上对组件内的选择器会回 **null**
 *    （作用域没匹配上），第一版把 null 当成"失败"直接返回了，于是兜底的放大圆
 *    永远不播、只剩"无动画切换"。必须**继续往下一段尝试**。
 */
export function queryNodeRect(selector, instance) {
  const fromDocument = () => {
    // #ifdef H5
    try {
      const el = typeof document !== 'undefined' ? document.querySelector(selector) : null
      if (!el) return null
      const rect = el.getBoundingClientRect()
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    } catch {
      return null
    }
    // #endif
    // eslint-disable-next-line no-unreachable
    return null
  }

  /*
   * H5 先走 document（同步、零等待）。
   *
   * 2026-10-23 实测：H5 上 `uni.createSelectorQuery()` 存在但 `.exec()` 的回调
   * **永远不来** ⇒ 要等 600ms 超时才兜底到 document ⇒ 整条链路约 1s，
   * 表现就是"连着点两下、第二下没反应"（busy 还没释放）。
   */
  // #ifdef H5
  const direct = fromDocument()
  if (direct) return Promise.resolve(direct)
  // #endif

  return new Promise((resolve) => {
    let settled = false
    const settle = (rect) => {
      if (settled) return
      settled = true
      resolve(rect || null)
    }

    // 兜底超时：个别机型上 selectorQuery 的回调永远不来
    const timer = setTimeout(() => settle(fromDocument()), 600)

    const viaDocument = () => {
      clearTimeout(timer)
      settle(fromDocument())
    }

    try {
      const query = uni.createSelectorQuery()
      const scoped = instance ? query.in(instance) : query
      scoped
        .select(selector)
        .boundingClientRect((rect) => {
          if (rect && Number(rect.width) > 0 && Number(rect.height) > 0) {
            clearTimeout(timer)
            settle(rect)
            return
          }
          // 拿不到（H5 作用域不匹配 / 节点还没渲染）→ 退回 document
          viaDocument()
        })
        .exec()
    } catch {
      viaDocument()
    }
  })
}

/**
 * 视口尺寸。**三段依次尝试**：
 *   ① uni.getSystemInfoSync（App / 小程序有；H5 构建里这个 API 可能根本不存在）
 *   ② H5 的 window.innerWidth / innerHeight
 *   ③ 0×0（调用方据此降级为无动画）
 *
 * ⚠️ 2026-10-23 实测踩过：本仓 H5 构建里 `uni.getSystemInfoSync` **不是函数**
 *    （抛 TypeError），旧版只 try/catch 回 0×0，于是几何永远判无效、
 *    圆形揭露永远走"无动画"分支 —— 表现就是"点了会换色，但没有圆形扩散"。
 */
export function viewportSize() {
  try {
    if (typeof uni !== 'undefined' && typeof uni.getSystemInfoSync === 'function') {
      const info = uni.getSystemInfoSync()
      const width = Number(info.windowWidth) || 0
      const height = Number(info.windowHeight) || 0
      if (width > 0 && height > 0) return { width, height }
    }
  } catch {
    /* 走下面的 window */
  }

  // #ifdef H5
  try {
    const width = Number(globalThis.innerWidth) || 0
    const height = Number(globalThis.innerHeight) || 0
    if (width > 0 && height > 0) return { width, height }
  } catch {
    /* fallthrough */
  }
  // #endif

  return { width: 0, height: 0 }
}

/**
 * 圆形揭露的执行体。
 *
 * @param {object} opts
 * @param {string} opts.selector 触发按钮的选择器（如 '.palette-toggle'）
 * @param {object} [opts.instance] 组件实例（组件内查询要 .in）
 * @param {(geo: {cx:number,cy:number,radius:number}) => void} opts.onReveal
 *        有几何时调用：调用方据此播放"放大的圆"并切配色；
 *        没有几何时调用方自行无动画切换。
 * @returns {Promise<'reveal' | 'no-anim'>}
 */
export async function startReveal({ selector, instance, onReveal }) {
  let rect = null
  try {
    rect = await queryNodeRect(selector, instance)
  } catch {
    rect = null
  }

  const viewport = viewportSize()
  const geometry = revealGeometry(rect, viewport)
  if (!geometry) {
    // 无动画路径：调用方在 onReveal 之外自己切；这里直接告诉它"没几何"
    return 'no-anim'
  }

  try {
    onReveal(geometry)
  } catch {
    return 'no-anim'
  }
  return 'reveal'
}

/** 模块级单例：按钮与页面根类名读同一份 */
const palette = ref(readStored())

export function usePalette() {
  function setPalette(key) {
    if (!KNOWN.has(key)) return
    palette.value = key
    try {
      setItem(PALETTE_KEY, key)
    } catch {
      // 存储失败不影响本次会话
    }
  }

  function togglePalette() {
    const index = APP_PALETTES.findIndex((p) => p.key === palette.value)
    const next = APP_PALETTES[(index + 1) % APP_PALETTES.length]
    setPalette(next.key)
    return next.key
  }

  return { palette, palettes: APP_PALETTES, setPalette, togglePalette }
}
