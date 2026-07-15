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

async function runJson(cmd, args, timeout = 90000) {
  const { stdout } = await pexec(cmd, args, { env: CLI_ENV, timeout, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
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
      zh_summary: (v.description || '').trim().slice(0, 300) || null,
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
export const CHANNEL_ADAPTERS = {
  Bilibili: queryBilibili,
  YouTube: queryYoutube,
  GitHub: queryGithub,
};
