# -*- coding: utf-8 -*-
"""把 platform-export 落到飞书云盘的各平台快照统一解析成一份 JSON。

用法：python3 parse-exports.py <快照目录> > snapshots.json

输出 {平台: {快照日期(YYYYMMDD): {归一化标题: {指标...}}}}，
指标一律归一到：exposure(曝光/阅读人数) / view(观看) / ctr(封面点击率)
/ like / comment / fav / share / fans / extra(平台特有原文)。

各平台格式差异见 platform-export/README.md，这里只做"读+归一"，不做判断。
"""
import sys, os, glob, json, re, csv, warnings

warnings.filterwarnings('ignore')


def norm_title(s):
    """标题归一：去空白与常见标点、转小写。导出与多维表格的标题常差一个空格或大小写。

    弯引号必须一起去（2026-08-11 实测）：多维表格里她打的是「可能“说清楚”只对了一半」，
    公众号后台存的是直引号，只去直引号的话这两个串永远对不上——一篇好文就这么回填不进去。
    """
    return re.sub(r'[\s,，。？?！!、：:；;「」【】《》〈〉""\'\'“”‘’·~～—\-()（）]', '', str(s or '')).lower()


def num(v):
    try:
        return float(str(v).replace('%', '').replace(',', '') or 0)
    except ValueError:
        return 0.0


def parse_xhs(path):
    import openpyxl
    ws = openpyxl.load_workbook(path, data_only=True)['Sheet1']
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    if not rows:
        return {}
    idx = {str(h): i for i, h in enumerate(rows[0])}
    out = {}
    for r in rows[1:]:
        if not r[0]:
            continue
        g = lambda k: num(r[idx[k]]) if k in idx and r[idx[k]] is not None else 0.0
        out[norm_title(r[0])] = dict(
            title=str(r[0]), pub=str(r[idx['首次发布时间']]) if '首次发布时间' in idx else '',
            exposure=g('曝光'), view=g('观看量'), ctr=g('封面点击率'),
            like=g('点赞'), comment=g('评论'), fav=g('收藏'),
            share=g('分享'), fans=g('涨粉'),
        )
    return out


def parse_mp(path):
    """公众号导出是 OLE2 .xls，正文有三块；只取「数据来源概况」，按标题聚合各渠道阅读人数。"""
    import xlrd
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    agg = {}
    for i in range(3, sh.nrows):
        r = sh.row_values(i)
        if len(r) < 15:
            continue
        chan, pub, title, cnt = str(r[11]), str(r[12]), str(r[13]), r[14]
        if not title or not pub or cnt in ('', None):
            continue
        k = norm_title(title)
        rec = agg.setdefault(k, dict(title=title, pub=pub, channels={}))
        rec['channels'][chan] = int(num(cnt))
    out = {}
    for k, rec in agg.items():
        ch = rec['channels']
        out[k] = dict(
            title=rec['title'], pub=rec['pub'],
            exposure=float(ch.get('全部', 0)), view=0.0, ctr=0.0,
            like=0.0, comment=0.0, fav=0.0, share=0.0, fans=0.0,
            extra=' '.join(f'{c}{n}' for c, n in sorted(ch.items(), key=lambda x: -x[1]) if c != '全部'),
        )
    return out


def _pct(v):
    """后台给的是小数（0.5057），复盘里人看的是 50.6%。"""
    return f'{num(v) * 100:.1f}%'


def parse_mp_detail(path):
    """公众号逐篇明细（mp-detail-*.xls / mp-detail-nonotice-*.xls，OLE2 .xls）。

    这是 2026-08-11 才补上的口径：在此之前公众号只有全号汇总，一篇文章只剩一个「阅读 N」，
    N 小根本不等于内容差。这份表把「分发」和「内容」拆开了——
    送达人数（推给了多少人）/ 公众号消息阅读次数（推送里打开多少）/ 分享产生阅读次数（转发带来多少）/
    阅读完成率（读完的比例）。extra 里按这个顺序拼一句人话，直接进多维表格的「传播」列。
    未通知的那份没有送达相关列，按存在与否取。
    """
    import xlrd
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    idx = {str(h).strip(): i for i, h in enumerate(sh.row_values(0))}
    if '内容标题' not in idx:
        return {}
    out = {}
    for i in range(1, sh.nrows):
        r = sh.row_values(i)
        title = str(r[idx['内容标题']]).strip()
        if not title:
            continue
        g = lambda k: num(r[idx[k]]) if k in idx else 0.0
        bits = []
        if '送达人数' in idx:
            bits.append(f'送达{int(g("送达人数"))}')
        bits += [f'消息内打开{int(g("公众号消息阅读次数"))}',
                 f'分享带来{int(g("分享产生阅读次数"))}',
                 f'完读率{_pct(g("阅读完成率"))}']
        out[norm_title(title)] = dict(
            title=title, pub=str(r[idx['发表时间']]) if '发表时间' in idx else '',
            exposure=g('总阅读人数'), view=g('总阅读次数'), ctr=0.0,
            like=0.0, comment=0.0, fav=0.0,
            share=g('总分享人数'), fans=g('阅读后关注人数'),
            extra=' '.join(bits),
        )
    return out


