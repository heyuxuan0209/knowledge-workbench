import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initSkin } from './components/wb/skin'

initSkin() // 首屏应用已选皮肤，避免默认皮肤闪一下

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
