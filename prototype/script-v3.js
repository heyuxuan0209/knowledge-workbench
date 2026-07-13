// ========== 状态管理 ==========
let selectedCards = new Set();

// ========== 主输入框交互 ==========
const mainInput = document.getElementById('mainInput');
const analyzeBtn = document.getElementById('analyzeBtn');

// 自动调整 textarea 高度
mainInput.addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
    
    // 启用/禁用分析按钮
    analyzeBtn.disabled = e.target.value.trim().length === 0;
});

// 点击分析按钮
analyzeBtn.addEventListener('click', () => {
    const input = mainInput.value.trim();
    if (input) {
        handleUserInput(input);
    }
});

// 处理用户输入
function handleUserInput(input) {
    console.log('分析输入:', input);
    
    // 检测输入类型
    if (isURL(input)) {
        const platform = detectPlatform(input);
        alert(`检测到 ${platform} 链接\n\n正在获取内容...`);
    } else {
        alert(`检测到文本内容 (${input.length} 字)\n\n开始分析...`);
    }
    
    // 实际应用中这里会调用后端 API
}

function isURL(str) {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
    if (url.includes('feishu.cn') || url.includes('larksuite.com')) return '飞书文档';
    if (url.includes('xiaohongshu.com')) return '小红书';
    if (url.includes('mp.weixin.qq.com')) return '公众号';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'X (Twitter)';
    if (url.includes('arxiv.org')) return 'arXiv 论文';
    return '网页';
}

// ========== 输入选项按钮 ==========
const uploadFileBtn = document.getElementById('uploadFileBtn');
const feishuBtn = document.getElementById('feishuBtn');
const obsidianBtn = document.getElementById('obsidianBtn');
const fileInput = document.getElementById('fileInput');

uploadFileBtn.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        alert(`已选择文件: ${file.name}\n大小: ${(file.size / 1024).toFixed(1)} KB\n\n开始分析...`);
    }
});

feishuBtn.addEventListener('click', () => {
    alert('飞书文档使用方法：\n\n1. 在飞书中打开文档\n2. 全选复制内容 (Cmd+A, Cmd+C)\n3. 粘贴到上方输入框\n4. 点击"开始分析"');
});

obsidianBtn.addEventListener('click', () => {
    alert('Obsidian 使用方法：\n\n1. 导出笔记为 .md 文件\n2. 点击"上传文件"按钮\n3. 选择 .md 文件\n\n或者直接复制笔记内容粘贴到输入框');
});

// ========== Feed 卡片选择 ==========
const feedCards = document.querySelectorAll('.feed-card-compact');
const analyzeSelectedBtn = document.getElementById('analyzeSelectedBtn');
const selectedCountMain = document.getElementById('selectedCountMain');

feedCards.forEach(card => {
    const checkbox = card.querySelector('input[type="checkbox"]');
    const cardId = card.dataset.id;
    
    // 点击卡片（除了复选框）切换选中
    card.addEventListener('click', (e) => {
        if (e.target.type !== 'checkbox') {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        }
    });
    
    // 复选框变化
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            selectedCards.add(cardId);
            card.style.borderColor = 'var(--accent-primary)';
        } else {
            selectedCards.delete(cardId);
            card.style.borderColor = 'var(--border-light)';
        }
        updateSelectedCount();
    });
});

function updateSelectedCount() {
    const count = selectedCards.size;
    
    if (count > 0) {
        analyzeSelectedBtn.style.display = 'flex';
        selectedCountMain.textContent = count;
    } else {
        analyzeSelectedBtn.style.display = 'none';
    }
}

analyzeSelectedBtn.addEventListener('click', () => {
    alert(`开始分析已选中的 ${selectedCards.size} 篇内容...`);
    console.log('选中的卡片 ID:', Array.from(selectedCards));
});

// ========== 视图切换 ==========
const mainView = document.getElementById('mainView');
const feedView = document.getElementById('feedView');
const viewAllFeedBtn = document.getElementById('viewAllFeedBtn');
const backToMainBtn = document.getElementById('backToMainBtn');

viewAllFeedBtn.addEventListener('click', () => {
    mainView.style.display = 'none';
    feedView.style.display = 'block';
    renderFullFeed();
});

backToMainBtn.addEventListener('click', () => {
    feedView.style.display = 'none';
    mainView.style.display = 'block';
});

