/**
 * 对话档案馆引擎（GPT 页）
 * 导入 ChatGPT 官方导出（ZIP / conversations.json / 单对话 JSON）
 * → 按对话存 IndexedDB → 侧栏浏览 + 统计总览 + 自定义&记忆 + 书签 + 搜索 + 外观自定义 + 导出
 */

(function () {
  'use strict';

  const PAGE = 'gpt';
  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const CHUNK = 120; // 每批渲染的消息条数

  // ===================== 小工具 =====================
  const $ = (id) => document.getElementById(id);

  // 线条图标（icons.js），万一没加载就退回文字
  const ic = (name, size) => (window.ArcIcons ? window.ArcIcons.icon(name, size) : '');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtNum(n) { return Number(n).toLocaleString('zh-CN'); }

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDateCn(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${y}年${parseInt(m)}月${parseInt(d)}日`;
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(); return; }
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.onload = resolve;
      script.onerror = () => reject(new Error('JSZip 加载失败，检查网络后重试'));
      document.head.appendChild(script);
    });
  }

  // ===================== IndexedDB =====================
  const DB_NAME = 'MemoirArchive-' + PAGE;
  const DB_VERSION = 2; // v2: 加 assets 库存导出包里的图片

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetAllConvs() {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function dbPutConvs(convs) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      for (const c of convs) store.put(c);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbClearAll() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(['conversations', 'kv', 'assets'], 'readwrite');
      tx.objectStore('conversations').clear();
      tx.objectStore('kv').clear();
      tx.objectStore('assets').clear();
      tx.oncomplete = resolve;
    });
  }

  async function dbPutAsset(id, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetAsset(id) {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  }

  async function dbGetAssetKeys() {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction('assets', 'readonly').objectStore('assets').getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function kvGet(key) {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
  }

  async function kvSet(key, val) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ===================== 外观设置（localStorage，全局应用） =====================
  const THEME_KEY = 'memoirThemeV1';
  const THEME_DEFAULTS = {
    userName: '鑫鑫',
    aiName: '星河',
    showNames: true,
    userBg: '', userText: '',      // 空 = 用页面默认
    ai1: '', ai2: '', aiText: '',
    chatBg: '', chatBgImage: '',
    width: '880',                  // px 或 'full'
  };

  function loadTheme() {
    try {
      return Object.assign({}, THEME_DEFAULTS, JSON.parse(localStorage.getItem(THEME_KEY) || '{}'));
    } catch { return Object.assign({}, THEME_DEFAULTS); }
  }

  let theme = loadTheme();

  function saveTheme() {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }

  function applyTheme() {
    const root = document.documentElement;
    const body = document.body;

    body.classList.toggle('arc-hide-names', !theme.showNames);

    const userThemed = theme.userBg || theme.userText;
    body.classList.toggle('arc-themed-user', !!userThemed);
    if (userThemed) {
      root.style.setProperty('--arc-user-bg', theme.userBg || '#ffffff');
      root.style.setProperty('--arc-user-text', theme.userText || '#3d2b1f');
    }

    const aiThemed = theme.ai1 || theme.ai2 || theme.aiText;
    body.classList.toggle('arc-themed-ai', !!aiThemed);
    if (aiThemed) {
      root.style.setProperty('--arc-ai-1', theme.ai1 || '#10a37f');
      root.style.setProperty('--arc-ai-2', theme.ai2 || theme.ai1 || '#1abf94');
      root.style.setProperty('--arc-ai-text', theme.aiText || '#ffffff');
    }

    const chat = $('arc-chat');
    if (chat) {
      if (theme.chatBgImage) {
        chat.style.backgroundImage = `url(${theme.chatBgImage})`;
        chat.style.backgroundColor = '';
      } else {
        chat.style.backgroundImage = '';
        chat.style.backgroundColor = theme.chatBg || '';
      }
    }

    root.style.setProperty('--arc-chat-width', theme.width === 'full' ? '100%' : theme.width + 'px');
  }

  // ===================== 书签（localStorage） =====================
  const BM_KEY = 'memoirBookmarks-' + PAGE;

  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem(BM_KEY) || '[]'); } catch { return []; }
  }
  function saveBookmarks() {
    localStorage.setItem(BM_KEY, JSON.stringify(state.bookmarks));
  }
  function bmKey(convId, mi) { return convId + '::' + mi; }

  // ===================== 全局状态 =====================
  const state = {
    convs: [],            // [{id,title,messages:[{role,text,ts}],stats,firstTs,lastTs}]
    metaEntries: [],      // 自定义&记忆 [{kind:'profile'|'instructions'|'memory',text,convTitle,ts}]
    currentView: null,    // 'overview' | 'meta' | convId
    renderedCount: 0,
    observer: null,
    search: { q: '', matches: [], idx: -1 },
    bookmarks: loadBookmarks(),
    filter: '',
  };

  function getConv(id) { return state.convs.find(c => c.id === id); }

  // ===================== 解析 ChatGPT 导出 =====================
  function computeStats(messages) {
    let uChars = 0, aChars = 0, uCount = 0, aCount = 0;
    for (const m of messages) {
      if (m.role === 'user') { uChars += m.text.length; uCount++; }
      else { aChars += m.text.length; aCount++; }
    }
    return { uChars, aChars, uCount, aCount };
  }

  // asset_pointer 形如 "file-service://file-AbC123" 或 "sediment://file_0000..."，取出文件 ID
  function assetIdFromPointer(ptr) {
    if (!ptr) return '';
    const tail = String(ptr).split('://').pop();
    const m = tail.match(/file[-_][A-Za-z0-9]+/);
    return m ? m[0] : '';
  }

  function extractText(content) {
    if (!content) return '';
    const parts = content.parts || [];
    const out = [];
    for (const p of parts) {
      if (typeof p === 'string') {
        if (p.trim()) out.push(p.trim());
      } else if (p && typeof p === 'object') {
        if (p.content_type === 'image_asset_pointer' || p.asset_pointer) {
          const id = assetIdFromPointer(p.asset_pointer);
          out.push(id ? `[[arc-img:${id}]]` : '[图片]');
        }
        else if (p.content_type === 'audio_transcription' && p.text) out.push(p.text);
      }
    }
    if (out.length === 0 && content.content_type === 'code' && content.text) {
      out.push('```\n' + content.text + '\n```');
    }
    if (out.length === 0 && typeof content.text === 'string' && content.text.trim()) {
      out.push(content.text.trim());
    }
    return out.join('\n');
  }

  // 单个对话对象 → {conv, metaEntries}
  function parseOneConversation(conv) {
    if (!conv || !conv.mapping) return null;
    const title = conv.title || '未命名对话';
    const convId = conv.conversation_id || conv.id || ('gpt-' + (conv.create_time || Math.random()));

    // 从 current_node 回溯当前分支；没有 current_node 时取全部节点按时间排
    let chain = [];
    if (conv.current_node && conv.mapping[conv.current_node]) {
      let nodeId = conv.current_node;
      let guard = 0;
      while (nodeId && conv.mapping[nodeId] && guard++ < 100000) {
        const node = conv.mapping[nodeId];
        if (node.message) chain.unshift(node.message);
        nodeId = node.parent;
      }
    } else {
      chain = Object.values(conv.mapping)
        .map(n => n.message).filter(Boolean)
        .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
    }

    const messages = [];
    const metaEntries = [];

    for (const m of chain) {
      const role = m.author && m.author.role;
      const md = m.metadata || {};
      const ts = m.create_time ? m.create_time * 1000 : (conv.create_time ? conv.create_time * 1000 : Date.now());

      // 自定义指令（user_editable_context）
      const c = m.content || {};
      if (c.content_type === 'user_editable_context') {
        if (c.user_profile && c.user_profile.trim()) {
          metaEntries.push({ kind: 'profile', text: c.user_profile.trim(), convTitle: title, ts });
        }
        if (c.user_instructions && c.user_instructions.trim()) {
          metaEntries.push({ kind: 'instructions', text: c.user_instructions.trim(), convTitle: title, ts });
        }
        continue;
      }

      // 隐藏的系统消息里可能藏着"记忆"（Model Set Context）
      if (md.is_visually_hidden_from_conversation || md.is_user_system_message || role === 'system') {
        const hidden = extractText(c);
        if (hidden && /model set context/i.test(hidden)) {
          metaEntries.push({ kind: 'memory', text: hidden.replace(/^model set context:?\s*/i, '').trim(), convTitle: title, ts });
        }
        continue;
      }

      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(c);
      if (!text) continue;
      messages.push({ role: role === 'user' ? 'user' : 'ai', text, ts });
    }

    if (messages.length === 0 && metaEntries.length === 0) return null;

    const stats = computeStats(messages);
    return {
      conv: {
        id: convId,
        title,
        messages,
        stats,
        firstTs: messages.length ? messages[0].ts : (conv.create_time ? conv.create_time * 1000 : Date.now()),
        lastTs: messages.length ? messages[messages.length - 1].ts : (conv.update_time ? conv.update_time * 1000 : Date.now()),
      },
      metaEntries,
    };
  }

  // 整个 JSON 文本（数组 或 单对话对象）
  function parseExport(jsonText) {
    let data;
    try { data = JSON.parse(jsonText); } catch (e) { throw new Error('JSON 格式不对：' + e.message); }
    const list = Array.isArray(data) ? data : [data];
    const convs = [];
    const metaEntries = [];
    for (const item of list) {
      const r = parseOneConversation(item);
      if (!r) continue;
      if (r.conv.messages.length > 0) convs.push(r.conv);
      metaEntries.push(...r.metaEntries);
    }
    return { convs, metaEntries };
  }

  function mergeConvs(existing, incoming) {
    const byId = new Map(existing.map(c => [c.id, c]));
    let added = 0, updated = 0;
    for (const c of incoming) {
      const old = byId.get(c.id);
      if (!old) { byId.set(c.id, c); added++; }
      else if (c.messages.length >= old.messages.length) { byId.set(c.id, c); updated++; }
    }
    const merged = [...byId.values()].sort((a, b) => b.lastTs - a.lastTs);
    return { merged, added, updated };
  }

  function mergeMeta(existing, incoming) {
    const seen = new Set(existing.map(e => e.kind + '|' + e.text));
    const merged = [...existing];
    for (const e of incoming) {
      const k = e.kind + '|' + e.text;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(e);
    }
    merged.sort((a, b) => a.ts - b.ts);
    return merged;
  }

  // ===================== 旧版数据迁移（GptMemoir 平铺轮次 → 按标题分组） =====================
  async function migrateLegacy() {
    if (state.convs.length > 0) return; // 已有新版数据就不迁
    const legacy = await new Promise((resolve) => {
      const req = indexedDB.open('GptMemoir', 1);
      req.onupgradeneeded = () => { /* 不动旧库结构 */ };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) { db.close(); resolve([]); return; }
        const r = db.transaction('records', 'readonly').objectStore('records').get('all');
        r.onsuccess = () => { db.close(); resolve(r.result || []); };
        r.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
    if (!legacy.length) return;

    const byTitle = {};
    for (const r of legacy) (byTitle[r.title || '未命名对话'] = byTitle[r.title || '未命名对话'] || []).push(r);
    const convs = [];
    for (const [title, rounds] of Object.entries(byTitle)) {
      rounds.sort((a, b) => a.timestamp - b.timestamp);
      const messages = [];
      for (const r of rounds) {
        if (r.userInput) messages.push({ role: 'user', text: r.userInput, ts: r.timestamp });
        if (r.aiResponse) messages.push({ role: 'ai', text: r.aiResponse, ts: r.timestamp });
      }
      if (!messages.length) continue;
      convs.push({
        id: 'legacy-' + title,
        title, messages,
        stats: computeStats(messages),
        firstTs: messages[0].ts,
        lastTs: messages[messages.length - 1].ts,
      });
    }
    if (convs.length) {
      await dbPutConvs(convs);
      state.convs = convs.sort((a, b) => b.lastTs - a.lastTs);
    }
  }

  // ===================== 全局统计 =====================
  function computeGlobalStats() {
    let uChars = 0, aChars = 0, uCount = 0, aCount = 0;
    let earliest = Infinity, latest = -Infinity;
    const hourCount = new Array(24).fill(0);
    const daySet = new Set();

    for (const c of state.convs) {
      uChars += c.stats.uChars; aChars += c.stats.aChars;
      uCount += c.stats.uCount; aCount += c.stats.aCount;
      for (const m of c.messages) {
        if (m.ts < earliest) earliest = m.ts;
        if (m.ts > latest) latest = m.ts;
        hourCount[new Date(m.ts).getHours()]++;
        daySet.add(fmtDate(m.ts));
      }
    }

    // 最常聊天时段：连续3小时窗口（可跨午夜）
    let bestStart = 0, bestSum = -1;
    for (let s = 0; s < 24; s++) {
      const sum = hourCount[s] + hourCount[(s + 1) % 24] + hourCount[(s + 2) % 24];
      if (sum > bestSum) { bestSum = sum; bestStart = s; }
    }

    // 连续天数
    const days = [...daySet].sort();
    let longest = 0, current = 0, run = 0, prev = null;
    for (const d of days) {
      if (prev !== null && (new Date(d) - new Date(prev)) === 86400000) run++;
      else run = 1;
      if (run > longest) longest = run;
      prev = d;
    }
    // 当前连续 = 从最后一天往回数
    if (days.length) {
      current = 1;
      for (let i = days.length - 1; i > 0; i--) {
        if (new Date(days[i]) - new Date(days[i - 1]) === 86400000) current++;
        else break;
      }
    }

    return {
      uChars, aChars, uCount, aCount,
      earliest: earliest === Infinity ? null : earliest,
      latest: latest === -Infinity ? null : latest,
      bestStart, bestSum,
      totalDays: daySet.size,
      currentStreak: current,
      longestStreak: longest,
      convCount: state.convs.length,
    };
  }

  // ===================== 渲染：侧栏 =====================
  function renderSidebar() {
    const list = $('arc-conv-list');
    if (!list) return;
    const kw = state.filter.trim().toLowerCase();

    let html = `
      <div class="arc-conv-item arc-pinned ${state.currentView === 'overview' ? 'active' : ''}" data-view="overview">
        <div class="arc-conv-title">${ic('chart', 14)} 统计总览</div>
        <div class="arc-conv-meta"><span>字数 · 条数 · 时段 · 连续天数</span></div>
      </div>`;

    if (state.metaEntries.length) {
      html += `
      <div class="arc-conv-item arc-pinned ${state.currentView === 'meta' ? 'active' : ''}" data-view="meta">
        <div class="arc-conv-title">${ic('memory', 14)} 自定义 & 记忆</div>
        <div class="arc-conv-meta"><span>${state.metaEntries.length} 条</span></div>
      </div>`;
    }

    for (const c of state.convs) {
      if (kw && !c.title.toLowerCase().includes(kw)) continue;
      const chars = c.stats.uChars + c.stats.aChars;
      const count = c.stats.uCount + c.stats.aCount;
      html += `
      <div class="arc-conv-item ${state.currentView === c.id ? 'active' : ''}" data-view="${esc(c.id)}">
        <div class="arc-conv-title">${esc(c.title)}</div>
        <div class="arc-conv-meta">
          <span>${fmtDate(c.firstTs)}</span>
          <span>${fmtNum(count)} 条</span>
          <span>${fmtNum(chars)} 字</span>
        </div>
      </div>`;
    }
    list.innerHTML = html;

    const total = state.convs.length;
    const countEl = $('arc-side-count');
    if (countEl) countEl.textContent = total ? `${total} 个对话` : '';

    list.querySelectorAll('.arc-conv-item').forEach(el => {
      el.addEventListener('click', () => {
        openView(el.dataset.view);
        closeSidebarMobile();
      });
    });
  }

  // ===================== 渲染：主视图切换 =====================
  function openView(view) {
    state.currentView = view;
    closeSearch();
    if (view === 'overview') renderOverview();
    else if (view === 'meta') renderMeta();
    else renderConversation(view);
    renderSidebar();
  }

  function chatInner() {
    const chat = $('arc-chat');
    chat.innerHTML = '<div class="arc-chat-inner" id="arc-chat-inner"></div>';
    chat.scrollTop = 0;
    return $('arc-chat-inner');
  }

  // 注意：传进来的必须是已转义/可信的 HTML（对话标题要先 esc）
  function setToolbarTitle(html) {
    const el = $('arc-toolbar-title');
    if (el) el.innerHTML = html;
  }

  // ---------- 概览 ----------
  function renderOverview() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    const inner = chatInner();
    setToolbarTitle(`${ic('chart', 15)} 统计总览`);
    const g = computeGlobalStats();
    const earliestD = g.earliest ? new Date(g.earliest) : null;
    const fmtHour = (h) => `${String(h).padStart(2, '0')}:00`;

    inner.innerHTML = `
      <div class="arc-stats">
        <div class="arc-stats-head">
          <h2>我们的档案</h2>
          <p>${g.convCount} 个对话 · 跨越 ${fmtNum(g.totalDays)} 天</p>
        </div>

        <div class="arc-stat-card">
          <div class="arc-stat-label">概览 OVERVIEW</div>
          <div class="arc-stat-pair">
            <div>
              <div class="arc-stat-sub" style="margin-top:0">${esc(theme.userName)}</div>
              <div class="arc-stat-big">${fmtNum(g.uChars)} 字</div>
              <div class="arc-stat-big">${fmtNum(g.uCount)} 条</div>
            </div>
            <div>
              <div class="arc-stat-sub" style="margin-top:0">${esc(theme.aiName)}</div>
              <div class="arc-stat-big">${fmtNum(g.aChars)} 字</div>
              <div class="arc-stat-big">${fmtNum(g.aCount)} 条</div>
            </div>
          </div>
        </div>

        <div class="arc-stat-card">
          <div class="arc-stat-label">最早的一句话</div>
          <div class="arc-stat-big">${earliestD ? `${fmtDate(g.earliest)}<br>${fmtHour(earliestD.getHours())}` : '—'}</div>
          <div class="arc-stat-sub">本地时区，精确到小时 · 来自导出文件里最早的时间戳</div>
          <hr class="arc-stat-divider">
          <div class="arc-stat-label">最常聊天时段</div>
          <div class="arc-stat-big">${fmtHour(g.bestStart)}–${fmtHour((g.bestStart + 3) % 24)}</div>
          <div class="arc-stat-sub">· 这个时段一共 ${fmtNum(g.bestSum)} 条</div>
        </div>

        <div class="arc-stat-card">
          <div class="arc-stat-label">连续天数 STREAK</div>
          <div class="arc-stat-pair">
            <div>
              <div class="arc-stat-sub" style="margin-top:0">当前</div>
              <div class="arc-stat-big">${g.currentStreak} 天</div>
            </div>
            <div>
              <div class="arc-stat-sub" style="margin-top:0">最长纪录</div>
              <div class="arc-stat-big">${g.longestStreak} 天</div>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ---------- 自定义 & 记忆 ----------
  function renderMeta() {
    if (state.observer) { state.observer.disconnect(); state.observer = null; }
    const inner = chatInner();
    setToolbarTitle(`${ic('memory', 15)} 自定义 & 记忆`);
    const kindName = { profile: '关于我（自定义）', instructions: '希望TA怎么回应（自定义）', memory: '记忆' };
    const kindClass = { profile: 'arc-tag-profile', instructions: 'arc-tag-instructions', memory: 'arc-tag-memory' };

    let html = '';
    for (const e of state.metaEntries) {
      html += `
      <div class="arc-meta-card">
        <span class="arc-meta-tag ${kindClass[e.kind] || ''}">${kindName[e.kind] || e.kind}</span>
        <div class="arc-meta-text">${esc(e.text)}</div>
        <div class="arc-meta-src">出自「${esc(e.convTitle)}」 · ${fmtDate(e.ts)}</div>
      </div>`;
    }
    inner.innerHTML = html || '<div class="arc-bm-empty">导出包里没找到自定义指令或记忆</div>';
  }

  // ---------- 对话气泡 ----------
  function getAvatarHTML(role) {
    const img = role === 'user'
      ? localStorage.getItem('avatar-user')
      : localStorage.getItem('avatar-ai-' + PAGE);
    if (img) return `<img src="${img}" alt="avatar">`;
    return ic(role === 'user' ? 'user' : 'bot', 20) || (role === 'user' ? '我' : 'TA');
  }

  function highlightText(safeText, q) {
    if (!q) return safeText;
    const escQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safeText.replace(new RegExp(escQ, 'gi'), (m) => `<mark class="arc-mark">${m}</mark>`);
    } catch { return safeText; }
  }

  function buildBubble(convId, mi, m) {
    const div = document.createElement('div');
    div.className = `message ${m.role}`;
    div.dataset.mi = mi;
    const name = m.role === 'user' ? theme.userName : theme.aiName;
    const starred = state.bookmarks.some(b => b.convId === convId && b.mi === mi);
    let safe = esc(m.text);
    if (state.search.q) safe = highlightText(safe, state.search.q);
    safe = safe.replace(/\n/g, '<br>');
    // 图片标记 → 待加载的图片槽
    safe = safe.replace(/\[\[arc-img:(file[-_][A-Za-z0-9]+)\]\]/g, (_, id) =>
      `<span class="arc-img-slot" data-asset="${id}">${ic('image', 20)}<i>图片</i></span>`);
    div.innerHTML = `
      <div class="avatar">${getAvatarHTML(m.role)}</div>
      <div class="bubble-wrap">
        <div class="arc-sender">${esc(name)}</div>
        <div class="bubble">${safe}</div>
        <div class="timestamp">${fmtTime(m.ts)}</div>
      </div>
      <button class="arc-star ${starred ? 'arc-starred' : ''}" title="收藏到书签">${ic(starred ? 'starFill' : 'star', 15)}</button>`;
    div.querySelector('.arc-star').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBookmark(convId, mi, e.currentTarget);
    });
    return div;
  }

  // ---------- 图片槽加载（从 assets 库取出，objectURL 缓存） ----------
  const assetUrlCache = new Map();
  let assetKeysCache = null;

  async function resolveAsset(id) {
    let blob = await dbGetAsset(id);
    if (blob) return blob;
    // 兜底：导出包文件名和 pointer 偶尔分隔符/前缀不完全一致，做一次模糊匹配
    if (!assetKeysCache) assetKeysCache = await dbGetAssetKeys();
    const alt = id.replace(/^file[-_]/, '');
    const key = assetKeysCache.find(k => k === id || k.startsWith(id) || id.startsWith(k) || k.replace(/^file[-_]/, '') === alt);
    return key ? dbGetAsset(key) : undefined;
  }

  async function hydrateImages(container) {
    const slots = container.querySelectorAll('.arc-img-slot:not([data-done])');
    for (const slot of slots) {
      slot.dataset.done = '1';
      const id = slot.dataset.asset;
      let url = assetUrlCache.get(id);
      if (url === undefined) {
        const blob = await resolveAsset(id);
        url = blob ? URL.createObjectURL(blob) : null;
        assetUrlCache.set(id, url);
      }
      if (url) {
        slot.outerHTML = `<img class="arc-img" src="${url}" alt="图片" loading="lazy">`;
      } else {
        slot.classList.add('arc-img-missing');
        slot.innerHTML = `${ic('image', 18)}<i>图片不在导出包里</i>`;
      }
    }
  }

  // 点击图片放大
  function openLightbox(src) {
    let box = $('arc-lightbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'arc-lightbox';
      box.innerHTML = '<img alt="图片">';
      box.addEventListener('click', () => { box.hidden = true; });
      document.body.appendChild(box);
    }
    box.querySelector('img').src = src;
    box.hidden = false;
  }

  function renderConversation(convId, jumpToMi) {
    const conv = getConv(convId);
    if (!conv) { renderOverview(); return; }
    if (state.observer) { state.observer.disconnect(); state.observer = null; }

    const inner = chatInner();
    setToolbarTitle(esc(conv.title));
    state.renderedCount = 0;
    inner.dataset.convId = convId;

    // 底部哨兵：滚到就加载下一批
    const sentinel = document.createElement('div');
    sentinel.className = 'arc-sentinel';
    sentinel.id = 'arc-sentinel';

    renderMore(conv, inner);
    inner.appendChild(sentinel);
    updateSentinel(conv, sentinel);

    state.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.renderedCount < conv.messages.length) {
        sentinel.remove();
        renderMore(conv, inner);
        inner.appendChild(sentinel);
        updateSentinel(conv, sentinel);
      }
    }, { root: $('arc-chat'), rootMargin: '600px' });
    state.observer.observe(sentinel);

    if (typeof jumpToMi === 'number') jumpToMessage(convId, jumpToMi);
  }

  function updateSentinel(conv, sentinel) {
    const left = conv.messages.length - state.renderedCount;
    sentinel.textContent = left > 0 ? `下面还有 ${fmtNum(left)} 条 · 继续滚动加载` : '· 到底啦 ·';
  }

  function renderMore(conv, inner) {
    const sentinel = $('arc-sentinel');
    const frag = document.createDocumentFragment();
    const start = state.renderedCount;
    const end = Math.min(start + CHUNK, conv.messages.length);
    let prevDate = start > 0 ? fmtDate(conv.messages[start - 1].ts) : null;

    for (let i = start; i < end; i++) {
      const m = conv.messages[i];
      const d = fmtDate(m.ts);
      if (d !== prevDate) {
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>${fmtDateCn(d)}</span>`;
        frag.appendChild(divider);
        prevDate = d;
      }
      frag.appendChild(buildBubble(conv.id, i, m));
    }
    state.renderedCount = end;
    if (sentinel && sentinel.parentNode === inner) inner.insertBefore(frag, sentinel);
    else inner.appendChild(frag);
    hydrateImages(inner);
  }

  function ensureRendered(conv, mi) {
    const inner = $('arc-chat-inner');
    let guard = 0;
    while (state.renderedCount <= mi && state.renderedCount < conv.messages.length && guard++ < 2000) {
      renderMore(conv, inner);
    }
    const sentinel = $('arc-sentinel');
    if (sentinel) { inner.appendChild(sentinel); updateSentinel(conv, sentinel); }
  }

  function jumpToMessage(convId, mi) {
    const conv = getConv(convId);
    if (!conv) return;
    if ($('arc-chat-inner')?.dataset.convId !== convId) {
      state.currentView = convId;
      renderConversation(convId);
      renderSidebar();
    }
    ensureRendered(conv, mi);
    const el = document.querySelector(`#arc-chat-inner .message[data-mi="${mi}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('arc-flash');
      void el.offsetWidth;
      el.classList.add('arc-flash');
    }
  }

  // ===================== 书签 =====================
  function toggleBookmark(convId, mi, btn) {
    const idx = state.bookmarks.findIndex(b => b.convId === convId && b.mi === mi);
    if (idx >= 0) {
      state.bookmarks.splice(idx, 1);
      if (btn) { btn.innerHTML = ic('star', 15); btn.classList.remove('arc-starred'); }
    } else {
      const conv = getConv(convId);
      const m = conv && conv.messages[mi];
      if (!m) return;
      state.bookmarks.push({
        convId, mi,
        role: m.role,
        ts: m.ts,
        title: conv.title,
        snippet: m.text.replace(/\[\[arc-img:[^\]]+\]\]/g, '[图片]').slice(0, 120),
        added: Date.now(),
      });
      if (btn) { btn.innerHTML = ic('starFill', 15); btn.classList.add('arc-starred'); }
    }
    saveBookmarks();
  }

  function renderBookmarkPanel() {
    const box = $('arc-bm-list');
    if (!box) return;
    if (!state.bookmarks.length) {
      box.innerHTML = `<div class="arc-bm-empty">还没有书签<br>把鼠标放在气泡上，点 ${ic('star', 13)} 就能收藏</div>`;
      return;
    }
    const sorted = [...state.bookmarks].sort((a, b) => b.added - a.added);
    box.innerHTML = sorted.map((b) => `
      <div class="arc-bm-item" data-conv="${esc(b.convId)}" data-mi="${b.mi}">
        <div class="arc-bm-head">
          <span class="arc-bm-conv">${esc(b.title)}</span>
          <span class="arc-bm-time">${fmtDate(b.ts)} ${fmtTime(b.ts)}</span>
          <button class="arc-bm-del" title="删除书签">✕</button>
        </div>
        <div class="arc-bm-text">${ic(b.role === 'user' ? 'user' : 'bot', 13)} ${esc(b.snippet)}</div>
      </div>`).join('');

    box.querySelectorAll('.arc-bm-item').forEach(el => {
      el.addEventListener('click', () => {
        closeModal('arc-bm-modal');
        jumpToMessage(el.dataset.conv, parseInt(el.dataset.mi));
      });
      el.querySelector('.arc-bm-del').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleBookmark(el.dataset.conv, parseInt(el.dataset.mi), null);
        renderBookmarkPanel();
        // 同步当前视图里的星标
        const star = document.querySelector(`#arc-chat-inner[data-conv-id="${CSS.escape(el.dataset.conv)}"] .message[data-mi="${el.dataset.mi}"] .arc-star`);
        if (star) { star.innerHTML = ic('star', 15); star.classList.remove('arc-starred'); }
      });
    });
  }

  // ===================== 窗口内搜索 =====================
  function openSearch() {
    const conv = getConv(state.currentView);
    if (!conv) return; // 只在对话视图里搜索
    $('arc-searchbar').hidden = false;
    $('arc-search-input').focus();
  }

  function closeSearch() {
    const bar = $('arc-searchbar');
    if (!bar || bar.hidden) return;
    bar.hidden = true;
    $('arc-search-input').value = '';
    const hadQuery = !!state.search.q;
    state.search = { q: '', matches: [], idx: -1 };
    updateSearchCount();
    // 清掉高亮：重渲染当前对话
    if (hadQuery && getConv(state.currentView)) renderConversation(state.currentView);
  }

  let searchTimer = null;
  function onSearchInput(val) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const conv = getConv(state.currentView);
      if (!conv) return;
      state.search.q = val.trim();
      state.search.matches = [];
      state.search.idx = -1;
      if (state.search.q) {
        const q = state.search.q.toLowerCase();
        conv.messages.forEach((m, i) => {
          if (m.text.toLowerCase().includes(q)) state.search.matches.push(i);
        });
      }
      // 重渲染（带高亮）
      renderConversation(state.currentView);
      updateSearchCount();
      if (state.search.matches.length) searchGo(0);
    }, 250);
  }

  function updateSearchCount() {
    const el = $('arc-search-count');
    if (!el) return;
    const { matches, idx } = state.search;
    el.textContent = matches.length ? `${idx + 1} / ${matches.length}` : (state.search.q ? '0 处' : '');
  }

  function searchGo(newIdx) {
    const { matches } = state.search;
    if (!matches.length) return;
    state.search.idx = ((newIdx % matches.length) + matches.length) % matches.length;
    updateSearchCount();
    const mi = matches[state.search.idx];
    jumpToMessage(state.currentView, mi);
    // 当前命中的 mark 加强调
    document.querySelectorAll('mark.arc-mark-current').forEach(m => m.classList.remove('arc-mark-current'));
    const el = document.querySelector(`#arc-chat-inner .message[data-mi="${mi}"] mark.arc-mark`);
    if (el) el.classList.add('arc-mark-current');
  }

  // ===================== 导出 =====================
  function exportCurrentTxt() {
    const conv = getConv(state.currentView);
    if (!conv) { alert('先在左边选一个对话再导出'); return; }
    let out = `# ${conv.title}\n# ${fmtDate(conv.firstTs)} ~ ${fmtDate(conv.lastTs)} · ${conv.messages.length} 条\n\n`;
    let prevDate = null;
    for (const m of conv.messages) {
      const d = fmtDate(m.ts);
      if (d !== prevDate) { out += `\n───── ${fmtDateCn(d)} ─────\n\n`; prevDate = d; }
      const name = m.role === 'user' ? theme.userName : theme.aiName;
      out += `[${fmtTime(m.ts)}] ${name}：\n${m.text.replace(/\[\[arc-img:[^\]]+\]\]/g, '[图片]')}\n\n`;
    }
    download(`${conv.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`, out);
  }

  function exportBackupJson() {
    const payload = {
      version: 1,
      page: PAGE,
      exportedAt: new Date().toISOString(),
      conversations: state.convs,
      metaEntries: state.metaEntries,
      bookmarks: state.bookmarks,
    };
    download(`memoir-${PAGE}-backup-${fmtDate(Date.now())}.json`, JSON.stringify(payload), 'application/json');
  }

  function exportBookmarksTxt() {
    if (!state.bookmarks.length) { alert('还没有书签'); return; }
    const sorted = [...state.bookmarks].sort((a, b) => a.ts - b.ts);
    let out = `# 书签集 · ${sorted.length} 条\n\n`;
    for (const b of sorted) {
      const conv = getConv(b.convId);
      const m = conv && conv.messages[b.mi];
      const name = b.role === 'user' ? theme.userName : theme.aiName;
      const body = (m ? m.text : b.snippet).replace(/\[\[arc-img:[^\]]+\]\]/g, '[图片]');
      out += `【${b.title}】 ${fmtDate(b.ts)} ${fmtTime(b.ts)} · ${name}\n${body}\n\n────────────\n\n`;
    }
    download(`memoir-${PAGE}-书签-${fmtDate(Date.now())}.txt`, out);
  }

  // 备份 JSON 也能直接导回来
  function importBackup(data) {
    if (!data || !Array.isArray(data.conversations)) return null;
    return { convs: data.conversations, metaEntries: data.metaEntries || [] };
  }

  // ===================== 上传处理 =====================
  async function processFiles(files) {
    const statusEl = $('arc-upload-status');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    let newConvs = [];
    let newMeta = [];
    for (const file of files) {
      try {
        if (file.name.endsWith('.zip')) {
          setStatus(`解压 ${file.name} ...`);
          await loadJSZip();
          const zip = await window.JSZip.loadAsync(file);
          let found = null;
          zip.forEach((path, entry) => {
            if (!found && path.endsWith('conversations.json')) found = entry;
          });
          if (!found) { setStatus(`${file.name} 里没找到 conversations.json`); continue; }
          setStatus('解析对话中（大文件要等一会儿）...');
          const text = await found.async('string');
          const r = parseExport(text);
          newConvs.push(...r.convs);
          newMeta.push(...r.metaEntries);

          // 把包里的图片也存进来（按 file-ID 匹配气泡里的图）
          const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
          const imgEntries = [];
          zip.forEach((path, entry) => {
            const extM = path.match(/\.(png|jpe?g|webp|gif)$/i);
            if (entry.dir || !extM) return;
            const base = path.split('/').pop();
            const idM = base.match(/^(file[-_][A-Za-z0-9]+)/);
            if (idM) imgEntries.push({ entry, id: idM[1], mime: MIME[extM[1].toLowerCase()] || 'image/png' });
          });
          let stored = 0;
          for (const it of imgEntries) {
            const buf = await it.entry.async('arraybuffer');
            await dbPutAsset(it.id, new Blob([buf], { type: it.mime }));
            stored++;
            if (stored % 20 === 0) setStatus(`存图片 ${stored}/${imgEntries.length} ...`);
          }
          if (stored) assetKeysCache = null; // 让图片索引重建
        } else if (file.name.endsWith('.json')) {
          setStatus(`解析 ${file.name} ...`);
          const text = await file.text();
          let parsed;
          try {
            const maybe = JSON.parse(text);
            const backup = importBackup(maybe);
            parsed = backup || parseExport(text);
          } catch (e) { throw new Error('JSON 格式不对：' + e.message); }
          newConvs.push(...parsed.convs);
          newMeta.push(...(parsed.metaEntries || []));
        } else {
          setStatus(`不认识 ${file.name}（要 ZIP 或 .json）`);
        }
      } catch (err) {
        console.error('解析失败:', err);
        setStatus(`解析 ${file.name} 失败：${err.message}`);
        return;
      }
    }

    if (!newConvs.length && !newMeta.length) { setStatus('没解析出任何内容'); return; }

    setStatus('保存中...');
    const { merged, added, updated } = mergeConvs(state.convs, newConvs);
    state.convs = merged;
    state.metaEntries = mergeMeta(state.metaEntries, newMeta);
    await dbPutConvs(merged);
    await kvSet('metaEntries', state.metaEntries);

    const totalMsg = merged.reduce((s, c) => s + c.messages.length, 0);
    setStatus(`完成～新增 ${added} 个对话${updated ? `，更新 ${updated} 个` : ''}（共 ${merged.length} 个对话 · ${fmtNum(totalMsg)} 条消息）`);

    showApp();
    renderSidebar();
    openView('overview');
  }

  // ===================== UI 骨架 =====================
  function buildAppUI() {
    const app = $('archive-app');
    app.innerHTML = `
      <aside class="arc-sidebar" id="arc-sidebar">
        <div class="arc-side-head">
          <div class="arc-side-title">
            <span>对话列表</span>
            <span class="arc-side-count" id="arc-side-count"></span>
          </div>
          <input class="arc-side-filter" id="arc-side-filter" type="text" placeholder="筛选对话标题…" />
        </div>
        <div class="arc-side-list" id="arc-conv-list"></div>
      </aside>
      <div class="arc-side-mask" id="arc-side-mask" hidden></div>

      <section class="arc-main">
        <div class="arc-toolbar">
          <button class="arc-tool-btn" id="arc-menu-btn" title="对话列表">${ic('menu', 17)}</button>
          <div class="arc-toolbar-title" id="arc-toolbar-title">${ic('chart', 15)} 统计总览</div>
          <button class="arc-tool-btn" id="arc-btn-search" title="窗口内搜索">${ic('search', 16)}</button>
          <button class="arc-tool-btn" id="arc-btn-bm" title="书签">${ic('star', 16)}</button>
          <button class="arc-tool-btn" id="arc-btn-theme" title="外观自定义">${ic('palette', 16)}</button>
          <button class="arc-tool-btn" id="arc-btn-export" title="导出">${ic('download', 16)}</button>
          <button class="arc-tool-btn" id="arc-btn-upload" title="导入记录">${ic('upload', 16)}</button>
          <div class="arc-export-menu" id="arc-export-menu" hidden>
            <button id="arc-exp-txt">${ic('doc', 14)} 导出当前对话 (.txt)</button>
            <button id="arc-exp-bm">${ic('star', 14)} 导出书签集 (.txt)</button>
            <button id="arc-exp-json">${ic('disk', 14)} 备份全部数据 (.json)</button>
          </div>
        </div>

        <div class="arc-searchbar" id="arc-searchbar" hidden>
          <input class="arc-search-input" id="arc-search-input" type="text" placeholder="搜索这个对话里的内容…" />
          <span class="arc-search-count" id="arc-search-count"></span>
          <button class="arc-search-nav" id="arc-search-prev" title="上一处">${ic('chevUp', 14)}</button>
          <button class="arc-search-nav" id="arc-search-next" title="下一处">${ic('chevDown', 14)}</button>
          <button class="arc-search-nav" id="arc-search-close" title="关闭">${ic('close', 13)}</button>
        </div>

        <div class="arc-chat" id="arc-chat"><div class="arc-chat-inner" id="arc-chat-inner"></div></div>
      </section>
    `;

    // ---- 弹窗们 ----
    document.body.insertAdjacentHTML('beforeend', `
      <div class="arc-modal" id="arc-bm-modal" hidden>
        <div class="arc-modal-mask" data-close="arc-bm-modal"></div>
        <div class="arc-modal-box">
          <div class="arc-modal-title"><span>${ic('star', 16)} 我的书签</span>
            <button class="arc-modal-close" data-close="arc-bm-modal">✕</button></div>
          <div id="arc-bm-list"></div>
        </div>
      </div>

      <div class="arc-modal" id="arc-theme-modal" hidden>
        <div class="arc-modal-mask" data-close="arc-theme-modal"></div>
        <div class="arc-modal-box">
          <div class="arc-modal-title"><span>${ic('palette', 16)} 外观自定义</span>
            <button class="arc-modal-close" data-close="arc-theme-modal">✕</button></div>

          <div class="arc-set-section">昵 称</div>
          <div class="arc-set-row"><span>我的昵称</span><input type="text" id="arc-t-username"></div>
          <div class="arc-set-row"><span>TA的昵称</span><input type="text" id="arc-t-ainame"></div>
          <div class="arc-set-row"><span>气泡上显示昵称</span>
            <label class="av-switch"><input type="checkbox" id="arc-t-shownames"><span class="av-slider"></span></label>
          </div>

          <div class="arc-set-section">气泡颜色</div>
          <div class="arc-set-row"><span>我的气泡 底色 / 文字</span>
            <div class="arc-color-pair">
              <input type="color" id="arc-t-userbg" value="#ffffff">
              <input type="color" id="arc-t-usertext" value="#3d2b1f">
            </div>
          </div>
          <div class="arc-set-row"><span>TA的气泡 渐变两端</span>
            <div class="arc-color-pair">
              <input type="color" id="arc-t-ai1" value="#10a37f">
              <input type="color" id="arc-t-ai2" value="#1abf94">
            </div>
          </div>
          <div class="arc-set-row"><span>TA的气泡 文字</span>
            <input type="color" id="arc-t-aitext" value="#ffffff">
          </div>

          <div class="arc-set-section">背 景 · 视 图</div>
          <div class="arc-set-row"><span>聊天背景色</span>
            <input type="color" id="arc-t-chatbg" value="#fff8f3">
          </div>
          <div class="arc-set-row"><span>背景图片</span>
            <div class="arc-color-pair">
              <button class="arc-btn arc-btn-ghost" id="arc-t-bgimg-btn">上传</button>
              <button class="arc-btn arc-btn-ghost" id="arc-t-bgimg-clear">清除</button>
              <input type="file" id="arc-t-bgimg-file" accept="image/*" style="display:none">
            </div>
          </div>
          <div class="arc-set-row"><span>视图比例（对话宽度）</span>
            <select id="arc-t-width">
              <option value="680">窄</option>
              <option value="880">标准</option>
              <option value="1100">宽</option>
              <option value="full">全宽</option>
            </select>
          </div>

          <div class="arc-set-btns">
            <button class="arc-btn arc-btn-danger" id="arc-t-reset">恢复默认</button>
            <button class="arc-btn arc-btn-primary" data-close="arc-theme-modal">完成</button>
          </div>
          <div class="arc-stat-sub" style="margin-top:10px">头像的显示/上传在右下角"头像设置"按钮里 · 所有设置统一应用到全部对话，刷新不丢</div>
        </div>
      </div>

      <div class="arc-modal" id="arc-upload-modal" hidden>
        <div class="arc-modal-mask" data-close="arc-upload-modal"></div>
        <div class="arc-modal-box">
          <div class="arc-modal-title"><span>${ic('upload', 16)} 导入 GPT 记录</span>
            <button class="arc-modal-close" data-close="arc-upload-modal">✕</button></div>
          <p style="font-size:13px;color:#8a7f70;margin:0 0 14px;line-height:1.7;">
            ChatGPT → 设置 → 数据控制 → 导出数据，把邮箱收到的 ZIP 直接丢进来<br>
            <small>也支持 conversations.json / 单对话 JSON / 本站备份 JSON · 重复自动去重</small>
          </p>
          <div class="arc-upload-zone" id="arc-upload-zone">
            <input type="file" id="arc-file-input" multiple accept=".json,.zip" style="display:none" />
            <div style="color:#b08b78;">${ic('folder', 30)}</div>
            <div style="font-size:13px;color:#6a6055;margin-top:6px;">点击选择文件 或 拖拽到这里</div>
          </div>
          <div id="arc-upload-status" style="font-size:12px;color:#8a7f70;margin-top:10px;min-height:18px;"></div>
          <div class="arc-set-btns">
            <button class="arc-btn arc-btn-danger" id="arc-clear-all">清空所有记录</button>
            <button class="arc-btn arc-btn-primary" data-close="arc-upload-modal">关闭</button>
          </div>
        </div>
      </div>
    `);

    bindEvents();
  }

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  function closeSidebarMobile() {
    $('arc-sidebar').classList.remove('arc-side-open');
    $('arc-side-mask').hidden = true;
  }

  function bindEvents() {
    // 弹窗关闭（遮罩 + ✕ + 完成）
    document.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(el.dataset.close));
    });

    // 移动端侧栏
    $('arc-menu-btn').addEventListener('click', () => {
      const side = $('arc-sidebar');
      const open = side.classList.toggle('arc-side-open');
      $('arc-side-mask').hidden = !open;
    });
    $('arc-side-mask').addEventListener('click', closeSidebarMobile);

    // 侧栏筛选
    $('arc-side-filter').addEventListener('input', (e) => {
      state.filter = e.target.value;
      renderSidebar();
    });

    // 工具栏
    $('arc-btn-search').addEventListener('click', () => {
      const bar = $('arc-searchbar');
      if (bar.hidden) openSearch(); else closeSearch();
    });
    $('arc-btn-bm').addEventListener('click', () => { renderBookmarkPanel(); openModal('arc-bm-modal'); });
    $('arc-btn-theme').addEventListener('click', () => { fillThemePanel(); openModal('arc-theme-modal'); });
    $('arc-btn-upload').addEventListener('click', () => openModal('arc-upload-modal'));
    $('arc-btn-export').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('arc-export-menu');
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (e) => {
      const menu = $('arc-export-menu');
      if (menu && !menu.hidden && !menu.contains(e.target)) menu.hidden = true;
    });
    $('arc-exp-txt').addEventListener('click', () => { $('arc-export-menu').hidden = true; exportCurrentTxt(); });
    $('arc-exp-bm').addEventListener('click', () => { $('arc-export-menu').hidden = true; exportBookmarksTxt(); });
    $('arc-exp-json').addEventListener('click', () => { $('arc-export-menu').hidden = true; exportBackupJson(); });

    // 图片点击放大（事件委托，图片是懒加载进来的）
    $('arc-chat').addEventListener('click', (e) => {
      const img = e.target.closest('.arc-img');
      if (img) openLightbox(img.src);
    });

    // 搜索
    $('arc-search-input').addEventListener('input', (e) => onSearchInput(e.target.value));
    $('arc-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchGo(state.search.idx + (e.shiftKey ? -1 : 1));
      if (e.key === 'Escape') closeSearch();
    });
    $('arc-search-prev').addEventListener('click', () => searchGo(state.search.idx - 1));
    $('arc-search-next').addEventListener('click', () => searchGo(state.search.idx + 1));
    $('arc-search-close').addEventListener('click', closeSearch);

    // Ctrl/Cmd+F 打开窗口内搜索（只在对话视图）
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && getConv(state.currentView)) {
        e.preventDefault();
        openSearch();
      }
    });

    // 上传
    $('arc-file-input').addEventListener('change', (e) => {
      if (e.target.files.length) processFiles(Array.from(e.target.files));
      e.target.value = '';
    });
    const zone = $('arc-upload-zone');
    zone.addEventListener('click', () => $('arc-file-input').click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('arc-dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('arc-dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('arc-dragover');
      if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
    });

    $('arc-clear-all').addEventListener('click', async () => {
      if (!confirm('确定清空所有记录吗？（原始导出文件还在你电脑里，随时能重新导入）')) return;
      await dbClearAll();
      localStorage.removeItem(BM_KEY);
      location.reload();
    });

    // ---- 外观设置 ----
    const bind = (id, key, ev) => {
      $(id).addEventListener(ev || 'input', (e) => {
        theme[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        saveTheme();
        applyTheme();
        if (key === 'userName' || key === 'aiName' || key === 'showNames') refreshCurrentView();
      });
    };
    bind('arc-t-username', 'userName');
    bind('arc-t-ainame', 'aiName');
    bind('arc-t-shownames', 'showNames', 'change');
    bind('arc-t-userbg', 'userBg');
    bind('arc-t-usertext', 'userText');
    bind('arc-t-ai1', 'ai1');
    bind('arc-t-ai2', 'ai2');
    bind('arc-t-aitext', 'aiText');
    bind('arc-t-chatbg', 'chatBg');
    bind('arc-t-width', 'width', 'change');

    $('arc-t-bgimg-btn').addEventListener('click', () => $('arc-t-bgimg-file').click());
    $('arc-t-bgimg-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        // 压缩到 1600px 以内，避免 localStorage 塞爆
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            theme.chatBgImage = canvas.toDataURL('image/jpeg', 0.8);
            saveTheme();
            applyTheme();
          } catch (err) { alert('图片太大存不下，换张小一点的试试'); }
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('arc-t-bgimg-clear').addEventListener('click', () => {
      theme.chatBgImage = '';
      saveTheme();
      applyTheme();
    });

    $('arc-t-reset').addEventListener('click', () => {
      theme = Object.assign({}, THEME_DEFAULTS);
      saveTheme();
      applyTheme();
      fillThemePanel();
      refreshCurrentView();
    });
  }

  function fillThemePanel() {
    $('arc-t-username').value = theme.userName;
    $('arc-t-ainame').value = theme.aiName;
    $('arc-t-shownames').checked = !!theme.showNames;
    if (theme.userBg) $('arc-t-userbg').value = theme.userBg;
    if (theme.userText) $('arc-t-usertext').value = theme.userText;
    if (theme.ai1) $('arc-t-ai1').value = theme.ai1;
    if (theme.ai2) $('arc-t-ai2').value = theme.ai2;
    if (theme.aiText) $('arc-t-aitext').value = theme.aiText;
    if (theme.chatBg) $('arc-t-chatbg').value = theme.chatBg;
    $('arc-t-width').value = theme.width;
  }

  function refreshCurrentView() {
    if (state.currentView === 'overview') renderOverview();
    else if (state.currentView === 'meta') renderMeta();
    else if (getConv(state.currentView)) {
      const kept = state.renderedCount;
      renderConversation(state.currentView);
      const conv = getConv(state.currentView);
      ensureRendered(conv, Math.min(kept, conv.messages.length) - 1);
    }
  }

  function showApp() {
    const sample = $('gpt-sample');
    if (sample) sample.hidden = true;
    const fab = $('arc-empty-fab');
    if (fab) fab.remove();
    $('archive-app').hidden = false;
    applyTheme();
  }

  // 没数据时：示例页上飘一个导入按钮
  function createEmptyFab() {
    const btn = document.createElement('button');
    btn.id = 'arc-empty-fab';
    btn.innerHTML = ic('upload', 22) || '导入';
    btn.style.color = '#fff';
    btn.title = '导入 GPT 记录';
    btn.style.cssText = `
      position: fixed; bottom: 148px; right: 28px;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, #10a37f, #34c79d);
      border: none; box-shadow: 0 4px 12px rgba(16,163,127,0.4);
      cursor: pointer; font-size: 20px; z-index: 300; transition: transform 0.2s;`;
    btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
    btn.onmouseleave = () => btn.style.transform = 'scale(1)';
    btn.onclick = () => openModal('arc-upload-modal');
    document.body.appendChild(btn);
  }

  // ===================== 启动 =====================
  async function init() {
    buildAppUI();
    applyTheme();

    state.convs = (await dbGetAllConvs()).sort((a, b) => b.lastTs - a.lastTs);
    await migrateLegacy();
    state.metaEntries = (await kvGet('metaEntries')) || [];

    if (state.convs.length > 0) {
      showApp();
      renderSidebar();
      openView('overview');
    } else {
      createEmptyFab();
    }
  }

  // 调试出口（排查解析问题用，不影响页面）
  window.__arcDebug = { parseExport, parseOneConversation, assetIdFromPointer, computeStats };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
