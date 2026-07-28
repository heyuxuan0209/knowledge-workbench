#!/usr/bin/env node
// 标题批量翻译为中文（零 npm 依赖，走 DeepSeek REST，curl 子进程）。
// 与 knowledge-workbench/backend 一致：DeepSeek（api.deepseek.com，¥1/M tokens），
// 术语表注入保证专有名词一致，全部拼进单条 user message（DeepSeek 会忽略 system role 里的背景）。
//
// key 解析顺序：process.env.DEEPSEEK_API_KEY → 向上级目录寻找 backend/.env。
// 拿不到 key 或调用失败时：降级为「原文标题」并返回 translated=false，绝不中断主流程。
//
// 作为库使用: import { translateTitles, resolveApiKey } from './translate.mjs'

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const pexec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const GLOSSARY = {
  Agent: 'Agent', 'Multi-Agent': 'Multi-Agent', RAG: 'RAG', LLM: 'LLM',
  Prompt: 'Prompt', Token: 'Token', Embedding: '嵌入', 'Fine-tuning': '微调',
  Transformer: 'Transformer', Benchmark: '基准测试', 'Open-source': '开源',
};
const CHUNK = 40;   // 每次翻译的标题条数

export function resolveApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  let dir = __dirname;
  for (let i = 0; i < 7; i++) {
    for (const cand of [join(dir, 'backend', '.env'), join(dir, '.env')]) {
      if (existsSync(cand)) {
        const m = readFileSync(cand, 'utf8').match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+)\s*$/m);
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, '');
          if (v && v !== 'your_deepseek_api_key_here') return v;
        }
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function buildPrompt(titles) {
  const glossary = Object.entries(GLOSSARY).map(([en, zh]) => `${en} -> ${zh}`).join('；');
  const list = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return [
    '把下面的英文标题逐条翻译成简洁、准确、地道的中文标题。',
    '要求：',
    '- 保留产品名 / 公司名 / 模型名 / 论文专有名词的英文原文（如 GPT-5、Claude、Gemini、LoRA 等），不要硬译；',
    '- 已经是中文的标题原样返回；',
    '- 不加书名号、不加多余标点、不解释、不扩写，只给标题本身；',
    `- 术语对照：${glossary}`,
    '',
    `严格返回一个 JSON 数组，长度必须等于 ${titles.length}，第 i 个元素是第 i 个标题的中文译文，顺序一一对应，不要任何额外文字。`,
    '',
    '待翻译标题：',
    list,
  ].join('\n');
}

function extractJsonArray(text) {
  // 容忍 ```json 包裹 / 前后杂字
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) throw new Error('响应中未找到 JSON 数组');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callDeepSeek(key, prompt) {
  const payload = JSON.stringify({
    model: 'deepseek-chat',
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  const tmp = join(mkdtempSync(join(tmpdir(), 'fd-')), 'body.json');
  writeFileSync(tmp, payload);
  const { stdout } = await pexec('curl', [
    '-sS', '--max-time', '90',
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${key}`,
    '--data-binary', `@${tmp}`,
    'https://api.deepseek.com/chat/completions',
  ], { maxBuffer: 16 * 1024 * 1024 });
  const resp = JSON.parse(stdout);
  if (resp.error) throw new Error(resp.error.message || 'DeepSeek error');
  const content = resp.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('DeepSeek 返回空内容');
  return content;
}

// 输入英文标题数组，返回 { titles_zh:[...], translated:boolean, error }
// 失败/无 key 时 titles_zh 原样回退英文，translated=false。
export async function translateTitles(titles) {
  if (!titles.length) return { titles_zh: [], translated: true, error: null };
  const key = resolveApiKey();
  if (!key) return { titles_zh: titles.slice(), translated: false, error: '未找到 DEEPSEEK_API_KEY' };

  const out = new Array(titles.length);
  let anyFail = null;
  for (let i = 0; i < titles.length; i += CHUNK) {
    const batch = titles.slice(i, i + CHUNK);
    try {
      const content = await callDeepSeek(key, buildPrompt(batch));
      const arr = extractJsonArray(content);
      for (let j = 0; j < batch.length; j++) {
        const zh = typeof arr[j] === 'string' ? arr[j].trim() : '';
        out[i + j] = zh || batch[j];
      }
    } catch (e) {
      anyFail = (e.message || String(e)).slice(0, 200);
      for (let j = 0; j < batch.length; j++) out[i + j] = batch[j];   // 回退英文
    }
  }
  return { titles_zh: out, translated: !anyFail, error: anyFail };
}

// CLI: echo '["Title A","Title B"]' | node translate.mjs
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const chunks = [];
  process.stdin.on('data', d => chunks.push(d));
  process.stdin.on('end', async () => {
    let titles;
    try { titles = JSON.parse(chunks.join('') || '[]'); }
    catch { console.error('stdin 需要是 JSON 字符串数组'); process.exit(1); }
    const r = await translateTitles(titles);
    console.log(JSON.stringify(r, null, 2));
  });
}
