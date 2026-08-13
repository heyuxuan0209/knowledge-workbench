// 平台数据导出——集中配置（工单：小红书/公众号 D3/D7/D30 复盘取数）。
// 所有可调项都从 backend/.env 读，代码里不硬编造 token/chat_id/路径。
// 这些脚本由 launchd 独立进程调起（不经 server.js），所以自己显式加载 .env。
import dotenv from 'dotenv';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
// lib -> platform-export -> scripts -> backend
export const backendDir = join(here, '../../..');
const envPath = join(backendDir, '.env');

// ⚠️ 凭证认项目、不认全局环境变量（2026-08-13 实测踩到，排查花了半小时）
// dotenv **默认不覆盖已存在的 process.env**。而 ~/.zshrc 里 export 了一个同名的
// FEISHU_APP_ID/SECRET（属于「视频解读」机器人，另一个项目的），于是：
//   - launchd 跑 → plist 只设 PATH，环境干净 → 读到 .env 里的正确 app → 每天正常 ✅
//   - 人在终端手动跑 → zshrc 的变量赢 → 用错 app → 上传报 `1061004 forbidden` ❌
// 最坑的是报错长得像「飞书文件夹权限被改了」，会一路查到云盘协作者上去（我就查错了方向），
// 而群通知里教人补数的那句正是 `node run.mjs --force`——照着敲就会踩，且五个平台一起挂。
// 所以：凭证类 key 由项目 .env 说了算，谁也别想从外面盖掉。
const parsed = dotenv.parse(fs.readFileSync(envPath));
for (const k of ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_BOT_APP_ID', 'FEISHU_BOT_APP_SECRET']) {
  if (parsed[k]) process.env[k] = parsed[k];
}
// 其余 key 保持 dotenv 默认语义：外部环境变量仍可临时覆盖，
// 这样 `PLATFORM_EXPORT_MANUAL_CLICK=1 npm run export:xhs` 这类命令行调试照旧能用。
dotenv.config({ path: envPath });

const home = os.homedir();
const expand = (p) => (p && p.startsWith('~') ? join(home, p.slice(1)) : p);

export const config = {
  // 落盘目录：两个平台的 xlsx 都放这里
  exportDir: expand(process.env.PLATFORM_EXPORT_DIR) || join(home, 'Documents/platform-exports'),
  // 持久化浏览器 profile（首次手动扫码登录，之后复用登录态）
  xhsProfile: expand(process.env.PLATFORM_EXPORT_XHS_PROFILE) || join(home, '.playwright-profiles/xhs'),
  mpProfile: expand(process.env.PLATFORM_EXPORT_MP_PROFILE) || join(home, '.playwright-profiles/mp'),
  dyProfile: expand(process.env.PLATFORM_EXPORT_DY_PROFILE) || join(home, '.playwright-profiles/dy'),
  sphProfile: expand(process.env.PLATFORM_EXPORT_SPH_PROFILE) || join(home, '.playwright-profiles/sph'),
  zhihuProfile: expand(process.env.PLATFORM_EXPORT_ZHIHU_PROFILE) || join(home, '.playwright-profiles/zhihu'),
  xProfile: expand(process.env.PLATFORM_EXPORT_X_PROFILE) || join(home, '.playwright-profiles/x'),
  // 飞书云盘交接文件夹 token（云端 Claude 从这里取文件入表）——**必填**，在 backend/.env 设；
  // 不内置默认值：这是个人飞书文件夹 ID，不硬编码进公开仓。
  folderToken: process.env.PLATFORM_EXPORT_FOLDER_TOKEN || '',
  // 通知群 chat_id（云端 Claude 看到消息就自动入表回填）——**必填**，在 backend/.env 设。
  chatId: process.env.PLATFORM_EXPORT_CHAT_ID || '',
  // X 默认**不进每天的自动跑**（2026-08-11 用户叫停）。导出器写好了，但 profile 里没有登录态，
  // 而 X 的登录要走邮箱→密码→验证这一串、她试了两次没走完。放着不管的话，每天的飞书通知里
  // 会固定多一行「❌ X 未登录」——天天噪音，还让「今天全绿」这个信号永远出不来。
  // 想启用：先 `npm run export:x` 登一次，再在 .env 里设 PLATFORM_EXPORT_ENABLE_X=true。
  enableX: /^(1|true|yes|on)$/i.test(process.env.PLATFORM_EXPORT_ENABLE_X || ''),
  // 降级开关：true = 脚本只开到导出页，最后一下由真人点（所有平台操作真人触发）
  manualClick: /^(1|true|yes|on)$/i.test(process.env.PLATFORM_EXPORT_MANUAL_CLICK || ''),
  // 用哪个机器人身份发通知：note = FEISHU_BOT_APP（默认，主应用桥接才收得到事件转给云端 Claude）
  notifyBot: (process.env.PLATFORM_EXPORT_NOTIFY_BOT || 'note').toLowerCase(),
  // 真人手动点击（MANUAL_CLICK 下载）时最多等多久（毫秒）
  manualTimeoutMs: Number(process.env.PLATFORM_EXPORT_MANUAL_TIMEOUT_MS) || 5 * 60_000,
  // 交互式首次登录时最多等多久——给足从容登录/扫码的时间（登录一被检测到就立刻继续，等久无害）
  loginWaitMs: Number(process.env.PLATFORM_EXPORT_LOGIN_WAIT_MS) || 15 * 60_000,
};

// 调试截图目录（失败时把当时页面截下来，方便定位是哪一步 / 选择器漂了没）
export const debugDir = join(config.exportDir, '_debug');

// YYYYMMDD（本机时区）——文件名后缀，每天一份全量快照
export function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