// ========== 渲染完整 Feed ==========
function renderFullFeed() {
    const feedContent = document.querySelector('.feed-content');
    
    const fullFeedData = [
        {
            id: '1',
            author: 'Rohan Paul',
            handle: '@rohanpaul_ai',
            featured: true,
            score: 75,
            title: '马斯克承认对 Anthropic 判断有误，称其是当前 AI 领域领导者',
            summary: '马斯克竞争对手在X上发文承认自己此前对Anthropic的判断有误，称其"显然是当前AI领域的领导者"。他表示，没有公司发布过像Mythos/Fable这样优秀的模型，并相信Anthropic很快会推出Mythos 2。他还强调，即使作为竞争对手，也不会以伤害对方的方式切断合作，并列举了特斯拉开源专利、开放超级充电网络等先例。该推文被Rohan Paul转发，称这是Anthropic"最强有力的炫耀"。',
            originalText: 'Elon Musk: I was clearly wrong about Anthropic. They are obviously currently the leader in AI. No company has released a model as good as Mythos/Fable and they will undoubtedly have Mythos 2 ready soon. And I would never cut them off in a way that hurts them badly, even as a competitor. That\'s not my style. Tesla open sourced its patents and we made the Supercharger network available to all competitors, even though we could have made it a walled garden. SpaceX launches competing satellite systems with no increase in price or use of unfair terms. Even my worst enemies can attack me on this platform.',
            tags: ['Anthropic', 'xAI', '大传观点'],
            source: 'X (Twitter)',
            time: '2h ago',
            comments: 3,
            recommendation: '马斯克难得认错，直接称 Anthropic 是当前 AI 领域的领导者，这不仅表态可能重塑行业竞争叙事。不过更关键的是他提到 Mythos 2 快来了，这才是真正的信号。'
        },
        {
            id: '2',
            author: 'Eugene Yan',
            handle: '@eugeneyan',
            featured: false,
            score: 82,
            title: 'RAG 系统的 7 个常见陷阱及解决方案',
            summary: '许多团队在构建 RAG 系统时会遇到性能瓶颈。本文总结了从检索质量、上下文窗口管理到成本控制的 7 个关键问题，并提供了实用的解决方案。包括：1) 检索精度不足导致相关内容缺失；2) 上下文窗口浪费在不相关片段；3) 重排序策略选择不当；4) Token 成本快速增长；5) 响应延迟过高；6) 缓存策略缺失；7) 评估指标不完善。每个问题都配有实际案例和代码示例。',
            tags: ['RAG', '检索增强', '工程实践'],
            source: 'Blog',
            time: '1d ago',
            readTime: '15 min',
            recommendation: '非常实用的工程经验总结，作者在 Netflix 和 Amazon 都做过大规模 RAG 系统。特别推荐第 3 和第 6 部分关于重排序和缓存的内容。'
        },
        {
            id: '3',
            author: 'Andrew Ng',
            handle: '@AndrewYNg',
            featured: true,
            score: 88,
            title: 'Agent 架构演进：从 ReAct 到 Multi-Agent 系统',
            summary: '探讨 AI Agent 架构的演进路径，从简单的 ReAct 模式到复杂的多智能体协作系统，分析各自的适用场景和技术挑战。文章首先回顾了 ReAct（Reasoning + Acting）框架的核心思想，然后介绍了 Plan-and-Execute、ReWOO 等改进方案。重点讨论了多智能体系统中的角色分工、通信协议、冲突解决机制。最后提出了一个统一的评估框架，用于比较不同 Agent 架构的性能。',
            tags: ['Agent', '多智能体', '架构设计'],
            source: 'Paper',
            time: '3d ago',
            venue: 'arXiv',
            recommendation: '吴恩达老师的新论文，系统性地梳理了 Agent 架构的发展脉络。对于想深入理解 Agent 设计的同学很有帮助。'
        }
    ];
    
    feedContent.innerHTML = fullFeedData.map(item => `
        <div class="feed-card-full" data-id="${item.id}">
            <div class="card-header">
                <div class="author-info">
                    <div class="avatar-small"></div>
                    <span class="author-name">${item.author}</span>
                    <span class="author-handle">${item.handle}</span>
                </div>
                <div class="card-badges">
                    ${item.featured ? '<span class="badge-featured">精选</span>' : ''}
                    <span class="badge-score">${item.score}</span>
                </div>
            </div>
            
            <h3 class="card-title">${item.title}</h3>
            
            <div class="card-summary-full">${item.summary}</div>
            
            ${item.originalText ? `
                <details class="card-original">
                    <summary>查看英文原文</summary>
                    <blockquote>${item.originalText}</blockquote>
                </details>
            ` : ''}
            
            <div class="card-tags">
                ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
            
            <div class="card-meta">
                <span class="source-badge">${item.source}</span>
                <span class="separator">·</span>
                <span>${item.time}</span>
                ${item.readTime ? `<span class="separator">·</span><span>${item.readTime}</span>` : ''}
                ${item.comments ? `<span class="separator">·</span><span>${item.comments} 条讨论</span>` : ''}
            </div>
            
            ${item.recommendation ? `
                <div class="card-recommendation">
                    <strong>推荐理由：</strong>${item.recommendation}
                </div>
            ` : ''}
            
            <div class="card-actions">
                <button class="btn-card-action btn-select-full">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                    </svg>
                    <span>选中分析</span>
                </button>
                <button class="btn-card-action">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                    </svg>
                    <span>保存</span>
                </button>
            </div>
        </div>
    `).join('');
    
    // 添加完整卡片样式
    const style = document.createElement('style');
    style.textContent = `
        .feed-card-full {
            background: var(--bg-elevated);
            border: 1px solid var(--border-light);
            border-radius: 14px;
            padding: 1.5rem;
            margin-bottom: 1rem;
            transition: all 0.2s;
        }
        
        .feed-card-full:hover {
            border-color: var(--border-default);
            box-shadow: 0 2px 12px rgba(45, 37, 32, 0.06);
        }
        
        .card-summary-full {
            font-size: 0.9375rem;
            line-height: 1.65;
            color: var(--text-primary);
            margin-bottom: 1rem;
        }
        
        .card-original {
            margin-bottom: 1rem;
        }
        
        .card-original summary {
            font-size: 0.8125rem;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 0.5rem;
            background: var(--bg-sidebar);
            border-radius: 6px;
            font-weight: 500;
        }
        
        .card-original blockquote {
            margin-top: 0.5rem;
            padding: 0.875rem;
            background: var(--bg-sidebar);
            border-left: 3px solid var(--accent-primary);
            font-size: 0.875rem;
            line-height: 1.6;
            color: var(--text-secondary);
            font-style: italic;
            border-radius: 6px;
        }
        
        .card-tags {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 0.875rem;
        }
        
        .tag {
            background: rgba(176, 99, 27, 0.08);
            color: var(--accent-primary);
            padding: 0.25rem 0.625rem;
            border-radius: 5px;
            font-size: 0.75rem;
            font-weight: 530;
        }
        
        .card-recommendation {
            background: rgba(176, 99, 27, 0.06);
            border-left: 3px solid var(--accent-primary);
            padding: 0.875rem;
            margin-bottom: 1rem;
            font-size: 0.875rem;
            line-height: 1.6;
            border-radius: 6px;
        }
        
        .card-recommendation strong {
            color: var(--accent-primary);
            font-weight: 590;
        }
        
        .card-actions {
            display: flex;
            gap: 0.5rem;
        }
        
        .btn-card-action {
            background: transparent;
            border: 1px solid var(--border-default);
            border-radius: 8px;
            padding: 0.5rem 0.875rem;
            font-size: 0.8125rem;
            font-weight: 500;
            color: var(--text-secondary);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 0.375rem;
            transition: all 0.15s;
        }
        
        .btn-card-action:hover {
            border-color: var(--accent-primary);
            color: var(--accent-primary);
            background: rgba(176, 99, 27, 0.04);
        }
        
        .btn-select-full.active {
            background: rgba(176, 99, 27, 0.08);
            border-color: var(--accent-primary);
            color: var(--accent-primary);
        }
    `;
    document.head.appendChild(style);
    
    // 绑定完整卡片的选中事件
    document.querySelectorAll('.btn-select-full').forEach(btn => {
        btn.addEventListener('click', function() {
            this.classList.toggle('active');
            const svg = this.querySelector('svg');
            if (this.classList.contains('active')) {
                svg.setAttribute('fill', 'currentColor');
                this.querySelector('span').textContent = '已选中';
            } else {
                svg.removeAttribute('fill');
                this.querySelector('span').textContent = '选中分析';
            }
            updateFullFeedSelection();
        });
    });
}

