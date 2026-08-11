#!/usr/bin/env node
/**
 * 发布记录一致性巡检
 *
 * 起因（2026-08-08）：说话篇的 D7曝光=1122 < D3曝光=1452——曝光只增不减，这是误填
 * （把 D1 的数填进了 D7 格）。用户要求把这类检查自动化，别等人肉发现。
 *
 * 用法：
 *   node backend/scripts/publish-record-audit.mjs           # 只报告
 *   node backend/scripts/publish-record-audit.mjs --json    # 机器可读
 *
 * 退出码：0=无异常，1=有异常（便于 cron 判断要不要推送）
 */
import 'dotenv/config';
import { feishuFetch } from '../src/services/feishu-auth.js';

const APP = process.env.KW_BITABLE_APP || 'QIlkbwmGma9Tb1sRyAicfZeEnjb';
const TABLE = process.env.KW_PUBLISH_TABLE || 'tblL11CZzfQSxIy9';
const DAY = 86400_000;

const txt = (v) => Array.isArray(v) ? v.map(o => (o && o.text) ? o.text : o).join('') : v;

async function fetchAll() {
  let pageToken, out = [];
  do {
    const r = await feishuFetch(`/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      query: { page_size: 100, page_token: pageToken },
    });
    (r.items || []).forEach((x) => out.push(x));
    pageToken = r.has_more ? r.page_token : undefined;
  } while (pageToken);
  return out;
}

/** 曝光/涨粉这类累计量只增不减；点击率/互动率是 0-1 的比率 */
function auditRecord(rec, now) {
  const f = rec.fields || {};
  const issues = [];
  const title = txt(f['平台化标题']) || '(无标题)';
  const plat = f['平台'] || '?';
  const t = f['发布时间'] || 0;
  const age = t ? (now - t) / DAY : null;
  const tag = `[${plat}] ${String(title).slice(0, 26)}`;

  const D = ['D3', 'D7', 'D30'];
  const due = { D3: 3, D7: 7, D30: 30 };

  // ① 累计量倒退（容忍 2% 以内的平台自身修正）
  for (const key of ['曝光', '涨粉']) {
    const vals = D.map((d) => ({ d, v: f[`${d}${key}`] })).filter((x) => x.v != null);
    for (let i = 1; i < vals.length; i++) {
      if (vals[i].v < vals[i - 1].v * 0.98) {
        issues.push({
          level: 'error', type: '累计量倒退', tag,
          msg: `${vals[i].d}${key}=${vals[i].v} < ${vals[i - 1].d}${key}=${vals[i - 1].v}（${key}只增不减，多半是把早期快照填进了后期格）`,
          record_id: rec.record_id, field: `${vals[i].d}${key}`,
        });
      }
    }
  }

  // ② 提前填写（容忍 1 天内的提前收数，只报明显填错时点的）
  if (age != null) {
    for (const d of D) {
      if (f[`${d}曝光`] != null && age < due[d] - 1) {
        issues.push({
          level: 'error', type: '提前填写', tag,
          msg: `${d}曝光 已填，但发布至今仅 ${age.toFixed(1)} 天（未满 ${due[d]} 天）——这一格装的多半是更早时点的数`,
          record_id: rec.record_id, field: `${d}曝光`,
        });
      }
    }
  }

  // ③ 比率口径错（点击率/互动率应是 0-1 的小数，>1 说明填成了百分数）
  for (const d of D) {
    for (const key of ['点击率', '互动率']) {
      const v = f[`${d}${key}`];
      if (v != null && v > 1) {
        issues.push({
          level: 'error', type: '比率口径', tag,
          msg: `${d}${key}=${v}（应为 0-1 小数，>1 多半是把 14.3% 填成了 14.3）`,
          record_id: rec.record_id, field: `${d}${key}`,
        });
      }
    }
  }

  // ④ 曝光为 0 却有互动
  for (const d of D) {
    const exp = f[`${d}曝光`], rate = f[`${d}互动率`];
    if (exp === 0 && rate) {
      issues.push({ level: 'warn', type: '零曝光有互动', tag, msg: `${d}曝光=0 但 ${d}互动率=${rate}`, record_id: rec.record_id });
    }
  }

  // ⑤ 到期未回收——只盯真正在做数据复盘的两个平台，别被 X/知乎 的噪音淹掉
  // 只提醒「刚到期不久」的（14 天内），更早的属于历史欠账、天天报也不会去补
  const TRACKED = ['小红书', '公众号'];
  if (age != null && TRACKED.includes(plat)) {
    for (const d of D) {
      const overdue = age - due[d];
      if (overdue >= 0 && overdue <= 14 && f[`${d}曝光`] == null) {
        issues.push({
          level: 'warn', type: '到期未回收', tag,
          msg: `已发布 ${age.toFixed(0)} 天（${d} 到期 ${overdue.toFixed(0)} 天），${d}曝光 仍为空`,
          record_id: rec.record_id, field: `${d}曝光`,
        });
      }
    }
  }

  return issues;
}

const asJson = process.argv.includes('--json');
// --notify：只在发现「数据不自洽」时推「KW · 数据复盘」群。到期未回收由 loop-data-recall.sh 负责，这里不重复推。
const notify = process.argv.includes('--notify');
const REVIEW_CHAT = process.env.KW_REVIEW_CHAT_ID || 'oc_1cce937115d3a6771d9dd3d497e0be3b';
const now = Date.now();
const records = await fetchAll();
const issues = records.flatMap((r) => auditRecord(r, now));

if (notify) {
  const errs = issues.filter((i) => i.level === 'error');
  if (!errs.length) {
    console.log(`[${new Date().toISOString()}] 巡检通过，${records.length} 条无不自洽，不推送`);
    process.exit(0);
  }
  const lines = errs.map((i) => `• ${i.tag}\n  ${i.type}：${i.msg}`).join('\n\n');
  const text = `发布记录巡检发现 ${errs.length} 处数据不自洽（共 ${records.length} 条）：\n\n${lines}\n\n改完可以跑一次 node backend/scripts/publish-record-audit.mjs 复核。`;
  await feishuFetch('/open-apis/im/v1/messages', {
    method: 'POST',
    query: { receive_id_type: 'chat_id' },
    body: { receive_id: REVIEW_CHAT, msg_type: 'text', content: JSON.stringify({ text }) },
  });
  console.log(`[${new Date().toISOString()}] 已推送 ${errs.length} 处不自洽`);
  process.exit(1);
}

if (asJson) {
  console.log(JSON.stringify({ checked: records.length, issues }, null, 2));
} else {
  const errs = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  console.log(`发布记录巡检：共 ${records.length} 条，异常 ${errs.length} 项，提醒 ${warns.length} 项\n`);
  if (errs.length) {
    console.log('❌ 需要修（数据不自洽）');
    errs.forEach((i) => console.log(`  · ${i.tag}\n      ${i.type}：${i.msg}`));
    console.log();
  }
  if (warns.length) {
    console.log('⚠️ 提醒（该收数了）');
    const byType = {};
    warns.forEach((i) => (byType[i.type] ||= []).push(i));
    for (const [type, list] of Object.entries(byType)) {
      console.log(`  【${type}】${list.length} 条`);
      list.slice(0, 12).forEach((i) => console.log(`    · ${i.tag} — ${i.msg}`));
      if (list.length > 12) console.log(`    …还有 ${list.length - 12} 条`);
    }
  }
  if (!issues.length) console.log('✅ 全部自洽，没有该收未收的。');
}

process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
