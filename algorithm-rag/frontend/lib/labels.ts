export function statusTone(status: string): 'neutral' | 'green' | 'yellow' | 'red' | 'blue' {
  if (status === 'ready') return 'green';
  if (status === 'processing') return 'blue';
  if (status === 'failed') return 'red';
  if (status === 'pending_approval') return 'yellow';
  return 'neutral';
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_approval: '待审核',
    processing: '索引中',
    ready: '可查询',
    failed: '失败',
  };
  return labels[status] || '未知状态';
}

export function kindLabel(kind: string) {
  const labels: Record<string, string> = {
    pdf: 'PDF',
    markdown: 'Markdown',
  };
  return labels[kind] || '未知类型';
}
