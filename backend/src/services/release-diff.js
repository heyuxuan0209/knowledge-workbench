// 关键 Release 的确定性段落 diff：不调用模型，事实层只回答“哪段新增/删除/替换”。
// 相邻的删除+新增合并为 changed；段落移动暂时如实显示为一删一增，不假装理解意图。

function chunks(text) {
  const value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!value) return [];
  const paragraphs = value.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : value.split('\n').map(line => line.trim()).filter(Boolean);
}

function lcsOps(before, after) {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      ops.push({ type: 'unchanged', text: before[i] }); i += 1; j += 1;
    } else if (j < after.length && (i === before.length || table[i][j + 1] >= table[i + 1][j])) {
      ops.push({ type: 'added', text: after[j] }); j += 1;
    } else {
      ops.push({ type: 'removed', text: before[i] }); i += 1;
    }
  }
  return ops;
}

function groupOps(ops) {
  const groups = [];
  for (const op of ops) {
    const last = groups.at(-1);
    if (last?.type === op.type) last.lines.push(op.text);
    else groups.push({ type: op.type, lines: [op.text] });
  }
  const merged = [];
  for (let index = 0; index < groups.length; index += 1) {
    const current = groups[index];
    const next = groups[index + 1];
    if (current.type === 'removed' && next?.type === 'added') {
      const paired = Math.min(current.lines.length, next.lines.length);
      if (paired) merged.push({ type: 'changed', before: current.lines.slice(0, paired), after: next.lines.slice(0, paired) });
      if (current.lines.length > paired) merged.push({ type: 'removed', lines: current.lines.slice(paired) });
      if (next.lines.length > paired) merged.push({ type: 'added', lines: next.lines.slice(paired) });
      index += 1;
    } else if (current.type === 'added' && next?.type === 'removed') {
      const paired = Math.min(current.lines.length, next.lines.length);
      if (paired) merged.push({ type: 'changed', before: next.lines.slice(0, paired), after: current.lines.slice(0, paired) });
      if (next.lines.length > paired) merged.push({ type: 'removed', lines: next.lines.slice(paired) });
      if (current.lines.length > paired) merged.push({ type: 'added', lines: current.lines.slice(paired) });
      index += 1;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function diffReleaseText(beforeText, afterText) {
  const before = chunks(beforeText);
  const after = chunks(afterText);
  // 防止异常超长、逐行无空段文本让 O(n*m) 矩阵失控。
  if (before.length > 800 || after.length > 800) throw new Error('版本段落过多，暂不支持在线对比');
  const groups = groupOps(lcsOps(before, after));
  const changedGroups = groups.filter(group => group.type === 'changed');
  return {
    groups,
    stats: {
      added: groups.filter(group => group.type === 'added').reduce((sum, group) => sum + group.lines.length, 0)
        + changedGroups.reduce((sum, group) => sum + Math.max(0, group.after.length - group.before.length), 0),
      removed: groups.filter(group => group.type === 'removed').reduce((sum, group) => sum + group.lines.length, 0)
        + changedGroups.reduce((sum, group) => sum + Math.max(0, group.before.length - group.after.length), 0),
      changed: changedGroups.reduce((sum, group) => sum + Math.min(group.before.length, group.after.length), 0),
      unchanged: groups.filter(group => group.type === 'unchanged').reduce((sum, group) => sum + group.lines.length, 0),
    },
  };
}
