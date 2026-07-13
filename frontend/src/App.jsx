import FeedPage from './pages/FeedPage'

function App() {
  // 新架构（v2）：直接渲染 FeedPage，去掉旧的 workspace/onboarding 流程。
  // 旧页面已归档至 pages/_legacy（WorkspacePage / OnboardingPage / StyleSelectorPage 等）。
  // 参考: docs/SYNTHESIZED-ARCHITECTURE.md §2（三种使用模式），handoff/HANDOFF-TO-NEW-ARCHITECTURE.md §3。
  return <FeedPage />
}

export default App
