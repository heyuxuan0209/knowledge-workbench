import { useState } from 'react'

const STEPS = [
  { title: '发现信息', page: 'feed', route: '资讯', summary: '从稳定信源里找到值得看的少数内容。', detail: '外面的信息太多，先把注意力留给真正重要的东西。', jobs: ['多源采集与去重', '今日必读与话题聚合', '自定义关注的人和信源'] },
  { title: '解读与筛选', page: 'feed', route: '资讯 · 快速分析', summary: '读懂链接、视频和文档，判断是否值得留。', detail: 'AI 负责读、译、摘要，你决定哪些值得进入自己的知识体系。', jobs: ['链接、视频、播客与文档解读', '多篇素材一起追问', '保留原文与来源证据'] },
  { title: '沉淀素材', page: 'notes', route: '素材', summary: '把外部资料和自己的经验放进同一个库。', detail: '把自己的坑、经验和想法与外部信息一起收进来。', jobs: ['一键存为素材', '语义搜索找回旧内容', '按主题归类与去重'] },
  { title: '形成主题与判断', page: 'topics', route: '主题 · 灵感', summary: '让零散素材相互碰撞，长成可持续的认知。', detail: '主题是一篇会随新证据持续更新的综述，不是标签文件夹。', jobs: ['素材归入主题', '综述、冲突观点与修订记录', '从灵感升级为可写主题'] },
  { title: '创作母稿', page: 'studio', route: '创作 · 定稿', summary: '带着真实素材和核心判断，写出一份干净深稿。', detail: '先写清价值和结构，不在母稿阶段被平台格式带偏。', jobs: ['从主题或多条素材起稿', '段落级溯源与观点校验', '在飞书文档中评审与定稿'] },
  { title: '多平台适配与发布', page: 'studio', route: '创作 · 出片', summary: '把同一个判断，变成各平台真正能发的形态。', detail: '核心判断不变，表达形态随平台的阅读方式改变。', jobs: ['公众号排版与头图', '小红书/抖音图卡与口播稿', '辅助送到平台后台，最后由人确认'] },
  { title: '数据回流与复盘', externalUrl: 'https://feishu.cn/base/QIlkbwmGma9Tb1sRyAicfZeEnjb?table=tblL11CZzfQSxIy9', route: '飞书多维表格 · 发布与复盘', summary: '让发出去的内容带着真实结果回到下一轮。', detail: '复盘不在 KW 内重建一份数据。发布记录、D3/D7/D30 指标和验证结论的真实入口在飞书多维表格。', jobs: ['D3 / D7 / D30 数据回收', '多平台横向对照', '把复盘结论反馈给下一次选题'] },
]

export default function OverviewView({ setPage, setStudioTab }) {
  const [active, setActive] = useState(0)
  const step = STEPS[active]
  const enter = () => {
    localStorage.setItem('wb-overview-seen', '1')
    if (step.externalUrl) {
      window.open(step.externalUrl, '_blank', 'noopener,noreferrer')
      return
    }
    if (active === 5) setStudioTab?.('film')
    setPage(step.page)
  }

  return <div className="wb-overview">
    <div className="wb-overview-kicker">START HERE · 新手导航</div>
    <div className="wb-page-title">一条内容，在这里怎么长出来</div>
    <div className="wb-page-sub">从外部信息和你的一手经验出发，经过筛选、理解和判断，变成能发布的内容，再让真实数据回来帮助下一次决策。</div>
    <div className="wb-overview-rule"><b>人</b>做观点、品味和判断 <span>/</span> <b>AI</b>做采集、整理、适配和反馈</div>

    <div className="wb-overview-flow">
      {STEPS.map((item, index) => <button key={item.title} className={`wb-overview-step${index === active ? ' active' : ''}`} onClick={() => setActive(index)}>
        <span className="wb-overview-num">{String(index + 1).padStart(2, '0')}</span>
        <b>{item.title}</b><span>{item.summary}</span><em>{item.route}</em>
      </button>)}
    </div>

    <div className="wb-card wb-overview-detail">
      <div>
        <div className="wb-card-label">STEP {String(active + 1).padStart(2, '0')}</div>
        <h2>{step.title}</h2><p>{step.detail}</p>
        <div className="wb-overview-jobs">{step.jobs.map(job => <div key={job}>{job}</div>)}</div>
      </div>
      <div className="wb-overview-enter">
        <span>对应现有页面</span><strong>{step.route}</strong>
        <button className="wb-btn-primary" onClick={enter}>{step.externalUrl ? '在飞书打开 ↗' : '进入这一步 →'}</button>
      </div>
    </div>
  </div>
}
