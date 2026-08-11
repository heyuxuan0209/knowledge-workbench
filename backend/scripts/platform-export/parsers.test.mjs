// 抖音 / 视频号「读页面文本拼 CSV」两个解析器的回归测试：node --test scripts/platform-export/parsers.test.mjs
//
// 为什么要有这个文件：这两个平台没有导出按钮，只能读页面 innerText，后台一改版解析就悄悄错位——
// 而且**不报错**，只是标题里混进导航栏/指标、指标列变空，一路流到多维表格才表现为「匹配不上」。
// 下面的 fixture 是 2026-08-11 真机版式（照着当天导出的 CSV 反推），锁死两个真实踩坑：
//   dy  —— 「共 N 个作品」改成「作品 (N)」，旧锚点失效 → 整条导航栏成了第一条的标题；
//           新指标 完播率/2秒跳出率/吸粉量 不认识 → 被当成下一条的标题。
//   sph —— 「已声明原创」徽章夹在发布时间和 5 个指标数字之间 → 这条指标全空、下一条标题带一串数字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDouyinWorks, declaredCount } from './dy-export.mjs';
import { parseChannelsVideos } from './sph-export.mjs';

// —— 抖音：2026-08-11 的新版式（导航栏 + 「作品 (2)」+ 三个新指标）——
const DY_NEW = `作品发布
首页
内容管理
数据中心
收入变现
创作服务
AI分身
AI工坊
内容管理
作品 (2)
作品合集
全部
审核中
未通过
体裁
全部
所有时间
导出数据
0:41
分享一个能把英文长视频快速转写的skill
经常刷到30分钟以上的英文长视频，现场读起来头疼。
编辑作品
设置权限
2026年08月08日 12:09
已发布
播放
-
点赞
-
评论
-
收藏
-
分享
-
完播率
-
2秒跳出率
-
吸粉量
-
1:12
你相信AI能一键出片吗
提示词，教得了 AI 做什么，教不了它什么是好
编辑作品
2026年08月07日 15:56
已发布
播放
169
点赞
4
评论
0
收藏
1
分享
0
完播率
1.9%
2秒跳出率
57.32%
吸粉量
2`;

// —— 抖音：旧版式（「共 N 个作品」+ 老指标集合），确认没改回归 ——
const DY_OLD = `共 2 个作品
0:41
老版式第一条
2026年08月08日 12:09
已发布
播放
100
点赞
5
评论
1
收藏
2
分享
3
1:12
老版式第二条
2026年08月07日 15:56
已发布
播放
200
点赞
6
评论
0
收藏
0
分享
1`;

test('抖音：新版导航栏不进标题，新指标不污染下一条', () => {
  assert.equal(declaredCount(DY_NEW), 2);
  const recs = parseDouyinWorks(DY_NEW);
  assert.equal(recs.length, 2);

  // 第一条：导航栏/筛选栏一个字都不该出现在标题里
  assert.equal(recs[0].标题, '分享一个能把英文长视频快速转写的skill 经常刷到30分钟以上的英文长视频，现场读起来头疼。');
  for (const junk of ['内容管理', '导出数据', '所有时间', '作品合集', '审核中']) {
    assert.ok(!recs[0].标题.includes(junk), `标题里混进了「${junk}」`);
  }
  assert.equal(recs[0].涨粉, '', '吸粉量是「-」时该留空，不写 "-"');

  // 第二条：标题不该以上一条的新指标开头（这正是 2026-08-11 CSV 里的真实症状）
  assert.equal(recs[1].标题, '你相信AI能一键出片吗 提示词，教得了 AI 做什么，教不了它什么是好');
  assert.ok(!/^完播率|2秒跳出率|吸粉量/.test(recs[1].标题));
  assert.equal(recs[1]['曝光/播放量'], '169');
  assert.equal(recs[1].点赞, '4');
  assert.equal(recs[1].收藏, '1');
  assert.equal(recs[1].涨粉, '2', '抖音现在逐条给吸粉量了，该落进涨粉列');
});

test('抖音：旧版式「共 N 个作品」不回归', () => {
  assert.equal(declaredCount(DY_OLD), 2);
  const recs = parseDouyinWorks(DY_OLD);
  assert.deepEqual(recs.map((r) => r.标题), ['老版式第一条', '老版式第二条']);
  assert.equal(recs[0]['曝光/播放量'], '100');
  assert.equal(recs[1]['分享/转发'], '1');
});

test('抖音：没见过的新指标也要被吃掉，不许流进标题', () => {
  const txt = `共 1 个作品
只有一条
2026年08月08日 12:09
已发布
播放
50
某个还没出现过的率
12.3%
下一条标题不该被污染
2026年08月07日 12:09
已发布
播放
60`;
  const recs = parseDouyinWorks(txt);
  assert.equal(recs.length, 2);
  assert.equal(recs[1].标题, '下一条标题不该被污染');
});

// —— 视频号：2026-08-11 真机版式，前两条声明了原创 ——
const SPH = `视频 (4)
合集 (0)
视频管理
特效创作工具
发表视频
经常刷到30分钟以上的英文长视频，现场读起来头疼。
2026年08月08日 13:04
已声明原创
598
3
1
6
10
置顶
分享
数据
我几乎没写一行代码，就用 AI 做了条成品级的视频
2026年08月07日 14:20
已声明原创
701
4
0
4
8
置顶
分享
一个人做内容，我把杂活全交给了 AI。
2026年08月05日 12:30
590
20
0
12
6
置顶
把需求说清楚是东西很贵那个时代的技能
2026年07月24日 08:01
951
8
1
8
6
置顶`;

test('视频号：「已声明原创」不再吞掉指标、也不再串进下一条标题', () => {
  const { declared, recs } = parseChannelsVideos(SPH);
  assert.equal(declared, 4);
  assert.equal(recs.length, 4);

  // 声明了原创的那条，指标必须归位（改之前这里全是空的）
  assert.equal(recs[0]['曝光/播放量'], '598');
  assert.equal(recs[0].在看, '3');
  assert.equal(recs[0].评论, '1');
  assert.equal(recs[0]['分享/转发'], '6');
  assert.equal(recs[0].点赞, '10');

  // 下一条的标题不许以徽章或上一条的数字开头（改之前是「已声明原创 598 3 1 6 10 我几乎…」）
  assert.equal(recs[1].标题, '我几乎没写一行代码，就用 AI 做了条成品级的视频');
  assert.ok(!/^已声明原创|^\d/.test(recs[1].标题));
  assert.equal(recs[1]['曝光/播放量'], '701');

  // 没声明原创的两条不受影响
  assert.equal(recs[2]['曝光/播放量'], '590');
  assert.equal(recs[3]['曝光/播放量'], '951');
  assert.equal(recs[3].标题, '把需求说清楚是东西很贵那个时代的技能');

  // 视频号列表不给收藏，该列一律留空（别写 0，会被复盘当成"没人收藏"）
  assert.ok(recs.every((r) => r.收藏 === ''));
});
