import { ItemCard } from './ItemCard';

export function ItemList({ items, onFeedback }) {
  if (!items || items.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-lg">暂无内容</p>
        <p className="text-gray-400 text-sm mt-2">点击右上角刷新按钮获取最新内容</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {items.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          onFeedback={onFeedback}
        />
      ))}
    </div>
  );
}
