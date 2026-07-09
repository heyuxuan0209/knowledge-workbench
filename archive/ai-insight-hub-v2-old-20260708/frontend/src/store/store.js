import { create } from 'zustand';
import * as api from '../services/api';

export const useStore = create((set, get) => ({
  items: [],
  loading: false,
  error: null,
  stats: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const data = await api.getItems();
      set({ items: data.items, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },

  submitFeedback: async (itemId, action) => {
    try {
      await api.submitFeedback(itemId, action);

      // 如果是 save，调用导出
      if (action === 'save') {
        await api.exportItem(itemId);
      }

      // 从列表中移除
      set(state => ({
        items: state.items.filter(item => item.id !== itemId)
      }));
    } catch (error) {
      console.error('Feedback error:', error);
      set({ error: error.message });
    }
  },

  fetchStats: async () => {
    try {
      const stats = await api.getStats();
      set({ stats });
    } catch (error) {
      console.error('Stats error:', error);
    }
  }
}));
