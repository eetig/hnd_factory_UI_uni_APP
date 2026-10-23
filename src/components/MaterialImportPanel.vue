<script setup>
import { computed, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { uploadFile } from '../api/upload'
import { isAppFilePickerSupported, pickFileOnApp } from '../utils/appFilePicker'

/*
 * 物料导入（手机端，2026-10-23，变更-164）
 *
 * 与 PC 同一套两步接口：`/api/material/import/preview`（上传 + 差异预览）→
 * `/api/material/import/commit?token=`（确认写入）。**手机端不做任何解析**：
 * 3 万行的比对全在后端，前端只负责"选文件 → 看差异 → 点确认"。
 *
 * 文件从哪来（三端各一条路，都是平台限制，不是选择）：
 *   · H5：隐藏的 <input type="file">（DOM 能力）；
 *   · App：uni.chooseFile 在 App 端没实现，走 utils/appFilePicker（Android SAF）；
 *   · 微信小程序：**只能从聊天记录选文件**（wx.chooseMessageFile）——
 *     这是平台强制的入口，文件必须先发到"文件传输助手"或某个会话里。
 *     所以小程序端不提供"从手机存储选"，也不做 H5/App 那两种兜底。
 */

const toast = useToast()

const picking = ref(false)
const previewing = ref(false)
const committing = ref(false)
const fileName = ref('')
const preview = ref(null)
const result = ref(null)
const errorText = ref('')

const canCommit = computed(() => Boolean(preview.value?.token) && !committing.value)

function resetAll() {
  preview.value = null
  result.value = null
  errorText.value = ''
  fileName.value = ''
}

function assertOk(body, fallback) {
  if (!body || body.success === false || (body.code != null && body.code !== 200)) {
    throw new Error(body?.msg || fallback)
  }
  return body
}

function errText(e, fallback) {
  return e?.response?.data?.msg || e?.message || fallback
}

/** 上传 + 预览（三端共用；区别只在 filePath / file 怎么拿到） */
async function fetchPreview({ path, file }) {
  resetAll()
  previewing.value = true
  try {
    const res = await uploadFile({
      url: '/api/material/import/preview',
      filePath: path,
      file,
      name: 'file',
    })
    const body = assertOk(res.data, '预览失败')
    preview.value = body.data || {}
    fileName.value = preview.value.fileName || ''
  } catch (e) {
    errorText.value = errText(e, '预览失败')
  } finally {
    previewing.value = false
  }
}

// #ifdef H5
const fileInputRef = ref(null)

function openFilePicker() {
  fileInputRef.value?.click()
}

function handleFileInputChange(event) {
  const files = Array.from(event?.target?.files || [])
  if (event?.target) event.target.value = ''
  const file = files[0]
  if (!file) return
  if (!/\.(xlsx|xls)$/i.test(file.name || '')) {
    toast.error('只支持 .xlsx / .xls')
    return
  }
  fetchPreview({ file })
}
// #endif

// #ifdef APP-PLUS
function openFilePicker() {
  if (!isAppFilePickerSupported()) {
    toast.error('这台设备不支持选文件，请用电脑端导入')
    return
  }
  picking.value = true
  pickFileOnApp(['xlsx', 'xls'])
    .then((picked) => fetchPreview({ path: picked.path }))
    .catch((e) => toast.error(e?.message || '选择文件失败'))
    .finally(() => {
      picking.value = false
    })
}
// #endif

// #ifdef MP-WEIXIN
function openFilePicker() {
  // 小程序只能从聊天记录里选（平台限制）：先把 Excel 发到"文件传输助手"，再从这里选
  uni.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: ['xlsx', 'xls'],
    success: (res) => {
      const picked = (res.tempFiles || [])[0]
      if (!picked?.path) {
        toast.error('没有取到文件')
        return
      }
      fetchPreview({ path: picked.path })
    },
    fail: () => {
      // 用户取消不提示
    },
  })
}
// #endif

async function commit() {
  if (!canCommit.value) return
  committing.value = true
  errorText.value = ''
  try {
    const res = await request.post('/api/material/import/commit', null, {
      params: { token: preview.value.token },
    })
    const body = assertOk(res.data, '写入失败')
    result.value = body.data || {}
    preview.value = null
    toast.success(`已写入 ${result.value.inserted ?? 0} 条`)
  } catch (e) {
    errorText.value = errText(e, '写入失败')
  } finally {
    committing.value = false
  }
}

const diffItems = computed(() => {
  const p = preview.value
  if (!p) return []
  return [
    { label: '总行数', value: p.totalRows ?? 0 },
    { label: '新增', value: p.newCount ?? 0, tone: 'is-new' },
    { label: '更新', value: p.changedCount ?? 0, tone: 'is-changed' },
    { label: '消失', value: p.removedCount ?? 0, tone: 'is-removed' },
    { label: '无变化', value: p.unchangedCount ?? 0 },
  ]
})

const warnings = computed(() => (Array.isArray(preview.value?.warnings) ? preview.value.warnings : []))
</script>

