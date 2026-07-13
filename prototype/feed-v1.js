let selectedCards = new Set();
let allContents = [];

const contentTypeLabel = {
    article: 'Article', video: 'Video', tweet: 'X (Twitter)',
    paper: 'Paper', repo: 'GitHub', text: 'Text'
};

function timeAgo(isoString) {
    const diff = Date.now() - new Date(isoString).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function renderCard(item) {
    const hasAuthor = Boolean(item.display_name);
    const authorHtml = hasAuthor
        ? `<div class="card-author">
             <span class="authority-tag unrated">未标注可信度</span>
             <span class="author-name">${item.display_name}</span>
             <span class="author-handle">${item.platform} · @${item.handle}</span>
           </div>`
        : `<div class="card-author"><span class="no-author">来源：媒体转载，未识别到具体作者</span></div>`;

    return `
    <div class="feed-card" data-id="${item.id}">
        <div class="card-header">
            ${authorHtml}
            <span class="card-score">评分 ${item.external_score}</span>
        </div>
        <h3 class="card-title">${item.zh_title}</h3>
        <div class="card-summary">${item.zh_summary}</div>
        <div class="card-meta">
            <span class="type-badge">${contentTypeLabel[item.content_type] || item.content_type}</span>
            <span>·</span>
            <span>${timeAgo(item.published_at)}</span>
        </div>
        <div class="card-actions">
            <button class="btn-select" data-id="${item.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                <span>选中分析</span>
            </button>
            <button class="btn-topic">加入研究 Topic</button>
        </div>
    </div>`;
}

const API_BASE = 'http://localhost:3000';

async function loadFeed() {
    const feedListEl = document.getElementById('feedList');
    try {
        const res = await fetch(`${API_BASE}/api/contents?limit=30`);
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'API returned success:false');

        // API 字段名是 source_display_name/source_platform/source_handle（JOIN 出来的列名），
        // renderCard() 期望的是 display_name/platform/handle，这里做一次映射而不改 renderCard，
        // 保持 renderCard 与本地样本数据、未来其他数据源的字段约定一致。
        allContents = json.data.map(item => ({
            ...item,
            display_name: item.source_display_name,
            platform: item.source_platform,
            handle: item.source_handle
        }));

        document.getElementById('feedCount').textContent =
            `共 ${allContents.length} 条 · 实时来自 GET /api/contents（backend/data/app.db）`;
        feedListEl.innerHTML = allContents.map(renderCard).join('');
        bindCardEvents();
    } catch (err) {
        feedListEl.innerHTML = `<div class="loading">加载失败：${err.message}（请确认 backend 已启动在 :3000）</div>`;
    }
}

function bindCardEvents() {
    document.querySelectorAll('.feed-card').forEach(card => {
        const id = card.dataset.id;
        const selectBtn = card.querySelector('.btn-select');

        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-topic')) return;
            toggleSelection(card, id);
        });
    });
}

function toggleSelection(card, id) {
    const btn = card.querySelector('.btn-select');
    if (selectedCards.has(id)) {
        selectedCards.delete(id);
        card.classList.remove('selected');
        btn.classList.remove('active');
    } else {
        selectedCards.add(id);
        card.classList.add('selected');
        btn.classList.add('active');
    }
    updatePanel();
}

function updatePanel() {
    const container = document.getElementById('selectedItemsContainer');
    const emptyState = document.getElementById('emptyState');
    const count = document.getElementById('selectedCount');
    const list = document.getElementById('selectedItemsList');
    const railBadge = document.getElementById('railBadge');

    if (selectedCards.size > 0) {
        container.style.display = 'block';
        emptyState.style.display = 'none';
        count.textContent = selectedCards.size;
        list.innerHTML = Array.from(selectedCards).map(id => {
            const item = allContents.find(c => c.id === id);
            return `<div style="font-size:0.75rem;color:var(--text-secondary);padding:0.25rem 0;">• ${item.zh_title}</div>`;
        }).join('');
    } else {
        container.style.display = 'none';
        emptyState.style.display = 'block';
    }

    // 折叠状态下用窄条上的小圆点提示选中数量，避免"选了内容但看不到反馈"
    railBadge.textContent = selectedCards.size;
    railBadge.style.display = selectedCards.size > 0 ? 'flex' : 'none';
}

document.getElementById('pasteInput').addEventListener('input', (e) => {
    document.getElementById('analyzeBtn').disabled = e.target.value.trim().length === 0;
});

// ========== Mode 1 即兴分析对话（SSE 流式） ==========
// 无状态设计：conversationHistory 只存在于这个浏览器 tab 的内存里，刷新页面就丢失，
// 与后端的"不落库"设计对应（架构文档 §2 Mode 1）。

let chatContentIds = [];
let conversationHistory = [];

const quickAnalysisView = document.getElementById('quickAnalysisView');
const chatView = document.getElementById('chatView');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatSaveBtn = document.getElementById('chatSaveBtn');

