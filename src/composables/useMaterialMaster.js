import { ref } from 'vue'
import request from '../api/request'

// ===== 物料主数据（模块级单例）=====
// 图片解析用：按识别出的物料名称反查编码，并把单位一并带出。
//
// ⚠️ 前端【不做】任何归一化、不做模糊匹配、不做候选排序 —— 规则只保留后端一份
// （hnd_factory 的 MaterialMatcher）。否则前后端会各自演化出不同的判定，
// 出现「页面上看着匹配上了、后端校验却拒了」这类难查的分歧。
//
// 2026-10-23（变更-159）主数据涨到 30,434 行后新增三条：
//   · pageMaterials() —— 物料选择器的分页查询（服务端筛选，不再一次拉 30 条）；
//   · fetchMaterialFacets() —— 选择器顶部的类型胶囊与计数；
//   · fetchMaterialDetail() —— 罐类物料的评估类型价格表（展开「N 种状态价」用）。

export const materialLookupError = ref('')

function extractError(error, fallback) {
  if (error?.response?.status === 404) {
    return '物料主数据接口不存在，请确认后端已上线 /api/material/*。'
  }
  return error?.response?.data?.msg || error?.message || fallback
}

/** 后端统一返回体 {code,msg,data,success}：业务失败也是 HTTP 200，必须显式判 */
function assertOk(body, fallback) {
  if (body?.success === false || (body?.code != null && body.code !== 200)) {
    throw new Error(body?.msg || fallback)
  }
}

/**
 * 按物料名称匹配编码。
 *
 * @returns {{ matched: object|null, candidates: object[], failed: boolean }}
 *   matched 仅在「归一化后全等且唯一命中」时非空；查不到或多条命中一律为 null，
 *   由 candidates 供人工选择。failed 表示接口调用本身失败（与「没查到」是两回事，
 *   调用方需要区分，否则会误以为「主数据里就是没有」）。
 */
export async function matchMaterial(name) {
  const keyword = String(name ?? '').trim()
  if (!keyword) {
    return { matched: null, candidates: [], failed: false }
  }

  try {
    const res = await request.get('/api/material/match', { params: { name: keyword } })
    const body = res.data || {}
    assertOk(body, '物料匹配接口返回异常。')

    const data = body.data || {}
    return {
      matched: data.matched || null,
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      failed: false,
    }
  } catch (error) {
    materialLookupError.value = extractError(error, '物料匹配失败。')
    return { matched: null, candidates: [], failed: true }
  }
}

/** 人工检索物料（编码单元格的搜索框用；旧的 20 条上限版，保留给既有调用点） */
export async function searchMaterials(keyword, limit = 20) {
  const text = String(keyword ?? '').trim()
  if (!text) {
    return []
  }

  try {
    const res = await request.get('/api/material/search', { params: { keyword: text, limit } })
    const body = res.data || {}
    assertOk(body, '物料检索接口返回异常。')
    return Array.isArray(body.data) ? body.data : []
  } catch (error) {
    materialLookupError.value = extractError(error, '物料检索失败。')
    return []
  }
}

/**
 * 物料选择器分页查询（与 PC 物料主数据页同一套接口，服务端筛选）。
 *
 * @param {{keyword?:string,type?:string,pageNum?:number,pageSize?:number}} params
 * @returns {{ rows: object[], total: number, failed: boolean }}
 */
export async function pageMaterials(params = {}) {
  const query = { pageNum: params.pageNum || 1, pageSize: params.pageSize || 30 }
  const keyword = String(params.keyword ?? '').trim()
  if (keyword) query.keyword = keyword
  if (params.type) query.type = params.type

  try {
    const res = await request.get('/api/material/page', { params: query })
    const body = res.data || {}
    assertOk(body, '物料查询接口返回异常。')
    return {
      rows: Array.isArray(body.dataList) ? body.dataList : [],
      total: Number(body.total) || 0,
      failed: false,
    }
  } catch (error) {
    materialLookupError.value = extractError(error, '物料查询失败。')
    return { rows: [], total: 0, failed: true }
  }
}

/** 选择器的类型胶囊与计数（与当前关键词无关，一次取回即可） */
export async function fetchMaterialFacets() {
  try {
    const res = await request.get('/api/material/facets')
    const body = res.data || {}
    assertOk(body, '物料计数接口返回异常。')
    return body.data || { total: 0, types: [], statuses: [] }
  } catch {
    // 计数是辅助信息：取不到就不显示数字，不影响选择
    return { total: 0, types: [], statuses: [] }
  }
}

/** 物料详情（罐类物料的价格表）：选择器里展开「N 种状态价」用 */
export async function fetchMaterialDetail(code) {
  try {
    const res = await request.get('/api/material/detail', { params: { code } })
    const body = res.data || {}
    assertOk(body, '物料详情接口返回异常。')
    return body.data || null
  } catch (error) {
    materialLookupError.value = extractError(error, '物料详情加载失败。')
    return null
  }
}

export function useMaterialMaster() {
  return {
    materialLookupError,
    matchMaterial,
    searchMaterials,
    pageMaterials,
    fetchMaterialFacets,
    fetchMaterialDetail,
  }
}
