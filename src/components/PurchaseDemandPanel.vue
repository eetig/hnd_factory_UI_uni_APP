<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { hasPerm } from '../api/auth'
import { copyRowField } from '../utils/clipboard'

/*
 * 采购需求（手机端，2026-10-23，变更-164）
 *
 * 与 PC 的差异（都是因为屏幕小，不是功能缺失）：
 *   · 表格 → **卡片**。PC 上 8 列能一眼扫完，手机上横向滚表格没法看；
 *   · 列顺序/列显隐 → **不做**（使用方 2026-10-23 明确"手机上不需要"；
 *     卡片布局只有一种顺序，做了只是给人添麻烦）；
 *   · 点单元格复制 → **长按**（手机上"点一下"是进详情，两者抢手势）。
 *
 * 与 PC 完全一致的两条关键行为：
 *   ① 新增保存后**不关表单**：清空物料名称/编码/规格 + 数量复位 1，
 *      保留需求人/提出日期/类别/用途/要求到货日期 —— 同一批需求连着录几条物料；
 *   ② 长按行号复制三样（Tab 分隔）、长按物料名称/编码/规格复制单项，且**不弹详情**。
 */

const toast = useToast()
const canEdit = computed(() => hasPerm('purchase:edit') || hasPerm('admin'))

// ===== 列表 =====
const rows = ref([])
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const keyword = ref('')
const statusFilter = ref('')
const pageNum = ref(1)
const PAGE_SIZE = 20

/** 与后端 PurchaseTrackingVO 的状态枚举一致（超期/临期/待提单/等货/已到货/部分到货） */
const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'OVERDUE', label: '超期' },
  { value: 'DUE_SOON', label: '临期' },
  { value: 'PENDING_OA', label: '待提单' },
  { value: 'WAITING', label: '等货' },
  { value: 'ARRIVED', label: '已到货' },
  { value: 'PARTIAL', label: '部分到货' },
]

const STATUS_TEXT = {
  OVERDUE: '超期',
  DUE_SOON: '临期',
  PENDING_OA: '待提单',
  WAITING: '等货',
  ARRIVED: '已到货',
  PARTIAL: '部分到货',
}

const hasMore = computed(() => rows.value.length < total.value)

let listSeq = 0

function buildParams(page) {
  const params = { pageNum: page, pageSize: PAGE_SIZE }
  const kw = keyword.value.trim()
  if (kw) params.keyword = kw
  if (statusFilter.value) params.statuses = statusFilter.value
  return params
}

