// 一次性脚本（2026-07-16）：批量登记用户点名的 X 账号（借道 AI HOT，passive）。
// handle 均经 Web 实测核实（见当日会话记录），displayName 用人名便于在 Feed/信源页辨认。
// 幂等：registerSource 按 platform+handle（NOCASE）findOrCreate，重复跑不建重。
// 顺带清理：把之前被误识别为 WeChat 的 '@AnthropicAI' 源删掉（0 条内容，安全）。
import { registerSource } from '../src/services/source-registry.js';
import { getDatabase } from '../src/db/init.js';

const FOLLOWS = [
  ['Andrej Karpathy', 'karpathy'],
  ['Swyx', 'swyx'],
  ['Josh Woodward', 'joshwoodward'],
  ['Boris Cherny', 'bcherny'],
  ['Thibault Sottiaux', 'thsottiaux'],
  ['Peter Yang', 'petergyang'],
  ['Nan Yu', 'thenanyu'],
  ['Madhu Guru', 'realmadhuguru'],
  ['Amanda Askell', 'AmandaAskell'],
  ['Cat Wu', '_catwu'],
  ['Thariq', 'trq212'],
  ['Google Labs', 'GoogleLabs'],
  ['Amjad Masad', 'amasad'],
  ['Guillermo Rauch', 'rauchg'],
  ['Alex Albert', 'alexalbert__'],
  ['Aaron Levie', 'levie'],
  ['Ryo Lu', 'ryolu_'],
  ['Garry Tan', 'garrytan'],
  ['Matt Turck', 'mattturck'],
  ['Zara Zhang', 'zarazhangrui'],
  ['Nikunj Kothari', 'nikunj'],
  ['Peter Steinberger', 'steipete'],
  ['Dan Shipper', 'danshipper'],
  ['Aditya Agarwal', 'adityaag'],
  ['Sam Altman', 'sama'],
  ['Claude', 'claudeai'],
  ['Anthropic', 'AnthropicAI'],
];

// 清理误登记的 WeChat '@AnthropicAI'
{
  const db = getDatabase();
  const wrong = db.prepare(
    "SELECT sp.source_id FROM source_platforms sp WHERE sp.platform = 'WeChat' AND sp.handle LIKE '@%'"
  ).all();
  for (const r of wrong) {
    db.prepare('DELETE FROM source_platforms WHERE source_id = ?').run(r.source_id);
    db.prepare('DELETE FROM sources WHERE id = ?').run(r.source_id);
  }
  db.close();
  if (wrong.length) console.log(`🧹 已删除 ${wrong.length} 个误识别为 WeChat 的 @handle 源`);
}

let merged = 0;
for (const [name, handle] of FOLLOWS) {
  const source = registerSource({
    sourceType: 'Person', displayName: name, platform: 'X', handle,
    trackMode: 'passive',
  });
  // display_name 若是 AI HOT 早前建的（可能是 X 昵称），保留原名不覆盖
  const hadContent = source.platforms?.length ? '' : '';
  console.log(`✓ ${name} (@${handle}) → ${source.display_name}${source.id ? '' : hadContent}`);
  merged++;
}

// 统计借道覆盖：这些源已有多少 AI HOT 内容
{
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT s.display_name, sp.handle, COUNT(c.id) AS n
    FROM source_platforms sp
    JOIN sources s ON s.id = sp.source_id
    LEFT JOIN contents c ON c.source_id = s.id
    WHERE sp.platform = 'X' AND s.registered_by_user = 1
    GROUP BY s.id ORDER BY n DESC
  `).all();
  db.close();
  const withContent = rows.filter(r => r.n > 0);
  console.log(`\n共登记 ${merged} 个 X 源；其中 ${withContent.length} 个已有 AI HOT 转载内容：`);
  for (const r of withContent) console.log(`  ${r.display_name} (@${r.handle}): ${r.n} 条`);
}
