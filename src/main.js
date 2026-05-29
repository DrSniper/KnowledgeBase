import MarkdownIt from 'markdown-it'
import markdownItAnchor from 'markdown-it-anchor'
import './styles.css'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
}).use(markdownItAnchor, {
  permalink: markdownItAnchor.permalink.headerLink(),
})

const categories = [
  { dir: '10-技术知识', name: '技术知识', icon: '⌘', desc: '技术概念、原理、框架和工具说明' },
  { dir: '20-排障手册', name: '排障手册', icon: '⚡', desc: '故障现象、排查步骤、根因、修复和回滚' },
  { dir: '30-项目经验', name: '项目经验', icon: '◆', desc: '项目背景、设计决策、交付经验和复盘' },
  { dir: '40-操作手册', name: '操作手册', icon: '▣', desc: '标准作业流程、Runbook 和日常运维步骤' },
  { dir: '50-代码实践', name: '代码实践', icon: '</>', desc: '编码规范、重构、测试和工程实践' },
  { dir: '60-架构设计', name: '架构设计', icon: '◎', desc: '架构方案、技术选型、系统设计和权衡' },
  { dir: '70-学习笔记', name: '学习笔记', icon: '◐', desc: '课程、书籍、文章和论文学习记录' },
  { dir: '80-资源索引', name: '资源索引', icon: '↗', desc: '链接、工具和资料清单' },
]

