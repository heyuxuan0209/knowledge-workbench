export default function NewUserTip({ onDismiss }) {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-6 mb-6">
      <div className="flex items-start justify-between gap-6">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900 mb-3">💡 新手提示</h3>
          <ul className="space-y-2 text-sm text-gray-700">
            <li className="flex items-start">
              <span className="mr-2 text-blue-600 font-medium">1.</span>
              <span>浏览下方内容，点"感兴趣"的会自动追踪相关主题</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2 text-blue-600 font-medium">2.</span>
              <span>相似的内容会自动归类到同一主题</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2 text-blue-600 font-medium">3.</span>
              <span>点"不感兴趣"帮助系统学习你的偏好</span>
            </li>
          </ul>
        </div>
        <button
          onClick={onDismiss}
          className="flex-shrink-0 px-5 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors border border-gray-200"
        >
          知道了
        </button>
      </div>
    </div>
  )
}
