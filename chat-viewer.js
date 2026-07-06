/**
 * 对话档案馆引擎（GPT 页）
 * 导入 ChatGPT 官方导出（ZIP / conversations.json / 单对话 JSON）
 * → 按对话存 IndexedDB → 侧栏浏览 + 统计总览 + 自定义&记忆 + 书签 + 搜索 + 外观自定义 + 导出
 */

(function () {
  'use strict';

  const PAGE = (document.body && document.body.dataset.page) || 'gpt';
  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const CHUNK = 120; // 每批渲染的消息条数

  // 每个平台的品牌配置（Claude/Gemini 页共用这套引擎）
  const BRAND = {
    gpt: {
      label: 'GPT', color1: '#10a37f', color2: '#34c79d', aiIcon: 'bot',
      hint: 'ChatGPT → 设置 → 数据控制 → 导出数据，把邮箱收到的 ZIP 直接丢进来',
    },
    claude: {
      label: 'Claude', color1: '#d97757', color2: '#e89a7e', aiIcon: 'blossom',
      hint: 'claude.ai → 设置(Settings) → 账户(Account) → 导出数据(Export data)，把邮箱收到的 ZIP 丢进来',
    },
    gemini: {
      label: 'Gemini', color1: '#4285f4', color2: '#6fa3f8', aiIcon: 'sparkle',
      hint: 'Google Takeout（takeout.google.com）勾选"我的活动 → Gemini Apps"导出，把 ZIP 或 我的活动记录.html 丢进来',
    },
  };
  const brand = BRAND[PAGE] || BRAND.gpt;

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
    renderStart: 0,       // 当前对话已渲染区间的起点（区间是 [renderStart, 总长)，从底往上补）
    observer: null,
    search: { q: '', matches: [], idx: -1, results: [], ridx: -1 },
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

  // Claude 官方导出：conversations.json 是 [{uuid,name,created_at,chat_messages:[{sender,text,content,created_at}]}]
  function parseClaudeConversation(conv) {
    if (!conv || !Array.isArray(conv.chat_messages)) return null;
    const title = conv.name || '未命名对话';
    const convId = conv.uuid || ('claude-' + (conv.created_at || Math.random()));
    const messages = [];
    for (const m of conv.chat_messages) {
      const role = m.sender === 'human' ? 'user' : 'ai';
      let text = (m.text || '').trim();
      if (!text && Array.isArray(m.content)) {
        text = m.content
          .map(c => (c && c.type === 'text' && c.text) ? c.text : '')
          .filter(Boolean).join('\n').trim();
      }
      if (!text) continue;
      const ts = m.created_at ? Date.parse(m.created_at) : (conv.created_at ? Date.parse(conv.created_at) : Date.now());
      messages.push({ role, text, ts });
    }
    if (!messages.length) return null;
    messages.sort((a, b) => a.ts - b.ts);
    return {
      conv: {
        id: convId, title, messages,
        stats: computeStats(messages),
        firstTs: messages[0].ts,
        lastTs: messages[messages.length - 1].ts,
      },
      metaEntries: [],
    };
  }

  // 整个 JSON 文本（数组 或 单对话对象），自动识别 ChatGPT / Claude 格式
  function parseExport(jsonText) {
    let data;
    try { data = JSON.parse(jsonText); } catch (e) { throw new Error('JSON 格式不对：' + e.message); }
    const list = Array.isArray(data) ? data : [data];
    const convs = [];
    const metaEntries = [];
    for (const item of list) {
      let r = null;
      if (item && item.mapping) r = parseOneConversation(item);
      else if (item && Array.isArray(item.chat_messages)) r = parseClaudeConversation(item);
      if (!r) continue;
      if (r.conv.messages.length > 0) convs.push(r.conv);
      metaEntries.push(...r.metaEntries);
    }
    return { convs, metaEntries };
  }

  // ===================== Gemini（Google Takeout 活动记录，沿用老库 GeminiMemoir） =====================
  // 老模块 gemini-upload.js 的数据原样保留在 GeminiMemoir 里作为源头，
  // 档案馆的"对话"是按天从它重新生成的，怎么折腾都不会丢原始记录。

  function geminiOpenDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('GeminiMemoir', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('conversations')) {
          const store = db.createObjectStore('conversations', { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function geminiLoadRecords() {
    try {
      const db = await geminiOpenDB();
      return new Promise((resolve) => {
        const r = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
        r.onsuccess = () => { db.close(); resolve(r.result || []); };
        r.onerror = () => { db.close(); resolve([]); };
      });
    } catch { return []; }
  }

  async function geminiSaveRecords(records) {
    const db = await geminiOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('conversations', 'readwrite');
      const store = tx.objectStore('conversations');
      for (const r of records) store.put(r);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  // "2026年4月15日 14:06:08 GMT+8" / "Apr 15, 2026, 2:06:08 PM PDT" → 毫秒
  function geminiTsToMs(timestamp, date) {
    const m = timestamp && timestamp.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if (timestamp) {
      const p = Date.parse(timestamp.replace(/\s+[A-Z]{2,5}(\+\d+)?$/, ''));
      if (!isNaN(p)) return p;
    }
    return date ? new Date(date + 'T12:00:00').getTime() : Date.now();
  }

  // 活动记录是零散轮次 → 按天拼成对话
  function geminiRecordsToConvs(records) {
    const byDate = {};
    for (const r of records) {
      const ts = geminiTsToMs(r.timestamp, r.date);
      const d = r.date || fmtDate(ts);
      (byDate[d] = byDate[d] || []).push({ r, ts });
    }
    const convs = [];
    for (const [d, items] of Object.entries(byDate)) {
      items.sort((a, b) => a.ts - b.ts || String(a.r.id).localeCompare(String(b.r.id)));
      const messages = [];
      for (const { r, ts } of items) {
        if (r.userInput) messages.push({ role: 'user', text: r.userInput, ts });
        if (r.aiResponse) messages.push({ role: 'ai', text: r.aiResponse, ts });
      }
      if (!messages.length) continue;
      convs.push({
        id: 'gemini-day-' + d,
        title: fmtDateCn(d),
        messages,
        stats: computeStats(messages),
        firstTs: messages[0].ts,
        lastTs: messages[messages.length - 1].ts,
      });
    }
    convs.sort((a, b) => b.lastTs - a.lastTs);
    return convs;
  }

  // Takeout 的 我的活动记录.html 解析（从 gemini-upload.js 移植）
  function parseGeminiHTML(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const records = [];
    const cells = doc.querySelectorAll('.outer-cell');
    for (const cell of cells) {
      const title = cell.querySelector('.mdl-typography--title');
      if (!title || !title.textContent.includes('Gemini')) continue;
      const fullText = cell.textContent;

      let userInput = '';
      let timestamp = '';
      let aiResponse = '';

      const promptedMatch = fullText.match(/Prompted\s+(.+?)(?=\d{4}年\d{1,2}月\d{1,2}日)/s);
      if (promptedMatch) userInput = promptedMatch[1].trim();

      const timeMatch = fullText.match(/(\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}:\d{2}\s*[A-Z]*)/);
      if (timeMatch) timestamp = timeMatch[1].trim();

      if (timestamp) {
        const timeIndex = fullText.indexOf(timestamp);
        if (timeIndex > -1) {
          let afterTime = fullText.substring(timeIndex + timestamp.length);
          afterTime = afterTime.replace(/\s*Gemini Apps\s*$/g, '').trim();
          afterTime = afterTime.replace(/商品：\s*Gemini Apps为什么此处会显示此活动记录[\s\S]*?控制这些设置。?/g, '').trim();
          if (afterTime.length > 0) aiResponse = afterTime;
        }
      }

      if (userInput.includes('Gemini Apps为什么此处会显示') || userInput.includes('Activity') || userInput.startsWith('商品：')) continue;
      if (!userInput) continue;

      const idStr = timestamp + (userInput || '').substring(0, 50);
      let hash = 0;
      for (let i = 0; i < idStr.length; i++) {
        hash = ((hash << 5) - hash) + idStr.charCodeAt(i);
        hash = hash & hash;
      }
      const dateM = timestamp.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      records.push({
        id: 'gem_' + Math.abs(hash).toString(36),
        timestamp,
        date: dateM ? `${dateM[1]}-${dateM[2].padStart(2, '0')}-${dateM[3].padStart(2, '0')}` : '',
        userInput,
        aiResponse,
        isIncomplete: !aiResponse,
      });
    }
    records.reverse();
    return records;
  }

  function geminiMergeRecords(existing, incoming) {
    const map = new Map();
    for (const r of existing) map.set(r.id, r);
    let added = 0;
    for (const r of incoming) {
      const old = map.get(r.id);
      if (!old) { map.set(r.id, r); added++; }
      else if (!old.aiResponse && r.aiResponse) map.set(r.id, r);
    }
    return { merged: [...map.values()], added };
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
    if (PAGE !== 'gpt') return;
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
    return ic(role === 'user' ? 'user' : brand.aiIcon, 20) || (role === 'user' ? '我' : 'TA');
  }

  function highlightText(safeText, q) {
    if (!q) return safeText;
    const escQ = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safeText.replace(new RegExp(escQ, 'gi'), (m) => `<mark class="arc-mark">${m}</mark>`);
    } catch { return safeText; }
  }

  // 轻量排版：把长消息里的 ## 标题、**粗体**、```代码```、--- 渲染出来
  function mdLite(s) {
    s = s.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (_, code) =>
      `<span class="arc-code">${code.replace(/^\n+|\n+$/g, '')}</span>`);
    s = s.replace(/`([^`\n]+)`/g, '<code class="arc-ic">$1</code>');
    s = s.replace(/(^|\n)#{1,4}\s*([^\n]+)/g, (_, br, t) => `${br}<strong class="arc-h">${t}</strong>`);
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|\n)\s*---+\s*(?=\n|$)/g, '$1<span class="arc-hr"></span>');
    return s;
  }

  function buildBubble(convId, mi, m) {
    const div = document.createElement('div');
    div.className = `message ${m.role}`;
    div.dataset.mi = mi;
    const name = m.role === 'user' ? theme.userName : theme.aiName;
    const starred = state.bookmarks.some(b => b.convId === convId && b.mi === mi);
    let safe = esc(m.text);
    if (state.search.q) safe = highlightText(safe, state.search.q);
    safe = mdLite(safe);
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
        slot.title = '导出包里没有这张图，点一下可以从电脑里补一张';
        slot.innerHTML = `${ic('image', 18)}<i>图片不在包里 · 点我补一张</i>`;
      }
    }
  }

  // 手动补图：点缺图的槽 → 选图 → 存进 assets 库，永远显示
  let pendingAssetId = null;

  function fillMissingImage(file) {
    if (!pendingAssetId || !file) return;
    const id = pendingAssetId;
    pendingAssetId = null;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = async () => {
        const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          await dbPutAsset(id, blob);
          assetKeysCache = null;
          const url = URL.createObjectURL(blob);
          assetUrlCache.set(id, url);
          document.querySelectorAll(`.arc-img-missing[data-asset="${CSS.escape(id)}"]`).forEach(slot => {
            slot.outerHTML = `<img class="arc-img" src="${url}" alt="图片">`;
          });
        }, 'image/jpeg', 0.85);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
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

  // 像聊天软件一样：打开就在最底（最新），往上滑加载更早的
  function renderConversation(convId, jumpToMi) {
    const conv = getConv(convId);
    if (!conv) { renderOverview(); return; }
    if (state.observer) { state.observer.disconnect(); state.observer = null; }

    const inner = chatInner();
    setToolbarTitle(esc(conv.title));
    inner.dataset.convId = convId;
    state.renderStart = Math.max(0, conv.messages.length - CHUNK);

    // 顶部哨兵：滑到就往前补一批
    const sentinel = document.createElement('div');
    sentinel.className = 'arc-sentinel';
    sentinel.id = 'arc-sentinel';
    inner.appendChild(sentinel);

    inner.appendChild(buildRangeFrag(conv, state.renderStart, conv.messages.length));
    updateSentinel(conv, sentinel);
    hydrateImages(inner);

    const chat = $('arc-chat');
    chat.scrollTop = chat.scrollHeight;

    state.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && state.renderStart > 0) prependChunk(conv);
    }, { root: chat, rootMargin: '600px 0px' });
    state.observer.observe(sentinel);

    if (typeof jumpToMi === 'number') jumpToMessage(convId, jumpToMi);
  }

  function updateSentinel(conv, sentinel) {
    sentinel.textContent = state.renderStart > 0
      ? `上面还有 ${fmtNum(state.renderStart)} 条 · 往上滑继续看`
      : '· 这就是我们的开头啦 ·';
  }

  function buildRangeFrag(conv, s, e) {
    const frag = document.createDocumentFragment();
    let prevDate = s > 0 ? fmtDate(conv.messages[s - 1].ts) : null;
    for (let i = s; i < e; i++) {
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
    return frag;
  }

  // 往前补渲染到 toIndex（不传就补一批），并保持滚动位置不跳
  function prependChunk(conv, toIndex) {
    const inner = $('arc-chat-inner');
    const chat = $('arc-chat');
    const sentinel = $('arc-sentinel');
    if (!inner || !sentinel) return;
    const newStart = toIndex !== undefined
      ? Math.max(0, Math.min(toIndex, state.renderStart))
      : Math.max(0, state.renderStart - CHUNK);
    if (newStart >= state.renderStart) return;

    const frag = buildRangeFrag(conv, newStart, state.renderStart);
    const before = chat.scrollHeight;
    sentinel.after(frag);
    state.renderStart = newStart;
    chat.scrollTop += chat.scrollHeight - before;
    updateSentinel(conv, sentinel);
    hydrateImages(inner);
  }

  function ensureRendered(conv, mi) {
    if (mi < state.renderStart) prependChunk(conv, mi);
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
        <div class="arc-bm-text">${ic(b.role === 'user' ? 'user' : brand.aiIcon, 13)} ${esc(b.snippet)}</div>
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

  // ===================== 搜索（本对话 / 全部对话） =====================
  function searchScope() {
    const sel = $('arc-search-scope');
    return sel ? sel.value : 'conv';
  }

  function openSearch() {
    // 不在对话视图时自动切成"全部对话"
    if (!getConv(state.currentView)) {
      const sel = $('arc-search-scope');
      if (sel) sel.value = 'all';
    }
    $('arc-searchbar').hidden = false;
    $('arc-search-input').focus();
  }

  function closeSearch() {
    const bar = $('arc-searchbar');
    if (!bar || bar.hidden) return;
    bar.hidden = true;
    $('arc-search-input').value = '';
    $('arc-search-results').hidden = true;
    const hadQuery = !!state.search.q;
    state.search = { q: '', matches: [], idx: -1, results: [], ridx: -1 };
    updateSearchCount();
    // 清掉高亮：重渲染当前对话
    if (hadQuery && getConv(state.currentView)) renderConversation(state.currentView);
  }

  function snippetAround(text, pos, qLen) {
    const start = Math.max(0, pos - 34);
    const end = Math.min(text.length, pos + qLen + 46);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  function globalSearch(q) {
    const ql = q.toLowerCase();
    const res = [];
    for (const c of state.convs) {
      for (let i = 0; i < c.messages.length; i++) {
        const m = c.messages[i];
        const pos = m.text.toLowerCase().indexOf(ql);
        if (pos < 0) continue;
        res.push({ convId: c.id, mi: i, title: c.title, ts: m.ts, role: m.role, snippet: snippetAround(m.text, pos, q.length) });
        if (res.length >= 300) return res;
      }
    }
    return res;
  }

  function renderSearchResults() {
    const box = $('arc-search-results');
    const { results, q } = state.search;
    if (!q || searchScope() !== 'all') { box.hidden = true; return; }
    if (!results.length) {
      box.innerHTML = '<div class="arc-bm-empty">全部对话里都没找到</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = results.map((r, i) => `
      <div class="arc-sr-item" data-i="${i}">
        <div class="arc-bm-head">
          <span class="arc-bm-conv">${esc(r.title)}</span>
          <span class="arc-bm-time">${fmtDate(r.ts)} ${fmtTime(r.ts)}</span>
        </div>
        <div class="arc-bm-text">${highlightText(esc(r.snippet), q)}</div>
      </div>`).join('');
    box.hidden = false;
    box.querySelectorAll('.arc-sr-item').forEach(el => {
      el.addEventListener('click', () => {
        box.hidden = true;
        searchGo(parseInt(el.dataset.i));
      });
    });
  }

  let searchTimer = null;
  function onSearchInput(val) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const q = val.trim();
      state.search.q = q;

      if (searchScope() === 'all') {
        state.search.results = q ? globalSearch(q) : [];
        state.search.ridx = -1;
        state.search.matches = [];
        renderSearchResults();
        updateSearchCount();
        return;
      }

      const conv = getConv(state.currentView);
      if (!conv) return;
      $('arc-search-results').hidden = true;
      state.search.matches = [];
      state.search.idx = -1;
      if (q) {
        const ql = q.toLowerCase();
        conv.messages.forEach((m, i) => {
          if (m.text.toLowerCase().includes(ql)) state.search.matches.push(i);
        });
      }
      // 重渲染（带高亮），从最近的一处开始往前翻
      renderConversation(state.currentView);
      updateSearchCount();
      if (state.search.matches.length) searchGo(state.search.matches.length - 1);
    }, 250);
  }

  function updateSearchCount() {
    const el = $('arc-search-count');
    if (!el) return;
    const s = state.search;
    if (searchScope() === 'all') {
      el.textContent = s.results.length
        ? (s.ridx >= 0 ? `${s.ridx + 1} / ${s.results.length}` : `${s.results.length} 条`)
        : (s.q ? '0 条' : '');
    } else {
      el.textContent = s.matches.length ? `${s.idx + 1} / ${s.matches.length}` : (s.q ? '0 处' : '');
    }
  }

  function highlightCurrentMark(mi) {
    document.querySelectorAll('mark.arc-mark-current').forEach(m => m.classList.remove('arc-mark-current'));
    const el = document.querySelector(`#arc-chat-inner .message[data-mi="${mi}"] mark.arc-mark`);
    if (el) el.classList.add('arc-mark-current');
  }

  function searchGo(newIdx) {
    const s = state.search;
    if (searchScope() === 'all') {
      if (!s.results.length) return;
      s.ridx = ((newIdx % s.results.length) + s.results.length) % s.results.length;
      updateSearchCount();
      const r = s.results[s.ridx];
      jumpToMessage(r.convId, r.mi);
      highlightCurrentMark(r.mi);
      return;
    }
    if (!s.matches.length) return;
    s.idx = ((newIdx % s.matches.length) + s.matches.length) % s.matches.length;
    updateSearchCount();
    const mi = s.matches[s.idx];
    jumpToMessage(state.currentView, mi);
    highlightCurrentMark(mi);
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

  // ===================== 云端备份（GitHub 私有仓库，换电脑不怕） =====================
  const GH_TOKEN_KEY = 'gh-memory-token'; // 和"记忆库"共用同一个 Token
  const VAULT_REPO = 'memoir-vault';      // 自动创建的私有仓库，聊天记录只放这里
  const PAKO_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js';
  const GH_API = 'https://api.github.com';

  function loadPako() {
    return new Promise((resolve, reject) => {
      if (window.pako) { resolve(); return; }
      const script = document.createElement('script');
      script.src = PAKO_CDN;
      script.onload = resolve;
      script.onerror = () => reject(new Error('压缩库加载失败，检查网络后重试'));
      document.head.appendChild(script);
    });
  }

  const ghToken = () => localStorage.getItem(GH_TOKEN_KEY) || '';
  function ghHeaders(extra) {
    return Object.assign({
      Authorization: `token ${ghToken()}`,
      Accept: 'application/vnd.github.v3+json',
    }, extra || {});
  }

  let ghLoginCache = null;
  async function ghUser() {
    if (ghLoginCache) return ghLoginCache;
    const res = await fetch(`${GH_API}/user`, { headers: ghHeaders() });
    if (!res.ok) throw new Error('Token 不对或权限不够（建 Token 时要勾 repo 权限）');
    ghLoginCache = (await res.json()).login;
    return ghLoginCache;
  }

  async function ensureVault(login) {
    const res = await fetch(`${GH_API}/repos/${login}/${VAULT_REPO}`, { headers: ghHeaders() });
    if (res.ok) return;
    if (res.status !== 404) throw new Error('查仓库失败 ' + res.status);
    const create = await fetch(`${GH_API}/user/repos`, {
      method: 'POST',
      headers: ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: VAULT_REPO, private: true, auto_init: true,
        description: '回忆录云端备份（私有）',
      }),
    });
    if (!create.ok) throw new Error('创建私有仓库失败 ' + create.status);
  }

  function u8ToBase64(u8) {
    let out = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  async function vaultSha(login, path) {
    const dir = path.slice(0, path.lastIndexOf('/'));
    const res = await fetch(`${GH_API}/repos/${login}/${VAULT_REPO}/contents/${dir}`, { headers: ghHeaders() });
    if (!res.ok) return undefined;
    const list = await res.json();
    const name = path.slice(path.lastIndexOf('/') + 1);
    const hit = Array.isArray(list) ? list.find(f => f.name === name) : null;
    return hit ? hit.sha : undefined;
  }

  async function cloudBackup(setSt) {
    if (!ghToken()) throw new Error('先填 GitHub Token（和右下角"记忆库"用同一个）');
    if (!state.convs.length) throw new Error('还没有记录，先导入再备份');
    setSt('打包压缩中…');
    await loadPako();
    const payload = {
      version: 1, page: PAGE, savedAt: new Date().toISOString(),
      conversations: state.convs, metaEntries: state.metaEntries,
      bookmarks: state.bookmarks, theme,
    };
    const gz = window.pako.gzip(JSON.stringify(payload));
    setSt(`压缩好了（${(gz.length / 1048576).toFixed(1)} MB），上传中…`);
    const login = await ghUser();
    await ensureVault(login);
    const path = `backup/memoir-${PAGE}.json.gz`;
    const sha = await vaultSha(login, path);
    const body = { message: `backup ${PAGE} ${new Date().toLocaleString('zh-CN')}`, content: u8ToBase64(gz) };
    if (sha) body.sha = sha;
    const res = await fetch(`${GH_API}/repos/${login}/${VAULT_REPO}/contents/${path}`, {
      method: 'PUT',
      headers: ghHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('上传失败 ' + res.status);
    const now = new Date().toLocaleString('zh-CN');
    localStorage.setItem('memoirCloudSynced-' + PAGE, now);
    return now;
  }

  async function cloudRestore(setSt) {
    if (!ghToken()) throw new Error('先填 GitHub Token（和右下角"记忆库"用同一个）');
    setSt('从云端下载中…');
    await loadPako();
    const login = await ghUser();
    const res = await fetch(`${GH_API}/repos/${login}/${VAULT_REPO}/contents/backup/memoir-${PAGE}.json.gz`, {
      headers: ghHeaders({ Accept: 'application/vnd.github.raw' }),
    });
    if (res.status === 404) throw new Error('云端还没有这一页的备份，先备份一次');
    if (!res.ok) throw new Error('下载失败 ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    setSt('解包中…');
    const payload = JSON.parse(window.pako.ungzip(buf, { to: 'string' }));
    if (!payload || !Array.isArray(payload.conversations)) throw new Error('云端备份格式不对');

    const { merged } = mergeConvs(state.convs, payload.conversations);
    state.convs = merged;
    state.metaEntries = mergeMeta(state.metaEntries, payload.metaEntries || []);
    const seen = new Set(state.bookmarks.map(b => bmKey(b.convId, b.mi)));
    for (const b of (payload.bookmarks || [])) {
      const k = bmKey(b.convId, b.mi);
      if (!seen.has(k)) { state.bookmarks.push(b); seen.add(k); }
    }
    saveBookmarks();
    await dbPutConvs(merged);
    await kvSet('metaEntries', state.metaEntries);
    showApp();
    renderSidebar();
    openView('overview');
    return merged.length;
  }

  // ===================== 上传处理 =====================
  async function processFiles(files) {
    const statusEl = $('arc-upload-status');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    let newConvs = [];
    let newMeta = [];
    let newGemini = [];
    for (const file of files) {
      try {
        if (PAGE === 'gemini' && file.name.endsWith('.html')) {
          setStatus(`解析 ${file.name} ...`);
          newGemini = newGemini.concat(parseGeminiHTML(await file.text()));
          continue;
        }
        if (PAGE === 'gemini' && file.name.endsWith('.zip')) {
          setStatus(`解压 ${file.name} ...`);
          await loadJSZip();
          const zip = await window.JSZip.loadAsync(file);
          const htmlEntries = [];
          zip.forEach((path, entry) => {
            if (!entry.dir && path.endsWith('.html')) htmlEntries.push(entry);
          });
          if (!htmlEntries.length) { setStatus(`${file.name} 里没找到活动记录 HTML`); continue; }
          for (const entry of htmlEntries) {
            setStatus(`解析 ${entry.name} ...`);
            newGemini = newGemini.concat(parseGeminiHTML(await entry.async('string')));
          }
          continue;
        }
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

    // Gemini：轮次记录先并进老库（源头），再按天重新生成对话
    if (newGemini.length) {
      setStatus(`合并 ${newGemini.length} 条活动记录...`);
      const existing = await geminiLoadRecords();
      const { merged: mergedRecords, added } = geminiMergeRecords(existing, newGemini);
      await geminiSaveRecords(mergedRecords);
      newConvs = newConvs.concat(geminiRecordsToConvs(mergedRecords));
      setStatus(`活动记录新增 ${added} 条，重建对话中...`);
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

    // 存过钥匙的话，导入完自动备份到云端（手机那边恢复一下就是最新的）
    if (ghToken()) {
      const cloudSt = (t, err) => {
        const el = $('arc-cloud-status');
        if (el) { el.textContent = t; el.style.color = err ? '#c0392b' : '#8a7f70'; }
      };
      cloudBackup(cloudSt)
        .then(t => cloudSt('已自动备份到云端 · ' + t))
        .catch(e => cloudSt('自动云备份没成功（手动点一下"备份到云端"）：' + e.message, true));
    }
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
          <select id="arc-search-scope" class="arc-search-scope" title="搜索范围">
            <option value="conv">本对话</option>
            <option value="all">全部对话</option>
          </select>
          <input class="arc-search-input" id="arc-search-input" type="text" placeholder="想找哪句话…" />
          <span class="arc-search-count" id="arc-search-count"></span>
          <button class="arc-search-nav" id="arc-search-prev" title="上一处">${ic('chevUp', 14)}</button>
          <button class="arc-search-nav" id="arc-search-next" title="下一处">${ic('chevDown', 14)}</button>
          <button class="arc-search-nav" id="arc-search-close" title="关闭">${ic('close', 13)}</button>
        </div>
        <div class="arc-search-results" id="arc-search-results" hidden></div>

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

          <div class="arc-set-section">温柔配色（点一下整套换）</div>
          <div class="arc-preset-row" id="arc-preset-row"></div>

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
          <div class="arc-modal-title"><span>${ic('upload', 16)} 导入 ${brand.label} 记录</span>
            <button class="arc-modal-close" data-close="arc-upload-modal">✕</button></div>
          <p style="font-size:13px;color:#8a7f70;margin:0 0 14px;line-height:1.7;">
            ${brand.hint}<br>
            <small>也支持 conversations.json / 单对话 JSON / 本站备份 JSON · 重复自动去重</small><br>
            <small>记录存在浏览器里，要用固定的网址打开才看得到——用桌面的「打开回忆录」启动器就永远不会丢</small>
          </p>
          <div class="arc-upload-zone" id="arc-upload-zone">
            <input type="file" id="arc-file-input" multiple accept="${PAGE === 'gemini' ? '.json,.zip,.html' : '.json,.zip'}" style="display:none" />
            <div style="color:#b08b78;">${ic('folder', 30)}</div>
            <div style="font-size:13px;color:#6a6055;margin-top:6px;">点击选择文件 或 拖拽到这里</div>
          </div>
          <div id="arc-upload-status" style="font-size:12px;color:#8a7f70;margin-top:10px;min-height:18px;"></div>

          <div class="arc-set-section" style="margin-top:14px;">${ic('cloud', 13)} 云 端（换电脑、清浏览器都不怕）</div>
          <div style="display:flex;gap:6px;margin:10px 0 8px;">
            <input type="password" id="arc-gh-token" placeholder="GitHub Token（和记忆库共用）"
              style="flex:1;padding:6px 10px;border:1px solid #e8d8c8;border-radius:8px;font-size:12px;background:#fffaf7;color:#5a3e2b;outline:none;">
            <button class="arc-btn arc-btn-ghost" id="arc-gh-save">存</button>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="arc-btn arc-btn-primary" id="arc-cloud-push" style="flex:1;">备份到云端</button>
            <button class="arc-btn arc-btn-ghost" id="arc-cloud-pull" style="flex:1;">从云端恢复</button>
          </div>
          <div id="arc-cloud-status" style="font-size:12px;color:#8a7f70;margin-top:8px;min-height:16px;"></div>
          <div class="arc-stat-sub" style="margin-top:2px;">备份放在你自己的私有仓库 ${VAULT_REPO}，只有你的 Token 打得开 · 文字/书签/设置都会备份，图片暂时不上云</div>

          <div class="arc-set-btns">
            <button class="arc-btn arc-btn-danger" id="arc-clear-all">清空所有记录</button>
            <button class="arc-btn arc-btn-primary" data-close="arc-upload-modal">关闭</button>
          </div>
        </div>
      </div>

      <input type="file" id="arc-fill-img-input" accept="image/*" style="display:none">
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

    // 图片点击放大 + 缺图点击补图（事件委托，图片是懒加载进来的）
    $('arc-chat').addEventListener('click', (e) => {
      const img = e.target.closest('.arc-img');
      if (img) { openLightbox(img.src); return; }
      const miss = e.target.closest('.arc-img-missing');
      if (miss) {
        pendingAssetId = miss.dataset.asset;
        $('arc-fill-img-input').click();
      }
    });
    $('arc-fill-img-input').addEventListener('change', (e) => {
      if (e.target.files.length) fillMissingImage(e.target.files[0]);
      e.target.value = '';
    });

    // 搜索
    const curSearchIdx = () => (searchScope() === 'all' ? state.search.ridx : state.search.idx);
    $('arc-search-input').addEventListener('input', (e) => onSearchInput(e.target.value));
    $('arc-search-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchGo(curSearchIdx() + (e.shiftKey ? -1 : 1));
      if (e.key === 'Escape') closeSearch();
    });
    $('arc-search-scope').addEventListener('change', () => {
      onSearchInput($('arc-search-input').value);
      $('arc-search-input').focus();
    });
    $('arc-search-prev').addEventListener('click', () => searchGo(curSearchIdx() - 1));
    $('arc-search-next').addEventListener('click', () => searchGo(curSearchIdx() + 1));
    $('arc-search-close').addEventListener('click', closeSearch);

    // Ctrl/Cmd+F 打开搜索（有记录就能搜）
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && state.convs.length) {
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

    // ---- 云端 ----
    const cloudStatus = (t, err) => {
      const el = $('arc-cloud-status');
      if (el) { el.textContent = t; el.style.color = err ? '#c0392b' : '#8a7f70'; }
    };
    $('arc-gh-token').value = ghToken();
    const lastSync = localStorage.getItem('memoirCloudSynced-' + PAGE);
    if (lastSync) cloudStatus('上次备份：' + lastSync);
    $('arc-gh-save').addEventListener('click', () => {
      localStorage.setItem(GH_TOKEN_KEY, $('arc-gh-token').value.trim());
      ghLoginCache = null;
      cloudStatus(ghToken() ? 'Token 已保存' : 'Token 已清除');
    });
    $('arc-cloud-push').addEventListener('click', async () => {
      const btn = $('arc-cloud-push');
      btn.disabled = true;
      try {
        const t = await cloudBackup(cloudStatus);
        cloudStatus('备份好了 · ' + t);
      } catch (e) { cloudStatus(e.message, true); }
      finally { btn.disabled = false; }
    });
    $('arc-cloud-pull').addEventListener('click', async () => {
      const btn = $('arc-cloud-pull');
      btn.disabled = true;
      try {
        const n = await cloudRestore(cloudStatus);
        cloudStatus(`恢复好了，现在共 ${n} 个对话`);
      } catch (e) { cloudStatus(e.message, true); }
      finally { btn.disabled = false; }
    });

    // ---- 温柔配色一键换 ----
    const PRESETS = [
      { name: '暖杏(默认)', ai1: '', ai2: '', aiText: '', userBg: '', userText: '', chatBg: '' },
      { name: '樱花粉', ai1: '#f2a5b8', ai2: '#f7c6d3', aiText: '#5a323e', userBg: '#fff5f8', userText: '#5a323e', chatBg: '#fdf0f4' },
      { name: '雾霭紫', ai1: '#a893dd', ai2: '#c5b3ea', aiText: '#ffffff', userBg: '#f8f5ff', userText: '#463a63', chatBg: '#f4f0fb' },
      { name: '薄荷奶绿', ai1: '#83c9ab', ai2: '#a8ddc3', aiText: '#1f4a36', userBg: '#f3faf6', userText: '#2b4a3c', chatBg: '#eef7f2' },
      { name: '海盐蓝', ai1: '#8cb8e8', ai2: '#b0cff3', aiText: '#243d5c', userBg: '#f4f9fe', userText: '#2e4562', chatBg: '#eef5fc' },
      { name: '焦糖奶茶', ai1: '#c8a17b', ai2: '#dcbf9f', aiText: '#43301f', userBg: '#fdf8f2', userText: '#4a3626', chatBg: '#f8f1e8' },
    ];
    $('arc-preset-row').innerHTML = PRESETS.map((p, i) => `
      <button class="arc-preset" data-i="${i}">
        <span class="arc-preset-dot" style="background:${p.ai1 ? `linear-gradient(135deg, ${p.ai1}, ${p.ai2})` : 'linear-gradient(135deg, #e8826a, #f5a97f)'}"></span>
        <span>${p.name}</span>
      </button>`).join('');
    $('arc-preset-row').querySelectorAll('.arc-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = PRESETS[parseInt(btn.dataset.i)];
        Object.assign(theme, {
          ai1: p.ai1, ai2: p.ai2, aiText: p.aiText,
          userBg: p.userBg, userText: p.userText, chatBg: p.chatBg, chatBgImage: '',
        });
        saveTheme();
        applyTheme();
        fillThemePanel();
        refreshCurrentView();
      });
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
      const conv = getConv(state.currentView);
      const kept = state.renderStart;
      const chat = $('arc-chat');
      const fromBottom = chat ? (chat.scrollHeight - chat.scrollTop) : 0;
      renderConversation(state.currentView);
      if (kept < state.renderStart) prependChunk(conv, kept);
      if (chat) chat.scrollTop = chat.scrollHeight - fromBottom; // 尽量停在原来的位置
    }
  }

  function showApp() {
    const sample = $('arc-sample') || $('gpt-sample');
    if (sample) sample.hidden = true;
    const fab = $('arc-empty-fab');
    if (fab) fab.remove();
    $('archive-app').hidden = false;
    document.body.classList.add('arc-active'); // 锁住整页，工具栏不再被滚走

    // 把页脚那句固定的话搬进应用底部，一直看得见
    if (!$('arc-footline')) {
      const fm = document.querySelector('.footer-fixed-msg');
      if (fm) {
        const line = document.createElement('div');
        line.className = 'arc-footline';
        line.id = 'arc-footline';
        line.textContent = fm.textContent;
        document.querySelector('.arc-main').appendChild(line);
      }
    }
    applyTheme();
  }

  // 没数据时：示例页头下面放两颗明显的按钮（手机上也一眼看到）
  function createStartCard() {
    const sample = $('arc-sample') || $('gpt-sample');
    const header = sample && sample.querySelector('.chat-header');
    if (!header) return;
    const card = document.createElement('div');
    card.className = 'arc-start-card';
    card.innerHTML = `
      <button class="arc-btn arc-btn-primary" id="arc-start-import">${ic('upload', 15)} 导入 ${brand.label} 记录</button>
      <button class="arc-btn arc-btn-ghost" id="arc-start-restore">${ic('cloud', 15)} 从云端恢复</button>`;
    header.after(card);
    card.querySelector('#arc-start-import').addEventListener('click', () => openModal('arc-upload-modal'));
    card.querySelector('#arc-start-restore').addEventListener('click', () => openModal('arc-upload-modal'));
  }

  // 没数据时：示例页上飘一个导入按钮
  function createEmptyFab() {
    const btn = document.createElement('button');
    btn.id = 'arc-empty-fab';
    btn.innerHTML = ic('upload', 22) || '导入';
    btn.title = `导入 ${brand.label} 记录`;
    btn.style.cssText = `
      position: fixed; bottom: 148px; right: 28px;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, ${brand.color1}, ${brand.color2});
      border: none; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      color: #fff; cursor: pointer; font-size: 20px; z-index: 300; transition: transform 0.2s;`;
    btn.onmouseenter = () => btn.style.transform = 'scale(1.1)';
    btn.onmouseleave = () => btn.style.transform = 'scale(1)';
    btn.onclick = () => openModal('arc-upload-modal');
    document.body.appendChild(btn);
  }

  // ===================== 启动 =====================
  async function init() {
    if (!$('archive-app')) return; // 这个页面没接档案馆就不启动
    buildAppUI();
    applyTheme();

    state.convs = (await dbGetAllConvs()).sort((a, b) => b.lastTs - a.lastTs);
    await migrateLegacy();

    // Gemini：每次启动都从老库（源头）重建按天对话，老数据一条不丢
    if (PAGE === 'gemini') {
      const records = await geminiLoadRecords();
      if (records.length) {
        const regen = geminiRecordsToConvs(records);
        const { merged } = mergeConvs(state.convs, regen);
        state.convs = merged;
        await dbPutConvs(merged);
      }
    }

    state.metaEntries = (await kvGet('metaEntries')) || [];

    if (state.convs.length > 0) {
      showApp();
      renderSidebar();
      openView('overview');
    } else {
      createEmptyFab();
      createStartCard();
    }
  }

  // 调试出口（排查解析问题用，不影响页面）
  window.__arcDebug = { parseExport, parseOneConversation, assetIdFromPointer, computeStats, mdLite, geminiTsToMs, geminiRecordsToConvs, geminiMergeRecords };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