function updateFullFeedSelection() {
    const selected = document.querySelectorAll('.btn-select-full.active').length;
    const selectedPanel = document.getElementById('selectedItemsPanel');
    const selectedCount = document.getElementById('selectedCount');
    const selectedList = document.getElementById('selectedList');
    
    if (selected > 0) {
        selectedPanel.style.display = 'block';
        selectedCount.textContent = selected;
        
        // 更新列表
        const titles = Array.from(document.querySelectorAll('.feed-card-full'))
            .filter(card => card.querySelector('.btn-select-full.active'))
            .map(card => card.querySelector('.card-title').textContent);
        
        selectedList.innerHTML = titles.map(title => 
            `<div style="font-size: 0.75rem; color: var(--text-secondary); padding: 0.25rem 0; line-height: 1.5;">• ${title}</div>`
        ).join('');
    } else {
        selectedPanel.style.display = 'none';
    }
}

// 开始分析按钮（右侧面板）
const startAnalysisBtn = document.getElementById('startAnalysisBtn');
if (startAnalysisBtn) {
    startAnalysisBtn.addEventListener('click', () => {
        const count = document.getElementById('selectedCount').textContent;
        alert(`开始分析已选中的 ${count} 篇内容...\n\n正在启动 AI 对话界面...`);
    });
}

console.log('✅ Knowledge Workbench 原型已加载');
console.log('💡 支持的操作：');
console.log('   - 在主输入框粘贴链接或文本');
console.log('   - 点击"上传文件"选择 PDF/Markdown');
console.log('   - 从 Feed 中选择内容进行分析');
console.log('   - 点击"查看全部"进入完整 Feed 视图');
