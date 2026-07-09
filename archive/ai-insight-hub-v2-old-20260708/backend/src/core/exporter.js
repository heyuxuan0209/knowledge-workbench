import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 生成 Obsidian Markdown
 */
function generateMarkdown(item) {
  const date = new Date(item.pub_date || item.created_at);
  const dateStr = date.toISOString().split('T')[0];

  return `---
title: ${item.title}
source: ${item.source}
category: ${item.category || 'unknown'}
url: ${item.url}
date: ${dateStr}
score: ${item.score || 0}
relevance: ${item.relevance_score || 0}
tags:
  - ai-insights
  - ${item.category || 'uncategorized'}
created: ${new Date().toISOString()}
---

# ${item.title}

## 📊 元信息

- **来源**: ${item.source}
- **分类**: ${item.category || '未分类'}
- **发布时间**: ${dateStr}
- **AI HOT 评分**: ${item.score || 'N/A'}
- **相关度**: ${item.relevance_score || 0}/100

## 📝 摘要

${item.summary || '暂无摘要'}

## 🔗 原文链接

${item.url}

## 💭 我的想法

<!-- 在这里添加你的笔记和想法 -->

---

**保存时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
`;
}

/**
 * 安全化文件名
 */
function sanitizeFilename(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

/**
 * 导出到 Obsidian
 */
export async function exportToObsidian(item, config) {
  // 1. 解析路径
  const vaultPath = config.obsidian.vault_path.replace('~', homedir());
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  // 根据配置的 folder_pattern 生成路径
  const folderPath = join(
    vaultPath,
    config.obsidian.folder_pattern
      .replace('{year}', year)
      .replace('{month}', month)
  );

  // 2. 创建目录
  await mkdir(folderPath, { recursive: true });

  // 3. 生成文件名
  const safeName = sanitizeFilename(item.title);
  const fileName = `${safeName}.md`;
  const filePath = join(folderPath, fileName);

  // 4. 生成内容
  const markdown = generateMarkdown(item);

  // 5. 写入文件
  await writeFile(filePath, markdown, 'utf-8');

  return filePath;
}
