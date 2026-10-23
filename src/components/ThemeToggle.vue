<script setup>
import { getCurrentInstance, ref } from 'vue'
import CircularRevealLayer from './CircularRevealLayer.vue'
import { useTheme } from '../composables/useTheme'

// 主题切换：触发器是「半明半暗」的圆点按钮，**点一下直接翻面**（不弹菜单）。
//
// 演变记录（别再改回去）：
//   2026-10-08 曾改成"点开企微式浮层、两项里选"（浅色 / 深色，当前项打勾），
//     理由是"开关只能靠图标朝向猜现在哪套，浮层能把当前项明确标出来"。
//   2026-10-09 使用方要求改回直接切换：主题这件事**界面本身就是答案** ——
//     整个页面已经是深色还是浅色一目了然，为了"确认当前是哪套"多付一次点击与一次
//     浮层开关的动画，在车间里是净损失。所以退回一键切换。
//
// 为什么圆点不引图标字体（而用 CSS 画）：wot 的图标集里没有太阳/月亮，而用 emoji 或
// 中文字形在不同机型上差异太大 —— 半明半暗的圆点是「光照 / 对比度」的通用隐喻，
// 与触发器同一个隐喻（全局类 .theme-dot 见 App.vue）。两半都填色，所以轮廓是完整正圆，
// 浅色下再转半圈（见 .theme-dot.is-light）。

// 顶栏与登录页共用本组件，所以两处入口一起改：调用方模板一个字都不用动。
const { isLight, toggleTheme } = useTheme()

/*
 * 圆形揭露（2026-10-23，变更-170 续）。
 * 使用方：「把红色框选出的按钮（深浅色切换）也做成扩散的效果，微信小程序也是」。
 * 与配色按钮共用同一个揭露层组件，所以两处的圆心、半径、缓动完全一致。
 *
 * 拿不到节点几何时立即切换（无动画），绝不出现"点了没反应"。
 */
const instance = getCurrentInstance()?.proxy
const layerRef = ref(null)
const busy = ref(false)

async function onClick() {
  if (busy.value) return
  busy.value = true
  try {
    // 圆里滚的是**新主题**：切换由揭露层在合适的时机执行（有 VT 时在 VT 回调里）
    await layerRef.value?.revealFrom({
      selector: '.theme-toggle',
      instance,
      switchNow: toggleTheme,
      targetColor: isLight.value ? '#191320' : '#FFFAF6',
    })
  } catch {
    toggleTheme()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    class="theme-toggle"
    :aria-label="isLight ? '切换到深色主题' : '切换到浅色主题'"
    @click="onClick"
  >
    <view class="theme-dot" :class="{ 'is-light': isLight }"></view>
  </button>

  <!-- 圆形揭露层（公用件）：从按钮中心扩散铺满，铺满后翻深浅 -->
  <CircularRevealLayer ref="layerRef" />
</template>

<style lang="scss" scoped>
.theme-toggle {
  display: flex;
  width: 84rpx;
  height: 84rpx;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid $ui-border;
  border-radius: 26rpx;
  background-color: $ui-raise;
  transition: background-color $ui-dur $ui-ease, transform 160ms $ui-ease;

  // 小程序 button 自带 ::after 描边，不清掉胶囊边上会多一条灰线
  &::after {
    border: 0;
  }

  &:active {
    transform: scale(0.94);
    background-color: $ui-surface-3;
  }
}
</style>
