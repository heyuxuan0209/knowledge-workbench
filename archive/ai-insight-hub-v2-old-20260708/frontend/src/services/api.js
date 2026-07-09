const API_BASE = '/api';

export async function getItems(params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${API_BASE}/items${queryString ? `?${queryString}` : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch items: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

export async function submitFeedback(itemId, action) {
  const response = await fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item_id: itemId,
      action: action
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to submit feedback: ${response.statusText}`);
  }

  return response.json();
}

export async function exportItem(itemId) {
  const response = await fetch(`${API_BASE}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item_id: itemId
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to export item: ${response.statusText}`);
  }

  return response.json();
}

export async function getStats() {
  const response = await fetch(`${API_BASE}/items/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}
