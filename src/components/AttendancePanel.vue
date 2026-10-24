<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useToast } from 'wot-design-uni'
import request from '../api/request'
import { hasPerm } from '../api/auth'

/*
 * 个人考勤（2026-10-24，变更-171）。
 *
 * 使用方的用法是**事后录入 + 和人事对账**（他不在这打卡），所以这页是"台账"不是打卡器：
 *   · 打开就是**整月填好**的月历（后端按"周一到周五 + 每月最后一个周六 = 工作日；
 *     其余周末与法定节假日 = 休息"补的默认值），他只改有变动的那几天；
 *   · 工作日 2 段（上班/下班）、休息日加班 4 段（上午上班/午休/下午上班/下午下班）；
 *   · **不算迟到早退**，迟了早了就按段标"忘打卡"（他的原话）；
 *   · 调休 = 工作日被公司安排休息的另一种类型。
 *
 * 所有默认规则与统计口径都在**后端**（`/api/attendance/month` 返回整月 + 统计），
 * 这边不自己算 —— 否则 App 和将来的 PC 看板会出现两套口径。
 */

const toast = useToast()
const canEdit = computed(() => hasPerm('attendance:edit') || hasPerm('admin'))

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const TYPE_LABELS = {
  work: '工作日',
  overtime: '休息日加班',
  rest: '休息',
  comp: '调休',
}

const month = ref('')
const days = ref([])
const summary = reactive({
  workDays: 0,
  overtimeDays: 0,
  restDays: 0,
  compDays: 0,
  totalMinutes: 0,
  missCount: 0,
  incompleteDays: 0,
})
const loading = ref(false)
const loadError = ref('')

/*
 * 默认时间（2026-10-24，变更-171 续）。
 *
 * 使用方给的标准作息：08:00 上班、12:00-13:30 午休、17:30 下班 ⇒ 一个工作日 **8 小时**。
 * 首次打开某月时后端就按这套把工作日铺好（所以打开是"出勤 19 天"而不是"缺段 19 天"）。
 * 这里只负责"改这套默认值"，改完只影响之后新生成的月份。
 */
const settings = reactive({
  workStart: '08:00',
  workEnd: '17:30',
  lunchStart: '12:00',
  lunchEnd: '13:30',
  standardMinutes: 480,
})
const settingsOpen = ref(false)
const settingsSaving = ref(false)
const settingsError = ref('')
const settingsForm = reactive({ workStart: '', workEnd: '', lunchStart: '', lunchEnd: '' })

function openSettings() {
  settingsForm.workStart = settings.workStart
  settingsForm.workEnd = settings.workEnd
  settingsForm.lunchStart = settings.lunchStart
  settingsForm.lunchEnd = settings.lunchEnd
  settingsError.value = ''
  settingsOpen.value = true
}

async function saveSettings() {
  if (settingsSaving.value) return
  settingsError.value = ''
  const times = {
    workStart: normalizeTime(settingsForm.workStart),
    workEnd: normalizeTime(settingsForm.workEnd),
    lunchStart: normalizeTime(settingsForm.lunchStart),
    lunchEnd: normalizeTime(settingsForm.lunchEnd),
  }
  for (const [key, value] of Object.entries(times)) {
    if (!value) {
      settingsError.value = '时间格式应为 08:00'
      return
    }
  }
  settingsSaving.value = true
  try {
    const res = await request.post('/api/attendance/settings', times)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')
    toast.success('默认时间已保存')
    settingsOpen.value = false
    loadMonth()
  } catch (e) {
    settingsError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    settingsSaving.value = false
  }
}

function todayMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function shiftMonth(delta) {
  const [y, m] = month.value.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  loadMonth()
}

async function loadMonth() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await request.get('/api/attendance/month', { params: { month: month.value } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '加载失败')
    const data = body.data || {}
    days.value = Array.isArray(data.days) ? data.days : []
    summary.workDays = data.workDays || 0
    summary.overtimeDays = data.overtimeDays || 0
    summary.restDays = data.restDays || 0
    summary.compDays = data.compDays || 0
    summary.totalMinutes = data.totalMinutes || 0
    summary.missCount = data.missCount || 0
    summary.incompleteDays = data.incompleteDays || 0
    if (data.settings) {
      settings.workStart = (data.settings.workStart || '08:00').slice(0, 5)
      settings.workEnd = (data.settings.workEnd || '17:30').slice(0, 5)
      settings.lunchStart = (data.settings.lunchStart || '12:00').slice(0, 5)
      settings.lunchEnd = (data.settings.lunchEnd || '13:30').slice(0, 5)
      settings.standardMinutes = data.settings.standardMinutes || 480
    }
  } catch (e) {
    loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
    days.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  month.value = todayMonth()
  loadMonth()
})

