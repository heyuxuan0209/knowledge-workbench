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
    """标题归一：去空白与常见标点、转小写。导出与多维表格的标题常差一个空格或大小写。"""
    return re.sub(r'[\s,，。？?！!、：:；;「」【】""\'\'·~—\-()（）]', '', str(s or '')).lower()


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


PARSERS = [('xhs', 'xhs-*.xlsx', parse_xhs), ('公众号', 'mp-*.xlsx', parse_mp),
           ('知乎', 'zhihu-*.csv', parse_csv), ('抖音', 'dy-*.csv', parse_csv),
           ('视频号', 'sph-*.csv', parse_csv)]
PLATFORM = {'xhs': '小红书'}

if __name__ == '__main__':
    root = sys.argv[1]
    result, errors = {}, []
    for key, pat, fn in PARSERS:
        plat = PLATFORM.get(key, key)
        for p in sorted(glob.glob(os.path.join(root, pat))):
            m = re.search(r'(\d{8})', os.path.basename(p))
            if not m:
                continue
            try:
                data = fn(p)
            except Exception as e:  # 单个快照坏掉不该拖垮整轮
                errors.append(f'{os.path.basename(p)}: {e}')
                continue
            if data:
                result.setdefault(plat, {})[m.group(1)] = data
    json.dump({'snapshots': result, 'errors': errors}, sys.stdout, ensure_ascii=False)
