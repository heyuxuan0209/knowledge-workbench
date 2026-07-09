export default function RightPanel({ currentView, selectedItems, currentChat }) {
  // 今日推送 - 快速操作面板
  if (currentView === 'inbox') {
    return (
      <div className="w-96 border-l border-gray-800 bg-gray-900/30 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">
            选中项: {selectedItems.length}
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedItems.length > 0 ? (
            <>
              {/* Quick Tags */}
              <div className="mb-6">
                <div className="text-xs font-medium text-gray-400 mb-3">🏷️ 快速标签</div>
                <div className="flex flex-wrap gap-2">
                  <button className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                    Multi-agent
                  </button>
                  <button className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                    AI安全
                  </button>
                  <button className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                    GitHub
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="mb-6">
                <div className="text-xs font-medium text-gray-400 mb-3">💾 操作</div>
                <div className="space-y-2">
                  <button className="w-full text-left px-3 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">
                    ☐ 加入工作区
                  </button>
                  <button className="w-full text-left px-3 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">
                    ☐ 保存到资源库
                  </button>
                  <button className="w-full text-left px-3 py-2 bg-gray-800 text-gray-300 text-sm rounded hover:bg-gray-700">
                    ☐ 创建新主题
                  </button>
                </div>
              </div>

              {/* AI Assistant */}
              <div className="mb-6">
                <div className="text-xs font-medium text-gray-400 mb-3">🤖 AI助手</div>
                <textarea
                  placeholder="帮我总结这篇..."
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-300 placeholder-gray-500 resize-none"
                  rows={3}
                />
                <button className="w-full mt-2 py-2 bg-purple-500 text-white text-sm font-medium rounded hover:bg-purple-600">
                  生成
                </button>
              </div>

              {/* Preview */}
              {selectedItems.length === 1 && (
                <div>
                  <div className="text-xs font-medium text-gray-400 mb-3">🔗 译文预览</div>
                  <div className="p-3 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-400 leading-relaxed">
                    {selectedItems[0].summary.slice(0, 200)}...
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <div className="text-gray-600 text-sm">选择内容查看详情</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 工作区对话 - 上下文和产出面板
  if (currentView === 'workspace' && currentChat) {
    return (
      <div className="w-96 border-l border-gray-800 bg-gray-900/30 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h3 className="text-sm font-semibold text-gray-200">上下文 & 产出</h3>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Context Materials */}
          <div className="mb-6">
            <div className="text-xs font-medium text-gray-400 mb-3">📎 上下文材料 (5)</div>
            <div className="space-y-2">
              {['Claude两种模式', 'LangGraph 1.0', 'Agent编排模式', '开源框架对比', 'GitLost案例'].map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2 bg-gray-800/50 rounded border border-gray-700">
                  <input type="checkbox" defaultChecked className="mt-1 flex-shrink-0" />
                  <span className="text-xs text-gray-300">{item}</span>
                </div>
              ))}
            </div>
            <button className="w-full mt-2 py-1.5 text-xs text-gray-500 hover:text-gray-400">
              + 添加材料
            </button>
          </div>

          {/* Generated Output */}
          <div className="mb-6">
            <div className="text-xs font-medium text-gray-400 mb-3">📝 生成的产出</div>
            <div className="p-3 bg-gray-800/50 border border-gray-700 rounded">
              <div className="text-xs text-gray-300 leading-relaxed space-y-2">
                <div className="font-semibold"># 多智能体架构</div>
                <div>## 对比总结</div>
                <div>### Advisor模式</div>
                <div>- 性能92%</div>
                <div>- 成本-63%</div>
                <div className="text-gray-500">...</div>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button className="flex-1 py-1.5 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                📋 复制
              </button>
              <button className="flex-1 py-1.5 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                💾 保存
              </button>
              <button className="flex-1 py-1.5 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">
                📤 发布
              </button>
            </div>
          </div>

          {/* Related Projects */}
          <div>
            <div className="text-xs font-medium text-gray-400 mb-3">🔗 相关项目 (3)</div>
            <div className="space-y-2">
              <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
                <div className="text-xs text-gray-300">langchain/langgraph</div>
                <div className="text-xs text-gray-500">⭐ 12.3k</div>
              </div>
              <div className="p-2 bg-gray-800/50 rounded border border-gray-700">
                <div className="text-xs text-gray-300">anthropic/anthropic-sdk</div>
                <div className="text-xs text-gray-500">⭐ 8.1k</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}
