// 多平台一键发布 —— MultiPost 浏览器扩展通道（ADR-094）
//
// 为什么走扩展而不是各平台官方 API：七个目标平台里只有 YouTube 和 X 的写接口对个人开放。
// 抖音「发布内容至抖音」要企业/服务商资质；小红书笔记发布按类目逐接口审核、没有个人开放的证据；
// 视频号基本没有开放写接口；微信公众号 2025-07 起个人主体与未认证账号的发布接口已被回收
// （draft/add 在社区大量实测返回 48001）。所以"一键发布"只能靠复用浏览器里已登录的会话代填代点。
//
// 通信协议（读 MultiPost 源码 src/contents/extension.ts 确认，不是猜的）：
//   页面 window.postMessage({ type:'request', traceId, action:'MULTIPOST_EXTENSION_*', data })
//   扩展校验 event.origin 是否在它的 trustedDomains 里，不在就回 403 Untrusted origin
//   回包也走 window.postMessage，用 traceId 配对
//
// 三条实测得来的硬约束（2026-08-08 手动跑通 X / 小红书后写下，别改回去）：
//  ① 用 PUBLISH 不用 PUBLISH_NOW。前者弹一个复核窗让人过目再发，后者直接开各平台标签页。
//     判断留给人是 ADR-044 的边界，发布这一下尤其不该替用户按。
//  ② **绝不能说"已发布"。** 扩展的完成回调 handlePublishComplete 只表示"标签页开好、内容注入完毕"，
//     它完全不检查平台那边有没有真发出去；视频/文章 tab 的 isAutoPublish 更是写死 false，永远不会自己点发布。
//     实测踩过：扩展弹「发布完成」，小红书里既没内容也没待审。措辞一律是"已送到发布台，去确认"。
//  ③ 小红书图文没有图片会**静默失败**——它的整段逻辑被 `if (images.length > 0)` 包着，
//     没图就直接跳过，一句提示都没有，页面还停在「上传视频」tab 看起来像在等你操作。发之前必须挡。

const TIMEOUT_MS = 15_000;

// KW 的平台形态（reference/prompts/creation/platform-forms/）→ MultiPost 平台常量。
// 名字取自 MultiPost 源码 src/sync/{dynamic,article,video}.ts，大小写敏感。
export const FORM_TO_PLATFORM = {
  'gzh-long': 'ARTICLE_WEIXIN',      // 长文走 article 通道，吃 htmlContent
  'xhs-card': 'DYNAMIC_REDNOTE',
  'xhs-long': 'DYNAMIC_REDNOTE',
  'x-short': 'DYNAMIC_X',
  'x-thread': 'DYNAMIC_X',
  'douyin-card': 'DYNAMIC_DOUYIN',
  'jike': 'DYNAMIC_OKJIKE',
  'reddit': 'DYNAMIC_REDDIT',
  'bilibili': 'DYNAMIC_BILIBILI',
  // douyin-koubo 是口播文字稿、不是成片，没有 mp4 可传——故意不映射，UI 上说明白让用户自己传。
};

// 需要图片才能发的通道（没图会静默失败，见文件头 ③）
const NEEDS_IMAGE = new Set(['DYNAMIC_REDNOTE']);

let seq = 0;
const traceId = () => `kw-${Date.now()}-${++seq}`;

// 一次请求-响应。扩展的回包也走 window message，靠 traceId 配对。
function call(action, data = {}) {
  return new Promise((resolve, reject) => {
    const id = traceId();
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('扩展没有响应（15 秒超时）——确认 MultiPost 已安装并启用'));
    }, TIMEOUT_MS);

    function onMessage(event) {
      const r = event.data;
      if (!r || r.type !== 'response' || r.traceId !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (r.code === 403) return reject(new Error('UNTRUSTED'));   // 上层据此走申请信任
      if (r.code !== 0) return reject(new Error(r.message || `扩展返回错误 ${r.code}`));
      resolve(r.data);
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ type: 'request', traceId: id, action, data }, '*');
  });
}

