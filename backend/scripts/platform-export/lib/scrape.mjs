// 页面抓表 + CSV 落盘——给「后台没有导出按钮」的平台（视频号肯定没有、抖音可能没有）兜底。
// 硬约束（工单）：只读「当前页面已经渲染出来的表格」，不翻页、不扫库、不打接口爬。
//
// 为什么走 DOM 文本而不是抓 XHR：与 xhs/mp 一致的哲学——最稳的是「人眼在页面上看到的那份数据」，
// 后台改版接口漂了但只要页面还渲染成表，文本抓取就还在。抓不到就 snap+抛「卡在哪一步」，不硬猜。
import fs from 'fs';

// 在浏览器里把「像表格的结构」读成 { headers, rows }。
// 兼容三种：语义 <table>、ARIA role="table"/"grid"、以及常见 div 表格（抖音/视频号多是 React/Vue 自绘）。
// 返回候选里「数据行最多」的那张——后台一个页面常有多张表（概览小卡 + 明细大表），要的是明细那张。
export async function extractTable(page) {
  return await page.evaluate(() => {
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

    // 收集一张表：给定「行元素数组」和「取一行内单元格」的函数
    function harvest(rowEls, cellsOf) {
      const rows = rowEls.map((r) => cellsOf(r).map((c) => clean(c.innerText || c.textContent)));
      return rows.filter((cells) => cells.some((x) => x)); // 丢全空行
    }

    const candidates = [];

    // 1) 语义 <table>
    for (const t of document.querySelectorAll('table')) {
      const trs = [...t.querySelectorAll('tr')];
      if (!trs.length) continue;
      const grid = harvest(trs, (tr) => [...tr.querySelectorAll('th,td')]);
      if (grid.length >= 2) candidates.push(grid);
    }

    // 2) ARIA role 表格 / 网格
    for (const t of document.querySelectorAll('[role="table"],[role="grid"]')) {
      const trs = [...t.querySelectorAll('[role="row"]')];
      if (!trs.length) continue;
      const grid = harvest(trs, (tr) => [...tr.querySelectorAll('[role="columnheader"],[role="cell"],[role="gridcell"]')]);
      if (grid.length >= 2) candidates.push(grid);
    }

    // 3) div 自绘表格：找「类名里带 table/list/row」的容器里重复的 row 结构
    if (!candidates.length) {
      const rowNodes = [...document.querySelectorAll(
        '[class*="table-row"],[class*="tableRow"],[class*="list-row"],[class*="content-row"],[class*="data-row"]',
      )];
      if (rowNodes.length >= 2) {
        const grid = harvest(rowNodes, (r) => {
          const cells = [...r.children].filter((c) => clean(c.innerText || c.textContent));
          return cells.length ? cells : [r];
        });
        if (grid.length >= 2) candidates.push(grid);
      }
    }

    if (!candidates.length) return null;
    // 选数据行最多的一张
    const best = candidates.sort((a, b) => b.length - a.length)[0];
    return { headers: best[0], rows: best.slice(1) };
  });
}

// 把 { headers, rows } 压成对象数组（表头文本作 key）。
export function rowsToObjects({ headers, rows }) {
  return rows.map((cells) => {
    const o = {};
    headers.forEach((h, i) => { o[clean(h)] = cells[i] ?? ''; });
    return o;
  });
}
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

// 标准列 → 该平台表头里可能的叫法（关键词，命中即映射）。发布时间是匹配主键，务必抓准。
// 命中策略：表头文本「包含」任一关键词即算这一列。找不到就留空（不瞎填）。
export const STD_COLUMNS = [
  { key: '标题', aliases: ['标题', '作品名称', '作品', '视频标题', '名称', '内容'] },
  { key: '发布时间', aliases: ['发布时间', '发表时间', '时间', '日期'] },
  { key: '曝光/播放量', aliases: ['播放量', '播放', '曝光', '展现', '观看'] },
  { key: '点赞', aliases: ['点赞', '赞'] },
  { key: '评论', aliases: ['评论'] },
  { key: '收藏', aliases: ['收藏'] },
  { key: '分享/转发', aliases: ['分享', '转发'] },
  { key: '涨粉', aliases: ['涨粉', '新增粉丝', '粉丝增量', '关注增量', '新增关注'] },
];

// 把抓到的对象数组按 STD_COLUMNS 归一到标准列。headers 里的原始叫法拿去逐列匹配。
// 返回 { columns:[标准列key], records:[{标准列key:值}] }。一列都没匹配上时保留原始表，避免丢数据。
export function normalizeToStd(objects) {
  if (!objects.length) return { columns: STD_COLUMNS.map((c) => c.key), records: [] };
  const rawKeys = Object.keys(objects[0]);
  // 每个标准列挑一个原始表头
  const pick = {};
  for (const col of STD_COLUMNS) {
    const hit = rawKeys.find((rk) => col.aliases.some((a) => rk.includes(a)));
    if (hit) pick[col.key] = hit;
  }
  const matched = Object.keys(pick).length;
  if (matched < 2) {
    // 表头对不上（改版了）——不硬映射，原样落盘让人/云端 Claude 判断
    return { columns: rawKeys, records: objects, raw: true };
  }
  const records = objects.map((o) => {
    const r = {};
    for (const col of STD_COLUMNS) r[col.key] = pick[col.key] ? o[pick[col.key]] : '';
    return r;
  });
  return { columns: STD_COLUMNS.map((c) => c.key), records };
}

// 写 CSV（UTF-8 带 BOM，Excel/飞书打开中文不乱码）。字段按 RFC4180 转义。
export function writeCsv(path, columns, records) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(esc).join(',')];
  for (const rec of records) lines.push(columns.map((c) => esc(rec[c])).join(','));
  fs.writeFileSync(path, '﻿' + lines.join('\r\n'), 'utf8');
  return path;
}
