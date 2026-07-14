// 图标集：全部取自原型的内联描边 SVG（16px 网格，stroke=currentColor）

const S = ({ size = 16, sw = 1.5, style, children }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}>{children}</svg>
)

export const IconFeed = () => (
  <S><rect x="2" y="3" width="12" height="10" rx="1.5" /><line x1="4.5" y1="6" x2="11.5" y2="6" /><line x1="4.5" y1="8.5" x2="11.5" y2="8.5" /><line x1="4.5" y1="11" x2="8.5" y2="11" /></S>
)
export const IconNotes = () => (
  <S><rect x="2.5" y="2.5" width="10" height="11" rx="1.5" /><line x1="5" y1="5.5" x2="10" y2="5.5" /><line x1="5" y1="8" x2="10" y2="8" /><line x1="5" y1="10.5" x2="8" y2="10.5" /></S>
)
export const IconTopics = () => (
  <S><path d="M2 5a1 1 0 0 1 1-1h3l1.3 1.6H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></S>
)
export const IconStudio = () => (
  <S><path d="M11.4 2.4 13.6 4.6 5.4 12.8 2.8 13.4 3.4 10.8z" /><line x1="10" y1="4" x2="12" y2="6" /></S>
)
export const IconSources = () => (
  <S><circle cx="6" cy="6" r="2.3" /><path d="M2.4 13c0-2 1.6-3.3 3.6-3.3S9.6 11 9.6 13" /><path d="M10.2 4.2a2.1 2.1 0 0 1 0 3.9" /><path d="M11.2 13c0-1.7-.8-2.8-2-3.3" /></S>
)
export const IconSettings = () => (
  <S><line x1="2.5" y1="5" x2="13.5" y2="5" /><line x1="2.5" y1="11" x2="13.5" y2="11" /><circle cx="6" cy="5" r="1.7" fill="#faf8f2" /><circle cx="10.5" cy="11" r="1.7" fill="#faf8f2" /></S>
)
export const IconChevronLeft = ({ style }) => (
  <S size={16} sw={1.6} style={style}><path d="M10 4l-4 4 4 4" /></S>
)
export const IconChevronRight = ({ size = 15, style }) => (
  <S size={size} sw={1.6} style={style}><path d="M6 4l4 4-4 4" /></S>
)
export const IconCaret = ({ style }) => (
  <S size={12} style={style}><path d="M6 4l5 4-5 4" /></S>
)
export const IconChat = ({ size = 12 }) => (
  <S size={size}><path d="M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6l-3 2.5V10.4z" /></S>
)
export const IconTag = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinejoin="round" style={{ marginRight: 4 }}><path d="M2.5 2.5h5L14 9l-5 5-6.5-6.5z" /><circle cx="5.2" cy="5.2" r="1" /></svg>
)
export const IconExternal = ({ size = 11, style }) => (
  <S size={size} sw={1.6} style={style}><path d="M5 11 11 5" /><path d="M6 5h5v5" /></S>
)
export const IconClip = () => (
  <S size={11} sw={1.6} style={{ verticalAlign: '-1px', marginRight: 4 }}><path d="M11.5 6.5 6.3 11.7a2.2 2.2 0 0 1-3.1-3.1l5.3-5.3a1.4 1.4 0 0 1 2 2L5.2 10.6" /></S>
)
export const IconTrash = () => (
  <S size={13} style={{ verticalAlign: '-2px' }}><path d="M3 4.5h10" /><path d="M6.4 4.5V3h3.2v1.5" /><path d="M4.7 4.5 5.3 13h5.4l.6-8.5" /></S>
)
export const IconBolt = () => (
  <S size={11} sw={1.6} style={{ verticalAlign: '-1px', marginRight: 3 }}><path d="M8.5 2 4 9h3l-.5 5L11 7H8z" /></S>
)
export const IconWarn = () => (
  <S size={13} sw={1.5} style={{ flexShrink: 0 }}><path d="M8 2.5 14 13H2z" /><line x1="8" y1="6.5" x2="8" y2="9.5" /><circle cx="8" cy="11.3" r="0.4" /></S>
)
export const IconChart = ({ size = 15 }) => (
  <S size={size}><line x1="3" y1="13" x2="13" y2="13" /><line x1="5" y1="13" x2="5" y2="8" /><line x1="8" y1="13" x2="8" y2="5" /><line x1="11" y1="13" x2="11" y2="9.5" /></S>
)
export const IconSend = () => (
  <S size={15} sw={1.6}><path d="M8 12.5v-9" /><path d="M4.5 7 8 3.5 11.5 7" /></S>
)
export const IconDoc = ({ size = 13 }) => (
  <S size={size}><rect x="3" y="2.5" width="10" height="11" rx="1.2" /><line x1="5.5" y1="5.5" x2="10.5" y2="5.5" /><line x1="5.5" y1="8" x2="10.5" y2="8" /><line x1="5.5" y1="10.5" x2="8.5" y2="10.5" /></S>
)
export const IconBulb = ({ size = 13 }) => (
  <S size={size}><path d="M8 2.2a3.8 3.8 0 0 1 2.2 6.9c-.5.4-.7.9-.7 1.4H6.5c0-.5-.2-1-.7-1.4A3.8 3.8 0 0 1 8 2.2z" /><line x1="6.6" y1="12.4" x2="9.4" y2="12.4" /><line x1="7" y1="14" x2="9" y2="14" /></S>
)
