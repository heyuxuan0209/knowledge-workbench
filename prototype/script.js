// 选中状态管理
let selectedCards = new Set();

// 卡片选择逻辑
document.querySelectorAll('.feed-card').forEach(card => {
    const cardId = card.dataset.id;
    const selectBtn = card.querySelector('.btn-select');
    
    // 点击卡片本身切换选中
    card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-follow') || e.target.closest('.btn-select')) {
            return;
        }
        toggleCardSelection(card, cardId);
    });
    
    // 点击选中按钮
    selectBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleCardSelection(card, cardId);
    });
});

function toggleCardSelection(card, cardId) {
    const selectBtn = card.querySelector('.btn-select');
    const svg = selectBtn.querySelector('svg');
    
    if (selectedCards.has(cardId)) {
        selectedCards.delete(cardId);
        card.classList.remove('selected');
        selectBtn.classList.remove('active');
        svg.removeAttribute('fill');
    } else {
        selectedCards.add(cardId);
        card.classList.add('selected');
        selectBtn.classList.add('active');
        svg.setAttribute('fill', 'currentColor');
    }
    updateSelectedItems();
}

function updateSelectedItems() {
    const container = document.getElementById('selectedItemsContainer');
    const count = document.getElementById('selectedCount');
    const list = document.getElementById('selectedItemsList');
    const startBtn = document.getElementById('startAnalysisBtn');
    
    if (selectedCards.size > 0) {
        container.style.display = 'block';
        count.textContent = selectedCards.size;
        
        // 更新列表
        list.innerHTML = '';
        selectedCards.forEach(id => {
            const card = document.querySelector(`[data-id="${id}"]`);
            const title = card.querySelector('.feed-card-title').textContent;
            const item = document.createElement('div');
            item.className = 'selected-item';
            item.innerHTML = `<span>•</span><span>${title}</span>`;
            list.appendChild(item);
        });
        
        startBtn.disabled = false;
    } else {
        container.style.display = 'none';
        startBtn.disabled = true;
    }
}

// 关注按钮
document.querySelectorAll('.btn-follow').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const svg = btn.querySelector('svg');
        const span = btn.querySelector('span');
        
        btn.classList.toggle('following');
        if (btn.classList.contains('following')) {
            span.textContent = '已关注';
            svg.setAttribute('fill', 'currentColor');
        } else {
            span.textContent = '关注';
            svg.removeAttribute('fill');
        }
    });
});

// 开始分析按钮
document.getElementById('startAnalysisBtn').addEventListener('click', () => {
    document.getElementById('quickAnalysisView').style.display = 'none';
    document.getElementById('chatView').classList.add('active');
    document.getElementById('chatItemCount').textContent = selectedCards.size;
});

// 返回按钮
document.getElementById('backBtn').addEventListener('click', () => {
    document.getElementById('chatView').classList.remove('active');
    document.getElementById('quickAnalysisView').style.display = 'block';
});

// URL 输入框
const urlInput = document.querySelector('.url-input');
const urlAnalyzeBtn = urlInput.nextElementSibling;

urlInput.addEventListener('input', (e) => {
    urlAnalyzeBtn.disabled = e.target.value.trim().length === 0;
});

// 过滤按钮
document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});
