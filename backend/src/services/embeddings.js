// 本地 embedding 服务（VISION-V4 阶段1a 地基）：素材/内容/主题的语义向量。
// - 全本地、零 API 成本：transformers.js（ONNX）在 backend 进程内跑，复用常驻 node。
// - 懒加载：首次用到语义功能才加载模型（不拖慢启动、不用就不占内存）。
// - 出网走全局代理：模型首次下载经 undici EnvHttpProxyAgent（server.js 已挂），HF 可达。
// - 模型可换：EMBEDDING_MODEL 环境变量切换；索引与查询必须同一模型，换模型要整体重建（reindex）。
//
// 归一化后用点积即余弦；向量以 JSON 数组存进 DB 预留的 embedding 字段（schema-v3 早已留位）。

// 模型注册表：不同家族的池化方式/前缀约定/长文预算不同。
// - bge-m3：CLS 池化、无需前缀、原生多语 + 长上下文（8192），检索区分度好但更重（常驻内存约 1.5G）。
// - multilingual-e5-small：mean 池化、需要 query:/passage: 前缀、384 维、轻量（约 200M），
//   绝对余弦偏高但排序正确，适合常驻后端。
// dtype：q8 量化显著缩小下载体积与常驻内存（bge-m3 fp32≈2.3G → q8≈0.6G），
// 对检索质量几乎无损；小模型直接 fp32 即可。
const MODELS = {
  // maxChars 2500：bge-m3 CPU 上长序列注意力很慢，2500 字（标题+前段）已足够表征检索主题，
  // 再长边际收益小却成本剧增（实测 6000 字批量嵌入 22 条 >3min）。
  'Xenova/bge-m3': { pooling: 'cls', prefixQuery: '', prefixDoc: '', maxChars: 2500, dim: 1024, dtype: 'q8' },
  'Xenova/multilingual-e5-small': { pooling: 'mean', prefixQuery: 'query: ', prefixDoc: 'passage: ', maxChars: 1600, dim: 384, dtype: 'fp32' },
  'Xenova/multilingual-e5-base': { pooling: 'mean', prefixQuery: 'query: ', prefixDoc: 'passage: ', maxChars: 1600, dim: 768, dtype: 'q8' },
};

// 默认 bge-m3（q8）：多语 + 长上下文，区分度显著优于 e5-small（实测 e5 把无关项误排第一，
// bge 正确排末位）；q8 量化后缓存加载约 2s、常驻内存约 0.6-0.8G，可接受。
// 想更轻可用 EMBEDDING_MODEL=Xenova/multilingual-e5-small（换模型后须 POST /api/notes/reindex?force=1）。
export const MODEL_NAME = process.env.EMBEDDING_MODEL || 'Xenova/bge-m3';
const CFG = MODELS[MODEL_NAME] || MODELS['Xenova/multilingual-e5-small'];
export const EMBEDDING_DIM = CFG.dim;

let _pipelinePromise = null;

// 懒加载单例：整个进程只加载一次模型
async function getExtractor() {
  if (!_pipelinePromise) {
    _pipelinePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      // 允许联网拉取（首次），之后走本地缓存（node_modules/@huggingface/transformers/.cache）
      env.allowRemoteModels = true;
      const t0 = Date.now();
      const extractor = await pipeline('feature-extraction', MODEL_NAME, { dtype: CFG.dtype });
      console.log(`🧠 embedding 模型已加载：${MODEL_NAME}（${CFG.dtype}，${((Date.now() - t0) / 1000).toFixed(1)}s，dim=${CFG.dim}）`);
      return extractor;
    })().catch(err => {
      _pipelinePromise = null; // 失败可重试
      throw err;
    });
  }
  return _pipelinePromise;
}

// 文本预处理：折叠空白 + 截断到模型预算（长精读稿超过上下文没意义，取首段最有代表性）
function prep(text, prefix) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CFG.maxChars);
  return prefix + cleaned;
}

// 单条向量。isQuery 决定前缀（e5 家族区分查询/文档；bge 家族前缀为空无影响）
export async function embedText(text, { isQuery = false } = {}) {
  const extractor = await getExtractor();
  const out = await extractor(prep(text, isQuery ? CFG.prefixQuery : CFG.prefixDoc), {
    pooling: CFG.pooling, normalize: true,
  });
  return Array.from(out.data);
}

// 批量（文档侧）。transformers.js 支持数组输入，一次 forward 更快
export async function embedBatch(texts, { isQuery = false } = {}) {
  if (!texts.length) return [];
  const extractor = await getExtractor();
  const prefix = isQuery ? CFG.prefixQuery : CFG.prefixDoc;
  const out = await extractor(texts.map(t => prep(t, prefix)), { pooling: CFG.pooling, normalize: true });
  // out.dims = [n, dim]，展平后按 dim 切片
  const dim = out.dims[out.dims.length - 1];
  const flat = Array.from(out.data);
  return texts.map((_, i) => flat.slice(i * dim, (i + 1) * dim));
}

// 归一化向量的余弦 = 点积
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// 预热（供 backend 启动后可选调用；不调用则首次查询时懒加载）
export async function warmup() {
  try { await getExtractor(); return true; } catch (err) {
    console.error('embedding 预热失败（不影响关键词功能）:', err.message);
    return false;
  }
}
