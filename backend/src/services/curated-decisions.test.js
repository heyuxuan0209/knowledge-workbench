import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionPrompt, evidenceFor, extractDecisionJson } from './curated-decisions.js';

test('证据分级不会把标题或极短栏目名冒充完整材料', () => {
  assert.equal(evidenceFor({ zh_body: '正文'.repeat(80), summ: '' }).status, 'full');
  assert.equal(evidenceFor({ summ: '这是包含关键事实、数字和结论的一段来源摘要，长度足够支持保守改写。' }).status, 'summary');
  assert.equal(evidenceFor({ summ: '算法与理论' }).status, 'title_only');
  assert.equal(evidenceFor({ summ: '' }).status, 'title_only');
});

test('阅读决策 Prompt 把信息完整放在个性关联之前', () => {
  const prompt = buildDecisionPrompt([{
    id: 'a', title: '模型发布', src: '官方', evidence: { status: 'summary', text: '价格下降并扩大上下文窗口。' },
  }]);
  assert.match(prompt, /发生了什么/);
  assert.match(prompt, /关键数字/);
  assert.match(prompt, /限制/);
  assert.match(prompt, /不要提 Knowledge Workbench、KW/);
  assert.match(prompt, /材料不足就判 exclude/);
});

test('模型 JSON 可带围栏或前后说明但仍按 i 解析', () => {
  const parsed = extractDecisionJson('说明\n```json\n{"items":[{"i":0,"summary":"完整摘要","verdict":"brief"}]}\n```');
  assert.equal(parsed.items[0].i, 0);
  assert.equal(parsed.items[0].verdict, 'brief');
});
