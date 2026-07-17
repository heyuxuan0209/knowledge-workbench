import { execFile } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { join } from 'path';

const pexec = promisify(execFile);

// active-query 渠道适配器（ADR-014）：child_process 直调 Agent-Reach 装的本地 CLI，
// 消费 --json 结构化输出，转成 Content 模型。第一期只做免登录三渠道：
//   Bilibili → bili-cli user-videos（UP 主视频列表，中文直存零 LLM 成本）
//   YouTube  → yt-dlp --flat-playlist（频道最新视频；flat 模式无发布时间/简介，接受）
//   GitHub   → gh api users/<x>/repos?sort=pushed（最近推送的仓库）
// X / 小红书等登录态渠道后置（解锁需用户授权提取浏览器 cookie，见 ADR-014）。
//
// 上游都是非官方/半官方接口，随时可能失效（agent-reach doctor 探活）；
// 单渠道失败向上抛，由 sync-active-query.js 做按源隔离，不阻塞其他源。

// pip user 级安装路径不在服务进程 PATH 里，显式补上（ADR-014 本地环境耦合项）
const PIP_BIN = join(homedir(), 'Library/Python/3.10/bin');
const CLI_ENV = { ...process.env, PATH: `${PIP_BIN}:${process.env.PATH || ''}` };

