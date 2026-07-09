import { useState, useEffect } from 'react';
import { useStore } from '../store/store';
import { ItemList } from '../components/ItemList';
import { Header } from '../components/Header';

export function Home() {
  const { items, loading, error, stats, fetchItems, submitFeedback, fetchStats } = useStore();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetchItems();
    fetchStats();
  }, [fetchItems, fetchStats]);

  const handleRefresh = async () => {
    await fetchItems();
    await fetchStats();
  };

  const handleFeedback = async (itemId, action) => {
    await submitFeedback(itemId, action);

    // 显示提示
    const messages = {
      'approve': '✅ 已标记为有用',
      'save': '💾 已保存到 Obsidian',
      'skip': '⏭️ 已跳过'
    };

    setToast(messages[action]);
    setTimeout(() => setToast(null), 2000);

    // 刷新统计
    await fetchStats();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-indigo-600 mx-auto mb-4"></div>
          <div className="text-xl text-gray-700 font-medium">正在加载精选内容...</div>
          <div className="text-sm text-gray-500 mt-2">为你筛选最相关的 AI 资讯</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-6xl mb-4">😕</div>
          <div className="text-xl text-red-600 font-bold mb-2">加载失败</div>
          <div className="text-gray-700 mb-6">{error}</div>
          <button
            onClick={handleRefresh}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <Header onRefresh={handleRefresh} stats={stats} />

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        {/* 顶部信息栏 */}
        <div className="bg-white rounded-lg shadow-sm p-5 mb-6 border border-indigo-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1 flex items-center gap-2">
                <span className="text-3xl">📰</span>
                今日精选推荐
              </h2>
              <p className="text-sm text-gray-600">
                从 AI HOT 精选内容中，为你推荐 <strong className="text-indigo-600">{items.length}</strong> 条相关资讯
              </p>
            </div>
            <div className="hidden md:block">
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1 text-gray-600">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span>高相关</span>
                </div>
                <div className="flex items-center gap-1 text-gray-600">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span>精选内容</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 内容列表 */}
        <ItemList
          items={items}
          onFeedback={handleFeedback}
        />

        {/* 底部信息 */}
        {items.length === 0 && !loading && (
          <div className="text-center py-12 bg-white rounded-lg shadow-sm">
            <div className="text-6xl mb-4">🎉</div>
            <div className="text-xl font-medium text-gray-700 mb-2">全部看完了！</div>
            <div className="text-gray-500 mb-6">今天的推荐内容已全部浏览完毕</div>
            <button
              onClick={handleRefresh}
              className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              重新加载
            </button>
          </div>
        )}
      </main>

      {/* Toast 提示 */}
      {toast && (
        <div className="fixed bottom-8 right-8 bg-gray-900 text-white px-6 py-3 rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}
