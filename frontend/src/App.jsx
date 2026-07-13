import { useState, useEffect } from 'react'
import OnboardingPage from './pages/OnboardingPage'
import StyleSelectorPage from './pages/StyleSelectorPage'
import WorkspacePage from './pages/WorkspacePage'
import WorkspaceListPage from './pages/WorkspaceListPage'
import WorkspaceDetailPage from './pages/WorkspaceDetailPage'
import ConversationPage from './pages/ConversationPage'

// 临时切回三栏布局（2026-07-13）：新的 Feed + Mode 1 弹窗（FeedPage.jsx）是按
// ADR-011 实现的新架构入口，代码还在，没删——用户想先看一眼三栏布局再决定要不要切换，
// 架构方向的决策先搁置，不是回退这个改动本身。要切回新版时把下面 return 换成 <FeedPage />。
function App() {
  const [step, setStep] = useState('workspace') // onboarding | style | workspace
  const [userInterests, setUserInterests] = useState([])

  // 路由状态
  const [route, setRoute] = useState('main') // main | workspace-list | workspace-detail | conversation
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(null)
  const [currentConversationId, setCurrentConversationId] = useState(null)

  useEffect(() => {
    const completed = localStorage.getItem('onboarding_completed')
    const interests = localStorage.getItem('user_interests')

    if (completed === 'true') {
      setStep('workspace')
      setUserInterests(interests ? JSON.parse(interests) : [])
    }
  }, [])

  const handleOnboardingComplete = (interests) => {
    setUserInterests(interests)
    setStep('style')
  }

  const handleStyleSelect = (style) => {
    localStorage.setItem('onboarding_completed', 'true')
    localStorage.setItem('ui_style', style)
    localStorage.setItem('user_interests', JSON.stringify(userInterests))
    setStep('workspace')
  }

  const handleSkip = () => {
    localStorage.setItem('onboarding_completed', 'true')
    setStep('workspace')
  }

  // 路由处理
  const handleNavigateToWorkspaceList = () => {
    setRoute('workspace-list')
  }

  const handleSelectWorkspace = (workspaceId) => {
    setCurrentWorkspaceId(workspaceId)
    setRoute('workspace-detail')
  }

  const handleSelectConversation = (conversationId) => {
    setCurrentConversationId(conversationId)
    setRoute('conversation')
  }

  const handleBackToMain = () => {
    setRoute('main')
    setCurrentWorkspaceId(null)
    setCurrentConversationId(null)
  }

  const handleBackToWorkspaceList = () => {
    setRoute('workspace-list')
    setCurrentWorkspaceId(null)
    setCurrentConversationId(null)
  }

  const handleBackToWorkspaceDetail = () => {
    setRoute('workspace-detail')
    setCurrentConversationId(null)
  }

  if (step === 'onboarding') {
    return <OnboardingPage onComplete={handleOnboardingComplete} onSkip={handleSkip} />
  }

  if (step === 'style') {
    return <StyleSelectorPage onSelect={handleStyleSelect} />
  }

  // 工作区路由
  if (route === 'workspace-list') {
    return <WorkspaceListPage onSelectWorkspace={handleSelectWorkspace} />
  }

  if (route === 'workspace-detail' && currentWorkspaceId) {
    return (
      <WorkspaceDetailPage
        workspaceId={currentWorkspaceId}
        onBack={handleBackToWorkspaceList}
        onSelectConversation={handleSelectConversation}
      />
    )
  }

  if (route === 'conversation' && currentConversationId) {
    return (
      <ConversationPage
        workspaceId={currentWorkspaceId}
        conversationId={currentConversationId}
        onBack={handleBackToWorkspaceDetail}
      />
    )
  }

  return <WorkspacePage onNavigateToWorkspaces={handleNavigateToWorkspaceList} />
}

export default App
