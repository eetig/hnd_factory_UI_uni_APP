/**
 * 触感反馈（2026-10-22，apple-design 第 13 节：多模态反馈）。
 *
 * ## 为什么值得有
 *
 * 车间场景里，操作员常常戴手套、屏幕有油污、或者光线很亮 —— 视觉反馈会被削弱。
 * 一次 10ms 的轻震比一个 300ms 的 toast 更容易被"感觉到"，而且不占屏幕。
 * Apple 的做法是：**同一个动作，视觉和触觉一起给**，人就不会怀疑"我到底点上了没有"。
 *
 * ## 三条约束
 *
 * 1. **可关**：机器上的震动有人喜欢有人烦，所以存本地开关，默认开。
 *    以后要加设置项，调用 `setHapticsEnabled(false)` 即可（不必改调用点）。
 * 2. **失败静默**：H5 没有震动 API，部分安卓机型/精简系统也不支持。
 *    这里全部 try/catch 吞掉 —— 触感是加分项，绝不能因为它抛错把业务流程带崩。
 * 3. **分档位**：成功用轻，失败用重。三档（light/medium/heavy）由平台解释；
 *    不支持 type 的旧平台会忽略这个参数、按默认时长震，仍然可用。
 *
 * ## 别把它用在这些地方
 *
 * · 滚动、翻页（高频动作，震起来像手机坏了）
 * · 输入框打字
 * · 单纯的 hover / 展开收起
 * 只在"**有结果的时刻**"给：保存成功、删除、抽屉到位、操作失败。
 */

const ENABLED_KEY = 'hapticsEnabled'

/** 运行时缓存：避免每次都读存储（存储是同步 IPC，在滚动回调里读会掉帧） */
let enabledCache = null

/** 是否开启触感（默认开；显式关过就是关） */
export function isHapticsEnabled() {
  if (enabledCache !== null) return enabledCache
  try {
    const raw = uni.getStorageSync(ENABLED_KEY)
    enabledCache = raw === '' || raw === null || raw === undefined ? true : raw !== '0'
  } catch (e) {
    enabledCache = true
  }
  return enabledCache
}

/** 开关（给以后的设置页用；改完立刻生效，无需重启） */
export function setHapticsEnabled(on) {
  enabledCache = !!on
  try {
    uni.setStorageSync(ENABLED_KEY, on ? '1' : '0')
  } catch (e) {
    // 存不进去也不影响本次会话
  }
}

/**
 * 触发一次触感。
 *
 * @param {'light'|'medium'|'heavy'} kind 成功用 light，失败/危险动作用 heavy
 */
export function haptic(kind = 'light') {
  if (!isHapticsEnabled()) return

  /* #ifndef H5 */
  // H5 端没有震动 API（部分浏览器有 navigator.vibrate，但桌面/多数移动浏览器要么没有
  // 要么需要用户手势），这里直接不编进去，避免控制台报错。
  try {
    uni.vibrateShort({ type: kind })
  } catch (e) {
    // 老平台不认 type、或设备没有马达：忽略
  }
  /* #endif */
}

/** 语义化封装：调用点用它，读起来比 haptic('light') 更像业务 */
export const haptics = {
  /** 动作成功（保存、删除、上传完成） */
  success: () => haptic('light'),
  /** 动作失败/被拒绝 */
  error: () => haptic('heavy'),
  /** 面板吸附到位、切换完成这类"落位" */
  settle: () => haptic('medium'),
}
