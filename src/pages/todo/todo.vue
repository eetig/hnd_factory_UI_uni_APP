<template>
  <view class="td" :class="themeClass" :style="[themeVars, frameStyle]" @touchstart="onEdgeStart" @touchend="onEdgeEnd">
    <PageTitle title="待办" />
    <!-- 顶部：一句话概况 + 两个页签 -->
    <view class="td__head">
      <view class="td__summary">
        <text class="td__count">{{ openItems.length }}</text>
        <text class="td__count-unit">件待办</text>
        <view class="td__pills">
          <text v-if="overdueCount" class="td__pill td__pill--late">逾期 {{ overdueCount }}</text>
          <text v-if="todayCount" class="td__pill td__pill--today">今天 {{ todayCount }}</text>
          <text v-if="!openItems.length && !loading" class="td__pill">都办完了</text>
        </view>
      </view>

      <!--
        页签改成可拖的液体胶囊（2026-11-21）：胶囊和下面两页共用同一个进度，
        拖动时被前缘拽着拉长、后缘黏在原地，半页处纵向鼓一下（抄的抄表页那套，见 liquidStyle）。
        手指在这条带子上拖也算翻页 —— 和内容区是同一份手势。
      -->
      <view
        class="td__tabs"
        @touchstart.stop="onTouchStart"
        @touchmove.stop.prevent="onTouchMove"
        @touchend.stop="onTouchEnd"
        @touchcancel.stop="onTouchEnd"
      >
        <view class="td__tabs-inner">
          <view class="td__liquid" :style="liquidStyle" />
          <view
            v-for="(pane, i) in PANES"
            :key="pane.key"
            class="td__tab"
            :class="{ 'td__tab--on': i === highlightIndex }"
            @click="goTab(i)"
          >
            <text>{{ pane.label }}</text>
          </view>
        </view>
      </view>
    </view>

    <!--
      两页并排的轨道（2026-11-21）：横着拖时整条轨道 1:1 跟手，没有「过半才翻」的判定；
      松手按手指速度滑一段再吸附整页。竖着滑不接管，交给每页自己的 scroll-view。
    -->
    <view
      class="td__stage"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <view class="td__track" :style="trackStyle">
        <view v-for="pane in PANES" :key="pane.key" class="td__page">
          <scroll-view class="td__list" :scroll-y="true" :refresher-enabled="true"
            :refresher-triggered="refreshing" @refresherrefresh="onRefresh(pane.key)">
            <!-- 内边距放在这层：App 端 scroll-view 的右内边距不参与内容宽度，卡片会被推出右边界 -->
            <view class="td__inner">
              <view v-if="isBooting(pane.key) && !countOf(pane.key)" class="td__hint">正在取…</view>

              <view v-else-if="!countOf(pane.key)" class="td__empty">
                <text class="td__empty-title">{{ pane.emptyTitle }}</text>
                <text class="td__empty-sub">{{ pane.emptySub }}</text>
              </view>

              <template v-else>
                <view v-for="group in groupsOf(pane.key)" :key="group.key" class="td__group">
                  <view class="td__group-head">
                    <text class="td__group-name">{{ group.name }}</text>
                    <text class="td__group-count">{{ group.items.length }}</text>
                  </view>

                  <view v-for="item in group.items" :key="item.id" class="td__item"
                    :class="{
                      'td__item--late': group.key === 'overdue',
                      'td__item--striking': strikeOf(item.id) === 'done',
                      'td__item--un-striking': strikeOf(item.id) === 'undo',
                    }" @click="openEdit(item)">
                    <view class="td__check"
                      :class="{ 'td__check--on': item.done || strikeOf(item.id) === 'done' }"
                      @click.stop="toggle(item)">
                      <text v-if="item.done || strikeOf(item.id) === 'done'" class="td__check-mark"
                        :class="{
                          'td__check-mark--pop': strikeOf(item.id) === 'done',
                          'td__check-mark--out': strikeOf(item.id) === 'undo',
                        }">✓</text>
                    </view>

                    <view class="td__body">
                      <view class="td__title-wrap">
                        <text class="td__title"
                          :class="{ 'td__title--done': item.done && strikeOf(item.id) !== 'undo' }">{{ item.title }}</text>
                        <!-- 一根从左往右长出来的线：完成时「划掉」，取消完成时倒着收回 -->
                        <view class="td__strike"
                          :class="{
                            'td__strike--in': strikeOf(item.id) === 'done',
                            'td__strike--out': strikeOf(item.id) === 'undo',
                          }"></view>
                      </view>
                      <text v-if="item.note" class="td__note">{{ item.note }}</text>

                      <view v-if="item.images && item.images.length" class="td__shots">
                        <!-- 序号就是数组顺序（选图的先后），缩略图上也标出来，免得「哪张是第一张」靠猜 -->
                        <view v-for="(src, index) in item.images.slice(0, 3)" :key="index" class="td__shot-wrap"
                          @click.stop="preview(item, index)">
                          <image class="td__shot" :src="resolveAssetUrl(src)" mode="aspectFill" />
                          <text class="td__shot-no">{{ index + 1 }}</text>
                        </view>
                        <text v-if="item.images.length > 3" class="td__more">+{{ item.images.length - 3 }}</text>
                      </view>

                      <view class="td__meta">
                        <text v-if="item.dueDate" class="td__due" :class="dueClass(item)">{{ dueText(item) }}</text>
                        <text v-else class="td__due td__due--none">没定日子</text>
                        <text v-if="item.done && item.doneAt" class="td__doneat">{{ item.doneAt }} 办完</text>
                      </view>
                    </view>
                  </view>
                </view>
              </template>

              <view class="td__bottom-space"></view>
            </view>
          </scroll-view>
        </view>
      </view>
    </view>

    <view class="td__bar">
      <view class="td__add" @click="openCreate">
        <text class="td__add-plus">＋</text>
        <text class="td__add-text">记一条</text>
      </view>
    </view>

    <!--
      编辑 / 新建（2026-11-25）：关闭就是保存。
      点遮罩、按返回手势、点「收起 / 完成」都会先落库再收起，不再需要用户记住「点保存」。
    -->
    <AppPopup v-model="sheetOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-surface);" @close="onSheetClose">
      <view class="td-sheet">
        <view class="td-sheet__head">
          <text class="td-sheet__title">{{ editingId ? '改这条' : '记一条' }}</text>
          <text class="td-sheet__close" @click="finish">收起</text>
        </view>

        <text class="td-sheet__tip">写好直接收起也会存，不用点保存</text>

        <input v-model="form.title" class="td-sheet__input td-sheet__input--title" placeholder="要办什么"
          :maxlength="200" confirm-type="done" />

        <textarea v-model="form.note" class="td-sheet__area" placeholder="补充说明（可不填）" :maxlength="1000"
          auto-height />

        <view class="td-sheet__row">
          <text class="td-sheet__label">截止</text>
          <view class="td-sheet__value">
            <DateField v-model="form.dueDate" placeholder="没定日子" @change="onDueChange" />
          </view>
          <text v-if="form.dueDate" class="td-sheet__clear" @click="form.dueDate = ''">清空</text>
        </view>

        <view class="td-sheet__shots">
          <!-- 序号 = 选中先后；删掉中间一张，后面的会自动往前补，跟提交顺序始终一致 -->
          <view v-for="(src, index) in form.images" :key="index" class="td-sheet__shot-wrap">
            <image class="td-sheet__shot" :src="resolveAssetUrl(src)" mode="aspectFill" @click="previewForm(index)" />
            <text class="td-sheet__shot-no">{{ index + 1 }}</text>
            <text class="td-sheet__shot-del" @click.stop="removeShot(index)">×</text>
          </view>
          <view v-if="form.images.length < MAX_SHOTS" class="td-sheet__shot-add" @click="photoOpen = true">
            <text class="td-sheet__shot-plus">＋</text>
            <text class="td-sheet__shot-label">附图</text>
          </view>
        </view>

        <view class="td-sheet__actions">
          <view v-if="editingId" class="td-sheet__del" @click="removeItem">删除</view>
          <view class="td-sheet__save" @click="finish">
            <text>完成</text>
          </view>
        </view>
      </view>
    </AppPopup>

    <!-- 附图来源 -->
    <AppPopup v-model="photoOpen" position="bottom" round safe-area-inset-bottom
      custom-style="background-color: var(--ui-sheet-fill);">
      <view class="photo-sheet">
        <text class="photo-sheet__title">附图</text>
        <view class="photo-sheet__item" @click="pick('camera')">
          <wd-icon name="camera" size="20px" />
          <text>拍一张</text>
        </view>
        <view class="photo-sheet__item" @click="pick('album')">
          <wd-icon name="picture" size="20px" />
          <text>从相册选择</text>
        </view>
        <view class="photo-sheet__cancel" @click="photoOpen = false">取消</view>
      </view>
    </AppPopup>

    <!-- LoadingMask 没有 visible 属性，挂载即显示；必须用 v-if 控制，否则遮罩永远盖在页面上 -->
    <LoadingMask v-if="booting" />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import AppPopup from '../../components/AppPopup.vue'