const docs = Object.entries(import.meta.glob('../{10-技术知识,20-排障手册,30-项目经验,40-操作手册,50-代码实践,60-架构设计,70-学习笔记,80-资源索引}/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})).map(([path, raw]) => parseDoc(path, raw))
  .sort((a, b) => String(b.updated || b.created || '').localeCompare(String(a.updated || a.created || '')))

const state = {
  query: '',
  selectedCategory: 'all',
  selectedTag: 'all',
  routeDoc: new URLSearchParams(location.search).get('doc') || '',
}

function parseDoc(path, raw) {
  const frontmatter = extractFrontmatter(raw)
  const body = raw.replace(/^---[\s\S]*?---\s*/, '')
  const dir = path.replace(/^\.\.\//, '').split('/')[0]
  const slug = encodeURIComponent(path.replace(/^\.\.\//, '').replace(/\.md$/, ''))
  const title = frontmatter.title || path.split('/').pop().replace(/\.md$/, '')
  const text = stripMarkdown(body)
  return {
    path,
    dir,
    slug,
    title,
    body,
    html: md.render(body),
    excerpt: text.slice(0, 180),
    readingTime: Math.max(1, Math.ceil(text.length / 500)),
    ...frontmatter,
    tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
  }
}

function extractFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result = {}
  const lines = match[1].split('\n')
  let currentKey = null
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (kv) {
      currentKey = kv[1]
      const value = kv[2].trim()
      result[currentKey] = value === '' ? [] : cleanYamlValue(value)
      continue
    }
    const item = line.match(/^\s*-\s*(.*)$/)
    if (item && currentKey) {
      if (!Array.isArray(result[currentKey])) result[currentKey] = []
      result[currentKey].push(cleanYamlValue(item[1].trim()))
    }
  }
  return result
}

function cleanYamlValue(value) {
  return value.replace(/^['"]|['"]$/g, '')
}

function stripMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_~\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function categoryMeta(dir) {
  return categories.find(item => item.dir === dir) || { name: dir, icon: '•', desc: '' }
}

function allTags() {
  return [...new Set(docs.flatMap(doc => doc.tags))].sort()
}

function filteredDocs() {
  const keyword = state.query.trim().toLowerCase()
  return docs.filter(doc => {
    const matchesCategory = state.selectedCategory === 'all' || doc.dir === state.selectedCategory
    const matchesTag = state.selectedTag === 'all' || doc.tags.includes(state.selectedTag)
    const haystack = `${doc.title} ${doc.excerpt} ${doc.tags.join(' ')} ${doc.category || ''}`.toLowerCase()
    const matchesQuery = !keyword || haystack.includes(keyword)
    return matchesCategory && matchesTag && matchesQuery
  })
}

function currentDoc() {
  return docs.find(doc => doc.slug === state.routeDoc)
}

function setDoc(doc) {
  state.routeDoc = doc ? doc.slug : ''
  const url = new URL(location.href)
  if (doc) url.searchParams.set('doc', doc.slug)
  else url.searchParams.delete('doc')
  history.pushState({}, '', url)
  render()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function renderShell(content) {
  document.querySelector('#app').innerHTML = `
    <div class="site-shell">
      <header class="topbar">
        <a class="brand" href="./" data-action="home">
          <span class="brand-mark">K</span>
          <span><strong>KnowledgeBase</strong><small>DrSniper Docs</small></span>
        </a>
        <nav>
          <a href="#docs" data-action="home">Docs</a>
          <a href="https://github.com/DrSniper/KnowledgeBase" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>
      ${content}
      <footer><span>Built for GitHub Pages</span><span>Docs are generated from Markdown files.</span></footer>
    </div>`
}

function renderHome() {
  const tags = allTags()
  const visibleDocs = filteredDocs()
  renderShell(`
    <main>
      <section class="hero">
        <div class="hero-badge">个人技术知识库 · GitHub Pages</div>
        <h1>把问题、排障和经验沉淀成可检索的工程文档。</h1>
        <p>收集 Kubernetes、DevOps、日志链路、代码实践和项目经验，用统一模板、分类和标签组织，方便长期复用。</p>
        <div class="hero-actions">
          <a class="button primary" href="#docs">浏览文档</a>
          <a class="button secondary" href="https://github.com/DrSniper/KnowledgeBase" target="_blank" rel="noreferrer">查看仓库</a>
        </div>
        <div class="metrics">
          <div><strong>${docs.length}</strong><span>Docs</span></div>
          <div><strong>${categories.length}</strong><span>Categories</span></div>
          <div><strong>${tags.length}</strong><span>Tags</span></div>
        </div>
      </section>
      <section class="category-grid">
        ${categories.map(cat => `
          <button class="category-card ${state.selectedCategory === cat.dir ? 'active' : ''}" data-category="${escapeHtml(cat.dir)}">
            <span>${cat.icon}</span><strong>${cat.name}</strong><small>${cat.desc}</small>
          </button>`).join('')}
      </section>
      <section id="docs" class="docs-section">
        <div class="section-heading">
          <div><span class="eyebrow">Documentation</span><h2>文档列表</h2></div>
          ${(state.selectedCategory !== 'all' || state.selectedTag !== 'all' || state.query) ? '<button class="reset" data-action="reset">清除筛选</button>' : ''}
        </div>
        <div class="filters">
          <input id="search" type="search" placeholder="搜索标题、摘要、标签..." value="${escapeHtml(state.query)}" />
          <select id="categorySelect">
            <option value="all">全部分类</option>
            ${categories.map(cat => `<option value="${escapeHtml(cat.dir)}" ${state.selectedCategory === cat.dir ? 'selected' : ''}>${cat.name}</option>`).join('')}
          </select>
          <select id="tagSelect">
            <option value="all">全部标签</option>
            ${tags.map(tag => `<option value="${escapeHtml(tag)}" ${state.selectedTag === tag ? 'selected' : ''}>${escapeHtml(tag)}</option>`).join('')}
          </select>
        </div>
        ${visibleDocs.length ? `<div class="doc-grid">
          ${visibleDocs.map(doc => `
            <article class="doc-card" data-doc="${doc.slug}">
              <div class="doc-meta"><span>${categoryMeta(doc.dir).name}</span><span>${doc.readingTime} min read</span></div>
              <h3>${escapeHtml(doc.title)}</h3>
              <p>${escapeHtml(doc.excerpt)}</p>
              <div class="tag-row">${doc.tags.slice(0, 4).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            </article>`).join('')}
        </div>` : '<div class="empty">暂无匹配文档。</div>'}
      </section>
    </main>`)

  document.querySelectorAll('[data-category]').forEach(el => el.addEventListener('click', () => {
    state.selectedCategory = el.dataset.category
    state.routeDoc = ''
    render()
  }))
  document.querySelectorAll('[data-doc]').forEach(el => el.addEventListener('click', () => {
    setDoc(docs.find(doc => doc.slug === el.dataset.doc))
  }))
  document.querySelector('#search')?.addEventListener('input', event => {
    state.query = event.target.value
    render()
    document.querySelector('#search')?.focus()
  })
  document.querySelector('#categorySelect')?.addEventListener('change', event => {
    state.selectedCategory = event.target.value
    render()
  })
  document.querySelector('#tagSelect')?.addEventListener('change', event => {
    state.selectedTag = event.target.value
    render()
  })
  document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
    state.selectedCategory = 'all'
    state.selectedTag = 'all'
    state.query = ''
    render()
  })
}

function renderDoc(doc) {
  renderShell(`
    <main class="reader-layout">
      <aside class="reader-sidebar">
        <button class="back" data-action="back">← 返回文档列表</button>
        <div class="toc-card">
          <span class="eyebrow">Current</span>
          <h3>${escapeHtml(doc.title)}</h3>
          <p>${categoryMeta(doc.dir).name} · ${doc.readingTime} min read</p>
          <div class="tag-row">${doc.tags.map(tag => `<span data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`).join('')}</div>
        </div>
      </aside>
      <article class="markdown-body">
        <div class="article-kicker">${categoryMeta(doc.dir).name}</div>
        <h1>${escapeHtml(doc.title)}</h1>
        <div class="article-meta">
          <span>Created: ${escapeHtml(doc.created || 'unknown')}</span>
          <span>Updated: ${escapeHtml(doc.updated || 'unknown')}</span>
          <span>Status: ${escapeHtml(doc.status || 'active')}</span>
        </div>
        <div>${doc.html}</div>
      </article>
    </main>`)
  document.querySelector('[data-action="back"]')?.addEventListener('click', () => setDoc(null))
  document.querySelectorAll('[data-tag]').forEach(el => el.addEventListener('click', () => {
    state.selectedTag = el.dataset.tag
    setDoc(null)
  }))
}

function render() {
  const doc = currentDoc()
  if (doc) renderDoc(doc)
  else renderHome()
  document.querySelectorAll('[data-action="home"]').forEach(el => el.addEventListener('click', event => {
    event.preventDefault()
    setDoc(null)
  }))
}

window.addEventListener('popstate', () => {
  state.routeDoc = new URLSearchParams(location.search).get('doc') || ''
  render()
})

render()
