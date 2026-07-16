import { ingestUrl, ingest } from './content-ingestion.js';
import { translateText, detectLanguage } from './translation.js';
import { getDatabase } from '../db/init.js';

// 抓取成功后把原文与译文回写 contents（异步失败不影响本次返回，只是下次没缓存）
function persistZhBody(contentId, rawFullText, zhBody) {
  try {
    const db = getDatabase();
    db.prepare(`
      UPDATE contents SET raw_full_text = ?, zh_body = ?, has_translation = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(rawFullText, zhBody, contentId);
    db.close();
  } catch (err) {
    console.error(`[body-resolver] persist cache failed for ${contentId}:`, err.message);
  }
}

// 从「一条已入库的 content 记录」解析出它的正文，供任何需要"读原文"的模块复用
// （即兴分析对话 ephemeral-chat.js、摘要/观点提取 content-analysis.js 均依赖这里）。
// 抽成独立模块的原因：这条"原文 vs 摘要"的处理策略是一份产品决策（见下方注释），
// 不应该被拆开在多个模块里各自实现一遍，否则未来改策略要改多处、容易遗漏。
//
// 原文 vs 摘要（2026-07-12 确立，docs/WIREFRAMES.md 核心设计原则 §7）：AI HOT 同步进来的
// contents 表只存了平台给的短摘要（article 类型实测平均 241 字），不是原文。
// - X (tweet)：摘要基本等价于原文全文（推文本身就短），且平台层面不做抓取（ADR-007 硬约束），
//   直接用摘要，不去抓 X 链接
// - article/paper/repo 且有 url：实时抓取原文（复用 content-ingestion.js 的 ingestUrl），
//   抓取成功才用原文，失败或超时则降级回摘要，且必须显式告知"无法获取原文"——不掩盖事实
const FETCHABLE_TYPES = ['article', 'paper', 'repo'];
// 40s：ingestUrl 现在是两段式（直抓失败 → Jina 兜底再试一次），15s 只够单段，
// 曾把本可成功的 Jina 兜底掐死在半路、静默退化成摘要
const FETCH_TIMEOUT_MS = 40000;

async function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`超时（${ms / 1000}秒）`)), ms))
  ]);
}

// 返回 { body, isFullText, note }
// isFullText: true 表示这是真实原文，false 表示降级用了摘要（note 说明原因，成功时为 null）
export async function resolveContentBody(content) {
  if (content.content_type === 'tweet') {
    return {
      body: content.zh_summary || content.zh_body || '',
      isFullText: true,
      note: null // 推文本身就短，摘要≈全文，不算降级
    };
  }

  // 视频类（active-query/AI HOT 拉回的 YouTube/B站视频卡片）三级策略：
  // ① YouTube 先走字幕提取（快，复用 Mode 1 ingest 管道）
  // ② 无字幕/B站 → 本地 ASR 转写兜底（ADR-015：faster-whisper，首次分钟级，结果缓存）
  // ③ ASR 也失败 → 诚实降级为标题+简介
  if (content.content_type === 'video') {
    if (content.zh_body) {
      return { body: content.zh_body, isFullText: true, note: null };
    }

    const isYoutube = content.url && /youtube\.com|youtu\.be/.test(content.url);
    const isBilibili = content.url && /bilibili\.com|b23\.tv/.test(content.url);

    // ① 字幕（仅 YouTube；B站字幕接口需登录态渠道，ADR-014 未解锁）
    if (isYoutube) {
      try {
        const ingested = await withTimeout(ingest(content.url), 30000);
        if (ingested.fetchStatus !== 'success') throw new Error(ingested.fetchError);
        // 与 Mode 1 同款长视频保护：字幕前 20k 字符已足够支撑解读
        const raw = ingested.body.length > 20000 ? ingested.body.slice(0, 20000) + '\n…（内容过长，已截取前段解读）' : ingested.body;
        const zhBody = detectLanguage(raw) === 'zh' ? raw : await translateText(raw);
        persistZhBody(content.id, ingested.body, zhBody);
        return { body: zhBody, isFullText: true, note: null };
      } catch (subtitleError) {
        console.log(`[body-resolver] 字幕不可用（${subtitleError.message}），转 ASR 兜底: ${content.id}`);
      }
    }

    // ② ASR 兜底（B站直达；YouTube 字幕失败后到这）
    if (isYoutube || isBilibili) {
      try {
        const { transcribeVideo, MAX_AUDIO_SECONDS } = await import('./asr.js');
        const asr = await transcribeVideo(content.url);
        const raw = asr.text.length > 20000 ? asr.text.slice(0, 20000) + '\n…（内容过长，已截取前段解读）' : asr.text;
        // 中文转写走排版（加标点分段，不改字词）；英文走翻译（翻译天然重排）
        const { formatTranscript } = await import('./translation.js');
        const zhBody = detectLanguage(raw) === 'zh' ? await formatTranscript(raw) : await translateText(raw);
        persistZhBody(content.id, asr.text, zhBody);
        return {
          body: zhBody,
          isFullText: true,
          note: `正文由音频本地转写（ASR）生成${asr.truncated ? `，长视频只转写了前 ${Math.round(MAX_AUDIO_SECONDS / 60)} 分钟` : ''}，可能存在少量听写误差`
        };
      } catch (asrError) {
        return {
          body: content.zh_summary || '',
          isFullText: false,
          note: `无法获取视频字幕，音频转写也失败（${asrError.message}），以下基于标题与简介，请自行查看原视频核实：${content.url}`
        };
      }
    }

    // ③ 其他平台视频（无已知获取手段）
    return {
      body: content.zh_summary || '',
      isFullText: false,
      note: '该视频暂无法获取字幕或音频，以下基于标题与简介，深入分析请查看原视频'
    };
  }

  if (!FETCHABLE_TYPES.includes(content.content_type) || !content.url) {
    return {
      body: content.zh_body || content.zh_summary || '',
      isFullText: Boolean(content.zh_body),
      note: content.zh_body ? null : '无法获取原文（缺少可抓取的链接），以下基于平台摘要'
    };
  }

  // 缓存命中：上次已抓取并翻译过（见下方回写），直接用，避免每轮对话重复"抓取+翻译"
  // （实测一篇 GitHub README 抓取+翻译要 30s+，无状态设计下每轮都重来是不可接受的）
  if (content.zh_body) {
    return { body: content.zh_body, isFullText: true, note: null };
  }

  try {
    const ingested = await withTimeout(ingestUrl(content.url), FETCH_TIMEOUT_MS);

    if (ingested.fetchStatus !== 'success') {
      return {
        body: content.zh_summary || '',
        isFullText: false,
        note: `无法获取原文（${ingested.fetchError}），以下基于平台摘要，请自行查看原文核实：${content.url}`
      };
    }

    // 超长原文截断后再翻译（README/长文动辄上万字，全文翻译又慢又贵，8k 字已足够支撑解读）
    const rawBody = ingested.body.length > 8000 ? ingested.body.slice(0, 8000) + '\n…（原文过长已截断）' : ingested.body;
    const lang = detectLanguage(rawBody);
    const zhBody = lang === 'zh' ? rawBody : await translateText(rawBody);

    // 回写缓存：contents 表存在此记录时保存译文，下一轮直接命中上面的 zh_body 分支
    persistZhBody(content.id, ingested.body, zhBody);

    return { body: zhBody, isFullText: true, note: null };
  } catch (error) {
    return {
      body: content.zh_summary || '',
      isFullText: false,
      note: `无法获取原文（${error.message}），以下基于平台摘要，请自行查看原文核实：${content.url}`
    };
  }
}