<template>
  <view class="mi">
    <view class="mi__hero">
      <text class="mi__title">物料主数据导入</text>
      <text class="mi__sub">
        选一份 SAP 导出的物料清单（.xlsx）。先看差异，确认后才写库 —— 一步都不跳。
      </text>
    </view>

    <view v-if="errorText" class="mi__error">
      <text>{{ errorText }}</text>
    </view>

    <view v-if="!preview && !result" class="mi__pick" :class="{ 'is-busy': previewing || picking }" @click="openFilePicker">
      <text class="mi__pick-icon">＋</text>
      <text class="mi__pick-text">{{ previewing ? '正在上传并比对…' : '选择 Excel 文件' }}</text>
      <text class="mi__pick-hint">只支持 .xlsx / .xls</text>
    </view>

    <!-- 差异预览 -->
    <view v-if="preview" class="mi__card">
      <view class="mi__card-head">
        <text class="mi__card-title">差异预览</text>
        <text class="mi__file">{{ fileName }}</text>
      </view>

      <view class="mi__diff">
        <view v-for="item in diffItems" :key="item.label" class="mi__diff-item" :class="item.tone">
          <text class="mi__diff-value">{{ item.value }}</text>
          <text class="mi__diff-label">{{ item.label }}</text>
        </view>
      </view>

      <view v-if="warnings.length" class="mi__warnings">
        <text v-for="(w, i) in warnings" :key="i" class="mi__warning">{{ w }}</text>
      </view>

      <view class="mi__actions">
        <view class="mi__btn mi__btn--ghost" @click="resetAll">
          <text>重选</text>
        </view>
        <view class="mi__btn mi__btn--primary" :class="{ 'is-busy': committing }" @click="commit">
          <text>{{ committing ? '写入中…' : `确认写入 ${preview.newCount + preview.changedCount} 行` }}</text>
        </view>
      </view>
    </view>

    <!-- 结果 -->
    <view v-if="result" class="mi__card">
      <view class="mi__card-head">
        <text class="mi__card-title">写入完成</text>
      </view>
      <view class="mi__result">
        <view class="mi__result-row"><text class="mi__result-label">新增</text><text class="mi__result-value">{{ result.inserted ?? 0 }}</text></view>
        <view class="mi__result-row"><text class="mi__result-label">更新</text><text class="mi__result-value">{{ result.updated ?? 0 }}</text></view>
        <view class="mi__result-row"><text class="mi__result-label">停用</text><text class="mi__result-value">{{ result.disabled ?? 0 }}</text></view>
        <view class="mi__result-row"><text class="mi__result-label">待停用</text><text class="mi__result-value">{{ result.pendingDisabled ?? 0 }}</text></view>
      </view>
      <view class="mi__actions">
        <view class="mi__btn mi__btn--ghost" @click="resetAll">
          <text>再导一份</text>
        </view>
      </view>
    </view>

    <!-- #ifdef H5 -->
    <input ref="fileInputRef" type="file" accept=".xlsx,.xls" class="mi__file-input" @change="handleFileInputChange" />
    <!-- #endif -->

    <view class="mi__tip">
      <!-- #ifdef MP-WEIXIN -->
      <text>小程序只能从**聊天记录**里选文件：先把 Excel 发到「文件传输助手」，再点上面的按钮选它。</text>
      <!-- #endif -->
      <!-- #ifdef APP-PLUS -->
      <text>点上面按钮会打开系统的文件选择器。</text>
      <!-- #endif -->
      <!-- #ifdef H5 -->
      <text>3 万行左右的清单一般 5～10 秒能比对完，别在写入过程中关页面。</text>
      <!-- #endif -->
    </view>
  </view>
</template>

<style lang="scss" scoped>
.mi {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 24rpx 24rpx 0;
  box-sizing: border-box;
  overflow-y: auto;
}

.mi__hero {
  flex-shrink: 0;
  margin-bottom: 20rpx;
}

.mi__title {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.mi__sub {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.mi__error {
  flex-shrink: 0;
  margin-bottom: 16rpx;
  padding: 16rpx 20rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.mi__pick {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  min-height: 320rpx;
  border-radius: 24rpx;
  border: 2rpx dashed var(--ui-border-strong);
  background-color: var(--ui-raise);

  &.is-busy {
    opacity: 0.6;
  }
}

.mi__pick-icon {
  font-size: 56rpx;
  line-height: 1;
  color: var(--ui-text-3);
}

.mi__pick-text {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.mi__pick-hint {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.mi__card {
  flex-shrink: 0;
  margin-top: 20rpx;
  padding: 22rpx;
  border-radius: 22rpx;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.mi__card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
}

.mi__card-title {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.mi__file {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-size: 22rpx;
  color: var(--ui-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mi__diff {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 18rpx;
}

.mi__diff-item {
  flex: 1 1 30%;
  min-width: 150rpx;
  padding: 16rpx;
  border-radius: 16rpx;
  text-align: center;
  background-color: var(--ui-raise-2);
}

.mi__diff-value {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.mi__diff-label {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.mi__diff-item.is-new .mi__diff-value {
  color: #3f9d6b;
}

.mi__diff-item.is-changed .mi__diff-value {
  color: #e6a23c;
}

.mi__diff-item.is-removed .mi__diff-value {
  color: #f56c6c;
}

.mi__warnings {
  margin-top: 16rpx;
}

.mi__warning {
  display: block;
  font-size: 22rpx;
  line-height: 1.6;
  color: #e6a23c;
}

.mi__actions {
  display: flex;
  gap: 16rpx;
  margin-top: 22rpx;
}

.mi__btn {
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;

  &--ghost {
    flex: 0 0 180rpx;
    color: var(--ui-text-2);
    background-color: var(--ui-raise-2);
  }

  &--primary {
    flex: 1;
    color: #fff;
    background-color: var(--ui-brand, #b4551f);

    &.is-busy {
      opacity: 0.6;
    }
  }
}

.mi__result {
  margin-top: 18rpx;
}

.mi__result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--ui-hairline);
}

.mi__result-label {
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.mi__result-value {
  font-size: 28rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.mi__file-input {
  display: none;
}

.mi__tip {
  padding: 24rpx 4rpx 48rpx;
  font-size: 22rpx;
  line-height: 1.7;
  color: var(--ui-text-3);
}
</style>
