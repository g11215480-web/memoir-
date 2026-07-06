/**
 * 时间线：把 GPT / Claude / Gemini 三个家的记录按日期合在一起看
 * 只读各页存好的数据（MemoirArchive-* 和 GeminiMemoir），不改任何东西
 */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ic = (n, s) => (window.ArcIcons ? window.ArcIcons.icon(n, s) : '');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const PLATFORMS = {
    gpt: { name: 'GPT', c1: '#10a37f', c2: '#34c79d', icon: 'bot' },
    claude: { name: 'Claude', c1: '#d97757', c2: '#e89a7e', icon: 'blossom' },
    gemini: { name: 'Gemini', c1: '#4285f4', c2: '#6fa3f8', icon: 'sparkle' },
  };

  let theme = { userName: '鑫鑫', aiName: '星河' };
  try { theme = Object.assign(theme, JSON.parse(localStorage.getItem('memoirThemeV1') || '{}')); } catch {}

  const fmtDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fmtDateCn = (s) => { const [y, m, d] = s.split('-'); return `${y}年${parseInt(m)}月${parseInt(d)}日`; };
  const fmtTime = (ts) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // ---------- 读数据 ----------
  async function dbList() {
    try { return (await indexedDB.databases()).map(d => d.name); } catch { return null; }
  }

  function readArchive(names, page) {
    const dbName = 'MemoirArchive-' + page;
    if (names && !names.includes(dbName)) return Promise.resolve([]);
    return new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('conversations')) { db.close(); resolve([]); return; }
        const r = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
        r.onsuccess = () => { db.close(); resolve(r.result || []); };
        r.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
  }

  function readGeminiRecords(names) {
    if (names && !names.includes('GeminiMemoir')) return Promise.resolve([]);
    return new Promise((resolve) => {
      const req = indexedDB.open('GeminiMemoir');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('conversations')) { db.close(); resolve([]); return; }
        const r = db.transaction('conversations', 'readonly').objectStore('conversations').getAll();
        r.onsuccess = () => { db.close(); resolve(r.result || []); };
        r.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
  }

  function geminiTsToMs(timestamp, date) {
    const m = timestamp && timestamp.match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    if (timestamp) {
      const p = Date.parse(timestamp.replace(/\s+[A-Z]{2,5}(\+\d+)?$/, ''));
      if (!isNaN(p)) return p;
    }
    return date ? new Date(date + 'T12:00:00').getTime() : 0;
  }

  // ---------- 状态 ----------
  const byDate = new Map();   // date → [{p, role, text, ts}]
  const hasData = new Set();  // 有记录的平台
  const enabled = new Set(['gpt', 'claude', 'gemini']);
  let dates = [];
  let cur = -1;

  function add(p, role, text, ts) {
    if (!text || !ts) return;
    const d = fmtDate(ts);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ p, role, text, ts });
    hasData.add(p);
  }

  async function loadAll() {
    const names = await dbList();

    const [gpt, claude, geminiConvs, geminiRecords] = await Promise.all([
      readArchive(names, 'gpt'),
      readArchive(names, 'claude'),
      readArchive(names, 'gemini'),
      readGeminiRecords(names),
    ]);

    for (const c of gpt) for (const m of c.messages) add('gpt', m.role, m.text, m.ts);
    for (const c of claude) for (const m of c.messages) add('claude', m.role, m.text, m.ts);

    // Gemini：优先老库源头记录（更全），没有再用档案馆的
    if (geminiRecords.length) {
      for (const r of geminiRecords) {
        const ts = geminiTsToMs(r.timestamp, r.date);
        if (r.userInput) add('gemini', 'user', r.userInput, ts);
        if (r.aiResponse) add('gemini', 'ai', r.aiResponse, ts);
      }
    } else {
      for (const c of geminiConvs) for (const m of c.messages) add('gemini', m.role, m.text, m.ts);
    }

    dates = [...byDate.keys()].sort();
    cur = dates.length - 1;
  }

  // ---------- 渲染 ----------
  function renderControls() {
    if (!dates.length) return;
    $('tl-controls').hidden = false;

    const sel = $('tl-date');
    sel.innerHTML = dates.map((d, i) =>
      `<option value="${i}" ${i === cur ? 'selected' : ''}>${d}（${byDate.get(d).length}条）</option>`).join('');
    sel.onchange = () => { cur = parseInt(sel.value); renderDay(); };

    $('tl-prev').onclick = () => { if (cur > 0) { cur--; sync(); } };
    $('tl-next').onclick = () => { if (cur < dates.length - 1) { cur++; sync(); } };
    // 时光机：随便跳去有记忆的一天
    $('tl-random').onclick = () => {
      if (dates.length < 2) return;
      let r = cur;
      while (r === cur) r = Math.floor(Math.random() * dates.length);
      cur = r;
      sync();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const filters = $('tl-filters');
    filters.innerHTML = [...hasData].map(p => {
      const pf = PLATFORMS[p];
      return `<span class="tl-chip" data-p="${p}" style="--tl-c:${pf.c1}">${ic(pf.icon, 13)} ${pf.name}</span>`;
    }).join('');
    filters.querySelectorAll('.tl-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = chip.dataset.p;
        if (enabled.has(p)) { enabled.delete(p); chip.classList.add('off'); }
        else { enabled.add(p); chip.classList.remove('off'); }
        renderDay();
      });
    });
  }

  function sync() {
    $('tl-date').value = cur;
    renderDay();
  }

  function bubble(m) {
    const pf = PLATFORMS[m.p];
    const div = document.createElement('div');
    div.className = `message ${m.role}`;
    const name = m.role === 'user' ? theme.userName : theme.aiName;
    const text = esc(m.text).replace(/\[\[arc-img:[^\]]+\]\]/g, '〔图片〕').replace(/\n/g, '<br>');
    const aiStyle = m.role === 'ai'
      ? `style="background:linear-gradient(135deg,${pf.c1},${pf.c2});box-shadow:0 4px 14px ${pf.c1}55;"`
      : '';
    div.innerHTML = `
      <div class="avatar" style="${m.role === 'ai' ? `background:${pf.c1}22;color:${pf.c1};border-color:${pf.c1}55;` : ''}">${ic(m.role === 'user' ? 'user' : pf.icon, 19)}</div>
      <div class="bubble-wrap">
        <div class="arc-sender tl-sender-tag" style="font-size:0.72rem;color:var(--text-muted);padding:0 4px;">${esc(name)} · ${pf.name}</div>
        <div class="bubble" ${aiStyle}>${text}</div>
        <div class="timestamp">${fmtTime(m.ts)}</div>
      </div>`;
    return div;
  }

  function renderDay() {
    const box = $('tl-chat');
    box.innerHTML = '';
    if (cur < 0 || !dates.length) return;
    const d = dates[cur];
    const msgs = byDate.get(d).filter(m => enabled.has(m.p)).sort((a, b) => a.ts - b.ts);

    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.innerHTML = `<span>${fmtDateCn(d)}</span>`;
    box.appendChild(divider);

    const perP = {};
    for (const m of msgs) perP[m.p] = (perP[m.p] || 0) + 1;
    const stat = document.createElement('div');
    stat.className = 'tl-day-stat';
    stat.textContent = Object.entries(perP).map(([p, n]) => `${PLATFORMS[p].name} ${n} 条`).join(' · ') || '这一天被筛掉啦';
    box.appendChild(stat);

    const frag = document.createDocumentFragment();
    for (const m of msgs) frag.appendChild(bubble(m));
    box.appendChild(frag);
  }

  // ---------- 启动 ----------
  async function init() {
    await loadAll();
    if (!dates.length) {
      $('tl-chat').innerHTML = `<div class="tl-empty">还没有任何记录<br>先去 GPT / Claude / Gemini 页把导出包丢进去，这里就会热闹起来</div>`;
      return;
    }
    renderControls();
    renderDay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
