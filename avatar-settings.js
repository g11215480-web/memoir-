// ===== 头像设置模块 =====
(function () {
  const PAGE = document.body.dataset.page; // 'gpt' | 'claude' | 'gemini'
  if (!PAGE) return; // 首页不注入

  const DEFAULT_EMOJI = { gpt: '🤖', claude: '🌸', gemini: '✨', user: '🙋' };
  const ICON_NAME = { gpt: 'bot', claude: 'blossom', gemini: 'sparkle', user: 'user' };
  let uploadTarget = null;

  // 默认头像：优先用线条图标（icons.js），没有再退回 emoji
  function defaultAvatarHTML(type, size) {
    const name = type === 'user' ? ICON_NAME.user : ICON_NAME[PAGE];
    if (window.ArcIcons && window.ArcIcons.has(name)) return window.ArcIcons.icon(name, size || 20);
    return type === 'user' ? DEFAULT_EMOJI.user : DEFAULT_EMOJI[PAGE];
  }

  /* -------- 注入 UI -------- */
  function injectUI() {
    document.body.insertAdjacentHTML('beforeend', `
      <button class="av-fab" id="av-fab" title="头像设置" onclick="window.__avTogglePanel()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </button>

      <div class="av-panel" id="av-panel">
        <div class="av-panel-header">
          <span>头像设置</span>
          <button class="av-close" onclick="window.__avTogglePanel()">✕</button>
        </div>

        <div class="av-row">
          <span class="av-label">显示头像</span>
          <label class="av-switch">
            <input type="checkbox" id="av-toggle" onchange="window.__avOnToggle(this.checked)">
            <span class="av-slider"></span>
          </label>
        </div>

        <div id="av-upload-section">
          <div class="av-divider">自定义头像</div>

          <div class="av-upload-row">
            <div class="av-thumb" id="av-thumb-user"></div>
            <div class="av-upload-info">
              <span class="av-upload-label">我的头像</span>
              <div class="av-upload-btns">
                <button class="av-btn-upload" onclick="window.__avTriggerUpload('user')">上传图片</button>
                <button class="av-btn-reset" onclick="window.__avReset('user')">重置</button>
              </div>
            </div>
          </div>

          <div class="av-upload-row">
            <div class="av-thumb" id="av-thumb-ai"></div>
            <div class="av-upload-info">
              <span class="av-upload-label">星河头像</span>
              <div class="av-upload-btns">
                <button class="av-btn-upload" onclick="window.__avTriggerUpload('ai')">上传图片</button>
                <button class="av-btn-reset" onclick="window.__avReset('ai')">重置</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <input type="file" id="av-file-input" accept="image/*" style="display:none"
             onchange="window.__avOnFile(this)">
    `);
  }

  /* -------- 初始化 -------- */
  function init() {
    injectUI();

    const enabled = localStorage.getItem('avatarEnabled') !== 'false';
    document.getElementById('av-toggle').checked = enabled;
    applyVisibility(enabled);

    const userImg = localStorage.getItem('avatar-user');
    const aiImg   = localStorage.getItem('avatar-ai-' + PAGE);
    userImg ? applyImg('user', userImg) : applyEmoji('user');
    aiImg   ? applyImg('ai',   aiImg)   : applyEmoji('ai');
    setThumb('user', userImg);
    setThumb('ai',   aiImg);
  }

  /* -------- 应用显示/隐藏 -------- */
  function applyVisibility(on) {
    document.body.classList.toggle('no-avatars', !on);
    const sec = document.getElementById('av-upload-section');
    if (sec) sec.style.display = on ? '' : 'none';
  }

  /* -------- 设置 DOM 头像 -------- */
  function applyImg(type, src) {
    const sel = type === 'user' ? '.message.user .avatar' : '.message.ai .avatar';
    document.querySelectorAll(sel).forEach(el => {
      el.innerHTML = `<img src="${src}" alt="avatar">`;
    });
  }

  function applyEmoji(type) {
    const html = defaultAvatarHTML(type, 20);
    const sel  = type === 'user' ? '.message.user .avatar' : '.message.ai .avatar';
    document.querySelectorAll(sel).forEach(el => { el.innerHTML = html; });
  }

  function setThumb(type, src) {
    const el = document.getElementById('av-thumb-' + type);
    if (!el) return;
    if (src) {
      el.innerHTML = `<img src="${src}" alt="thumb">`;
    } else {
      el.innerHTML = defaultAvatarHTML(type, 22);
    }
  }

  /* -------- 公开 API -------- */
  window.__avTogglePanel = function () {
    document.getElementById('av-panel').classList.toggle('av-open');
  };

  window.__avOnToggle = function (checked) {
    localStorage.setItem('avatarEnabled', checked);
    applyVisibility(checked);
  };

  window.__avTriggerUpload = function (target) {
    uploadTarget = target;
    document.getElementById('av-file-input').click();
  };

  window.__avOnFile = function (input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      const src = e.target.result;
      if (uploadTarget === 'user') {
        localStorage.setItem('avatar-user', src);
        applyImg('user', src);
        setThumb('user', src);
      } else {
        localStorage.setItem('avatar-ai-' + PAGE, src);
        applyImg('ai', src);
        setThumb('ai', src);
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  };

  window.__avReset = function (type) {
    if (type === 'user') {
      localStorage.removeItem('avatar-user');
      applyEmoji('user');
      setThumb('user', null);
    } else {
      localStorage.removeItem('avatar-ai-' + PAGE);
      applyEmoji('ai');
      setThumb('ai', null);
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