// 单次重试：B站等上游有瞬时风控/网络抖动（实测同一命令间隔几秒即恢复），
// 定时任务场景一次轻量重试能消化大部分偶发失败；连续两次失败才如实上抛。
// execFile 的 error.message 只有 "Command failed"，真实原因在 stderr——拼进错误信息。
async function runJson(cmd, args, timeout = 90000) {
  for (let attempt = 0; ; attempt++) {
    try {
      const { stdout } = await pexec(cmd, args, { env: CLI_ENV, timeout, maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (err) {
      const detail = (err.stderr || err.message || '').toString().trim().slice(0, 300);
      if (attempt >= 1) throw new Error(`${cmd} ${args[0]} 失败: ${detail}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

// ---- Bilibili：bili user-videos <UID或用户名> ----
// 输出：{ok, data: [{bvid, title, description, url, stats:{view}}]}；无发布时间（接受，
// created_at 兜底排序，首次入库即"首见时间"）
export async function queryBilibili({ handle, displayName }, limit = 5) {
  const out = await runJson('bili', ['user-videos', handle, '-n', String(limit), '--json']);
  if (!out.ok) throw new Error(`bili-cli 返回 ok=false: ${JSON.stringify(out).slice(0, 120)}`);

  return (out.data || []).map(v => ({
    content: {
      id: `bili-${v.bvid || v.id}`,
      content_type: 'video',
      url: v.url || `https://www.bilibili.com/video/${v.bvid}`,
      published_at: null,
      original_lang: 'zh',
      has_translation: 0,
      zh_title: v.title || null,
      // 完整描述给到摘要生成用（sync 侧对新条目 batchSummarize 出完整一句话，
      // 不再硬截断半句话进 Feed）
      zh_summary: (v.description || '').trim().slice(0, 800) || null,
      en_title: null,
      input_method: 'feed',
      source_app: 'active_query',
      fetch_status: 'success',
      external_score: v.stats?.view ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    sourceInfo: { platform: 'Bilibili', handle, displayName },
  }));
}

// ---- YouTube：yt-dlp --flat-playlist ----
// handle 形如 '@karpathy' 或 channel/user ID（source-registry 识别时已归一）
export async function queryYoutube({ handle, displayName }, limit = 5) {
  const channelUrl = handle.startsWith('@')
    ? `https://www.youtube.com/${handle}/videos`
    : `https://www.youtube.com/channel/${handle}/videos`;

  const args = ['--flat-playlist', '--playlist-end', String(limit), '-J', channelUrl];
  // 国内环境需代理（复用 content-ingestion 的 YOUTUBE_PROXY_URL 约定）
  if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);

  const out = await runJson('yt-dlp', args, 120000);
  return (out.entries || []).filter(e => e?.id).map(e => ({
    content: {
      id: `yt-${e.id}`,
      content_type: 'video',
      url: `https://www.youtube.com/watch?v=${e.id}`,
      published_at: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : null,
      original_lang: 'en',
      has_translation: 0, // 新条目标题翻译由 sync 管道补，成功后置 1
      zh_title: null,
      zh_summary: null,   // flat 模式拿不到简介；解读时 content-body-resolver 会按需抓
      en_title: e.title || null,
      input_method: 'feed',
      source_app: 'active_query',
      fetch_status: 'success',
      external_score: e.view_count ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    sourceInfo: { platform: 'YouTube', handle, displayName: out.channel || displayName },
  }));
}

// ---- GitHub：gh api 最近推送的仓库（30 天内活跃的才算"动态"） ----
export async function queryGithub({ handle, displayName }, limit = 5) {
  const repos = await runJson('gh', [
    'api', `users/${handle}/repos?sort=pushed&per_page=${limit}&type=owner`,
  ]);

  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  return (Array.isArray(repos) ? repos : [])
    .filter(r => r.pushed_at && new Date(r.pushed_at).getTime() > cutoff && !r.fork)
    .map(r => ({
      content: {
        id: `gh-${r.full_name}`,
        content_type: 'repo',
        url: r.html_url,
        published_at: r.pushed_at,
        original_lang: 'en',
        has_translation: 0,
        zh_title: null,
        zh_summary: null, // 新条目由 sync 管道翻译 description 补上
        en_title: r.full_name,
        en_summary: r.description || null,
        input_method: 'feed',
        source_app: 'active_query',
        fetch_status: 'success',
        external_score: r.stargazers_count ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
      },
      sourceInfo: { platform: 'GitHub', handle, displayName },
    }));
}

// YouTube 单视频详情。两处消费：
// - sync-active-query：flat 列表缺简介/发布时间，对新条目逐个补取
// - content-ingestion（即时分析输入管道）：官方标题/频道名等元数据必须随字幕
//   一起喂给模型——只喂纯字幕时模型会从语音猜人名（曾把 Thariq Shihipar
//   误作 "Tarik Shaupar"），这是元数据块的根治点
// 失败返回 null 不阻塞，调用方自行降级
export async function fetchYoutubeDetail(videoId) {
  try {
    const args = ['--dump-json', '--no-download', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`];
    if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
    const d = await runJson('yt-dlp', args, 60000);
    return {
      title: d.title || null,
      channel: d.channel || d.uploader || null,
      description: (d.description || '').trim().slice(0, 500) || null,
      publishedAt: d.timestamp
        ? new Date(d.timestamp * 1000).toISOString()
        : (d.upload_date ? `${d.upload_date.slice(0, 4)}-${d.upload_date.slice(4, 6)}-${d.upload_date.slice(6, 8)}T00:00:00Z` : null),
    };
  } catch {
    return null;
  }
}

// 视频链接 → 所属频道（2026-07-17 反馈：Feed 流里复制的就是 watch 链接，identify 必须认）。
// yt-dlp dump-json 里 uploader_id 即 @handle（queryYoutube 两种 handle 形态都支持）。
// 失败返回 null，调用方自行降级/报错
export async function fetchYoutubeVideoChannel(videoId) {
  try {
    const args = ['--dump-json', '--no-download', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`];
    if (process.env.YOUTUBE_PROXY_URL) args.unshift('--proxy', process.env.YOUTUBE_PROXY_URL);
    const d = await runJson('yt-dlp', args, 60000);
    const handle = (d.uploader_id?.startsWith('@') ? d.uploader_id : null) || d.channel_id || null;
    return handle ? { handle, name: d.channel || d.uploader || handle } : null;
  } catch {
    return null;
  }
}

// ---- 小宇宙播客（2026-07-16 反馈：播客节目要能追更） ----
// 小宇宙不提供公开 RSS，但节目页是 Next.js 应用，__NEXT_DATA__ 里嵌着完整节目列表
// （标题/描述/发布时间/播放量），免登录直接抓页面即可。中文内容零翻译成本。
// 单集链接已被万能收口支持（M5 转写+shownotes），Feed 里点"精读"同样能走该管道。

const XYZ_UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// 短时间密集请求会触发小宇宙 503 风控（实测），间隔重试一次；定时任务频率下不会命中
async function fetchXyzPage(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: XYZ_UA, signal: AbortSignal.timeout(20000) });
    if (res.ok) return res.text();
    if (attempt >= 1) throw new Error(`小宇宙页面请求失败（HTTP ${res.status}，可能触发风控，稍后重试）`);
    await new Promise(r => setTimeout(r, 8000));
  }
}

function parseNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error('小宇宙页面结构变化（未找到 __NEXT_DATA__ 数据块）');
  return JSON.parse(m[1]);
}

// 节目页元信息（identify 登记时取节目名；支持 /podcast/<pid> 与 /episode/<eid> 两种链接）
export async function fetchXiaoyuzhouMeta(inputUrl) {
  const data = parseNextData(await fetchXyzPage(inputUrl));
  const props = data?.props?.pageProps || {};
  // 节目页直接有 podcast；单集页从 episode.podcast 取所属节目
  const podcast = props.podcast || props.episode?.podcast;
  if (!podcast?.pid || !podcast?.title) throw new Error('未能从小宇宙页面解析出节目信息');
  return { pid: podcast.pid, title: podcast.title, brief: podcast.brief || null };
}

export async function queryXiaoyuzhou({ handle, displayName }, limit = 5) {
  const data = parseNextData(await fetchXyzPage(`https://www.xiaoyuzhoufm.com/podcast/${handle}`));
  const podcast = data?.props?.pageProps?.podcast;
  if (!Array.isArray(podcast?.episodes)) throw new Error('小宇宙节目页没有节目列表（可能已下架）');

  return podcast.episodes.slice(0, limit).map(ep => ({
    content: {
      id: `xyz-${ep.eid}`,
      content_type: 'video', // schema 无 podcast 类型；音频与视频同走"转写→精读"管道，语义最近
      url: `https://www.xiaoyuzhoufm.com/episode/${ep.eid}`,
      published_at: ep.pubDate || null,
      original_lang: 'zh',
      has_translation: 0,
      zh_title: ep.title || null,
      zh_summary: (ep.description || '').trim().slice(0, 800) || null,
      en_title: null,
      input_method: 'feed',
      source_app: 'active_query',
      fetch_status: 'success',
      external_score: ep.playCount ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    sourceInfo: { platform: 'Podcast', handle, displayName: podcast.title || displayName },
  }));
}

// 视频链接 → UP 主（2026-07-17 反馈，同 YouTube：Feed 流里是 /video/BV… 链接）。
// 视频页嵌入的初始状态 JSON 里有 "owner":{"mid":…,"name":"…"}，免登录直接抓页面提取。
// 失败返回 null，调用方自行降级
export async function fetchBiliVideoOwner(videoUrl) {
  try {
    const res = await fetch(videoUrl, { headers: XYZ_UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"owner"\s*:\s*\{\s*"mid"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return m ? { uid: m[1], name: JSON.parse(`"${m[2]}"`) } : null;
  } catch {
    return null;
  }
}

// UP 主资料（登记时取真实昵称用；失败返回 null，调用方自行兜底）
export async function fetchBiliUser(uidOrName) {
  try {
    const out = await runJson('bili', ['user', uidOrName, '--json'], 30000);
    // bili user 返回 {data: {user: {...}}}；search --type user 返回 {data: [{...}]}
    const u = out.data?.user || (Array.isArray(out.data) ? out.data[0] : out.data);
    return u?.name ? { uid: String(u.id), name: u.name } : null;
  } catch {
    return null;
  }
}

// 平台 → 适配器路由。登录态渠道（X 等）不在表内，sync 侧如实跳过。
// Podcast 平台当前 = 小宇宙（handle 为节目 pid）；未来接 Apple 播客等再按 handle 分流
export const CHANNEL_ADAPTERS = {
  Bilibili: queryBilibili,
  YouTube: queryYoutube,
  GitHub: queryGithub,
  Podcast: queryXiaoyuzhou,
};
