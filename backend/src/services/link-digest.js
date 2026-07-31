// 链接解读链路（ADR-067）：飞书私信发链接 → 摄入 → 中文解读 → 回消息 + 落库。
// 与插件面板同一套语义（ADR-066 分流）：素材必存（发来=至少是料），带感想才立灵感。
// 走本机 HTTP 接口而非直接 import 各服务——与 feishu-bot 既有做法一致（saveCard 同款），
// 摄入/翻译/notes 管道的演进自动跟上，不用两处维护。

const apiBase = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

const INTERPRET_PROMPT = '请解读这份材料，输出三部分（用【摘要】【要点】【金句】做小标题）：'
  + '【摘要】3 句以内讲清这条内容说了什么、为什么值得看；'
  + '【要点】3-6 条，每条一句话，信息密度高；'
  + '【金句】1-2 条最有力的原话，先中文翻译、括号附英文原文（原文是中文则只给原句）。'
  + '直接输出内容，不要客套和前言。';

async function post(path, body) {
  const r = await fetch(`${apiBase()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}

// 摄入 + 解读 + 落库，返回可直接回飞书的文本与追问上下文
export async function digestUrl(url, feel = '') {
  const j = await post('/api/content/ingest', { input: url });
  if (!j.success || j.data?.fetchStatus !== 'success') {
    throw new Error(j.data?.fetchError || j.error || '摄入失败');
  }
  const d = j.data;
  const m = d.metadata || {};

  const { chat } = await import('./llm.js');
  const material = `【标题】${d.zhTitle || d.title || '(无题)'}\n【作者/平台】${[m.author, m.platform].filter(Boolean).join(' · ') || '未知'}\n【正文】\n${(d.zhBody || d.body || '').slice(0, 12000)}`;
  const res = await chat([
    { role: 'system', content: '你是用户的中文内容解读助手。材料如下：\n' + material },
    { role: 'user', content: INTERPRET_PROMPT },
  ], 'deepseek');
  const interp = res?.success ? (res.content || '').trim() : '（解读生成失败，可直接提问针对性追问）';

  // 素材必存；带感想 → 另立灵感 + 挂料（ADR-066 分流）
  let noteId = null, ideaOk = false;
  try {
    const excerpt = `【灵感卡·启发】${feel || (d.zhTitle || d.title || '一条值得记的内容')}\n【来源】${[m.author, m.platform].filter(Boolean).join(' @ ')} — ${url}\n【解读摘录】${interp.slice(0, 500)}`;
    const nj = await post('/api/notes', {
      excerpt, noteType: 'insight',
      sourceTitle: d.zhTitle || d.title || m.author || '链接内容', sourceUrl: url,
    });
    noteId = nj.data?.id || null;
    if (feel && noteId) {
      const ij = await post('/api/ideas', {
        title: feel.slice(0, 40),
        body: `感想：${feel}\n来源：${[m.author, m.platform].filter(Boolean).join(' @ ')} — ${url}\n解读摘要：${interp.slice(0, 300)}`,
        sourceKind: 'user', sourceRef: url, supportingNoteIds: [noteId],
      });
      ideaOk = !!ij.success;
    }
  } catch (e) { console.warn('[link-digest] 落库失败（不影响回复）:', e.message); }

  const head = [
    `📖 ${d.zhTitle || d.title || url}`,
    [m.author, m.platform, m.publishedAt].filter(Boolean).join(' · ') || null,
    d.note || null,
  ].filter(Boolean).join('\n');
  const tail = ideaOk
    ? `💡 感想已立为灵感、解读素材已挂料`
    : `✓ 已存素材库${feel ? '' : '（回一句感想可立为灵感）'}`;
  const replyText = `${head}\n\n${interp}\n\n———\n${tail}\n回复「全文」看完整中文稿；直接提问可追问`;
  return { replyText, data: d, noteId, ideaOk };
}

// 解读追问：带当前材料答（区别于 feishu-bot 的通用问句回复）
export async function askDigest(pend, question) {
  const { chat } = await import('./llm.js');
  const d = pend.data;
  const material = `${d.zhTitle || d.title || ''}\n${(d.zhBody || d.body || '').slice(0, 12000)}`;
  const res = await chat([
    { role: 'system', content: '基于下面这份材料回答用户追问，中文、简洁（几句话）；材料里没有的就明说没提，不要编：\n' + material },
    { role: 'user', content: question },
  ], 'deepseek');
  return res?.success ? (res.content || '').trim() : '';
}

// 追问期补感想：素材在 digest 时已存过 → 只立灵感并挂上那条素材
export async function saveFeel(pend, feel) {
  const m = pend.data.metadata || {};
  const ij = await post('/api/ideas', {
    title: feel.slice(0, 40),
    body: `感想：${feel}\n来源：${[m.author, m.platform].filter(Boolean).join(' @ ')} — ${pend.url}`,
    sourceKind: 'user', sourceRef: pend.url, supportingNoteIds: [pend.noteId].filter(Boolean),
  });
  if (!ij.success) throw new Error(ij.error || '立灵感失败');
}