/** 扩展装了没。装了返回 extensionId，没装抛错。 */
export async function checkExtension() {
  const d = await call('MULTIPOST_EXTENSION_CHECK_SERVICE_STATUS');
  if (!d?.extensionId) throw new Error('未检测到 MultiPost 扩展');
  return d.extensionId;
}

/** 申请把 KW 的域名加进扩展信任列表。会弹一个确认窗，要用户点同意。 */
export async function requestTrust() {
  // 这个 action 在扩展侧被列入 ACTIONS_NOT_NEED_TRUST_DOMAIN，所以未信任时也能调通
  const d = await call('MULTIPOST_EXTENSION_REQUEST_TRUST_DOMAIN');
  if (!d?.trusted) throw new Error('你在扩展弹窗里没有同意信任本站，发布通道未打开');
  return true;
}

/**
 * 送一批内容到发布台。**不等于已发布**——扩展会弹复核窗，用户在那里确认后才真发。
 * items: [{ platform, title, content, htmlContent, digest, images, tags }]
 * 同一次调用里的多个平台会一起进复核窗。
 */
export async function sendToPublisher(items) {
  if (!items?.length) throw new Error('没有可发布的内容');

  const missingImage = items.filter(i => NEEDS_IMAGE.has(i.platform) && !(i.images?.length));
  if (missingImage.length) {
    // 挡在这里而不是让扩展静默跳过（文件头 ③）
    throw new Error(`小红书必须带图，否则扩展会静默跳过、什么都不发。请先生成图文卡片再发。`);
  }

  const isArticle = items.some(i => i.platform.startsWith('ARTICLE_'));
  const first = items[0];

  // SyncData 的 data 是单份内容 + 多个平台，不是每平台一份（见 MultiPost src/sync/common.ts）
  const payload = {
    platforms: items.map(i => ({ name: i.platform })),
    isAutoPublish: false,          // 见文件头 ①：最后那一下留给人
    data: isArticle
      ? {
          title: first.title || '',
          digest: first.digest || '',
          htmlContent: first.htmlContent || '',
          markdownContent: first.content || '',
          cover: first.cover || undefined,
          images: first.images || [],
        }
      : {
          title: first.title || '',
          content: first.content || '',
          images: first.images || [],
          videos: first.videos || [],
          tags: first.tags || [],
        },
  };

  await call('MULTIPOST_EXTENSION_PUBLISH', payload);
  return { sent: items.length };
}

/**
 * 确保通道可用。UI 在发布前调一次。
 *
 * 顺序不能反：**REQUEST_TRUST_DOMAIN 必须第一个调**。扩展侧只把这一个 action 列进
 * ACTIONS_NOT_NEED_TRUST_DOMAIN，**其余全部 action 在未信任时一律返回 403**——
 * 包括看起来人畜无害的 CHECK_SERVICE_STATUS。
 * 第一版把 checkExtension() 放在前面，结果它自己先吃了 403 抛出去，
 * 永远走不到申请信任那一步，用户点按钮什么都不弹，UI 还提示"请在弹窗里点信任"——
 * 而那个弹窗从来没被触发过。死循环。
 *
 * 已信任时 REQUEST_TRUST_DOMAIN 直接返回 {trusted:true}，不打扰用户，所以可以每次无条件调。
 */
export async function ensureChannel() {
  try {
    await requestTrust();
  } catch (e) {
    // 超时＝扩展没装/没注入本站，比"没信任"更根本，得说清楚是哪一种
    if (/没有响应/.test(e.message)) {
      throw new Error(
        `扩展没有响应。两种可能：① MultiPost 没装或没启用；` +
        `② 当前地址不在扩展的 host_permissions 里——它只放行 https、localhost 和 127.0.0.1，` +
        `所以 http://kw-vps:3000 用不了，请改用 http://localhost:3000。当前地址：${location.origin}`,
      );
    }
    throw e;
  }
  await checkExtension();
  return true;
}