def parse_mp_engage(path):
    """公众号逐篇互动（mp-engage-*.csv，来自发表记录页内联的 publish_page）。

    逐篇明细那份只有阅读侧，没有点赞/在看/评论——这份补上。
    engaged=True 是给回填用的开关：口径纪律是「只在真拿到互动数时才写互动率」，
    在此之前公众号永远拿不到、只能留空；现在拿到了，哪怕真的是 0 赞 0 评也该如实写 0。
    """
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    out = {}
    for r in rows:
        title = (r.get('标题') or '').strip()
        if not title:
            continue
        zaikan = num(r.get('在看'))
        out[norm_title(title)] = dict(
            title=title, pub=(r.get('发布时间') or '').strip(),
            exposure=num(r.get('曝光/播放量')), view=0.0, ctr=0.0,
            like=num(r.get('点赞')), comment=num(r.get('评论')),
            fav=0.0, share=num(r.get('分享/转发')), fans=0.0,
            engaged=True,
            extra=f'在看{int(zaikan)}' if zaikan else '',
        )
    return out


CSV_MAP = {
    'exposure': ('曝光/播放量', '曝光·播放量', '播放量', '曝光'),
    'like': ('点赞',), 'comment': ('评论',), 'fav': ('收藏',),
    'share': ('分享/转发', '分享·转发', '转发', '分享'), 'fans': ('涨粉',),
}


def parse_csv(path):
    with open(path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    out = {}
    for r in rows:
        title = (r.get('标题') or '').strip()
        if not title:
            continue
        rec = dict(title=title, pub=(r.get('发布时间') or '').strip(),
                   view=0.0, ctr=0.0, extra=(r.get('类型') or '').strip())
        for key, names in CSV_MAP.items():
            rec[key] = next((num(r[n]) for n in names if r.get(n) not in (None, '')), 0.0)
        out[norm_title(title)] = rec
    return out


# 顺序有意义：同一天同一篇会被后面的源覆盖，所以**越权威的放越后面**。
# 公众号三个源互补：mp-*.xlsx 只有渠道分布（全号汇总），mp-engage 补点赞/在看/评论，
# mp-detail 是逐篇权威口径（总阅读人数/总分享人数/阅读后关注/送达/完读率），放最后。
PARSERS = [('xhs', 'xhs-*.xlsx', parse_xhs),
           ('公众号', 'mp-2*.xlsx', parse_mp),
           ('公众号', 'mp-engage-*.csv', parse_mp_engage),
           ('公众号', 'mp-detail*.xls', parse_mp_detail),
           ('知乎', 'zhihu-*.csv', parse_csv), ('抖音', 'dy-*.csv', parse_csv),
           ('视频号', 'sph-*.csv', parse_csv)]
PLATFORM = {'xhs': '小红书'}


def merge_entry(dst, src):
    """同一天同一篇、来自不同文件的指标合并。

    规则：有值的覆盖没值的（0/空不覆盖已有的非零值），extra 累加去重。
    这样三份公众号文件谁先谁后都不会互相抹掉——只会越并越全。
    """
    for k, v in src.items():
        if k == 'extra':
            parts = [p for p in (dst.get('extra') or '', v or '') if p]
            dst['extra'] = ' '.join(dict.fromkeys(parts))
        elif v not in (None, '', 0, 0.0, False):
            dst[k] = v
        else:
            dst.setdefault(k, v)


if __name__ == '__main__':
    root = sys.argv[1]
    result, errors = {}, []
    for key, pat, fn in PARSERS:
        plat = PLATFORM.get(key, key)
        for p in sorted(glob.glob(os.path.join(root, pat))):
            # 取**文件名末尾**那串 8 位日期：mp-detail-nonotice-20260811.xls 里只有这一处，
            # 但别的名字里万一还有数字（标题片段之类），末尾锚定更保险。
            m = re.search(r'(\d{8})(?=\.[a-z]+$)', os.path.basename(p))
            if not m:
                continue
            try:
                data = fn(p)
            except Exception as e:  # 单个快照坏掉不该拖垮整轮
                errors.append(f'{os.path.basename(p)}: {e}')
                continue
            if not data:
                continue
            bucket = result.setdefault(plat, {}).setdefault(m.group(1), {})
            for title_key, entry in data.items():
                if title_key in bucket:
                    merge_entry(bucket[title_key], entry)
                else:
                    bucket[title_key] = entry
    json.dump({'snapshots': result, 'errors': errors}, sys.stdout, ensure_ascii=False)
