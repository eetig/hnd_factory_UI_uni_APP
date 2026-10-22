import { useToast } from 'wot-design-uni'
import { haptics } from '../utils/haptics.js'

/**
 * 带触感的 toast（2026-10-22）。
 *
 * ## 为什么包一层，而不是在每个 toast.success 后面加一行
 *
 * 全仓的反馈都走 wot 的 `useToast()`，调用点有几十处（上传、删除、保存、校验失败…）。
 * 每一处都补一次 `haptics.success()`：
 *   · 一定会漏（漏掉的那处就变成"有的操作有震感、有的没有"，比全都没有更让人困惑）
 *   · 也一定会有人补在错误的位置（比如校验失败用了轻震）
 *
 * 包一层之后，语义跟着**反馈类型**走：success → 轻震，error → 重震，
 * 其余（info/warning/close）不震 —— 因为那三种多数是"提示"，不是"结果"。
 *
 * ## 用法
 *
 * ```js
 * const toast = useHapticToast()   // 与原来的 useToast() 完全同签名
 * toast.success('已保存')          // 顺带震一下
 * ```
 *
 * ⚠️ wot 的 toast 选项 ref 仍然由页面 `provide` 出来（模板里的 `<wd-toast/>` 要用它），
 *    所以这里必须**在 setup 期间**调用，不能在事件回调里临时 new。
 */
export function useHapticToast() {
  const toast = useToast()

  return {
    // ⚠️ 展开必须在**前面**：wot 的 toast 自带 success/error，写在后面会把下面的包装覆盖掉
    ...toast,
    success: (...args) => {
      haptics.success()
      return toast.success(...args)
    },
    error: (...args) => {
      haptics.error()
      return toast.error(...args)
    },
    // 下面几个是原样转发：它们是"提示"，不是"结果"，不该震
    info: (...args) => toast.info(...args),
    warning: (...args) => toast.warning(...args),
    close: (...args) => toast.close(...args),
  }
}
