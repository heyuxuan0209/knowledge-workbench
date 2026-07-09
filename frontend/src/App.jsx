import { useState, useEffect } from 'react'
import OnboardingPage from './pages/OnboardingPage'
import StyleSelectorPage from './pages/StyleSelectorPage'
import WorkspacePage from './pages/WorkspacePage'

function App() {
  const [step, setStep] = useState('workspace') // onboarding | style | workspace
  const [userInterests, setUserInterests] = useState([])

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

  if (step === 'onboarding') {
    return <OnboardingPage onComplete={handleOnboardingComplete} onSkip={handleSkip} />
  }

  if (step === 'style') {
    return <StyleSelectorPage onSelect={handleStyleSelect} />
  }

  return <WorkspacePage />
}

export default App
