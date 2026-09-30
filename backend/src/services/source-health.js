import { getDatabase } from '../db/init.js';
import { SOURCE_FETCH_RUNS_SCHEMA } from '../db/migrate-m30.js';

const HEALTH_PRIORITY = { failure: 5, stale: 4, pending: 3, empty: 1, healthy: 1, unsupported: 0, passive: 0 };

export function classifyFetchError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (/abort|timeout|timed out/.test(message)) return 'timeout';
  if (/http\s*40[134]|unauthor|forbidden|cookie|login/.test(message)) return 'auth';
  if (/http\s*429|rate.?limit|too many/.test(message)) return 'rate_limit';
  if (/http\s*5\d\d/.test(message)) return 'upstream';
  if (/parse|json|xml|unexpected token|invalid/.test(message)) return 'parse';
  if (/enotfound|econn|network|fetch failed|socket|dns/.test(message)) return 'network';
  return 'unknown';
}

function ensureSchema(db) {
  db.exec(SOURCE_FETCH_RUNS_SCHEMA);
}

// 账本写失败不能反过来拖垮内容同步；调用方仍会在日志里看到明确错误。
export function recordSourceFetchRun(run, { openDatabase = getDatabase } = {}) {
  if (!run.sourceId) return false;
  const db = openDatabase();
  try {
    ensureSchema(db);
    const startedAt = run.startedAt || new Date().toISOString();
    const finishedAt = run.finishedAt || new Date().toISOString();
    const status = run.status || (run.itemCount > 0 ? 'success' : 'empty');
    db.prepare(`
      INSERT INTO source_fetch_runs
        (source_id, source_platform_id, channel, status, item_count, started_at, finished_at, duration_ms, error_kind, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.sourceId,
      run.sourcePlatformId || null,
      run.channel,
      status,
      Number(run.itemCount) || 0,
      startedAt,
      finishedAt,
      Math.max(0, Number(run.durationMs) || 0),
      run.errorKind || (status === 'failure' ? classifyFetchError(run.error) : null),
      run.error ? String(run.error).slice(0, 500) : null,
    );
    if (run.sourcePlatformId) {
      db.prepare(`
        DELETE FROM source_fetch_runs
        WHERE source_platform_id = ? AND id NOT IN (
          SELECT id FROM source_fetch_runs WHERE source_platform_id = ? ORDER BY id DESC LIMIT 50
        )
      `).run(run.sourcePlatformId, run.sourcePlatformId);
    }
    return true;
  } catch (error) {
    console.error(`[source-health] 运行账本写入失败 source=${run.sourceId}: ${error.message}`);
    return false;
  } finally {
    db.close();
  }
}

export function derivePlatformHealth({ trackMode, latest = null, recentRuns = [], now = Date.now(), staleAfterHours = 72 }) {
  if (trackMode === 'link-only') return { status: 'unsupported', label: '仅登记，不自动抓取' };
  if (trackMode === 'passive') return { status: 'passive', label: '聚合覆盖，非独立抓取' };
  if (!latest) return { status: 'pending', label: '尚无运行记录' };

  const lastAttemptAt = latest.finished_at;
  const lastSuccess = recentRuns.find(run => run.status === 'success' || run.status === 'empty');
  const base = {
    lastAttemptAt,
    lastSuccessAt: lastSuccess?.finished_at || null,
    itemCount: latest.item_count || 0,
    durationMs: latest.duration_ms || 0,
  };
  if (latest.status === 'unsupported') {
    return { ...base, status: 'unsupported', label: '采集通道暂不可用', detail: latest.error_message || null };
  }
  if (latest.status === 'failure') {
    let consecutiveFailures = 0;
    for (const run of recentRuns) {
      if (run.status !== 'failure') break;
      consecutiveFailures++;
    }
    return {
      ...base,
      status: 'failure',
      label: consecutiveFailures > 1 ? `连续失败 ${consecutiveFailures} 次` : '最近抓取失败',
      detail: latest.error_message || latest.error_kind || '未知错误',
      errorKind: latest.error_kind || 'unknown',
      consecutiveFailures,
    };
  }
  const ageHours = (now - new Date(lastAttemptAt).getTime()) / 36e5;
  if (Number.isFinite(ageHours) && ageHours > staleAfterHours) {
    return { ...base, status: 'stale', label: `${Math.floor(ageHours / 24)} 天未检查` };
  }
  if (latest.status === 'empty') return { ...base, status: 'empty', label: '检查正常，暂无更新' };
  return { ...base, status: 'healthy', label: `抓取正常 · ${latest.item_count || 0} 条` };
}

export function attachSourceHealth(db, sources, { now = Date.now() } = {}) {
  ensureSchema(db);
  const runStmt = db.prepare(`
    SELECT status, item_count, started_at, finished_at, duration_ms, error_kind, error_message
    FROM source_fetch_runs
    WHERE source_platform_id = ?
    ORDER BY id DESC LIMIT 20
  `);
  for (const source of sources) {
    for (const platform of source.platforms || []) {
      const runs = runStmt.all(platform.id);
      platform.health = derivePlatformHealth({ trackMode: platform.track_mode, latest: runs[0] || null, recentRuns: runs, now });
    }
    const healths = (source.platforms || []).map(platform => platform.health).filter(Boolean);
    source.health = healths.sort((a, b) => (HEALTH_PRIORITY[b.status] || 0) - (HEALTH_PRIORITY[a.status] || 0))[0]
      || { status: 'pending', label: '尚无采集身份' };
  }
  return sources;
}
