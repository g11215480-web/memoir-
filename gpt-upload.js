/**
 * GPT 记录上传与解析
 * 解析 ChatGPT 官方导出（设置→数据控制→导出数据）的 ZIP 包或 conversations.json
 * 架构照着 gemini-upload.js：上传 → 解析 mapping 树 → IndexedDB → 按日期浏览
 */

(function() {
  'use strict';

  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) { resolve(); return; }
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ===== IndexedDB =====
  const DB_NAME = 'GptMemoir';
  const DB_VERSION = 1;
  const STORE = 'records';

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function loadRecords() {
    try {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get('all');
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    } catch { return []; }
  }

  async function saveRecords(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(records, 'all');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllRecords() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('all');
      tx.oncomplete = resolve;
    });
  }

  // ===== 解析 ChatGPT conversations.json =====
  // 每个对话是 mapping 树，从 current_node 沿 parent 回溯得到当前分支的消息链
  function parseConversationsJson(jsonText) {
    let conversations;
    try {
      conversations = JSON.parse(jsonText);
    } catch { return []; }
    if (!Array.isArray(conversations)) return [];

    const records = [];
    for (const conv of conversations) {
      if (!conv || !conv.mapping) continue;
      const title = conv.title || '未命名对话';

      // 回溯消息链
      const chain = [];
      let nodeId = conv.current_node;
      let guard = 0;
      while (nodeId && conv.mapping[nodeId] && guard++ < 10000) {
        const node = conv.mapping[nodeId];
        if (node.message) chain.unshift(node.message);
        nodeId = node.parent;
      }

      // 过滤出 user/assistant 的有效文本消息
      const msgs = [];
      for (const m of chain) {
        const role = m.author && m.author.role;
        if (role !== 'user' && role !== 'assistant') continue;
        if (m.metadata && (m.metadata.is_visually_hidden_from_conversation || m.metadata.is_user_system_message)) continue;
        const text = extractText(m.content);
        if (!text) continue;
        msgs.push({
          role,
          text,
          time: m.create_time ? m.create_time * 1000 : (conv.create_time ? conv.create_time * 1000 : Date.now()),
          mid: m.id || '',
        });
      }
      if (msgs.length === 0) continue;

      // 配成轮次：user 及其后面跟着的 assistant 们
      let current = null;
      for (const m of msgs) {
        if (m.role === 'user') {
          if (current) records.push(current);
          current = { id: 'gpt-' + (m.mid || m.time), timestamp: m.time, title, userInput: m.text, aiResponse: '' };
        } else {
          if (!current) {
            current = { id: 'gpt-' + (m.mid || m.time), timestamp: m.time, title, userInput: '', aiResponse: '' };
          }
          current.aiResponse += (current.aiResponse ? '\n\n' : '') + m.text;
        }
      }
      if (current) records.push(current);
    }

    // 加日期字段
    for (const r of records) {
      const d = new Date(r.timestamp);
      r.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return records;
  }

  // content 可能是 text / multimodal_text / code 等
  function extractText(content) {
    if (!content) return '';
    const parts = content.parts || [];
    const out = [];
    for (const p of parts) {
      if (typeof p === 'string') {
        if (p.trim()) out.push(p.trim());
      } else if (p && typeof p === 'object') {
        // 图片等多模态：先用占位（图片文件在导出包里，后续版本再接）
        if (p.content_type === 'image_asset_pointer' || p.asset_pointer) out.push('🖼️ [图片]');
      }
    }
    if (out.length === 0 && content.content_type === 'code' && content.text) {
      out.push('```\n' + content.text + '\n```');
    }
    return out.join('\n');
  }

  function mergeAndDedupe(existing, incoming) {
    const seen = new Set(existing.map(r => r.id));
    const merged = [...existing];
    let added = 0;
    for (const r of incoming) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
      added++;
    }
    merged.sort((a, b) => a.timestamp - b.timestamp);
    return { merged, added };
  }

  // ===== 文件处理 =====
  async function processFiles(files) {
    const statusEl = document.getElementById('gpt-upload-status');
    const setStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    let newRecords = [];
    for (const file of files) {
      try {
        if (file.name.endsWith('.zip')) {
          setStatus(`解压 ${file.name} ...`);
          await loadJSZip();
          const zip = await window.JSZip.loadAsync(file);
          // 找 conversations.json（可能在根目录或子目录）
          let found = null;
          zip.forEach((path, entry) => {
            if (!found && path.endsWith('conversations.json')) found = entry;
          });
          if (!found) { setStatus(`${file.name} 里没找到 conversations.json`); continue; }
          const text = await found.async('string');
          setStatus('解析对话中...');
          newRecords = newRecords.concat(parseConversationsJson(text));
        } else if (file.name.endsWith('.json')) {
          setStatus(`解析 ${file.name} ...`);
          const text = await file.text();
          newRecords = newRecords.concat(parseConversationsJson(text));
        } else {
          setStatus(`不认识 ${file.name}（要 ZIP 或 conversations.json）`);
        }
      } catch (err) {
        console.error('解析失败:', err);
        setStatus(`解析 ${file.name} 失败: ${err.message}`);
      }
    }

    if (newRecords.length === 0) { setStatus('没解析出任何对话'); return; }

    const existing = await loadRecords();
    const { merged, added } = mergeAndDedupe(existing, newRecords);
    await saveRecords(merged);
    setStatus(`✅ 解析出 ${newRecords.length} 轮，新增 ${added} 轮（去重后共 ${merged.length} 轮）`);
    updateStats(merged);
    await renderConversations();
  }

  function updateStats(records) {
    const el = document.getElementById('gpt-upload-stats');
    if (!el || records.length === 0) return;
    const dates = new Set(records.map(r => r.date));
    const first = new Date(records[0].timestamp);
    const last = new Date(records[records.length - 1].timestamp);
    el.innerHTML = `共 <b>${records.length}</b> 轮对话 · <b>${dates.size}</b> 天 · ${first.getFullYear()}.${first.getMonth() + 1}.${first.getDate()} ~ ${last.getFullYear()}.${last.getMonth() + 1}.${last.getDate()}`;
  }

  // ===== 渲染（按日期浏览） =====
  let allDates = [];
  let currentDateIndex = -1;

  async function renderConversations() {
    const records = await loadRecords();
    if (records.length === 0) return;

    const main = document.querySelector('.chat-page');
    if (!main) return;

    // 清掉占位示例（保留 chat-header）
    main.querySelectorAll('.date-divider, .message, .gpt-day-nav').forEach(el => el.remove());

    // 按日期分组
    const byDate = {};
    for (const r of records) (byDate[r.date] = byDate[r.date] || []).push(r);
    allDates = Object.keys(byDate).sort();
    if (currentDateIndex < 0 || currentDateIndex >= allDates.length) currentDateIndex = allDates.length - 1;

    // 日期导航条
    const nav = document.createElement('div');
    nav.className = 'gpt-day-nav';
    nav.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0 4px;flex-wrap:wrap;';
    nav.innerHTML = `
      <button onclick="gptPrevDay()" style="padding:4px 12px;border-radius:16px;border:1px solid #e0d5c5;background:#fff;cursor:pointer;">‹ 前一天</button>
      <select id="gpt-date-select" onchange="gptJumpDate(this.value)" style="padding:4px 10px;border-radius:16px;border:1px solid #e0d5c5;background:#fff;">
        ${allDates.map((d, i) => `<option value="${i}" ${i === currentDateIndex ? 'selected' : ''}>${d}（${byDate[d].length}轮）</option>`).join('')}
      </select>
      <button onclick="gptNextDay()" style="padding:4px 12px;border-radius:16px;border:1px solid #e0d5c5;background:#fff;cursor:pointer;">后一天 ›</button>
    `;
    main.appendChild(nav);

    // 当天的对话
    const date = allDates[currentDateIndex];
    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.innerHTML = `<span>${date.replace(/-/g, '年').replace('年', '年').replace(/年(\d+)年/, '年$1月')}日</span>`;
    // 简化：直接 yyyy年m月d日
    const [y, mo, da] = date.split('-');
    divider.innerHTML = `<span>${y}年${parseInt(mo)}月${parseInt(da)}日</span>`;
    main.appendChild(divider);

    for (const r of byDate[date]) {
      if (r.userInput) main.appendChild(bubble('user', r.userInput, r.timestamp));
      if (r.aiResponse) main.appendChild(bubble('ai', r.aiResponse, r.timestamp));
    }
  }

  function bubble(type, text, ts) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    const t = new Date(ts);
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const avatar = type === 'user' ? '🙋' : '🌿';
    const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    div.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="bubble-wrap">
        <div class="bubble">${safe}</div>
        <div class="timestamp">${time}</div>
      </div>`;
    return div;
  }

  window.gptPrevDay = function() {
    if (currentDateIndex > 0) { currentDateIndex--; renderConversations(); }
  };
  window.gptNextDay = function() {
    if (currentDateIndex < allDates.length - 1) { currentDateIndex++; renderConversations(); }
  };
  window.gptJumpDate = function(i) {
    currentDateIndex = parseInt(i);
    renderConversations();
  };

  // ===== 上传 UI =====
  function createUploadUI() {
    const uploadBtn = document.createElement('button');
    uploadBtn.innerHTML = '📤';
    uploadBtn.title = '上传 GPT 记录';
    uploadBtn.style.cssText = `
      position: fixed; bottom: 180px; right: 24px;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, #10a37f, #34c79d);
      border: none; box-shadow: 0 4px 12px rgba(16,163,127,0.4);
      cursor: pointer; font-size: 20px; z-index: 1000; transition: transform 0.2s;
    `;
    uploadBtn.onmouseenter = () => uploadBtn.style.transform = 'scale(1.1)';
    uploadBtn.onmouseleave = () => uploadBtn.style.transform = 'scale(1)';
    uploadBtn.onclick = () => { document.getElementById('gpt-upload-modal').style.display = 'block'; };
    document.body.appendChild(uploadBtn);

    const modal = document.createElement('div');
    modal.id = 'gpt-upload-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:2000;';
    modal.innerHTML = `
      <div onclick="closeGptUploadModal()" style="position:absolute;inset:0;background:rgba(0,0,0,0.4);"></div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,92vw);background:#fffaf3;border-radius:16px;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 8px;color:#10a37f;">📤 上传 GPT 记录</h3>
        <p style="font-size:13px;color:#8a7f70;margin:0 0 14px;line-height:1.7;">
          ChatGPT → 设置 → 数据控制 → 导出数据，把邮箱收到的 ZIP 直接丢进来<br>
          <small>也支持单独的 conversations.json · 重复记录自动去重</small>
        </p>
        <div id="gpt-upload-zone" style="border:2px dashed #10a37f55;border-radius:12px;padding:26px;text-align:center;cursor:pointer;background:#10a37f0a;"
          onclick="document.getElementById('gpt-file-input').click()">
          <input type="file" id="gpt-file-input" multiple accept=".json,.zip" style="display:none" />
          <div style="font-size:26px;">📁</div>
          <div style="font-size:13px;color:#6a6055;margin-top:6px;">点击选择文件 或 拖拽到这里</div>
        </div>
        <div id="gpt-upload-status" style="font-size:12px;color:#8a7f70;margin-top:10px;min-height:18px;"></div>
        <div id="gpt-upload-stats" style="font-size:12px;color:#6a6055;margin-top:4px;"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button onclick="clearGptData()" style="padding:6px 14px;border-radius:10px;border:1px solid #e08585;background:#fff;color:#c04040;cursor:pointer;font-size:13px;">清空所有记录</button>
          <button onclick="closeGptUploadModal()" style="padding:6px 14px;border-radius:10px;border:none;background:#10a37f;color:#fff;cursor:pointer;font-size:13px;">关闭</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    window.closeGptUploadModal = () => { modal.style.display = 'none'; };
    window.clearGptData = async () => {
      if (!confirm('确定要清空所有 GPT 记录吗？（原始导出文件还在你电脑里，可以重新上传）')) return;
      await clearAllRecords();
      document.getElementById('gpt-upload-status').textContent = '已清空';
      document.getElementById('gpt-upload-stats').textContent = '';
      location.reload();
    };

    document.getElementById('gpt-file-input').addEventListener('change', (e) => {
      if (e.target.files.length) processFiles(Array.from(e.target.files));
    });
    const zone = document.getElementById('gpt-upload-zone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.background = '#10a37f22'; });
    zone.addEventListener('dragleave', () => { zone.style.background = '#10a37f0a'; });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.background = '#10a37f0a';
      if (e.dataTransfer.files.length) processFiles(Array.from(e.dataTransfer.files));
    });
  }

  // ===== 启动 =====
  async function init() {
    createUploadUI();
    const records = await loadRecords();
    if (records.length > 0) {
      updateStats(records);
      await renderConversations();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
