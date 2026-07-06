/**
 * Gemini 记录上传与解析
 * 解析 Google Takeout 导出的 ZIP 包或"我的活动记录.html"
 */

(function() {
  'use strict';

  // 存储键
  const STORAGE_KEY = 'gemini_conversations';

  // 加载 JSZip（用于解压 ZIP 文件）
  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  let JSZipLoaded = false;

  function loadJSZip() {
    return new Promise((resolve, reject) => {
      if (window.JSZip) {
        JSZipLoaded = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = JSZIP_CDN;
      script.onload = () => {
        JSZipLoaded = true;
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // ===== 初始化 =====
  async function init() {
    try {
      createUploadUI();
      await loadAndRenderConversations();
    } catch (err) {
      console.error('Gemini 上传模块初始化失败:', err);
    }
  }

  // ===== 创建上传界面 =====
  function createUploadUI() {
    // 上传按钮（放在页面右下角，和其他按钮一起）
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'float-btn upload-btn';
    uploadBtn.innerHTML = window.ArcIcons ? window.ArcIcons.icon('upload', 20) : '📤';
    uploadBtn.title = '上传 Gemini 记录';
    uploadBtn.style.cssText = `
      position: fixed;
      bottom: 180px;
      right: 24px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #4285f4, #6fa3f8);
      border: none;
      box-shadow: 0 4px 12px rgba(66, 133, 244, 0.4);
      cursor: pointer;
      font-size: 20px;
      color: #fff;
      z-index: 1000;
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    uploadBtn.onmouseenter = () => uploadBtn.style.transform = 'scale(1.1)';
    uploadBtn.onmouseleave = () => uploadBtn.style.transform = 'scale(1)';
    uploadBtn.onclick = openUploadModal;
    document.body.appendChild(uploadBtn);

    // 上传弹窗
    const modal = document.createElement('div');
    modal.id = 'gemini-upload-modal';
    modal.innerHTML = `
      <div class="upload-modal-backdrop" onclick="closeGeminiUploadModal()"></div>
      <div class="upload-modal-content">
        <h3>${window.ArcIcons ? window.ArcIcons.icon('upload', 16) : ''} 上传 Gemini 记录</h3>
        <p class="upload-desc">
          选择 Google Takeout 导出的 ZIP 包或「我的活动记录.html」<br>
          <small>可以一次选多个文件，重复的记录会自动去重</small>
        </p>
        <div class="upload-zone" id="upload-zone">
          <input type="file" id="gemini-file-input" multiple accept=".html,.zip" style="display:none" />
          <div class="upload-zone-inner" onclick="document.getElementById('gemini-file-input').click()">
            <span class="upload-icon">${window.ArcIcons ? window.ArcIcons.icon('folder', 28) : ''}</span>
            <span>点击选择文件 或 拖拽到这里</span>
          </div>
        </div>
        <div class="upload-status" id="upload-status"></div>
        <div class="upload-stats" id="upload-stats"></div>
        <div class="upload-actions">
          <button class="btn-secondary" onclick="closeGeminiUploadModal()">关闭</button>
          <button class="btn-danger" onclick="clearGeminiData()">清空所有记录</button>
        </div>
      </div>
    `;
    modal.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2000;
    `;
    document.body.appendChild(modal);

    // 绑定文件选择
    const fileInput = document.getElementById('gemini-file-input');
    fileInput.addEventListener('change', handleFileSelect);

    // 拖拽上传
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer.files).filter(f =>
        f.name.endsWith('.html') || f.name.endsWith('.zip')
      );
      if (files.length > 0) {
        processFiles(files);
      } else {
        document.getElementById('upload-status').textContent = '请上传 .html 或 .zip 文件';
      }
    });

    // 添加样式
    addUploadStyles();
  }

  // ===== 添加样式 =====
  function addUploadStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .upload-modal-backdrop {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
      }
      .upload-modal-content {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #fffaf5;
        border-radius: 16px;
        padding: 24px 32px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      }
      .upload-modal-content h3 {
        margin: 0 0 12px 0;
        font-family: 'Noto Serif SC', serif;
        color: #4285f4;
      }
      .upload-desc {
        color: #666;
        font-size: 14px;
        margin-bottom: 16px;
      }
      .upload-desc small {
        color: #999;
      }
      .upload-zone {
        border: 2px dashed #c7d7fd;
        border-radius: 12px;
        padding: 32px;
        text-align: center;
        transition: all 0.2s;
        background: #f8faff;
      }
      .upload-zone:hover, .upload-zone.dragover {
        border-color: #4285f4;
        background: #eef4ff;
      }
      .upload-zone-inner {
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        color: #666;
      }
      .upload-icon {
        font-size: 32px;
      }
      .upload-status {
        margin-top: 16px;
        font-size: 14px;
        color: #666;
        min-height: 20px;
      }
      .upload-status.success { color: #10a37f; }
      .upload-status.error { color: #e53e3e; }
      .upload-stats {
        margin-top: 8px;
        padding: 12px;
        background: #f0f4ff;
        border-radius: 8px;
        font-size: 13px;
        color: #555;
        display: none;
      }
      .upload-stats.show { display: block; }
      .upload-actions {
        margin-top: 20px;
        display: flex;
        gap: 12px;
        justify-content: flex-end;
      }
      .btn-secondary {
        padding: 8px 20px;
        border: 1px solid #ddd;
        background: #fff;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
      }
      .btn-secondary:hover {
        background: #f5f5f5;
      }
      .btn-danger {
        padding: 8px 20px;
        border: none;
        background: #fee2e2;
        color: #dc2626;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
      }
      .btn-danger:hover {
        background: #fecaca;
      }
      /* 不完整记录标注 */
      .incomplete-badge {
        display: inline-block;
        background: #fef3c7;
        color: #92400e;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 4px;
        margin-left: 8px;
      }
    `;
    document.head.appendChild(style);
  }

  // ===== 弹窗控制 =====
  window.openGeminiUploadModal = function() {
    document.getElementById('gemini-upload-modal').style.display = 'block';
    updateUploadStats();
  };

  window.closeGeminiUploadModal = function() {
    document.getElementById('gemini-upload-modal').style.display = 'none';
  };

  function openUploadModal() {
    window.openGeminiUploadModal();
  }

  // ===== 文件处理 =====
  function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      processFiles(files);
    }
  }

  async function processFiles(files) {
    const statusEl = document.getElementById('upload-status');
    statusEl.className = 'upload-status';
    statusEl.textContent = `正在处理 ${files.length} 个文件...`;

    let allRecords = [];
    let errorCount = 0;

    for (const file of files) {
      try {
        if (file.name.endsWith('.zip')) {
          // 处理 ZIP 文件
          statusEl.textContent = `正在解压: ${file.name}...`;
          await loadJSZip();

          const zip = await JSZip.loadAsync(file);
          let foundHtml = false;

          // 查找 HTML 文件
          for (const [filename, zipEntry] of Object.entries(zip.files)) {
            if (filename.endsWith('.html') && !zipEntry.dir) {
              statusEl.textContent = `正在解析: ${filename}...`;
              const htmlContent = await zipEntry.async('string');
              const records = parseGeminiHTML(htmlContent);
              allRecords = allRecords.concat(records);
              statusEl.textContent = `已解析: ${filename} (${records.length} 条)`;
              foundHtml = true;
            }
          }

          if (!foundHtml) {
            statusEl.textContent = `${file.name} 中未找到 HTML 文件`;
            errorCount++;
          }
        } else {
          // 处理 HTML 文件
          const text = await file.text();
          const records = parseGeminiHTML(text);
          allRecords = allRecords.concat(records);
          statusEl.textContent = `已解析: ${file.name} (${records.length} 条)`;
        }
      } catch (err) {
        console.error('解析失败:', file.name, err);
        statusEl.textContent = `解析失败: ${file.name} - ${err.message}`;
        errorCount++;
      }
    }

    if (allRecords.length === 0) {
      statusEl.className = 'upload-status error';
      statusEl.textContent = '未找到有效记录，请确认文件格式正确';
      return;
    }

    // 合并去重
    statusEl.textContent = `正在合并去重 ${allRecords.length} 条记录...`;
    const existingRecords = await loadRecords();
    const mergedRecords = mergeAndDedupe(existingRecords, allRecords);
    const newCount = mergedRecords.length - existingRecords.length;

    // 保存到 IndexedDB
    statusEl.textContent = `正在保存 ${mergedRecords.length} 条记录...`;
    try {
      await saveRecords(mergedRecords);
    } catch (err) {
      console.error('保存失败:', err);
      statusEl.className = 'upload-status error';
      statusEl.textContent = `保存失败: ${err.message}`;
      return;
    }

    statusEl.className = 'upload-status success';
    statusEl.textContent = `处理完成！共 ${allRecords.length} 条，新增 ${newCount} 条，去重后总计 ${mergedRecords.length} 条`;

    if (errorCount > 0) {
      statusEl.textContent += ` (${errorCount} 个文件解析失败)`;
    }

    await updateUploadStats();
    await loadAndRenderConversations();
  }

  // ===== 解析 HTML =====
  function parseGeminiHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const records = [];

    // 找到所有 outer-cell（每条记录）
    const cells = doc.querySelectorAll('.outer-cell');

    for (const cell of cells) {
      // 检查是否是 Gemini Apps 的记录
      const title = cell.querySelector('.mdl-typography--title');
      if (!title || !title.textContent.includes('Gemini')) continue;

      // 获取整个 cell 的文本内容
      const fullText = cell.textContent;

      let userInput = '';
      let timestamp = '';
      let aiResponse = '';

      // 1. 提取用户输入："Prompted xxx" 到时间戳之前的内容
      const promptedMatch = fullText.match(/Prompted\s+(.+?)(?=\d{4}年\d{1,2}月\d{1,2}日)/s);
      if (promptedMatch) {
        userInput = promptedMatch[1].trim();
      }

      // 2. 提取时间戳
      const timeMatch = fullText.match(/(\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}:\d{2}\s*[A-Z]*)/);
      if (timeMatch) {
        timestamp = timeMatch[1].trim();
      }

      // 3. 提取 AI 回复：时间戳之后、"Gemini Apps" 之前的内容
      if (timestamp) {
        const timeIndex = fullText.indexOf(timestamp);
        if (timeIndex > -1) {
          let afterTime = fullText.substring(timeIndex + timestamp.length);
          // 去掉末尾的 "Gemini Apps"
          afterTime = afterTime.replace(/\s*Gemini Apps\s*$/g, '').trim();
          // 过滤掉系统提示信息
          afterTime = afterTime.replace(/商品：\s*Gemini Apps为什么此处会显示此活动记录[\s\S]*?控制这些设置。?/g, '').trim();
          if (afterTime.length > 0) {
            aiResponse = afterTime;
          }
        }
      }

      // 跳过纯系统消息（没有实际对话内容的）
      if (userInput.includes('Gemini Apps为什么此处会显示') ||
          userInput.includes('Activity') ||
          userInput.startsWith('商品：')) {
        continue;
      }

      // 如果没有用户输入，跳过（可能是系统消息）
      if (!userInput) continue;

      // 生成唯一ID
      const uniqueId = generateId(timestamp, userInput);

      records.push({
        id: uniqueId,
        timestamp: timestamp,
        date: extractDate(timestamp),
        userInput: userInput,
        aiResponse: aiResponse,
        isIncomplete: !aiResponse
      });
    }

    // HTML 文件里最新的在最前面，反转让最早的在前面
    records.reverse();

    return records;
  }

  // ===== 工具函数 =====
  function cleanText(text) {
    return text
      .replace(/<[^>]+>/g, '') // 去HTML标签
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractDate(timestamp) {
    // 支持格式: "2026年4月15日 14:06:08 PDT" 或 "Apr 15, 2026, 2:06:08 PM PDT"
    // 中文格式
    let match = timestamp.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (match) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    // 英文格式
    const monthMap = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    match = timestamp.match(/(\w{3})\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const month = monthMap[match[1]] || '01';
      const day = match[2].padStart(2, '0');
      const year = match[3];
      return `${year}-${month}-${day}`;
    }
    return '';
  }

  function generateId(timestamp, userInput) {
    const str = timestamp + (userInput || '').substring(0, 50);
    // 简单的字符串哈希
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'gem_' + Math.abs(hash).toString(36);
  }

  // ===== 合并去重 =====
  function mergeAndDedupe(existing, newRecords) {
    const map = new Map();

    // 先加载已有记录
    for (const rec of existing) {
      map.set(rec.id, rec);
    }

    // 合并新记录
    for (const rec of newRecords) {
      const existingRec = map.get(rec.id);
      if (existingRec) {
        // 如果已存在，保留更完整的那个（有AI回复的优先）
        if (!existingRec.aiResponse && rec.aiResponse) {
          map.set(rec.id, rec);
        }
      } else {
        map.set(rec.id, rec);
      }
    }

    // 转为数组并按时间排序（旧的在前，像聊天记录一样）
    const result = Array.from(map.values());
    result.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.timestamp.localeCompare(b.timestamp);
    });

    return result;
  }

  // ===== IndexedDB 存储（无大小限制）=====
  const DB_NAME = 'GeminiMemoir';
  const DB_VERSION = 1;
  const STORE_NAME = 'conversations';

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  async function loadRecords() {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
          const records = request.result || [];
          // 按日期和时间排序
          records.sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return b.timestamp.localeCompare(a.timestamp);
          });
          resolve(records);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return [];
    }
  }

  async function saveRecords(records) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      // 清空旧数据，写入新数据
      store.clear();

      for (const record of records) {
        store.put(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearAllRecords() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  window.clearGeminiData = async function() {
    if (confirm('确定要清空所有 Gemini 记录吗？此操作不可恢复。')) {
      await clearAllRecords();
      await updateUploadStats();
      await loadAndRenderConversations();
      document.getElementById('upload-status').textContent = '已清空所有记录';
    }
  };

  // ===== 更新统计 =====
  async function updateUploadStats() {
    const records = await loadRecords();
    const statsEl = document.getElementById('upload-stats');

    if (records.length === 0) {
      statsEl.className = 'upload-stats';
      statsEl.style.display = 'none';
      return;
    }

    // 统计
    const dates = new Set(records.map(r => r.date));
    const incompleteCount = records.filter(r => r.isIncomplete).length;

    statsEl.className = 'upload-stats show';
    statsEl.innerHTML = `
      <strong>当前数据:</strong><br>
      总记录: ${records.length} 条<br>
      日期范围: ${records.length > 0 ? records[records.length-1].date : ''} ~ ${records.length > 0 ? records[0].date : ''}<br>
      天数: ${dates.size} 天<br>
      不完整记录: ${incompleteCount} 条
    `;
  }

  // ===== 分页和树状图相关 =====
  const PAGE_SIZE = 50; // 每页显示50条对话轮次
  let currentPage = 1;
  let allRecords = [];
  let conversationTurns = []; // 对话轮次（已分组）
  let sortedDates = [];

  // ===== 把记录分组成对话轮次（处理重新生成）=====
  function groupIntoTurns(records) {
    const turns = [];
    let i = 0;

    while (i < records.length) {
      const current = records[i];
      const userInput = current.userInput;
      const date = current.date;

      // 收集同一用户输入的所有版本（连续的、相同日期和相同输入）
      const versions = [current];
      let j = i + 1;

      while (j < records.length) {
        const next = records[j];
        // 如果用户输入相同且日期相同，认为是重新生成的版本
        if (next.userInput === userInput && next.date === date) {
          versions.push(next);
          j++;
        } else {
          break;
        }
      }

      // 按 AI 回复长度排序，最长的在前面
      versions.sort((a, b) => (b.aiResponse?.length || 0) - (a.aiResponse?.length || 0));

      turns.push({
        userInput: userInput,
        date: date,
        timestamp: current.timestamp,
        versions: versions,
        currentVersion: 0 // 默认显示第一个（最长的）
      });

      i = j;
    }

    return turns;
  }

  // ===== 渲染对话 =====
  async function loadAndRenderConversations() {
    allRecords = await loadRecords();
    const chatPage = document.querySelector('.chat-page');
    if (!chatPage) return;

    // 保留 header，清除其他内容
    const header = chatPage.querySelector('.chat-header');
    chatPage.innerHTML = '';
    if (header) chatPage.appendChild(header);

    if (allRecords.length === 0) {
      // 显示空状态
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:#999;">
          <div style="margin-bottom:16px;">${window.ArcIcons ? window.ArcIcons.icon('folder', 44) : ''}</div>
          <p>还没有记录</p>
          <p style="font-size:14px;">点击右下角上传按钮，导入 Gemini 导出的活动记录</p>
        </div>
      `;
      chatPage.appendChild(emptyState);
      return;
    }

    // 分组成对话轮次
    conversationTurns = groupIntoTurns(allRecords);

    // 按日期分组，收集所有日期
    sortedDates = [...new Set(conversationTurns.map(t => t.date || '未知日期'))].sort();

    // 创建左右布局
    const layout = document.createElement('div');
    layout.className = 'gemini-layout';

    // 收起/展开按钮
    const navToggle = document.createElement('button');
    navToggle.className = 'nav-toggle';
    const calIcon = () => window.ArcIcons ? window.ArcIcons.icon('calendar', 18) : '📅';
    const closeIcon = () => window.ArcIcons ? window.ArcIcons.icon('close', 16) : '✕';
    navToggle.innerHTML = calIcon();
    navToggle.title = '显示/隐藏日期导航';
    navToggle.onclick = function() {
      const nav = document.querySelector('.date-nav');
      nav.classList.toggle('collapsed');
      this.innerHTML = nav.classList.contains('collapsed') ? calIcon() : closeIcon();
    };
    chatPage.appendChild(navToggle);

    // 按月份分组日期
    const byMonth = {};
    for (const d of sortedDates) {
      const month = d.substring(0, 7); // "2026-04"
      if (!byMonth[month]) byMonth[month] = [];
      byMonth[month].push(d);
    }
    const sortedMonths = Object.keys(byMonth).sort();

    // 左侧日期导航
    const dateNav = document.createElement('nav');
    dateNav.className = 'date-nav';
    dateNav.id = 'date-nav';

    let navHTML = `<div class="date-nav-title">${window.ArcIcons ? window.ArcIcons.icon('calendar', 13) : ''} ${sortedDates.length} 天</div>`;
    for (const month of sortedMonths) {
      const [year, mon] = month.split('-');
      const monthName = `${year}年${parseInt(mon)}月`;
      const dates = byMonth[month];
      const isLatestMonth = month === sortedMonths[sortedMonths.length - 1];

      navHTML += `
        <div class="month-group">
          <div class="month-header" onclick="this.nextElementSibling.classList.toggle('expanded')">
            ${monthName} (${dates.length}天)
          </div>
          <div class="month-dates ${isLatestMonth ? 'expanded' : ''}">
            ${dates.map(d => `
              <div class="date-nav-item" data-date="${d}" onclick="geminiNavToDate('${d}')">
                ${parseInt(d.split('-')[2])}日
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    dateNav.innerHTML = navHTML;
    layout.appendChild(dateNav);

    // 右侧内容区
    const contentWrap = document.createElement('div');
    contentWrap.className = 'chat-content-wrap';
    contentWrap.id = 'chat-content';
    layout.appendChild(contentWrap);

    chatPage.appendChild(layout);

    // 隐藏的分页控件（保留功能但不显示）
    const pagination = document.createElement('div');
    pagination.className = 'pagination';
    pagination.id = 'pagination';
    pagination.style.display = 'none';
    chatPage.appendChild(pagination);

    // 添加日期选择器样式
    if (!document.getElementById('date-selector-style')) {
      const style = document.createElement('style');
      style.id = 'date-selector-style';
      style.textContent = `
        .date-selector {
          padding: 12px 20px;
          background: #f8f4f0;
          border-bottom: 1px solid #e8e0d8;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          position: sticky;
          top: 60px;
          z-index: 100;
        }
        .date-selector label { color: #666; font-size: 14px; }
        .date-selector select {
          padding: 6px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          background: #fff;
          font-size: 14px;
        }
        .record-count { color: #999; font-size: 13px; margin-left: auto; }
        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 20px;
          background: #f8f4f0;
          border-top: 1px solid #e8e0d8;
        }
        .pagination button {
          padding: 8px 16px;
          border: 1px solid #ddd;
          background: #fff;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
        }
        .pagination button:hover:not(:disabled) { background: #f0f0f0; }
        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }
        .pagination .page-info { color: #666; font-size: 14px; }
        /* 树状图切换按钮 */
        .version-switcher {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin-left: 12px;
          font-size: 12px;
          color: #888;
        }
        .version-switcher button {
          width: 24px;
          height: 24px;
          border: 1px solid #ddd;
          background: #fff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .version-switcher button:hover { background: #f0f0f0; }
        .version-switcher button:disabled { opacity: 0.3; cursor: not-allowed; }
        .version-info { min-width: 40px; text-align: center; }
        /* 头像在消息顶部 */
        #chat-content .message {
          align-items: flex-start;
        }
        /* 左侧日期导航 + 右侧内容布局 */
        .gemini-layout {
          display: flex;
          gap: 0;
          min-height: calc(100vh - 200px);
          max-width: 1000px;
          margin: 0 auto;
        }
        .date-nav {
          width: 160px;
          flex-shrink: 0;
          background: #faf6f3;
          border-right: 1px solid #ebe3dc;
          padding: 8px 0;
          position: sticky;
          top: 64px;
          height: calc(100vh - 64px);
          overflow-y: auto;
          transition: width 0.2s, padding 0.2s;
        }
        .date-nav.collapsed {
          width: 0;
          padding: 0;
          overflow: hidden;
        }
        .nav-toggle {
          position: fixed;
          left: 8px;
          top: 80px;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #fff;
          border: 1px solid #ddd;
          cursor: pointer;
          z-index: 101;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .nav-toggle:hover { background: #f5f5f5; }
        .date-nav-title {
          padding: 8px 12px;
          font-size: 12px;
          color: #999;
          border-bottom: 1px solid #ebe3dc;
          margin-bottom: 4px;
        }
        .date-nav-list {
          list-style: none;
        }
        .month-group {
          margin-bottom: 4px;
        }
        .month-header {
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 600;
          color: #888;
          background: #f5f0ec;
          cursor: pointer;
        }
        .month-header:hover { background: #efe8e3; }
        .month-dates {
          display: none;
        }
        .month-dates.expanded {
          display: block;
        }
        .date-nav-item {
          padding: 6px 12px 6px 20px;
          font-size: 12px;
          color: #666;
          cursor: pointer;
          border-left: 2px solid transparent;
          transition: all 0.15s;
        }
        .date-nav-item:hover {
          background: #f5eeea;
          color: #4285f4;
        }
        .date-nav-item.active {
          background: #eef4ff;
          color: #4285f4;
          border-left-color: #4285f4;
          font-weight: 500;
        }
        .chat-content-wrap {
          flex: 1;
          padding: 16px;
          max-width: 700px;
        }
        /* 隐藏旧的日期选择器 */
        .date-selector { display: none !important; }
      `;
      document.head.appendChild(style);
    }

    // 绑定左侧导航点击
    window.geminiNavToDate = function(date) {
      // 更新左侧导航的 active 状态
      document.querySelectorAll('.date-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.date === date);
      });
      // 渲染该日期的对话
      renderDateContent(date);
    };

    // 默认显示最新日期
    const latestDate = sortedDates[sortedDates.length - 1];
    if (latestDate) {
      geminiNavToDate(latestDate);
    }
  }

  // 渲染指定日期的内容
  function renderDateContent(date, scrollToBottom = true) {
    const contentContainer = document.getElementById('chat-content');
    if (!contentContainer) return;

    // 清空内容
    contentContainer.innerHTML = '';

    // 筛选该日期的对话，按时间顺序排列（早的在上面）
    const dateTurns = conversationTurns
      .filter(t => t.date === date)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    if (dateTurns.length === 0) {
      contentContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">这一天没有记录</div>';
      return;
    }

    // 日期标题
    const dateHeader = document.createElement('div');
    dateHeader.className = 'date-divider';
    dateHeader.innerHTML = `<span>${formatDateDisplay(date)} · ${dateTurns.length} 轮对话</span>`;
    contentContainer.appendChild(dateHeader);

    // 渲染对话
    for (let i = 0; i < dateTurns.length; i++) {
      const turn = dateTurns[i];
      const globalIndex = conversationTurns.indexOf(turn);
      const currentVer = turn.versions[turn.currentVersion];
      const hasMultipleVersions = turn.versions.length > 1;

      // 用户消息
      if (turn.userInput) {
        const userMsg = createMessageBubble('user', turn.userInput, extractTime(turn.timestamp));
        contentContainer.appendChild(userMsg);
      }

      // AI 回复
      if (currentVer && currentVer.aiResponse) {
        const aiMsg = document.createElement('div');
        aiMsg.className = 'message ai';
        aiMsg.id = `turn-${globalIndex}`;

        let versionSwitcher = '';
        if (hasMultipleVersions) {
          versionSwitcher = `
            <div class="version-switcher">
              <button onclick="geminiPrevVersion(${globalIndex})" ${turn.currentVersion <= 0 ? 'disabled' : ''}>&lt;</button>
              <span class="version-info">${turn.currentVersion + 1}/${turn.versions.length}</span>
              <button onclick="geminiNextVersion(${globalIndex})" ${turn.currentVersion >= turn.versions.length - 1 ? 'disabled' : ''}>&gt;</button>
            </div>
          `;
        }

        const formattedContent = currentVer.aiResponse.replace(/\n/g, '<br>');
        aiMsg.innerHTML = `
          <div class="avatar">${window.ArcIcons ? window.ArcIcons.icon('sparkle', 20) : '✨'}</div>
          <div class="bubble-wrap">
            <div class="bubble">${formattedContent}</div>
            <div class="timestamp">${extractTime(currentVer.timestamp)}${versionSwitcher}</div>
          </div>
        `;
        contentContainer.appendChild(aiMsg);
      } else if (turn.userInput) {
        // 没有 AI 回复
        const incompleteMsg = document.createElement('div');
        incompleteMsg.className = 'message ai incomplete';
        incompleteMsg.innerHTML = `
          <div class="avatar">${window.ArcIcons ? window.ArcIcons.icon('sparkle', 20) : '✨'}</div>
          <div class="bubble-wrap">
            <div class="bubble" style="background: #f5f5f5; color: #999; font-style: italic;">
              这段记忆不完整...
            </div>
          </div>
        `;
        contentContainer.appendChild(incompleteMsg);
      }
    }

    // 滚动到页面底部（最新消息在下面）
    if (scrollToBottom) {
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 150);
    }
  }

  function renderPage(page) {
    const contentContainer = document.getElementById('chat-content');
    const pagination = document.getElementById('pagination');
    if (!contentContainer) return;

    // 确保 page 有效
    page = Math.max(1, page || 1);

    // 计算分页
    const totalPages = Math.ceil(conversationTurns.length / PAGE_SIZE) || 1;
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, conversationTurns.length);
    const pageTurns = conversationTurns.slice(start, end);

    // 清空内容
    contentContainer.innerHTML = '';

    // 按日期分组当前页的对话轮次
    const byDate = {};
    for (let i = 0; i < pageTurns.length; i++) {
      const turn = pageTurns[i];
      const date = turn.date || '未知日期';
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push({ turn, globalIndex: start + i });
    }

    // 渲染
    const pageDates = Object.keys(byDate).sort();
    for (const date of pageDates) {
      // 日期分隔线
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.innerHTML = `<span>${formatDateDisplay(date)}</span>`;
      contentContainer.appendChild(divider);

      // 该日期下的对话轮次
      const dayTurns = byDate[date].sort((a, b) => a.turn.timestamp.localeCompare(b.turn.timestamp));

      for (const { turn, globalIndex } of dayTurns) {
        const currentVer = turn.versions[turn.currentVersion];
        const hasMultipleVersions = turn.versions.length > 1;

        // 用户消息
        if (turn.userInput) {
          const userMsg = createMessageBubble('user', turn.userInput, extractTime(turn.timestamp));
          contentContainer.appendChild(userMsg);
        }

        // AI 回复
        if (currentVer.aiResponse) {
          const aiMsg = document.createElement('div');
          aiMsg.className = 'message ai';
          aiMsg.id = `turn-${globalIndex}`;

          let versionSwitcher = '';
          if (hasMultipleVersions) {
            versionSwitcher = `
              <div class="version-switcher">
                <button onclick="geminiPrevVersion(${globalIndex})" ${turn.currentVersion <= 0 ? 'disabled' : ''}>&lt;</button>
                <span class="version-info">${turn.currentVersion + 1}/${turn.versions.length}</span>
                <button onclick="geminiNextVersion(${globalIndex})" ${turn.currentVersion >= turn.versions.length - 1 ? 'disabled' : ''}>&gt;</button>
              </div>
            `;
          }

          const formattedContent = currentVer.aiResponse.replace(/\n/g, '<br>');
          aiMsg.innerHTML = `
            <div class="avatar">${window.ArcIcons ? window.ArcIcons.icon('sparkle', 20) : '✨'}</div>
            <div class="bubble-wrap">
              <div class="bubble">${formattedContent}</div>
              <div class="timestamp">${extractTime(currentVer.timestamp)}${versionSwitcher}</div>
            </div>
          `;
          contentContainer.appendChild(aiMsg);
        } else if (turn.userInput) {
          // 没有 AI 回复
          const incompleteMsg = document.createElement('div');
          incompleteMsg.className = 'message ai incomplete';
          incompleteMsg.innerHTML = `
            <div class="avatar">${window.ArcIcons ? window.ArcIcons.icon('sparkle', 20) : '✨'}</div>
            <div class="bubble-wrap">
              <div class="bubble" style="background: #f5f5f5; color: #999; font-style: italic;">
                这段记忆不完整...
              </div>
            </div>
          `;
          contentContainer.appendChild(incompleteMsg);
        }
      }
    }

    // 更新分页控件（上一页=更早的，下一页=更新的）
    pagination.innerHTML = `
      <button onclick="geminiPrevPage()" ${page <= 1 ? 'disabled' : ''}>← 更早</button>
      <span class="page-info">第 ${page} / ${totalPages} 页 (${start + 1}-${end} 轮)</span>
      <button onclick="geminiNextPage()" ${page >= totalPages ? 'disabled' : ''}>更新 →</button>
    `;

    // 不自动滚动，由调用者决定
  }

  function jumpToDate(targetDate) {
    // 找到该日期第一轮对话的索引
    const index = conversationTurns.findIndex(t => t.date === targetDate);
    if (index === -1) {
      console.log('未找到日期:', targetDate);
      return;
    }

    // 计算页码
    const page = Math.floor(index / PAGE_SIZE) + 1;
    currentPage = page;
    renderPage(page);

    // 滚动到内容底部（最新的在下面）
    setTimeout(() => {
      window.scrollTo(0, document.body.scrollHeight);
    }, 100);

    // 更新下拉框选中项
    const select = document.getElementById('date-jump');
    if (select) select.value = targetDate;
  }

  // 全局函数供按钮调用
  window.geminiPrevPage = function() {
    if (currentPage > 1) {
      currentPage--;
      renderPage(currentPage);
      document.getElementById('chat-content')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  window.geminiNextPage = function() {
    const totalPages = Math.ceil(conversationTurns.length / PAGE_SIZE);
    if (currentPage < totalPages) {
      currentPage++;
      renderPage(currentPage);
      document.getElementById('chat-content')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 版本切换（不滚动到底部，保持当前位置）
  window.geminiPrevVersion = function(turnIndex) {
    if (conversationTurns[turnIndex].currentVersion > 0) {
      conversationTurns[turnIndex].currentVersion--;
      const date = conversationTurns[turnIndex].date;
      renderDateContent(date, false);
    }
  };

  window.geminiNextVersion = function(turnIndex) {
    const turn = conversationTurns[turnIndex];
    if (turn.currentVersion < turn.versions.length - 1) {
      turn.currentVersion++;
      renderDateContent(turn.date, false);
    }
  };

  function createMessageBubble(type, content, time) {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;

    const avatar = window.ArcIcons
      ? window.ArcIcons.icon(type === 'ai' ? 'sparkle' : 'user', 20)
      : (type === 'ai' ? '✨' : '🙋');

    // 处理内容中的换行
    const formattedContent = content.replace(/\n/g, '<br>');

    msg.innerHTML = `
      <div class="avatar">${avatar}</div>
      <div class="bubble-wrap">
        <div class="bubble">${formattedContent}</div>
        <div class="timestamp">${time}</div>
      </div>
    `;

    return msg;
  }

  function formatDateDisplay(dateStr) {
    // "2026-04-04" -> "2026年4月4日"
    const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[1]}年${parseInt(match[2])}月${parseInt(match[3])}日`;
    }
    return dateStr;
  }

  function extractTime(timestamp) {
    // 从 "2026年4月4日 07:20:10 CDT" 提取 "07:20"
    const match = timestamp.match(/(\d{1,2}:\d{2}):\d{2}/);
    return match ? match[1] : '';
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
