// 灵感库 → 飞书多维表格 单向同步（ADR-068）：手机上可翻、复盘可引用。
// 表建在 ADR-061 复盘 base 里（与内容主表同 base，灵感表↔发布表可互相引用）。
// 机制：全量对账（diff-upsert）而非逐条追踪——ideas 量级小（≤几百），一次对账 2-3 个 API 调用，
// 幂等自愈、不需要在 sqlite 里加 record_id 列/迁移。匹配键 = 表里的 KW-ID 字段；
// 「KW更新」存 updated_at 做跳过判断。只删"有 KW-ID 但本地已不存在"的行，
// 用户在表里手动加的行（无 KW-ID）永不触碰。
// 单向先行（用户拍板）：KW 是唯一真相源；bitable 改状态回流是 Phase 2。

import { feishuFetch } from './feishu-auth.js';

const APP = 'QIlkbwmGma9Tb1sRyAicfZeEnjb'; // ADR-061 复盘 base（backfill-published 同款）
const TABLE_NAME = '灵感库';
const STATUS_ZH = { suggested: '攒着', adopted: '孵化', created: '已用', dismissed: '弃' };
const STAGE_ZH = { seedling: '幼苗', ready: '可写', topic: '已成主题', writing: '在写' };
const TIME_ZH = { hot: '·趁热', stale: '·可能过期', normal: '' };

let tableIdCache = null;

async function ensureTable() {
  if (tableIdCache) return tableIdCache;
  const list = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables`, { query: { page_size: 100 } });
  const hit = (list.items || []).find(t => t.name === TABLE_NAME);
  if (hit) { tableIdCache = hit.table_id; return tableIdCache; }
  const created = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables`, {
    method: 'POST',
    body: {
      table: {
        name: TABLE_NAME,
        default_view_name: '全部灵感',
        fields: [
          { field_name: '灵感', type: 1 },                     // 主字段：那句"要写什么"
          { field_name: '感想/正文', type: 1 },
          { field_name: '状态', type: 3, property: { options: Object.values(STATUS_ZH).map(name => ({ name })) } },
          { field_name: '火候', type: 1 },
          { field_name: '挂料数', type: 2, property: { formatter: '0' } },
          { field_name: '来源链接', type: 15 },
          { field_name: '来源类型', type: 1 },
          { field_name: '创建时间', type: 5, property: { date_formatter: 'yyyy/MM/dd' } },
          { field_name: 'KW-ID', type: 1 },
          { field_name: 'KW更新', type: 1 },
        ],
      },
    },
  });
  tableIdCache = created.table_id;
  console.log(`[bitable-ideas] 已在复盘 base 创建「${TABLE_NAME}」表: ${tableIdCache}`);
  return tableIdCache;
}

// bitable 文本字段读回来可能是分段数组 [{text}]，统一还原成字符串
const asText = (v) => Array.isArray(v) ? v.map(s => s?.text || '').join('') : (v == null ? '' : String(v));

async function listAllRecords(tableId) {
  const out = [];
  let pageToken = null;
  do {
    const q = { page_size: 500 };
    if (pageToken) q.page_token = pageToken;
    const j = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${tableId}/records`, { query: q });
    out.push(...(j.items || []));
    pageToken = j.has_more ? j.page_token : null;
  } while (pageToken);
  return out;
}

function toFields(idea) {
  const r = idea.readiness || {};
  const sourceUrl = typeof idea.source_ref === 'string' && /^https?:\/\//.test(idea.source_ref) ? idea.source_ref : null;
  const created = idea.created_at ? new Date(`${idea.created_at.replace(' ', 'T')}Z`).getTime() : null;
  return {
    '灵感': idea.title || '(无题)',
    '感想/正文': (idea.body || '').slice(0, 2000),
    '状态': STATUS_ZH[idea.status] || '攒着',
    '火候': `${STAGE_ZH[r.stage] || ''}${TIME_ZH[r.timeliness] || ''}` || '—',
    '挂料数': (idea.supporting_notes?.length || 0) + (idea.supporting_contents?.length || 0),
    ...(sourceUrl ? { '来源链接': { link: sourceUrl, text: '来源' } } : {}),
    '来源类型': idea.source_kind || 'user',
    ...(created ? { '创建时间': created } : {}),
    'KW-ID': idea.id,
    'KW更新': idea.updated_at || '',
  };
}

// 全量对账：新增/更新/删除三向 diff。返回统计。飞书未配置时静默跳过。
export async function reconcileIdeasToBitable() {
  const { listIdeas } = await import('../db/ideas.js');
  const { annotateReadiness } = await import('./idea-readiness.js');
  const ideas = annotateReadiness(listIdeas({ includeDismissed: true, limit: 500 }));

  const tableId = await ensureTable();
  const records = await listAllRecords(tableId);
  const byKwId = new Map();
  for (const rec of records) {
    const kwId = asText(rec.fields?.['KW-ID']);
    if (kwId) byKwId.set(kwId, rec); // 无 KW-ID 的行是用户手动加的，永不触碰
  }

  let created = 0, updated = 0, deleted = 0;
  for (const idea of ideas) {
    const rec = byKwId.get(idea.id);
    byKwId.delete(idea.id);
    if (!rec) {
      await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${tableId}/records`, {
        method: 'POST', body: { fields: toFields(idea) },
      });
      created++;
    } else if (asText(rec.fields?.['KW更新']) !== (idea.updated_at || '')) {
      await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${tableId}/records/${rec.record_id}`, {
        method: 'PUT', body: { fields: toFields(idea) },
      });
      updated++;
    }
  }
  for (const [, rec] of byKwId) { // 本地已删的灵感 → 表里同步删
    await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${tableId}/records/${rec.record_id}`, { method: 'DELETE' });
    deleted++;
  }
  if (created + updated + deleted) console.log(`[bitable-ideas] 对账完成：+${created} ~${updated} -${deleted}`);
  return { created, updated, deleted, total: ideas.length };
}

// 防抖调度：灵感有变动的路由调它即可（30s 内合并多次变动为一次对账），失败只记日志。
let timer = null;
export function scheduleIdeasBitableSync(delayMs = 30_000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    reconcileIdeasToBitable().catch(e => console.warn('[bitable-ideas] 同步失败（下轮定时兜底）:', e.message));
  }, delayMs);
}
