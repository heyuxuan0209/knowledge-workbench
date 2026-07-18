import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 创作层 prompt 加载器（P1「文件即行为」：reference/prompts/creation/ 是创作台的
// 唯一语言规范来源，改文件保存即生效）。设计约束：
// - 每次调用实时读盘，不做缓存——文件级迭代的整个意义就是免重启试错；
//   单次生成多读几个几 KB 的文件，成本可忽略
// - 文件缺失 / frontmatter 缺 label 直接抛错（诚实原则：宁可生成失败也不
//   静默用空模板产出残缺稿）
// - 平台路由表在这里只此一份（listPlatforms 扫目录），前端列表、生成校验、
//   rewrite 的平台提示全部从它派生——同 ADR-017 的单一来源纪律

const ROOT = join(__dirname, '../../../reference/prompts/creation');

export function loadPrompt(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf-8');
  } catch {
    throw new Error(`创作 prompt 文件缺失或不可读：reference/prompts/creation/${rel}`);
  }
}

// {{name}} 占位符注入。未提供的占位符替换为空串（删占位符=该信息不进 prompt，合法）
export function render(template, vars = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// 解析 platforms/*.md 的 frontmatter（--- 包围的 key: value 行）+ 正文
function parsePlatformFile(file) {
  const raw = loadPrompt(join('platforms', file));
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`平台模板 ${file} 缺少 frontmatter（--- label: … --- 头部）`);

  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.label) throw new Error(`平台模板 ${file} 的 frontmatter 缺少 label`);

  return {
    key: basename(file, '.md'),
    label: meta.label,
    icon: meta.icon || '',
    note: meta.note || meta.label,
    when: meta.when || '',
    order: Number(meta.order) || 99,
    spec: m[2].trim(),
  };
}

export function listPlatforms() {
  const files = readdirSync(join(ROOT, 'platforms')).filter(f => f.endsWith('.md'));
  if (!files.length) throw new Error('reference/prompts/creation/platforms/ 下没有任何平台模板');
  return files.map(parsePlatformFile).sort((a, b) => a.order - b.order);
}

export function getPlatform(key) {
  const platform = listPlatforms().find(p => p.key === key);
  if (!platform) {
    throw new Error(`未知平台模板「${key}」（可用：${listPlatforms().map(p => p.key).join('/')}，新增平台=在 platforms/ 加一个 md 文件）`);
  }
  return platform;
}