async function loadList({ append = false } = {}) {
  const seq = ++listSeq
  if (append) loadingMore.value = true
  else loading.value = true
  loadError.value = ''

  try {
    const res = await request.get('/api/purchase/list', { params: buildParams(append ? pageNum.value : 1) })
    // 打字停顿就连发几次，先发的后回会把新结果盖掉（与 PC 同一套序号护栏）
    if (seq !== listSeq) return

    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '采购需求接口返回异常。')

    const list = Array.isArray(body.dataList) ? body.dataList : []
    rows.value = append ? [...rows.value, ...list] : list
    total.value = Number(body.total) || 0
    if (!append) pageNum.value = 1
  } catch (e) {
    if (seq !== listSeq) return
    loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
  } finally {
    if (seq === listSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function applyFilters() {
  pageNum.value = 1
  loadList()
}

function pickStatus(value) {
  statusFilter.value = value
  applyFilters()
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  pageNum.value += 1
  await loadList({ append: true })
}

onMounted(() => {
  loadList()
})

// ===== 长按复制（不弹详情）=====
async function onLongPress(row, key) {
  await copyRowField(row, key)
}

// ===== 表单 =====
const formOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const isCreate = ref(true)
const savedCount = ref(0)
const lastSavedText = ref('')

function blankDraft() {
  return {
    id: null,
    requester: '',
    requestDate: '',
    materialName: '',
    materialCode: '',
    spec: '',
    purpose: '',
    category: '',
    quantity: 1,
    unit: '',
    requiredArrivalDate: '',
    actualArrivalQuantity: '',
    actualArrivalDate: '',
    oaNo: '',
    remark: '',
  }
}

const form = reactive(blankDraft())

function resetForm(draft = null) {
  const next = { ...blankDraft(), ...(draft || {}) }
  Object.keys(form).forEach((key) => {
    form[key] = next[key] ?? ''
  })
  form.quantity = next.quantity ?? 1
  form.id = next.id ?? null
}

function openCreate() {
  isCreate.value = true
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm()
  formOpen.value = true
}

function openEdit(row) {
  isCreate.value = false
  formError.value = ''
  savedCount.value = 0
  lastSavedText.value = ''
  resetForm(row)
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

/** 与 PC 的 buildPurchasePayload 同口径：空串发 null，非数字不发 NaN */
function buildPayload() {
  const text = (v) => {
    const s = String(v ?? '').trim()
    return s === '' ? null : s
  }
  const decimal = (v) => {
    const s = String(v ?? '').trim()
    if (s === '') return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  return {
    id: form.id ?? null,
    requester: String(form.requester ?? '').trim(),
    requestDate: text(form.requestDate),
    materialName: String(form.materialName ?? '').trim(),
    materialCode: text(form.materialCode),
    spec: text(form.spec),
    purpose: text(form.purpose),
    category: text(form.category),
    quantity: decimal(form.quantity),
    unit: text(form.unit),
    requiredArrivalDate: text(form.requiredArrivalDate),
    actualArrivalQuantity: decimal(form.actualArrivalQuantity),
    actualArrivalDate: text(form.actualArrivalDate),
    oaNo: text(form.oaNo),
    remark: text(form.remark),
  }
}

async function save() {
  if (saving.value) return
  const payload = buildPayload()

  // 必填口径与后端一致：界面先拦一次，少一趟往返
  if (!payload.requester) {
    formError.value = '需求人不能为空'
    return
  }
  if (!payload.materialName) {
    formError.value = '物料名称不能为空'
    return
  }

  saving.value = true
  formError.value = ''
  try {
    const res = await request.post('/api/purchase/save', payload)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')

    if (isCreate.value) {
      /*
       * 连续录入（与 PC 一致）：不关表单，只清"由物料派生"的三样 + 数量复位 1。
       * 需求人/日期/类别/用途留着 —— 同一批需求连着录时这些是共用的。
       */
      savedCount.value += 1
      lastSavedText.value = `第 ${savedCount.value} 条已保存（${payload.materialName}）`
      form.materialName = ''
      form.materialCode = ''
      form.spec = ''
      form.quantity = 1
      toast.success('已保存，接着录下一条')
      loadList()
    } else {
      toast.success('已保存')
      formOpen.value = false
      loadList()
    }
  } catch (e) {
    // 失败不关表单、不清内容：已填的要留着
    formError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeRow() {
  if (!form.id) return
  const ok = await new Promise((resolve) => {
    uni.showModal({
      title: '删除确认',
      content: `删除「${form.materialName}」这条采购需求？`,
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!ok) return

  try {
    const res = await request.delete('/api/purchase/delete', { params: { id: form.id } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '删除失败')
    toast.success('已删除')
    formOpen.value = false
    loadList()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '删除失败'
  }
}

// ===== 展示辅助 =====
function statusTone(row) {
  if (row.status === 'OVERDUE') return 'is-danger'
  if (row.status === 'DUE_SOON') return 'is-warn'
  if (row.status === 'ARRIVED') return 'is-ok'
  return ''
}

function dayHint(row) {
  if (row.status === 'OVERDUE' && row.overdueDays) return `已超 ${row.overdueDays} 天`
  if (row.status === 'DUE_SOON') {
    const d = row.daysToDue
    if (d === null || d === undefined) return ''
    return d === 0 ? '今天到期' : `还剩 ${d} 天`
  }
  return ''
}

function quantityText(row) {
  const qty = row.quantity ?? ''
  const unit = row.unit ? ` ${row.unit}` : ''
  return qty === '' || qty === null ? '—' : `${qty}${unit}`
}

const popupStyle =
  'max-height: 88vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill); overscroll-behavior: contain;'
</script>

<template>
  <view class="pd">
    <view class="pd__bar">
      <input
        v-model="keyword"
        class="pd__search"
        placeholder="物料名称 / 编码 / 需求人"
        placeholder-style="color: var(--ui-text-3)"
        confirm-type="search"
        @confirm="applyFilters"
      />
      <view v-if="canEdit" class="pd__add" @click="openCreate">
        <text>＋ 新增</text>
      </view>
    </view>

    <scroll-view class="pd__chips" scroll-x enable-flex>
      <view
        v-for="item in STATUS_FILTERS"
        :key="item.value"
        class="pd__chip"
        :class="{ 'is-on': statusFilter === item.value }"
        @click="pickStatus(item.value)"
      >
        <text>{{ item.label }}</text>
      </view>
    </scroll-view>

    <view v-if="loadError" class="pd__error" @click="loadList()">
      <text>{{ loadError }}（点一下重试）</text>
    </view>

    <view class="pd__list">
      <view
        v-for="(row, index) in rows"
        :key="row.id"
        class="pd__card"
        @click="openEdit(row)"
      >
        <view class="pd__card-head">
          <!-- 行号：长按复制三样（Tab 分隔，可直接粘进 Excel） -->
          <view class="pd__no" @click.stop @longpress.stop="onLongPress(row, 'index')">
            <text>{{ (pageNum - 1) * PAGE_SIZE + index + 1 }}</text>
          </view>
          <view class="pd__status" :class="statusTone(row)">
            <text>{{ STATUS_TEXT[row.status] || '等货' }}</text>
          </view>
          <text v-if="dayHint(row)" class="pd__days">{{ dayHint(row) }}</text>
          <text class="pd__requester">{{ row.requester || '—' }}</text>
        </view>

        <view class="pd__name" @click.stop @longpress.stop="onLongPress(row, 'materialName')">
          <text>{{ row.materialName || '—' }}</text>
        </view>

        <view class="pd__meta">
          <view class="pd__meta-item" @click.stop @longpress.stop="onLongPress(row, 'materialCode')">
            <text class="pd__label">编码</text>
            <text class="pd__code">{{ row.materialCode || '—' }}</text>
          </view>
          <view class="pd__meta-item pd__meta-item--grow" @click.stop @longpress.stop="onLongPress(row, 'spec')">
            <text class="pd__label">规格</text>
            <text class="pd__spec">{{ row.spec || '—' }}</text>
          </view>
        </view>

        <view class="pd__foot">
          <text class="pd__qty">{{ quantityText(row) }}</text>
          <text class="pd__date">要求到货 {{ row.requiredArrivalDate || '—' }}</text>
        </view>
      </view>

      <view v-if="!rows.length && !loading" class="pd__empty">
        <text>{{ loadError ? '加载失败' : '还没有采购需求 —— 点右上「新增」就能记一条' }}</text>
      </view>
      <view v-else-if="hasMore" class="pd__more" @click="loadMore">
        <text>{{ loadingMore ? '正在加载…' : `加载更多（已显示 ${rows.length} / ${total}）` }}</text>
      </view>
      <view v-else-if="rows.length" class="pd__more">
        <text>共 {{ total }} 条，到底了</text>
      </view>
      <view class="pd__hint">
        <text>长按行号复制「名称 / 编码 / 规格」三样；长按名称、编码、规格各复制单项</text>
      </view>
    </view>

    <wd-popup
      v-model="formOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="280"
      :custom-style="popupStyle"
      @close="closeForm"
    >
      <view class="pf">
        <view class="pf__grabber"></view>
        <view class="pf__head">
          <text class="pf__title">{{ isCreate ? '新增采购需求' : '采购需求详情' }}</text>
          <text class="pf__close" @click="closeForm">关闭</text>
        </view>

        <view v-if="lastSavedText" class="pf__saved">
          <text>{{ lastSavedText }}</text>
        </view>
        <view v-if="formError" class="pf__error">
          <text>{{ formError }}</text>
        </view>

        <scroll-view class="pf__body" scroll-y>
          <view class="pf__group">
            <text class="pf__group-title">基本信息</text>
            <view class="pf__row">
              <text class="pf__label">需求人 *</text>
              <input v-model="form.requester" class="pf__input" placeholder="谁提的" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">提出日期</text>
              <input v-model="form.requestDate" class="pf__input" placeholder="2026-10-23" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料名称 *</text>
              <input v-model="form.materialName" class="pf__input" placeholder="打字搜物料名称" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">物料编码</text>
              <input v-model="form.materialCode" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">规格型号</text>
              <input v-model="form.spec" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">类别</text>
              <input v-model="form.category" class="pf__input" placeholder="五金 / 电气…" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">用途</text>
              <input v-model="form.purpose" class="pf__input" placeholder="哪条线 / 哪个车间用" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">数量与到货</text>
            <view class="pf__row">
              <text class="pf__label">数量</text>
              <view class="pf__qty">
                <input v-model="form.quantity" class="pf__input pf__input--num" type="digit" placeholder="1" placeholder-style="color: var(--ui-text-3)" />
                <input v-model="form.unit" class="pf__input pf__input--unit" placeholder="单位" placeholder-style="color: var(--ui-text-3)" />
              </view>
            </view>
            <view class="pf__row">
              <text class="pf__label">要求到货</text>
              <input v-model="form.requiredArrivalDate" class="pf__input" placeholder="2026-10-30" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到数量</text>
              <input v-model="form.actualArrivalQuantity" class="pf__input" type="digit" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">实到日期</text>
              <input v-model="form.actualArrivalDate" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>

          <view class="pf__group">
            <text class="pf__group-title">单据与备注</text>
            <view class="pf__row">
              <text class="pf__label">OA 单号</text>
              <input v-model="form.oaNo" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
            <view class="pf__row">
              <text class="pf__label">备注</text>
              <input v-model="form.remark" class="pf__input" placeholder="选填" placeholder-style="color: var(--ui-text-3)" />
            </view>
          </view>
        </scroll-view>

        <view class="pf__foot">
          <view v-if="!isCreate && canEdit" class="pf__del" @click="removeRow">
            <text>删除</text>
          </view>
          <view class="pf__btn pf__btn--ghost" @click="closeForm">
            <text>{{ isCreate ? '先不填' : '取消' }}</text>
          </view>
          <view class="pf__btn pf__btn--primary" :class="{ 'is-busy': saving }" @click="save">
            <text>{{ saving ? '保存中…' : isCreate ? '保存并继续' : '保存' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<style lang="scss" scoped>
/* 自然流 + 整页滚动：与 EquipmentMaintenancePanel 一致。
   不写 height:100% + 内层 scroll-view —— 小程序里父容器常常没有确定高度，
   那样写会塌成 0 高（白屏），排查起来很费时间。 */
.pd {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
}

.pd__bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.pd__search {
  flex: 1;
  height: 72rpx;
  padding: 0 22rpx;
  border-radius: 36rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.pd__add {
  flex-shrink: 0;
  height: 72rpx;
  padding: 0 26rpx;
  border-radius: 36rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  font-weight: 600;
  color: #fff;
  background-color: var(--ui-brand, #b4551f);
}

.pd__chips {
  white-space: nowrap;
  margin: 16rpx 0 8rpx;
  height: 56rpx;
}

.pd__chip {
  display: inline-flex;
  align-items: center;
  height: 56rpx;
  padding: 0 22rpx;
  margin-right: 12rpx;
  border-radius: 28rpx;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &.is-on {
    color: #fff;
    background-color: var(--ui-brand, #b4551f);
    border-color: transparent;
  }
}

.pd__error {
  flex-shrink: 0;
  margin: 8rpx 0;
  padding: 14rpx 20rpx;
  border-radius: 16rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pd__list {
  padding-bottom: 24rpx;
}

.pd__card {
  margin-bottom: 16rpx;
  padding: 20rpx 22rpx;
  border-radius: 20rpx;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);
}

.pd__card-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pd__no {
  min-width: 52rpx;
  height: 40rpx;
  padding: 0 10rpx;
  border-radius: 10rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
}

.pd__status {
  height: 40rpx;
  padding: 0 16rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);

  &.is-danger {
    color: #f56c6c;
    background-color: rgba(245, 108, 108, 0.16);
  }

  &.is-warn {
    color: #e6a23c;
    background-color: rgba(230, 162, 60, 0.16);
  }

  &.is-ok {
    color: #3f9d6b;
    background-color: rgba(63, 157, 107, 0.16);
  }
}

.pd__days {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__requester {
  margin-left: auto;
  font-size: 22rpx;
  color: var(--ui-text-2);
}

.pd__name {
  margin-top: 12rpx;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 1.4;
  color: var(--ui-text);
  word-break: break-all;
}

.pd__meta {
  display: flex;
  gap: 20rpx;
  margin-top: 10rpx;
}

.pd__meta-item {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  min-width: 0;

  &--grow {
    flex: 1;
    min-width: 0;
  }
}

.pd__label {
  flex-shrink: 0;
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__code {
  font-size: 24rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
}

.pd__spec {
  flex: 1;
  min-width: 0;
  font-size: 24rpx;
  color: var(--ui-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pd__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid var(--ui-hairline);
}

.pd__qty {
  font-size: 26rpx;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.pd__date {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.pd__empty,
.pd__more {
  padding: 40rpx 0;
  text-align: center;
  font-size: 24rpx;
  color: var(--ui-text-3);
}

.pd__hint {
  padding: 24rpx 8rpx 40rpx;
  text-align: center;
  font-size: 22rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* ===== 表单 ===== */
.pf {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 88vh;
}

.pf__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.pf__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 28rpx 12rpx;
}

.pf__title {
  font-size: 32rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.pf__close {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.pf__saved {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #3f9d6b;
  background-color: rgba(63, 157, 107, 0.12);
}

.pf__error {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pf__body {
  flex: 1;
  min-height: 0;
  padding: 0 28rpx;
}

.pf__group {
  margin-bottom: 20rpx;
}

.pf__group-title {
  display: block;
  margin: 8rpx 0 12rpx;
  font-size: 24rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
  color: var(--ui-text-3);
}

.pf__row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 10rpx 0;
}

.pf__label {
  flex-shrink: 0;
  width: 152rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.pf__input {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  padding: 0 20rpx;
  border-radius: 16rpx;
  font-size: 26rpx;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);

  &--num {
    flex: 0 0 180rpx;
  }

  &--unit {
    flex: 1;
  }
}

.pf__qty {
  flex: 1;
  display: flex;
  gap: 12rpx;
  min-width: 0;
}

.pf__foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 18rpx 28rpx calc(18rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-hairline);
  background-color: var(--ui-sheet-fill);
}

.pf__del {
  flex-shrink: 0;
  height: 80rpx;
  padding: 0 26rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  font-size: 26rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.pf__btn {
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
</style>
