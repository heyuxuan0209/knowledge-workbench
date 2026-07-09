export default function TopicCreatedModal({ topic, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-xl font-semibold text-gray-900">
            ✅ 已标记为"感兴趣"
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="mb-8">
          <p className="text-base text-gray-800 mb-6">
            🎉 太好了！我帮你创建了一个新主题：
          </p>
          
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-6 mb-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-3">
              📁 主题名称：{topic.name}
            </h3>
            <p className="text-sm text-gray-700 font-medium mb-3">
              📊 已归入此主题的内容 ({topic.relatedItems.length}篇)：
            </p>
            <ul className="space-y-2">
              {topic.relatedItems.map((relatedItem, idx) => (
                <li key={idx} className="text-sm text-gray-600 flex items-start">
                  <span className="mr-2">•</span>
                  <span>
                    {relatedItem.title}
                    {relatedItem.similarity && (
                      <span className="ml-2 text-xs text-blue-600">
                        (相似度 {relatedItem.similarity})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <p className="text-sm font-semibold text-gray-900 mb-4">下一步你可以：</p>
            <div className="space-y-2.5">
              <button className="w-full px-5 py-3.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors text-left flex items-center">
                <span className="mr-3">🔔</span>
                <div>
                  <div className="font-semibold">开启追踪</div>
                  <div className="text-xs text-blue-100 mt-0.5">未来此主题有新内容时通知我</div>
                </div>
              </button>
              <button className="w-full px-5 py-3.5 bg-gray-50 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-100 transition-colors text-left flex items-center border border-gray-100">
                <span className="mr-3">🔬</span>
                <div>
                  <div className="font-semibold">深度研究</div>
                  <div className="text-xs text-gray-500 mt-0.5">现在就进入研究工作区分析这{topic.relatedItems.length}篇</div>
                </div>
              </button>
              <button className="w-full px-5 py-3.5 bg-gray-50 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-100 transition-colors text-left flex items-center border border-gray-100">
                <span className="mr-3">✏️</span>
                <span>改名 - 我想叫它别的名字</span>
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          🔔 开启追踪并继续浏览
        </button>
      </div>
    </div>
  )
}
