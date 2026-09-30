export function channelStatus(result) {
  if (!result) return 'failure';
  if (result.status) return result.status;
  return result.success === false ? 'failure' : 'success';
}

export function summarizeChannelStatuses(channels) {
  const entries = Object.entries(channels).map(([name, result]) => ({ name, status: channelStatus(result) }));
  const active = entries.filter(entry => entry.status !== 'skipped');
  let status = 'success';
  if (!active.length) status = 'skipped';
  else if (active.every(entry => entry.status === 'failure')) status = 'failure';
  else if (active.some(entry => entry.status === 'failure' || entry.status === 'partial')) status = 'partial';
  return { status, channels: Object.fromEntries(entries.map(entry => [entry.name, entry.status])) };
}