// ===== 月历格子（周一起始）=====
const grid = computed(() => {
  if (!days.value.length) return []
  const first = days.value[0].workDate // YYYY-MM-DD
  const [y, m] = first.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay() // 0=周日
  const pad = (firstDow + 6) % 7 // 周一起始 ⇒ 周一=0
  const cells = []
  for (let i = 0; i < pad; i += 1) cells.push(null)
  for (const d of days.value) cells.push(d)
  return cells
})

function dowOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

function timesOf(day) {
  const out = []
  if (day.amIn) out.push(day.amIn.slice(0, 5))
  if (day.amOut) out.push(day.amOut.slice(0, 5))
  if (day.pmIn) out.push(day.pmIn.slice(0, 5))
  if (day.pmOut) out.push(day.pmOut.slice(0, 5))
  return out
}

function missCountOf(day) {
  return [day.missAmIn, day.missAmOut, day.missPmIn, day.missPmOut].filter(Boolean).length
}

function cellTone(day) {
  if (day.dayType === 'overtime') return 'is-overtime'
  if (day.dayType === 'rest') return 'is-rest'
  if (day.dayType === 'comp') return 'is-comp'
  return timesOf(day).length ? 'is-work' : 'is-work-empty'
}

function minutesText(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m} 分`
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
}

// ===== 编辑 =====
const editorOpen = ref(false)
const saving = ref(false)
const formError = ref('')
const form = reactive({
  workDate: '',
  dayType: 'work',
  amIn: '',
  amOut: '',
  pmIn: '',
  pmOut: '',
  missAmIn: false,
  missAmOut: false,
  missPmIn: false,
  missPmOut: false,
  note: '',
  persisted: false,
})

function openDay(day) {
  if (!day) return
  form.workDate = day.workDate
  form.dayType = day.dayType
  form.amIn = day.amIn ? day.amIn.slice(0, 5) : ''
  form.amOut = day.amOut ? day.amOut.slice(0, 5) : ''
  form.pmIn = day.pmIn ? day.pmIn.slice(0, 5) : ''
  form.pmOut = day.pmOut ? day.pmOut.slice(0, 5) : ''
  form.missAmIn = Boolean(day.missAmIn)
  form.missAmOut = Boolean(day.missAmOut)
  form.missPmIn = Boolean(day.missPmIn)
  form.missPmOut = Boolean(day.missPmOut)
  form.note = day.note || ''
  form.persisted = Boolean(day.persisted)
  formError.value = ''
  editorOpen.value = true
}

const needsTimes = computed(() => form.dayType === 'work' || form.dayType === 'overtime')
const isOvertime = computed(() => form.dayType === 'overtime')

function pickType(type) {
  form.dayType = type
  if (type === 'rest' || type === 'comp') {
    form.amIn = ''
    form.amOut = ''
    form.pmIn = ''
    form.pmOut = ''
    form.missAmIn = false
    form.missAmOut = false
    form.missPmIn = false
    form.missPmOut = false
  }
  if (type === 'work') {
    form.pmIn = ''
    form.pmOut = ''
    form.missPmIn = false
    form.missPmOut = false
  }
  /*
   * 切到「休息日加班」：按标准作息把 4 段预填好
   * （使用方：「休息日加班时间是 8:00-12:00、13:30-17:30，和平常一样，
   *   只不过加班日人事要查午休卡」）⇒ 上午 上班→午休、下午 上班→下班 各一段。
   */
  if (type === 'overtime' && !form.amIn && !form.amOut) {
    form.amIn = settings.workStart
    form.amOut = settings.lunchStart
    form.pmIn = settings.lunchEnd
    form.pmOut = settings.workEnd
  }
}

/** "8:5" → "08:05"；非法返回 '' */
function normalizeTime(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  const m = s.match(/^(\d{1,2})[:：.]?(\d{1,2})?$/)
  if (!m) return ''
  const h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (h > 23 || min > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

async function save() {
  if (saving.value) return
  formError.value = ''
  const payload = {
    workDate: form.workDate,
    dayType: form.dayType,
    amIn: needsTimes.value ? normalizeTime(form.amIn) || null : null,
    amOut: needsTimes.value ? normalizeTime(form.amOut) || null : null,
    pmIn: isOvertime.value ? normalizeTime(form.pmIn) || null : null,
    pmOut: isOvertime.value ? normalizeTime(form.pmOut) || null : null,
    missAmIn: needsTimes.value ? form.missAmIn : false,
    missAmOut: needsTimes.value ? form.missAmOut : false,
    missPmIn: isOvertime.value ? form.missPmIn : false,
    missPmOut: isOvertime.value ? form.missPmOut : false,
    note: form.note || '',
  }

  // 填了但格式不对 ⇒ 明确报错，不要静默丢掉
  const typed = [
    ['上班', form.amIn],
    ['下班', form.amOut],
    ['下午上班', form.pmIn],
    ['下午下班', form.pmOut],
  ]
  for (const [label, raw] of typed) {
    if (String(raw ?? '').trim() && !normalizeTime(raw)) {
      formError.value = `${label}时间格式应为 08:30`
      return
    }
  }

  saving.value = true
  try {
    const res = await request.post('/api/attendance/save', payload)
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '保存失败')
    toast.success('已保存')
    editorOpen.value = false
    loadMonth()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function removeDay() {
  const ok = await new Promise((resolve) => {
    uni.showModal({
      title: '清除这一天',
      content: `清除 ${form.workDate} 的记录？会回到默认值。`,
      success: (r) => resolve(Boolean(r.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!ok) return
  try {
    const res = await request.delete('/api/attendance/day', { params: { date: form.workDate } })
    const body = res.data || {}
    if (body.success === false) throw new Error(body.msg || '清除失败')
    toast.success('已清除')
    editorOpen.value = false
    loadMonth()
  } catch (e) {
    formError.value = e?.response?.data?.msg || e?.message || '清除失败'
  }
}

// ===== 复制本月（贴给人事）=====
async function copyMonth() {
  const lines = [`${month.value} 考勤`]
  for (const day of days.value) {
    if (day.dayType === 'rest') continue
    const t = timesOf(day)
    const miss = missCountOf(day)
    const parts = [day.workDate, TYPE_LABELS[day.dayType] || day.dayType, t.join(' / ') || '未录']
    if (miss) parts.push(`忘打卡 ${miss} 段`)
    if (day.note) parts.push(day.note)
    lines.push(parts.join('  '))
  }
  lines.push(
    `出勤 ${summary.workDays} 天，加班 ${summary.overtimeDays} 天，调休 ${summary.compDays} 天，合计 ${minutesText(summary.totalMinutes)}`,
  )
  try {
    uni.setClipboardData({ data: lines.join('\n') })
  } catch {
    toast.error('复制失败，请手动选择')
  }
}

const popupStyle =
  'max-height: 86vh; display: flex; flex-direction: column; background-color: var(--ui-sheet-fill);'
</script>

<template>
  <view class="at">
    <!-- 月份切换 + 汇总 -->
    <view class="at__head">
      <view class="at__month">
        <text class="at__arrow" @click="shiftMonth(-1)">‹</text>
        <text class="at__month-text">{{ month }}</text>
        <text class="at__arrow" @click="shiftMonth(1)">›</text>
      </view>
      <view class="at__actions">
        <view class="at__copy" @click="openSettings">
          <text>默认时间</text>
        </view>
        <view class="at__copy" @click="copyMonth">
          <text>复制本月</text>
        </view>
      </view>
    </view>

    <view class="at__summary">
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.workDays }}</text>
        <text class="at__sum-label">出勤</text>
      </view>
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.overtimeDays }}</text>
        <text class="at__sum-label">加班</text>
      </view>
      <view class="at__sum-item">
        <text class="at__sum-num">{{ summary.compDays }}</text>
        <text class="at__sum-label">调休</text>
      </view>
      <view class="at__sum-item at__sum-item--wide">
        <text class="at__sum-num">{{ minutesText(summary.totalMinutes) }}</text>
        <text class="at__sum-label">合计工时</text>
      </view>
    </view>

    <view v-if="summary.missCount || summary.incompleteDays" class="at__warn">
      <text v-if="summary.missCount">忘打卡 {{ summary.missCount }} 段</text>
      <text v-if="summary.incompleteDays">缺段 {{ summary.incompleteDays }} 天</text>
    </view>

    <view v-if="loadError" class="at__error" @click="loadMonth">
      <text>{{ loadError }}（点一下重试）</text>
    </view>

    <!-- 月历 -->
    <view class="at__week">
      <text v-for="w in WEEK_LABELS" :key="w" class="at__week-cell">{{ w }}</text>
    </view>

    <view class="at__grid">
      <view
        v-for="(cell, index) in grid"
        :key="cell ? cell.workDate : `pad-${index}`"
        class="at__cell"
        :class="[cell ? cellTone(cell) : 'is-pad']"
        @click="cell && openDay(cell)"
      >
        <template v-if="cell">
          <text class="at__day">{{ Number(cell.workDate.slice(-2)) }}</text>
          <view v-if="cell.dayType === 'overtime'" class="at__tag">加班</view>
          <view v-else-if="cell.dayType === 'comp'" class="at__tag">调休</view>
          <text v-if="cell.dayType !== 'rest' && timesOf(cell).length" class="at__times">
            {{ timesOf(cell).join(' ') }}
          </text>
          <text v-if="missCountOf(cell)" class="at__miss">忘{{ missCountOf(cell) }}</text>
        </template>
      </view>
    </view>

    <view class="at__hint">
      <text>默认已按「周一到周五 + 每月最后一个周六上班、法定节假日休息」填好，有变动点那天改</text>
    </view>

    <!-- 默认时间（首次生成新月份时用这套值） -->
    <wd-popup v-model="settingsOpen" position="center" round :duration="220" custom-style="width: 86%;">
      <view class="st">
        <text class="st__title">默认上下班时间</text>
        <text class="st__hint">
          标准工作日按「下班 − 上班 − 午休」算，现在每天 {{ Math.round(settings.standardMinutes / 60 * 10) / 10 }} 小时。
          只影响之后新生成的月份，已生成的不动。
        </text>

        <view v-if="settingsError" class="st__error"><text>{{ settingsError }}</text></view>

        <view class="st__row">
          <text class="st__label">上班</text>
          <input v-model="settingsForm.workStart" class="st__input" placeholder="08:00" />
        </view>
        <view class="st__row">
          <text class="st__label">午休开始</text>
          <input v-model="settingsForm.lunchStart" class="st__input" placeholder="12:00" />
        </view>
        <view class="st__row">
          <text class="st__label">午休结束</text>
          <input v-model="settingsForm.lunchEnd" class="st__input" placeholder="13:30" />
        </view>
        <view class="st__row">
          <text class="st__label">下班</text>
          <input v-model="settingsForm.workEnd" class="st__input" placeholder="17:30" />
        </view>

        <view class="st__foot">
          <view class="ed__btn ed__btn--ghost" @click="settingsOpen = false"><text>取消</text></view>
          <view class="ed__btn ed__btn--primary" :class="{ 'is-busy': settingsSaving }" @click="saveSettings">
            <text>{{ settingsSaving ? '保存中…' : '保存' }}</text>
          </view>
        </view>
      </view>
    </wd-popup>

    <!-- 编辑弹层 -->
    <wd-popup
      v-model="editorOpen"
      position="bottom"
      round
      safe-area-inset-bottom
      :duration="280"
      :custom-style="popupStyle"
    >
      <view class="ed">
        <view class="ed__grabber"></view>
        <view class="ed__head">
          <text class="ed__title">{{ form.workDate }}</text>
          <text class="ed__close" @click="editorOpen = false">关闭</text>
        </view>

        <view v-if="formError" class="ed__error"><text>{{ formError }}</text></view>

        <scroll-view class="ed__body" scroll-y>
          <view class="ed__row">
            <text class="ed__label">类型</text>
            <view class="ed__types">
              <view
                v-for="(label, key) in TYPE_LABELS"
                :key="key"
                class="ed__type"
                :class="{ 'is-on': form.dayType === key }"
                @click="pickType(key)"
              >
                <text>{{ label }}</text>
              </view>
            </view>
          </view>

          <template v-if="needsTimes">
            <view class="ed__row">
              <text class="ed__label">{{ isOvertime ? '上午上班' : '上班' }}</text>
              <input v-model="form.amIn" class="ed__input" placeholder="08:00" placeholder-style="color: var(--ui-text-3)" />
              <view class="ed__miss" :class="{ 'is-on': form.missAmIn }" @click="form.missAmIn = !form.missAmIn">
                <text>忘打</text>
              </view>
            </view>
            <view class="ed__row">
              <text class="ed__label">{{ isOvertime ? '午休' : '下班' }}</text>
              <input v-model="form.amOut" class="ed__input" placeholder="17:00" placeholder-style="color: var(--ui-text-3)" />
              <view class="ed__miss" :class="{ 'is-on': form.missAmOut }" @click="form.missAmOut = !form.missAmOut">
                <text>忘打</text>
              </view>
            </view>

            <template v-if="isOvertime">
              <view class="ed__row">
                <text class="ed__label">下午上班</text>
                <input v-model="form.pmIn" class="ed__input" placeholder="13:00" placeholder-style="color: var(--ui-text-3)" />
                <view class="ed__miss" :class="{ 'is-on': form.missPmIn }" @click="form.missPmIn = !form.missPmIn">
                  <text>忘打</text>
                </view>
              </view>
              <view class="ed__row">
                <text class="ed__label">下午下班</text>
                <input v-model="form.pmOut" class="ed__input" placeholder="17:30" placeholder-style="color: var(--ui-text-3)" />
                <view class="ed__miss" :class="{ 'is-on': form.missPmOut }" @click="form.missPmOut = !form.missPmOut">
                  <text>忘打</text>
                </view>
              </view>
            </template>
          </template>

          <view class="ed__row">
            <text class="ed__label">备注</text>
            <input v-model="form.note" class="ed__input" placeholder="请假事由等（选填）" placeholder-style="color: var(--ui-text-3)" />
          </view>
        </scroll-view>

        <view class="ed__foot">
          <view v-if="form.persisted && canEdit" class="ed__del" @click="removeDay">
            <text>清除这天</text>
          </view>
          <view class="ed__btn ed__btn--ghost" @click="editorOpen = false"><text>取消</text></view>
          <view
            v-if="canEdit"
            class="ed__btn ed__btn--primary"
            :class="{ 'is-busy': saving }"
            @click="save"
          >
            <text>{{ saving ? '保存中…' : '保存' }}</text>
          </view>
          <view v-else class="ed__btn ed__btn--disabled"><text>无编辑权限</text></view>
        </view>
      </view>
    </wd-popup>
  </view>
</template>

<style lang="scss" scoped>
.at {
  padding: 16rpx 20rpx 40rpx;
  box-sizing: border-box;
}

.at__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.at__month {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.at__arrow {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  color: var(--ui-text-2);
  border-radius: 28rpx;
  background-color: var(--ui-raise-2);
}

.at__month-text {
  font-size: 32rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__actions {
  display: flex;
  gap: 10rpx;
}

.at__copy {
  height: 56rpx;
  padding: 0 22rpx;
  border-radius: 28rpx;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);
}

.at__summary {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
}

.at__sum-item {
  flex: 1;
  padding: 14rpx 10rpx;
  border-radius: 16rpx;
  text-align: center;
  background-color: var(--ui-surface);
  border: 2rpx solid var(--ui-border);

  &--wide {
    flex: 1.6;
  }
}

.at__sum-num {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__sum-label {
  display: block;
  margin-top: 2rpx;
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.at__warn {
  display: flex;
  gap: 16rpx;
  margin-top: 12rpx;
  padding: 10rpx 16rpx;
  border-radius: 14rpx;
  font-size: 22rpx;
  color: #e6a23c;
  background-color: rgba(230, 162, 60, 0.12);
}

.at__error {
  margin-top: 12rpx;
  padding: 12rpx 16rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.at__week {
  display: flex;
  margin-top: 18rpx;
}

.at__week-cell {
  flex: 1;
  text-align: center;
  font-size: 20rpx;
  color: var(--ui-text-3);
}

.at__grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: 6rpx;
}

.at__cell {
  width: calc(100% / 7);
  min-height: 108rpx;
  padding: 6rpx 4rpx;
  box-sizing: border-box;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rpx;

  &.is-pad {
    background: transparent;
  }

  &.is-rest {
    background-color: var(--ui-raise);
    opacity: 0.55;
  }

  &.is-comp {
    background-color: rgba(230, 162, 60, 0.14);
  }

  &.is-work {
    background-color: var(--ui-surface);
    border: 2rpx solid var(--ui-border);
  }

  &.is-work-empty {
    background-color: var(--ui-surface);
    border: 2rpx dashed var(--ui-line-strong, rgba(0, 0, 0, 0.18));
  }

  &.is-overtime {
    background-color: rgba(63, 157, 107, 0.14);
    border: 2rpx solid rgba(63, 157, 107, 0.3);
  }
}

.at__day {
  font-size: 24rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.at__tag {
  font-size: 18rpx;
  line-height: 1.2;
  color: var(--ui-text-2);
}

.at__times {
  font-size: 17rpx;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text-2);
  word-break: break-all;
  text-align: center;
}

.at__miss {
  font-size: 17rpx;
  color: #e6a23c;
}

.at__hint {
  margin-top: 18rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

/* ===== 默认时间弹层 ===== */
.st {
  padding: 26rpx 28rpx calc(20rpx + env(safe-area-inset-bottom));
}

.st__title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--ui-text);
}

.st__hint {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--ui-text-3);
}

.st__error {
  margin-top: 12rpx;
  padding: 10rpx 16rpx;
  border-radius: 12rpx;
  font-size: 23rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.st__row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 12rpx 0;
}

.st__label {
  flex-shrink: 0;
  width: 130rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.st__input {
  flex: 1;
  height: 72rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
}

.st__foot {
  display: flex;
  gap: 14rpx;
  margin-top: 18rpx;
}

/* ===== 编辑弹层 ===== */
.ed {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 86vh;
}

.ed__grabber {
  width: 72rpx;
  height: 8rpx;
  margin: 12rpx auto 0;
  border-radius: 4rpx;
  background-color: var(--ui-border-strong);
}

.ed__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 28rpx 10rpx;
}

.ed__title {
  font-size: 30rpx;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
}

.ed__close {
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.ed__error {
  margin: 0 28rpx 8rpx;
  padding: 12rpx 18rpx;
  border-radius: 14rpx;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.ed__body {
  flex: 1;
  min-height: 0;
  padding: 4rpx 28rpx;
}

.ed__row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 10rpx 0;
}

.ed__label {
  flex-shrink: 0;
  width: 148rpx;
  font-size: 26rpx;
  color: var(--ui-text-2);
}

.ed__types {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.ed__type {
  height: 60rpx;
  padding: 0 20rpx;
  border-radius: 30rpx;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: var(--ui-text-2);
  background-color: var(--ui-raise-2);
  border: 2rpx solid var(--ui-border);

  &.is-on {
    color: #fff;
    background-color: var(--ui-brand, #b4551f);
    border-color: transparent;
  }
}

.ed__input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  font-size: 26rpx;
  font-variant-numeric: tabular-nums;
  color: var(--ui-text);
  background-color: var(--ui-raise);
  border: 2rpx solid var(--ui-border);
}

.ed__miss {
  flex-shrink: 0;
  height: 72rpx;
  padding: 0 18rpx;
  border-radius: 14rpx;
  display: flex;
  align-items: center;
  font-size: 22rpx;
  color: var(--ui-text-3);
  background-color: var(--ui-raise-2);
  border: 2rpx solid transparent;

  &.is-on {
    color: #e6a23c;
    border-color: rgba(230, 162, 60, 0.4);
    background-color: rgba(230, 162, 60, 0.12);
  }
}

.ed__foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 16rpx 28rpx calc(16rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid var(--ui-hairline);
  background-color: var(--ui-sheet-fill);
}

.ed__del {
  flex-shrink: 0;
  height: 76rpx;
  padding: 0 20rpx;
  border-radius: 38rpx;
  display: flex;
  align-items: center;
  font-size: 24rpx;
  color: #f56c6c;
  background-color: rgba(245, 108, 108, 0.12);
}

.ed__btn {
  height: 76rpx;
  border-radius: 38rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  font-weight: 600;

  &--ghost {
    flex: 0 0 150rpx;
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

  &--disabled {
    flex: 1;
    color: var(--ui-text-3);
    background-color: var(--ui-raise-2);
  }
}
</style>