import { onBackPress, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import { handleGlobalBack } from '../../utils/popupStack'

import request from '../../api/request'
import { getItem, setItem, removeItem as removeStoredItem } from '../../api/storage'
import { uploadFile } from '../../api/upload'
import { resolveAssetUrl } from '../../api/config'
import { chooseImages } from '../../utils/chooseImages'
import { useTheme } from '../../composables/useTheme'
import DateField from '../../components/DateField.vue'
import LoadingMask from '../../components/LoadingMask.vue'
import PageTitle from '../../components/PageTitle.vue'
import { usePageFrame } from '../../composables/usePageFrame'
import { useEdgeSwipe } from '../../composables/useEdgeSwipe'

const { themeClass, themeVars } = useTheme()

/** 一条待办最多几张附图。模板里选图按钮的显示条件、pick() 的可选张数都读这一个数 */
const MAX_SHOTS = 6

/*
 * 两页的文案都收在这儿：模板里 v-for 一遍，页签文字、空态、计数全按 key 取，
 * 以后再加「这周办完」之类的页只改这个数组。
 */
const PANES = [
  { key: 'open', label: '待办', emptyTitle: '现在没有待办', emptySub: '点下面「记一条」，把脑子里的事挪出来' },
  { key: 'done', label: '已完成', emptyTitle: '还没有办完的事', emptySub: '勾掉的事会收在这里，翻得到' },
]

const openItems = ref([])
const doneItems = ref([])
const doneLoaded = ref(false)
const loading = ref(false)
const booting = ref(true)
const refreshing = ref(false)

/*
 * 正在播「完成 / 取消完成」动画的那条：id → 'done' | 'undo'。
 * 它跟 item.done 是两回事：item.done 要等接口回来刷新才变，动画得当场给反应。
 */
const striking = ref({})

/** 卡片上取动画状态，模板里到处用，取不到就是空串 */
function strikeOf(id) {
  return striking.value[id] || ''
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 系统开了「减弱动态效果」就不播动画，也别干等 */
function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (error) {
    return false
  }
}

/** 动画总时长：勾 120 + 划线 160 + 卡片淡出 140，留一点缓冲（跟样式里的 ms 对齐） */
const STRIKE_TOTAL = prefersReducedMotion() ? 0 : 320

const sheetOpen = ref(false)
const photoOpen = ref(false)
const editingId = ref(null)
const form = ref(blankForm())
/** 打开弹层那一刻的内容。关的时候跟它比，没改过就不发请求、不弹「改好了」 */
const baseline = ref(blankForm())
/** 这次打开是不是从本机草稿带回来的（带回来的内容即使没动，关的时候也要存） */
const draftRestored = ref(false)

/** 没存上的内容放这儿：create 是新建草稿，edit:<id> 是某条已有待办的改动草稿 */
const DRAFT_KEY = 'todo:unsavedDrafts'
/** 一次关闭只处理一次：遮罩、返回手势、收起/完成 都汇到 handleClose */
let closeHandled = false

const overdueCount = computed(() => groupOf(openItems.value).overdue.length)
const todayCount = computed(() => groupOf(openItems.value).today.length)

/*
 * 分组只按截止日算：今天 / 本周（7 天内）/ 以后 / 没定。
 * 逾期的单独提到最上面并要求「逾期」口径，因为使用方最需要先看到那些漏掉的。
 */
function groupsOf(key) {
  if (key === 'done') {
    return doneItems.value.length
      ? [{ key: 'done', name: '办完的', items: doneItems.value }]
      : []
  }
  const bucket = groupOf(openItems.value)
  return [
    { key: 'overdue', name: '逾期', items: bucket.overdue },
    { key: 'today', name: '今天', items: bucket.today },
    { key: 'week', name: '本周', items: bucket.week },
    { key: 'later', name: '以后', items: bucket.later },
    { key: 'none', name: '没定日子', items: bucket.none },
  ].filter((group) => group.items.length)
}

/** 某一页有几条：空态、加载态判断都读它（模板里不能直接调 ref 上的 .length 做 v-if 链） */
function countOf(key) {
  return key === 'done' ? doneItems.value.length : openItems.value.length
}

function blankForm() {
  return { title: '', note: '', dueDate: '', images: [] }
}

/** 只留要存 / 要比的四个字段：别把响应式代理和多余字段写进本地存储 */
function normalizeForm(raw) {
  return {
    title: String(raw?.title || ''),
    note: String(raw?.note || ''),
    dueDate: String(raw?.dueDate || ''),
    images: Array.isArray(raw?.images) ? raw.images.filter(Boolean) : [],
  }
}

function formSnapshot() {
  return normalizeForm(form.value)
}

function sameForm(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 有「写下来的东西」才算草稿：openCreate 默认填的今天不算 */
function hasWrittenContent(data) {
  return !!(data.title.trim() || data.note.trim() || data.images.length)
}

function draftKeyOf(id) {
  return id ? `edit:${id}` : 'create'
}

function readDrafts() {
  try {
    const parsed = JSON.parse(getItem(DRAFT_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    return {}
  }
}

function takeDraft(key) {
  const entry = readDrafts()[key]
  return entry && entry.form ? normalizeForm(entry.form) : null
}

function stashDraft(key, data) {
  const all = readDrafts()
  all[key] = { form: normalizeForm(data), at: Date.now() }
  setItem(DRAFT_KEY, JSON.stringify(all))
}

function dropDraft(key) {
  const all = readDrafts()
  if (!(key in all)) return
  delete all[key]
  if (Object.keys(all).length) setItem(DRAFT_KEY, JSON.stringify(all))
  else removeStoredItem(DRAFT_KEY)
}

function isoToday() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function daysFromToday(dateText) {
  if (!dateText) return null
  const today = new Date(`${isoToday()}T00:00:00`)
  const target = new Date(`${String(dateText).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target - today) / 86400000)
}

function groupOf(list) {
  const bucket = { overdue: [], today: [], week: [], later: [], none: [] }
  list.forEach((item) => {
    const days = daysFromToday(item.dueDate)
    if (days === null) bucket.none.push(item)
    else if (days < 0) bucket.overdue.push(item)
    else if (days === 0) bucket.today.push(item)
    else if (days <= 7) bucket.week.push(item)
    else bucket.later.push(item)
  })
  Object.keys(bucket).forEach((key) => {
    if (key === 'none') return
    bucket[key].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
  })
  return bucket
}

function dueText(item) {
  const days = daysFromToday(item.dueDate)
  if (days === null) return ''
  if (days < 0) return `逾期 ${-days} 天`
  if (days === 0) return '今天到期'
  if (days === 1) return '明天到期'
  if (days <= 7) return `${days} 天后 · ${String(item.dueDate).slice(5)}`
  return String(item.dueDate).slice(0, 10)
}

function dueClass(item) {
  const days = daysFromToday(item.dueDate)
  if (days === null) return 'td__due--none'
  if (days < 0) return 'td__due--late'
  if (days === 0) return 'td__due--today'
  return ''
}

async function load(showBoot = false) {
  if (showBoot) booting.value = true
  loading.value = true
  try {
    const openRes = await request.get('/api/todo/list?scope=open')
    openItems.value = pickList(openRes)
  } catch (error) {
    toast(errorText(error, '待办没取到'))
  } finally {
    loading.value = false
    booting.value = false
  }
}

async function loadDone() {
  const res = await request.get('/api/todo/list?scope=done')
  doneItems.value = pickList(res)
  doneLoaded.value = true
}

function pickList(res) {
  const body = res?.data || {}
  if (body.code !== 200) throw new Error(body.msg || '取待办失败')
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.map((row) => ({
    ...row,
    images: Array.isArray(row.images) ? row.images : [],
  }))
}

/* ===== 横向翻页：两页共用一条轨道 ===== */

/*
 * 一页的宽度就是屏幕宽（页面是满幅的），不用 createSelectorQuery 去量：
 * 量出来晚一帧，第一下拖动就会按 0 算。
 */
const winWidth = (() => {
  try {
    return Number(uni.getSystemInfoSync().windowWidth) || 375
  } catch (e) {
    return 375
  }
})()
/** 1rpx = 多少 px：胶囊的几何全按 rpx 定，再换算成 translate 需要的 px */
const RPX = winWidth / 750
const stageW = ref(winWidth)
const scrollX = ref(0)
const progress = computed(() => scrollX.value / Math.max(1, stageW.value))
/** 高亮翻到下一页的时机：过半即换（和胶囊前缘冲到对面几乎同时） */
const highlightIndex = computed(() => (progress.value >= 0.5 ? 1 : 0))
const trackStyle = computed(() => ({
  transform: `translate3d(${-scrollX.value.toFixed(2)}px, 0, 0)`,
}))

/* 胶囊尺寸（rpx）：两颗等宽，位置因此不用量 DOM */
const CHIP_W = 168
const CHIP_H = 64
const CHIP_GAP = 12

/** 吸附动画期间的轻微回弹：只用于收拢那一下，正常拖动不会用到 */
function easeOutBackSoft(t) {
  const c1 = 1.18
  const c3 = c1 + 1
  const u = t - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

/**
 * 液体胶囊（抄抄表页那套，2026-11-21）：
 * - 前缘（往右走时的右端）用 easeOut 一路往目标冲；
 * - 后缘前半程黏在原地，过 45% 才 easeIn 跟过去 —— 中间被拉长，像被拽出来的粘液；
 * - 半页处纵向鼓 7px、横向略模糊，像被挤出来的鼓包；
 * - 全部由 progress 驱动，没有独立定时器，所以和下面两页永远是同一进度。
 * 胶囊画在页签底下（z-index 0），页签自身底色不透明，文字对比度不受影响。
 */
const liquidStyle = computed(() => {
  const w = CHIP_W * RPX
  const h = CHIP_H * RPX
  const gap = CHIP_GAP * RPX
  const raw = Math.max(0, Math.min(1, progress.value))
  const t = pagerAnimating.value ? easeOutBackSoft(raw) : raw
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const easeOut = (v) => 1 - (1 - v) * (1 - v)
  const easeIn = (v) => v * v * v

  const lead = easeOut(clamp01(t))
  const trail = easeIn(clamp01((t - 0.45) / 0.55))

  const left = (w + gap) * trail
  const right = w + (w + gap) * lead
  const width = Math.max(20 * RPX, right - left)
  const bulge = Math.sin(Math.PI * raw)

  return {
    width: `${width.toFixed(2)}px`,
    height: `${(h + bulge * 7 * RPX).toFixed(2)}px`,
    transform: `translate3d(${left.toFixed(2)}px, ${(-bulge * 3.5 * RPX).toFixed(2)}px, 0)`,
    filter: bulge > 0.02 ? `blur(${(bulge * 1.1).toFixed(2)}px)` : 'none',
  }
})

const pagerAnimating = ref(false)
let samples = []
let flingToken = 0
let lastTickAt = 0
let touchBraked = false
/** 刚拖过轨道的时间：拖动结束会带出一个 click，别让它顺手打开一张卡片 */
let lastDragAt = 0
const gesture = { startX: 0, startY: 0, startScroll: 0, dragging: false, decided: false }

const VELOCITY_WINDOW = 60
const GLIDE_TAU = 760
const GLIDE_BOOST = 3.6
const GLIDE_VMAX = 15
const GLIDE_MIN_MS = 420
const SNAP_MS_BRAKE = 150
const SNAP_MS_GLIDE = 220

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
}
function rafTick(fn) {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn)
  else setTimeout(fn, 16)
}
function clampX(x) {
  return Math.max(0, Math.min(stageW.value, x))
}
function pushSample(x) {
  const t = nowMs()
  samples.push({ t, x })
  while (samples.length > 2 && t - samples[0].t > VELOCITY_WINDOW) samples.shift()
}
/** 松手速度 px/ms：只认抬手前 120ms 内的样本，否则「按住停一下再松手」会白飞一页 */
function releaseVelocity() {
  if (samples.length < 2) return 0
  const now = nowMs()
  const fresh = samples.filter((s) => now - s.t <= 120)
  if (fresh.length < 2) return 0
  const first = fresh[0]
  const last = fresh[fresh.length - 1]
  const dt = last.t - first.t
  return dt > 0 ? (last.x - first.x) / dt : 0
}
/** 刹车：掐断正在跑的动画，位置冻在当前这一帧 */
function brake() {
  flingToken += 1
  pagerAnimating.value = false
  lastTickAt = 0
  samples = []
}

function onTouchStart(e) {
  if (pagerAnimating.value && nowMs() - lastTickAt > 400) pagerAnimating.value = false
  touchBraked = false
  if (pagerAnimating.value) {
    brake()
    touchBraked = true
  }
  const t = e.touches?.[0]
  if (!t) return
  gesture.startX = t.clientX
  gesture.startY = t.clientY
  gesture.startScroll = scrollX.value
  // 左缘 24px 留给系统返回手势（本页也用 useEdgeSwipe 做了右滑返回）
  gesture.dragging = t.clientX > 24
  gesture.decided = false
  samples = []
  pushSample(t.clientX)
}

function onTouchMove(e) {
  if (!gesture.dragging || pagerAnimating.value) return
  const t = e.touches?.[0]
  if (!t) return
  const dx = t.clientX - gesture.startX
  const dy = t.clientY - gesture.startY
  if (!gesture.decided) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
    // 竖向多于横向：这是列表滚动，不抢
    if (Math.abs(dy) > Math.abs(dx)) {
      gesture.dragging = false
      return
    }
    gesture.decided = true
  }
  pushSample(t.clientX)
  scrollX.value = clampX(gesture.startScroll - dx)
}

function onTouchEnd() {
  if (!gesture.dragging || pagerAnimating.value) return
  gesture.dragging = false
  gesture.decided = false
  const v = releaseVelocity()
  samples = []
  if (Math.abs(scrollX.value - gesture.startScroll) > 8) lastDragAt = Date.now()
  startGlide(-v)
}

/**
 * 松手之后怎么滑：距离 = 初速度 × 时间常数，时长 = 3 × 时间常数，
 * easeOutCubic 的起手导数正好等于初速度 —— 速度接得上，不会「被推一把」。
 */
function startGlide(v0) {
  const snapMs = touchBraked ? SNAP_MS_BRAKE : SNAP_MS_GLIDE
  const vTrack = Math.max(-GLIDE_VMAX, Math.min(GLIDE_VMAX, v0 * GLIDE_BOOST))
  if (!Number.isFinite(vTrack) || Math.abs(vTrack) < 0.05) {
    snapNearest(snapMs)
    return
  }
  const want = scrollX.value + vTrack * GLIDE_TAU
  const target = clampX(want)
  const dist = Math.abs(target - scrollX.value)
  if (dist < 0.6) {
    snapNearest(snapMs)
    return
  }
  const ms = Math.max(GLIDE_MIN_MS, (dist / Math.abs(vTrack)) * 3)
  // 滑行终点是按速度算出来的任意位置，所以滑完必须再吸附一次，否则会停在两页中间
  animateTo(target, vTrack, ms, () => snapNearest(SNAP_MS_GLIDE))
}

function snapNearest(ms = SNAP_MS_GLIDE) {
  animateTo(Math.round(scrollX.value / Math.max(1, stageW.value)) * stageW.value, 0, ms)
}

function animateTo(target, v = 0, forceMs = 0, onDone = null) {
  const from = scrollX.value
  const to = clampX(target)
  const dist = Math.abs(to - from)
  if (dist < 0.6) {
    scrollX.value = to
    if (onDone) onDone()
    return
  }
  // 起手速度给得越大，同样的距离走得越短：480ms 是「一页」的基准
  const ms = forceMs || Math.min(560, Math.max(240, (dist / Math.max(1, stageW.value)) * 480))
  const t0 = nowMs()
  const token = ++flingToken
  lastTickAt = t0
  pagerAnimating.value = true
  const tick = () => {
    if (token !== flingToken) return
    lastTickAt = nowMs()
    const t = Math.min(1, (nowMs() - t0) / ms)
    const eased = 1 - Math.pow(1 - t, 3)
    scrollX.value = from + (to - from) * eased
    if (t < 1) {
      rafTick(tick)
      return
    }
    scrollX.value = to
    pagerAnimating.value = false
    if (onDone) onDone()
  }
  rafTick(tick)
}

function goTab(i) {
  // 刚拖过：这次 click 是拖动带出来的，不再额外跳一次
  if (Date.now() - lastDragAt < 350) return
  if (i === highlightIndex.value && Math.abs(scrollX.value - i * stageW.value) < 1) return
  if (pagerAnimating.value) brake()
  if (i === 1 && !doneLoaded.value) loadDone().catch((error) => toast(errorText(error, '已完成没取到')))
  animateTo(i * stageW.value, 0)
}

function onRefresh(key) {
  refreshing.value = true
  const jobs = [load()]
  if (key === 'done' || !doneLoaded.value) jobs.push(loadDone())
  Promise.all(jobs)
    .catch(() => {})
    .finally(() => {
      refreshing.value = false
    })
}

/** 这一页是不是还在首屏加载：已完成页没取过就不算空，别闪一下「还没有办完的事」 */
function isBooting(key) {
  return key === 'done' ? !doneLoaded.value : loading.value
}

// 手指直接滑到「已完成」（不点页签）时也得取一次数据
watch(highlightIndex, (index) => {
  if (index === 1 && !doneLoaded.value) {
    loadDone().catch((error) => toast(errorText(error, '已完成没取到')))
  }
})

function openCreate() {
  editingId.value = null
  const draft = takeDraft('create')
  if (draft && hasWrittenContent(draft)) {
    // 上次没存上（断网 / 只写了说明）的内容直接带回来，用户不用重打
    form.value = draft
    draftRestored.value = true
    toast('上次没存上的，给你带回来了')
  } else {
    if (draft) dropDraft('create')
    form.value = blankForm()
    form.value.dueDate = isoToday()
    draftRestored.value = false
  }
  baseline.value = formSnapshot()
  closeHandled = false
  sheetOpen.value = true
}

function openEdit(item) {
  // 刚横滑完带出来的 click：手指是「翻页」不是「点这张卡」，别顺手把编辑弹出来
  if (Date.now() - lastDragAt < 350) return
  // 这张正在播完成动画：别在它淡出的半路把编辑弹层顶出来
  if (striking.value[item.id]) return
  editingId.value = item.id
  // 基准是服务器上的原样：草稿恢复出来的内容也算「改过」，关的时候要存
  const base = normalizeForm({
    title: item.title,
    note: item.note,
    dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '',
    images: item.images,
  })
  const draft = takeDraft(draftKeyOf(item.id))
  if (draft) {
    form.value = draft
    draftRestored.value = true
    toast('上次没存上的改动，给你带回来了')
  } else {
    form.value = normalizeForm(base)
    draftRestored.value = false
  }
  baseline.value = base
  closeHandled = false
  sheetOpen.value = true
}

function onDueChange(value) {
  form.value.dueDate = value || ''
}

function preview(item, index) {
  const urls = item.images.map((src) => resolveAssetUrl(src))
  uni.previewImage({ urls, current: urls[index] })
}

function previewForm(index) {
  const urls = form.value.images.map((src) => resolveAssetUrl(src))
  uni.previewImage({ urls, current: urls[index] })
}

function removeShot(index) {
  form.value.images.splice(index, 1)
}

function pick(source) {
  // 一次能选几张 = 还差几张。以前写死 count: 1 且只取第 0 张，多选等于白选（2026-11-20 同事报的 bug）
  const remain = MAX_SHOTS - form.value.images.length
  if (remain <= 0) {
    toast(`最多 ${MAX_SHOTS} 张`)
    return
  }
  const options = {
    count: remain,
    sizeType: ['compressed'],
    sourceType: [source],
    success: (res) => {
      const paths = (res.tempFilePaths || []).filter(Boolean)
      if (paths.length) uploadShots(paths)
    },
    fail: () => {},
  }
  // 相册走系统相册（框架自绘那套界面与项目其它页不一致）
  if (source === 'album') chooseImages(options)
  else uni.chooseImage(options)
}

/**
 * 逐张上传，顺序 = 用户挑选的顺序。
 *
 * <p>为什么不并行：服务端给回的路径是按请求顺序 push 进 form.images 的，并行的话谁先回来谁在前，
 * 提交与展示的顺序就跟挑图的顺序对不上了。串行慢一点，但序是确定的；图也不多（最多 6 张）。
 * 中途失败就停：已经传上去的留着（用户能看见是第几张断的），没传的放弃，提示原因。
 */
async function uploadShots(paths) {
  photoOpen.value = false
  const room = Math.max(0, MAX_SHOTS - form.value.images.length)
  const list = paths.slice(0, room)
  if (!list.length) return

  let done = 0
  uni.showLoading({ title: `上传中 1/${list.length}`, mask: true })
  try {
    for (const filePath of list) {
      done += 1
      uni.showLoading({ title: `上传中 ${done}/${list.length}`, mask: true })
      const res = await uploadFile({ url: '/api/todo/photo', filePath, name: 'file' })
      const body = res?.data || {}
      const path = body?.data?.path
      if (body.code !== 200 || !path) throw new Error(body.msg || '上传失败')
      form.value.images.push(path)
    }
  } catch (error) {
    toast(errorText(error, `第 ${done} 张没传上去`))
  } finally {
    uni.hideLoading()
  }
}

/** 「收起 / 完成」：先按关闭处理（保存），再收起弹层 */
function finish() {
  handleClose()
  sheetOpen.value = false
}

/** 点遮罩、按返回手势时 AppPopup 发来的 close：同样按关闭处理 */
function onSheetClose() {
  handleClose()
}

/**
 * 关闭 = 保存（2026-11-25）。
 *
 * 使用方原话：经常忘了点保存，切走就白写了。所以这里不再有「保存」按钮：
 * - 没改过：不发请求，也不弹「改好了」；
 * - 有标题：新建 POST / 编辑 PUT；
 * - 没标题：不建空条目；写了说明 / 带了图就留本机草稿，下次打开带回来。
 */
function handleClose() {
  if (closeHandled) return
  closeHandled = true

  const snapshot = formSnapshot()
  const key = draftKeyOf(editingId.value)
  const changed = draftRestored.value || !sameForm(snapshot, baseline.value)
  if (!changed) return

  const title = snapshot.title.trim()
  if (!title) {
    if (editingId.value) {
      stashDraft(key, snapshot)
      toast('标题空了，这条没改，改动先留着')
      return
    }
    if (hasWrittenContent(snapshot)) {
      stashDraft(key, snapshot)
      toast('没写要办什么，先帮你留着')
    } else {
      dropDraft(key)
    }
    return
  }

  const payload = {
    title,
    note: snapshot.note.trim(),
    dueDate: snapshot.dueDate,
    images: snapshot.images,
  }
  commit(key, editingId.value, payload)
}

/**
 * 真正落库。弹层这时已经收起了，所以失败也不能把字丢掉：
 * 同一份内容写回本机草稿，下次点「记一条」/ 打开这条时自动带回来。
 */
async function commit(key, id, payload) {
  try {
    const res = id
      ? await request.put(`/api/todo/${id}`, payload)
      : await request.post('/api/todo/create', payload)
    const body = res?.data || {}
    if (body.code !== 200) throw new Error(body.msg || '没存上')
    dropDraft(key)
    toast(id ? '改好了' : '记下了')
    await load()
    if (doneLoaded.value) loadDone().catch(() => {})
  } catch (error) {
    stashDraft(key, payload)
    toast('网络不好，先存手机上了')
  }
}

/**
 * 完成 / 取消完成：先把动画放出去，同时发请求，等动画走完再刷新列表。
 *
 * 为什么不等接口回来再刷新：那样卡片会「愣」半秒才消失，比不播动画更钝；
 * 为什么失败要倒放：动画已经把「办完了」演给用户看了，接口失败还留着划线，
 * 用户会以为真办完了，第二天发现还在，比没动画更糟。
 */
async function toggle(item) {
  const id = item.id
  if (striking.value[id]) return // 动画还在播：再点一下不算，免得来回打架
  const target = !item.done
  striking.value = { ...striking.value, [id]: target ? 'done' : 'undo' }

  try {
    // 请求和动画并行：网络慢的时候，动画照样先把 320ms 演完，不会等接口才开始
    await Promise.all([
      request.post(`/api/todo/${id}/done?done=${target}`),
      sleep(STRIKE_TOTAL),
    ])
    await load()
    if (doneLoaded.value) await loadDone()
  } catch (error) {
    /*
     * 没存上：先让「勾上 / 划掉」演到一半再倒放。
     * 立刻缩回去只会闪一下，用户根本看不清发生了什么，反以为点了没反应；
     * 演一下再收回来 + 一句提示，才读得出「试了，没成」。
     */
    await sleep(prefersReducedMotion() ? 0 : 140)
    toast(errorText(error, '没改成，再试一次'))
  } finally {
    const rest = { ...striking.value }
    delete rest[id]
    striking.value = rest
  }
}

function removeItem() {
  if (!editingId.value) return
  uni.showModal({
    title: '删掉这条？',
    content: '删了就找不回来了',
    confirmText: '删掉',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await request.delete(`/api/todo/${editingId.value}`)
        // 这条都没了，之前没存上的改动草稿也别再带回来
        dropDraft(draftKeyOf(editingId.value))
        // 这次收起不是「用户走了要保存」，是这条已经删了：
        // 挡住 AppPopup 随后可能发来的 close，别把已删的内容又 PUT 一遍
        closeHandled = true
        sheetOpen.value = false
        toast('删掉了')
        await load()
        if (doneLoaded.value) await loadDone()
      } catch (error) {
        toast(errorText(error, '没删掉'))
      }
    },
  })
}

function errorText(error, fallback) {
  return error?.body?.msg || error?.data?.msg || error?.message || fallback
}

function toast(title) {
  uni.showToast({ title, icon: 'none' })
}

onShow(() => {
  load(booting.value)
  if (doneLoaded.value) loadDone().catch(() => {})
})

/*
 * 兜底：本页的 pages.json 没开下拉刷新，但有别的路径（从抽屉里跳转时，
 * 抽屉收起会把下拉刷新还给「当初被关掉的那一页」，历史版本给错了页）可能把它打开。
 * 真开着的时候拽一下就能收起转圈，不至于常驻一个永远转的圈。
 */
onPullDownRefresh(async () => {
  try {
    await load()
    if (doneLoaded.value) await loadDone()
  } finally {
    uni.stopPullDownRefresh()
  }
})

/* 弹窗入栈改由 AppPopup 组件内部负责（2026-11-18 全局化），本页不再手工登记。 */

onBackPress(() => {
  // 统一走全局守卫（2026-11-18 全局化）：本页没有抽屉，关掉弹窗就交回框架返回上一页
  return handleGlobalBack() !== 'root'
})
// 极简标题（2026-11-18）：顶栏只剩一行居中文字，抽屉入口改为左侧边缘右滑
const { frameStyle } = usePageFrame()
const { onTouchStart: onEdgeStart, onTouchEnd: onEdgeEnd } = useEdgeSwipe(() => uni.navigateBack())

</script>

<style lang="scss" scoped>
.td {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ui-scene-bg);
}

.td__head {
  padding: 8rpx 20rpx 0;
}

.td__summary {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.td__count {
  font-size: 76rpx;
  font-weight: 700;
  line-height: 1;
  color: var(--ui-text);
  font-variant-numeric: tabular-nums;
}

.td__count-unit {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.td__pills {
  display: flex;
  gap: 10rpx;
  margin-left: 12rpx;
}

.td__pill {
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

.td__pill--late {
  color: var(--ui-amber-800);
  background: var(--ui-amber-50);
}

.td__pill--today {
  color: var(--ui-accent);
  background: var(--ui-accent-soft, var(--ui-raise-2));
}

/*
 * 液体胶囊（2026-11-21）：这层只是「带子」，胶囊和两颗页签都画在 .td__tabs-inner 里。
 * 页签给死尺寸（168×64rpx），liquidStyle 才能按 rpx 算位置而不用量 DOM —— 量 DOM 会晚一帧。
 */
.td__tabs {
  margin: 22rpx 0 6rpx;
  padding-bottom: 6rpx;
}

.td__tabs-inner {
  position: relative;
  display: inline-flex;
  gap: 12rpx;
  align-items: center;
}

/* 绝对定位铺在页签底下；宽度、位移、鼓起都由 liquidStyle 直接写 style */
.td__liquid {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 0;
  border-radius: 999rpx;
  background: var(--ui-accent);
  transform-origin: left center;
  will-change: transform, width, filter;
  pointer-events: none;
}

.td__tab {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 168rpx;
  height: 64rpx;
  border-radius: 999rpx;
  background: var(--ui-raise-2);
  color: var(--ui-text-2);
  font-size: 27rpx;
  /* 底色不透明 + 自己刷选中色：胶囊滑出去的那一下，文字也不会掉对比度 */
  transition: background-color 200ms cubic-bezier(0.22, 1, 0.36, 1), color 200ms ease;
}

.td__tab--on {
  background: var(--ui-accent);
  color: var(--ui-on-accent);
  font-weight: 600;
}

/* 两页并排的轨道：宽度 200%，每页一半，拖动只改 transform，不触发布局 */
.td__stage {
  position: relative;
  flex: 1;
  height: 0;
  overflow: hidden;
}

.td__track {
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
}

.td__page {
  width: 50%;
  height: 100%;
}

.td__list {
  height: 100%;
}

/* 内边距放这层：App 端 scroll-view 的右内边距不参与内容宽度，卡片会被推出右边界 */
.td__inner {
  box-sizing: border-box;
  padding: 0 20rpx;
}

.td__group {
  margin-top: 22rpx;
}

.td__group-head {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  padding: 0 6rpx 10rpx;
}

.td__group-name {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--ui-text-2);
  letter-spacing: 1rpx;
}

.td__group-count {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__item {
  display: flex;
  gap: 18rpx;
  padding: 22rpx 22rpx 20rpx;
  margin-bottom: 12rpx;
  border-radius: 20rpx;
  background: var(--ui-surface);
  border: 2rpx solid var(--ui-hairline);
  /*
   * 完成动画的最后一拍：卡片淡出 + 轻轻下沉。
   * 延迟 170ms 是为了「先划掉、再淡出」—— 两个动作同时来会糊成一团。
   */
  transition: opacity 140ms ease-out 170ms, transform 140ms ease-out 170ms;
}

.td__item--late {
  border-color: var(--ui-amber-200);
}

/* 完成 / 取消完成时整张卡淡出；失败时摘掉这两个类，CSS 会自己倒放回去 */
.td__item--striking,
.td__item--un-striking {
  opacity: 0;
  transform: translateY(6rpx);
}

.td__check {
  width: 44rpx;
  height: 44rpx;
  flex: 0 0 44rpx;
  margin-top: 2rpx;
  border-radius: 999rpx;
  border: 3rpx solid var(--ui-border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 120ms ease-out, border-color 120ms ease-out, transform 100ms ease-out;
}

.td__check--on {
  background: var(--ui-accent);
  border-color: var(--ui-accent);
}

.td__check-mark {
  font-size: 26rpx;
  line-height: 1;
  color: var(--ui-on-accent);
}

/* 勾号弹出来 / 缩回去。用 animation 而不是 transition：它是一次性的「啪」一下 */
.td__check-mark--pop {
  animation: td-tick-pop 120ms cubic-bezier(.34, 1.4, .64, 1) both;
}

.td__check-mark--out {
  animation: td-tick-out 100ms ease-in both;
}

@keyframes td-tick-pop {
  from {
    transform: scale(.4);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes td-tick-out {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(.4);
    opacity: 0;
  }
}

.td__body {
  flex: 1;
  min-width: 0;
}

.td__title-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: top;
}

.td__title {
  font-size: 30rpx;
  line-height: 1.35;
  color: var(--ui-text);
  font-weight: 600;
}

.td__title--done {
  color: var(--ui-text-2);
  text-decoration: line-through;
}

/*
 * 划掉的那根线：绝对定位，靠 scaleX 从 0 长到 1（只动 transform，不动宽度，
 * 才不会每帧重排）。放在标题块正中，一行标题正好压在字中间。
 */
.td__strike {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 3rpx;
  background: var(--ui-text-2);
  transform: scaleX(0);
  transform-origin: left center;
  pointer-events: none;
  /* 过渡写在默认态：失败时摘掉 --in，线才能顺着同一个缓动缩回去，而不是「啪」一下没了 */
  transition: transform 160ms cubic-bezier(.4, .66, .24, 1);
}

.td__strike--in {
  transform: scaleX(1);
}

/* 取消完成：线从右往左收回（animation 才能从 1 起步倒着走） */
.td__strike--out {
  animation: td-strike-back 140ms cubic-bezier(.4, .66, .24, 1) both;
}

@keyframes td-strike-back {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.td__note {
  display: block;
  margin-top: 6rpx;
  font-size: 24rpx;
  line-height: 1.45;
  color: var(--ui-text-2);
}

.td__shots {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 12rpx;
}

.td__shot-wrap {
  position: relative;
}

.td__shot {
  width: 96rpx;
  height: 96rpx;
  border-radius: 12rpx;
  background: var(--ui-raise-2);
}

/* 第几张。压在左下角，不挡脸、也不和右上角的删除按钮打架 */
.td__shot-no {
  position: absolute;
  left: 4rpx;
  bottom: 4rpx;
  min-width: 28rpx;
  height: 28rpx;
  padding: 0 6rpx;
  border-radius: 999rpx;
  background: rgba(16, 22, 32, 0.62);
  color: #fff;
  font-size: 20rpx;
  line-height: 28rpx;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.td__more {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__meta {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 12rpx;
}

.td__due {
  font-size: 23rpx;
  color: var(--ui-text-2);
  font-variant-numeric: tabular-nums;
}

.td__due--late {
  color: var(--ui-amber-800);
  font-weight: 600;
}

.td__due--today {
  color: var(--ui-accent);
  font-weight: 600;
}

.td__due--none {
  color: var(--ui-text-3);
}

.td__doneat {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td__hint,
.td__empty {
  padding: 120rpx 20rpx;
  text-align: center;
}

.td__empty-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ui-text);
}

.td__empty-sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: var(--ui-text-2);
}

.td__bottom-space {
  height: 40rpx;
}

.td__bar {
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom, 0px));
  background: var(--ui-surface);
  border-top: 2rpx solid var(--ui-hairline);
}

.td__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  height: 96rpx;
  border-radius: 24rpx;
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}

.td__add-plus {
  font-size: 34rpx;
  line-height: 1;
}

.td__add-text {
  font-size: 30rpx;
  font-weight: 600;
}

/* 表单弹层 */
.td-sheet {
  padding: 24rpx 28rpx calc(20rpx + env(safe-area-inset-bottom, 0px));
}

.td-sheet__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.td-sheet__title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.td-sheet__close {
  font-size: 26rpx;
  color: var(--ui-text-3);
}

/* 一句话把「不用找保存」说清楚：使用方就是因为忘了点保存才丢内容 */
.td-sheet__tip {
  display: block;
  margin: -8rpx 0 18rpx;
  font-size: 23rpx;
  line-height: 1.4;
  color: var(--ui-text-3);
}

.td-sheet__input {
  height: 92rpx;
  padding: 0 22rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
  font-size: 30rpx;
  color: var(--ui-text);
}

.td-sheet__input--title {
  font-weight: 600;
}

.td-sheet__area {
  width: 100%;
  min-height: 120rpx;
  margin-top: 14rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
  font-size: 27rpx;
  line-height: 1.5;
  color: var(--ui-text);
  box-sizing: border-box;
}

.td-sheet__row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  margin-top: 14rpx;
  padding: 0 22rpx;
  min-height: 92rpx;
  border-radius: 18rpx;
  background: var(--ui-raise-2);
}

.td-sheet__label {
  font-size: 26rpx;
  color: var(--ui-text-2);
  flex: 0 0 auto;
}

.td-sheet__value {
  flex: 1;
  min-width: 0;
}

.td-sheet__clear {
  font-size: 24rpx;
  color: var(--ui-text-3);
  flex: 0 0 auto;
}

.td-sheet__shots {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 18rpx;
}

.td-sheet__shot-wrap {
  position: relative;
}

.td-sheet__shot {
  width: 130rpx;
  height: 130rpx;
  border-radius: 16rpx;
  background: var(--ui-raise-2);
}

.td-sheet__shot-del {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 40rpx;
  height: 40rpx;
  border-radius: 999rpx;
  background: var(--ui-text);
  color: var(--ui-surface);
  font-size: 24rpx;
  line-height: 40rpx;
  text-align: center;
}

/* 第几张，跟列表里的小图同一套角标 */
.td-sheet__shot-no {
  position: absolute;
  left: 8rpx;
  bottom: 8rpx;
  min-width: 32rpx;
  height: 32rpx;
  padding: 0 8rpx;
  border-radius: 999rpx;
  background: rgba(16, 22, 32, 0.62);
  color: #fff;
  font-size: 22rpx;
  line-height: 32rpx;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.td-sheet__shot-add {
  width: 130rpx;
  height: 130rpx;
  border-radius: 16rpx;
  border: 2rpx dashed var(--ui-border-strong);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
}

.td-sheet__shot-plus {
  font-size: 34rpx;
  line-height: 1;
  color: var(--ui-text-3);
}

.td-sheet__shot-label {
  font-size: 22rpx;
  color: var(--ui-text-3);
}

.td-sheet__actions {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.td-sheet__del {
  flex: 0 0 190rpx;
  height: 92rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  background: var(--ui-raise-2);
  color: var(--ui-amber-800);
}

.td-sheet__save {
  flex: 1;
  height: 92rpx;
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  font-weight: 600;
  background: var(--ui-accent);
  color: var(--ui-on-accent);
}

/* 附图来源弹层 */
.photo-sheet {
  padding: 20rpx 16rpx calc(12rpx + env(safe-area-inset-bottom, 0px));
}

.photo-sheet__title {
  display: block;
  padding: 0 12rpx 16rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.photo-sheet__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-bottom: 12rpx;
  padding: 26rpx 22rpx;
  border-radius: 20rpx;
  background: var(--ui-raise-2);
  font-size: 29rpx;
  color: var(--ui-text);
}

.photo-sheet__cancel {
  margin-top: 4rpx;
  padding: 24rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 29rpx;
  color: var(--ui-text-2);
  background: var(--ui-raise-2);
}

/*
 * 系统开了「减弱动态效果」：不播动画，勾和划线直接到位。
 * JS 那边 STRIKE_TOTAL 也会变 0，不会白等 320ms。
 */
@media (prefers-reduced-motion: reduce) {
  .td__item,
  .td__check,
  .td__strike--in {
    transition: none !important;
  }

  .td__check-mark--pop,
  .td__check-mark--out,
  .td__strike--out {
    animation: none !important;
  }
}
</style>
