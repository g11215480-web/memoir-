// ===== 星河记忆库 · GitHub 云端同步 =====
(function () {
  const REPO  = 'g11215480-web/memoir-';
  const BRANCH = 'claude/chat-memory-website-gdwBt';
  const DATA_PATH = 'data/memory.json';
  const API_BASE = 'https://api.github.com';

  const TOKEN_KEY  = 'gh-memory-token';
  const SYNCED_KEY = 'gh-memory-last-sync';

  // -------- token --------
  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t.trim()); }

  // -------- 收集本地数据 --------
  function collectLocal() {
    const pages = ['gpt', 'claude', 'gemini'];
    const cats  = ['撒娇', '安慰', '提醒', '色色'];
    const custom = {};
    pages.forEach(p => {
      custom[p] = {};
      cats.forEach(c => {
        const v = localStorage.getItem(`murmur-custom-${p}-${c}`);
        if (v) custom[p][c] = JSON.parse(v);
      });
    });
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      murmur: {
        freq: localStorage.getItem('murmur-freq') || '偶尔',
        cats: JSON.parse(localStorage.getItem('murmur-cats') || '["撒娇","安慰","提醒"]'),
        nsfw: localStorage.getItem('murmur-nsfw') === 'true',
        custom,
      },
      settings: {
        avatarEnabled: localStorage.getItem('avatarEnabled') !== 'false',
      },
    };
  }

  // -------- 把云端数据合并进本地 --------
  function applyRemote(data) {
    if (!data || data.version !== 1) return;
    const m = data.murmur;
    if (m) {
      if (m.freq) localStorage.setItem('murmur-freq', m.freq);
      if (m.cats) localStorage.setItem('murmur-cats', JSON.stringify(m.cats));
      if (m.nsfw !== undefined) localStorage.setItem('murmur-nsfw', String(m.nsfw));
      if (m.custom) {
        Object.entries(m.custom).forEach(([page, cats]) => {
          Object.entries(cats).forEach(([cat, lines]) => {
            const key = `murmur-custom-${page}-${cat}`;
            // 合并：云端有、本地没有 → 新增；都有 → 用云端覆盖
            localStorage.setItem(key, JSON.stringify(lines));
          });
        });
      }
    }
    if (data.settings) {
      if (data.settings.avatarEnabled !== undefined)
        localStorage.setItem('avatarEnabled', String(data.settings.avatarEnabled));
    }
  }

  // -------- GitHub API --------
  async function apiGet(path) {
    const res = await fetch(`${API_BASE}/repos/${REPO}/contents/${path}?ref=${BRANCH}`, {
      headers: { Authorization: `token ${getToken()}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET ${path} 失败: ${res.status}`);
    return res.json();
  }

  async function apiPut(path, content, sha) {
    const body = {
      message: `sync: 更新记忆库 ${new Date().toLocaleString('zh-CN')}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;
    const res = await fetch(`${API_BASE}/repos/${REPO}/contents/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${getToken()}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub PUT ${path} 失败: ${res.status}`);
    return res.json();
  }

  // -------- 推送到云端 --------
  async function push() {
    if (!getToken()) throw new Error('请先填写 GitHub Token');
    const local = collectLocal();
    const existing = await apiGet(DATA_PATH);
    const sha = existing ? existing.sha : undefined;
    await apiPut(DATA_PATH, local, sha);
    const now = new Date().toLocaleString('zh-CN');
    localStorage.setItem(SYNCED_KEY, now);
    return now;
  }

  // -------- 从云端拉取 --------
  async function pull() {
    if (!getToken()) throw new Error('请先填写 GitHub Token');
    const file = await apiGet(DATA_PATH);
    if (!file) throw new Error('云端还没有数据，请先推送一次');
    const content = JSON.parse(decodeURIComponent(escape(atob(file.content.replace(/\n/g, '')))));
    applyRemote(content);
    const now = new Date().toLocaleString('zh-CN');
    localStorage.setItem(SYNCED_KEY, now);
    return content.updatedAt;
  }

  // -------- UI --------
  function injectUI() {
    // 找头像设置面板，追加记忆库区域
    const panel = document.getElementById('av-panel');
    if (!panel) return;

    const section = document.createElement('div');
    section.id = 'gh-storage-section';
    section.innerHTML = `
      <div class="av-divider" style="margin-top:14px">${window.ArcIcons ? window.ArcIcons.icon('cloud', 13) : ''} 记忆库</div>

      <div class="av-row" style="flex-direction:column;align-items:flex-start;gap:6px">
        <span class="av-label" style="margin-bottom:2px">GitHub Token</span>
        <div style="display:flex;gap:6px;width:100%">
          <input id="gh-token-input" type="password" placeholder="ghp_xxxx…"
            value="${getToken()}"
            style="flex:1;padding:5px 8px;border:1px solid #e8d8c8;border-radius:6px;font-size:12px;background:#fffaf7;color:#5a3e2b;outline:none"
          />
          <button onclick="window.__ghSaveToken()" class="av-btn-upload" style="white-space:nowrap">保存</button>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="gh-push-btn" onclick="window.__ghPush()" class="av-btn-upload" style="flex:1">推送到云端</button>
        <button id="gh-pull-btn" onclick="window.__ghPull()" class="av-btn-reset"  style="flex:1">从云端恢复</button>
      </div>

      <div id="gh-status" style="font-size:11px;color:#a08070;margin-top:6px;min-height:16px;text-align:center">
        ${localStorage.getItem(SYNCED_KEY) ? `上次同步：${localStorage.getItem(SYNCED_KEY)}` : '尚未同步'}
      </div>
    `;
    panel.appendChild(section);
  }

  function setStatus(msg, isError) {
    const el = document.getElementById('gh-status');
    if (el) { el.textContent = msg; el.style.color = isError ? '#c0392b' : '#a08070'; }
  }

  function setBtnLoading(id, loading, text) {
    const btn = document.getElementById(id);
    if (btn) { btn.disabled = loading; btn.textContent = loading ? '…' : text; }
  }

  // -------- 暴露全局方法 --------
  window.__ghSaveToken = function () {
    const val = document.getElementById('gh-token-input')?.value || '';
    setToken(val);
    setStatus(val ? 'Token 已保存' : 'Token 已清除');
  };

  window.__ghPush = async function () {
    setBtnLoading('gh-push-btn', true, '推送到云端');
    setStatus('同步中…');
    try {
      const t = await push();
      setStatus(`已推送 · ${t}`);
    } catch (e) {
      setStatus(e.message, true);
    } finally {
      setBtnLoading('gh-push-btn', false, '推送到云端');
    }
  };

  window.__ghPull = async function () {
    setBtnLoading('gh-pull-btn', true, '从云端恢复');
    setStatus('拉取中…');
    try {
      const t = await pull();
      setStatus(`已恢复 · 云端数据时间：${new Date(t).toLocaleString('zh-CN')}`);
    } catch (e) {
      setStatus(e.message, true);
    } finally {
      setBtnLoading('gh-pull-btn', false, '从云端恢复');
    }
  };

  // -------- 初始化 --------
  document.addEventListener('DOMContentLoaded', injectUI);
})();
