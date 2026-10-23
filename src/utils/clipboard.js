/*
 * 长按复制（2026-10-23，变更-164）
 *
 * 使用方在 PC 上定了四条口径（变更-142/144），手机端照搬，但手势换成**长按**：
 *   · 序号/行号位置 → 复制「物料名称 ⇥ 物料编码 ⇥ 规格型号」一行三列（Tab 分隔，能直接粘进 Excel）
 *   · 物料名称 / 物料编码 / 规格型号 → 只复制那一项
 *   · **只复制，不进详情**（复制是高频动作，每次弹详情太吵）
 *
 * 为什么是长按而不是点击：手机上"点一下卡片"就是进详情，点一下复制会和它抢同一个手势；
 * 长按是系统级的复制语义，用户不用教。
 *
 * ⚠️ 使用方 2026-10-23 明确选「全部走 uni.setClipboardData」（不做"长按文本原生复制"）：
 *    两个入口体验不一致更糟 —— 单项能长按复制、三样不能，用户会反复试。
 */

export const COPY_COLUMN_KEYS = ['index', 'materialName', 'materialCode', 'spec']

export function isCopyColumn(key) {
  return COPY_COLUMN_KEYS.includes(key)
}

/**
 * 算出要复制的文本。
 *
 * @param {object} row 行数据
 * @param {string} key 'index' | 'materialName' | 'materialCode' | 'spec'
 * @returns {{ text: string, label: string, empty: boolean }}
 */
export function buildCopyPayload(row, key) {
  const name = String(row?.materialName ?? '').trim()
  const code = String(row?.materialCode ?? '').trim()
  const spec = String(row?.spec ?? '').trim()

  if (key === 'index') {
    return { text: [name, code, spec].join('\t'), label: '物料名称 / 编码 / 规格', empty: !name && !code && !spec }
  }
  if (key === 'materialName') return { text: name, label: '物料名称', empty: !name }
  if (key === 'materialCode') return { text: code, label: '物料编码', empty: !code }
  if (key === 'spec') return { text: spec, label: '规格型号', empty: !spec }

  return { text: '', label: '', empty: true }
}

/**
 * 复制并给反馈。
 *
 * 微信小程序的 `uni.setClipboardData` **自己会弹一个"内容已复制"的 toast**，
 * 我们再弹一次就是两条叠在一起 —— 所以小程序端不再补 toast，其它端补一条。
 *
 * @returns {Promise<boolean>} 是否成功
 */
export function copyToClipboard(text, label = '') {
  const data = String(text ?? '')
  if (!data) {
    uni.showToast({ title: '没有可复制的内容', icon: 'none' })
    return Promise.resolve(false)
  }

  return new Promise((resolve) => {
    uni.setClipboardData({
      data,
      success: () => {
        // #ifndef MP-WEIXIN
        uni.showToast({ title: label ? `已复制${label}` : '已复制', icon: 'none' })
        // #endif
        resolve(true)
      },
      fail: () => {
        uni.showToast({ title: '复制失败，请手动选中文本', icon: 'none' })
        resolve(false)
      },
    })
  })
}

/** 长按某一行/某个字段时的统一入口：算文本 → 复制 → 反馈 */
export async function copyRowField(row, key) {
  const { text, label, empty } = buildCopyPayload(row, key)
  if (empty) {
    uni.showToast({ title: `这行的${label || '内容'}是空的`, icon: 'none' })
    return false
  }
  return copyToClipboard(text, label)
}
