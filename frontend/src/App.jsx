import { useState, useEffect } from 'react'
import OnboardingPage from './pages/OnboardingPage'
import StyleSelectorPage from './pages/StyleSelectorPage'
import WorkspacePage from './pages/WorkspacePage'
import WorkspaceListPage from './pages/WorkspaceListPage'
import WorkspaceDetailPage from './pages/WorkspaceDetailPage'
import ConversationPage from './pages/ConversationPage'

function App() {
  const [step, setStep] = useState('workspace') // onboarding | style | workspace
  const [userInterests, setUserInterests] = useState([])

  // 新增：路由状态
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