document.getElementById('startAnalysisBtn')?.addEventListener('click', () => {
    if (selectedCards.size === 0) return;

    chatContentIds = Array.from(selectedCards);
    document.getElementById('chatItemCount').textContent = chatContentIds.length;
    conversationHistory = [];
    chatMessages.innerHTML = '';

    quickAnalysisView.style.display = 'none';
    chatView.classList.add('active');
    chatInput.focus();
});

document.getElementById('backBtn').addEventListener('click', () => {
    chatView.classList.remove('active');
    quickAnalysisView.style.display = 'block';
});

function appendMessage(role, content, { streaming = false, error = false } = {}) {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${role}`;

    const avatarLabel = role === 'user' ? '你' : 'AI';
    msgEl.innerHTML = `
        <div class="chat-message-header">
            <div class="chat-message-avatar"></div>
            <span class="chat-message-name">${avatarLabel}</span>
        </div>
        <div class="chat-message-content${streaming ? ' streaming' : ''}${error ? ' error' : ''}"></div>
    `;
    msgEl.querySelector('.chat-message-content').textContent = content;
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl.querySelector('.chat-message-content');
}

async function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text || chatSendBtn.disabled) return;

    chatInput.value = '';
    chatSendBtn.disabled = true;
    chatSaveBtn.disabled = true;

    appendMessage('user', text);
    conversationHistory.push({ role: 'user', content: text });

    const contentEl = appendMessage('assistant', '', { streaming: true });
    let fullResponse = '';

    try {
        const res = await fetch(`${API_BASE}/api/chat/ephemeral`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contentIds: chatContentIds,
                adHocContents: [],
                messages: conversationHistory
            })
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop(); // 最后一段可能不完整，留到下一轮

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6));

                if (event.type === 'content') {
                    fullResponse += event.content;
                    contentEl.textContent = fullResponse;
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else if (event.type === 'error') {
                    throw new Error(event.error);
                } else if (event.type === 'done') {
                    conversationHistory.push({ role: 'assistant', content: fullResponse });
                }
            }
        }

        contentEl.classList.remove('streaming');
    } catch (err) {
        contentEl.classList.remove('streaming');
        contentEl.classList.add('error');
        contentEl.textContent = `请求失败：${err.message}`;
        // 失败时不把这轮加入历史，避免污染下一次请求的上下文
        conversationHistory.pop();
    } finally {
        chatSendBtn.disabled = false;
        chatSaveBtn.disabled = false;
    }
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
});

chatSaveBtn.addEventListener('click', () => {
    // Topic 尚未实现（依赖任务 #3 之后的 Topic 相关能力），这里如实告知而非假装保存成功
    alert('"保存到 Topic" 功能尚未实现，依赖 Topic 相关能力（当前任务列表之外）。');
});

// ========== 左右面板：折叠 + 拖拽调整宽度（类 Codex 侧栏） ==========
// 两侧面板都用「显示/隐藏整个元素」实现折叠（不是透明度渡变），
// 因为 .main 是 flex:1，一旦相邻元素 display:none，中间栏立刻自动吃满空间。

function setupPanel({ panelEl, railEl, collapseBtn, dragHandle, minWidth, maxWidth, defaultWidth, side }) {
    function collapse() {
        panelEl.style.display = 'none';
        dragHandle.style.display = 'none';
        railEl.classList.add('visible');
    }

    function expand() {
        panelEl.style.display = 'flex';
        panelEl.style.flexDirection = 'column';
        dragHandle.style.display = 'block';
        railEl.classList.remove('visible');
    }

    collapseBtn.addEventListener('click', collapse);
    railEl.addEventListener('click', expand);

    // 拖拽调整宽度：mousedown 记录起点，mousemove 实时计算新宽度并夹在 [min,max] 之间，
    // 拖得比 minWidth 还小时视为「拖到底了」直接触发折叠，符合 Codex 的手感。
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    dragHandle.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startWidth = panelEl.getBoundingClientRect().width;
        dragHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
        const newWidth = startWidth + delta;

        if (newWidth < minWidth - 20) {
            dragging = false;
            dragHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            collapse();
            return;
        }
        panelEl.style.width = Math.min(maxWidth, Math.max(minWidth, newWidth)) + 'px';
    });

    window.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            dragHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    panelEl.style.width = defaultWidth + 'px';
}

setupPanel({
    panelEl: document.getElementById('sidebar'),
    railEl: document.getElementById('sidebarRail'),
    collapseBtn: document.getElementById('sidebarCollapseBtn'),
    dragHandle: document.getElementById('sidebarDragHandle'),
    minWidth: 160, maxWidth: 320, defaultWidth: 192, side: 'left'
});

setupPanel({
    panelEl: document.getElementById('aiPanel'),
    railEl: document.getElementById('aiPanelRail'),
    collapseBtn: document.getElementById('collapseBtn'),
    dragHandle: document.getElementById('aiPanelDragHandle'),
    minWidth: 240, maxWidth: 480, defaultWidth: 320, side: 'right'
});

loadFeed();
