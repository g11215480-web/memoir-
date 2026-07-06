/**
 * 手绘线条图标库（全站共用，代替 emoji）
 * 用法一（JS）：ArcIcons.icon('star', 18)
 * 用法二（HTML）：<span data-arc-icon="bot" data-arc-size="44"></span> 页面加载时自动填充
 * 全部用 currentColor 描边，颜色跟随文字颜色，方便各处上色
 */

(function () {
  'use strict';

  // 每个图标 = viewBox 24×24 的一组描边路径（线条圆头，带一点手绘的松弛感）
  const PATHS = {
    // 打开的书（导航栏）
    book: '<path d="M12 6.2C9.9 4.5 6.9 4.3 4.2 5.3v13.2c2.7-1 5.7-.8 7.8.9 2.1-1.7 5.1-1.9 7.8-.9V5.3C17.1 4.3 14.1 4.5 12 6.2Z"/><path d="M12 6.2v13.2"/>',

    // 信封 + 爱心（首页）
    letter: '<rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4"/><path d="M4.2 7.2 12 12.6l7.8-5.4"/><path d="M12 16.9c-1.6-1.1-2.7-2-2.7-3.2 0-1 .8-1.6 1.6-1.6.5 0 .9.2 1.1.6.2-.4.6-.6 1.1-.6.8 0 1.6.6 1.6 1.6 0 1.2-1.1 2.1-2.7 3.2Z"/>',

    // 机器人小脸（GPT）—— 头顶带一根呆毛
    bot: '<rect x="4.6" y="8.2" width="14.8" height="10.6" rx="3.4"/><path d="M12 8.2c-.2-1.5.5-2.1 1.3-2.7.6-.5.5-1.4-.2-1.7"/><path d="M4.6 12.6H3.2M19.4 12.6h1.4"/><circle cx="9.4" cy="12.8" r="1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="12.8" r="1" fill="currentColor" stroke="none"/><path d="M9.6 15.6c1.6 1.1 3.2 1.1 4.8 0"/>',

    // 五瓣小花（Claude）
    blossom: '<circle cx="12" cy="12" r="2.1"/>' +
      [0, 72, 144, 216, 288].map(a =>
        `<path d="M12 9.6C10.7 7.4 12 4.4 12 4.4s1.3 3 0 5.2Z" transform="rotate(${a} 12 12)"/>`).join(''),

    // 四角星光（Gemini）
    sparkle: '<path d="M12 3.4c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z"/><path d="M18.6 15.8c.3 1.6 1 2.3 2.6 2.6-1.6.3-2.3 1-2.6 2.6-.3-1.6-1-2.3-2.6-2.6 1.6-.3 2.3-1 2.6-2.6Z"/>',

    // 小人（用户）—— 头顶一小撮呆毛
    user: '<circle cx="12" cy="9" r="3.7"/><path d="M12 5.3c.1-.8.8-1.3 1.5-1.2"/><path d="M4.8 19.6c.9-3.7 3.5-5.6 7.2-5.6s6.3 1.9 7.2 5.6"/>',

    // 星星（书签用）
    star: '<path d="M12 3.8l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8Z"/>',
    starFill: '<path fill="currentColor" stroke="none" d="M12 3.8l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8Z"/>',

    // 放大镜
    search: '<circle cx="10.8" cy="10.8" r="5.8"/><path d="M15.2 15.2l4.6 4.6"/>',

    // 调色盘
    palette: '<path d="M12 3.6c4.7 0 8.4 3.3 8.4 7.4 0 2.6-1.9 4.3-4.2 4.3h-1.8c-1.2 0-2 1.1-1.6 2.2.3.9-.3 1.9-1.3 1.9-4.5 0-7.9-3.6-7.9-7.9 0-4.4 3.7-7.9 8.4-7.9Z"/><circle cx="8.2" cy="9.4" r=".9" fill="currentColor" stroke="none"/><circle cx="12.2" cy="7.6" r=".9" fill="currentColor" stroke="none"/><circle cx="16" cy="9.6" r=".9" fill="currentColor" stroke="none"/><circle cx="7.4" cy="13.4" r=".9" fill="currentColor" stroke="none"/>',

    // 下载 / 上传
    download: '<path d="M12 4.2v10"/><path d="M8 10.6l4 4 4-4"/><path d="M4.6 16.6v2.2c0 1 .8 1.8 1.8 1.8h11.2c1 0 1.8-.8 1.8-1.8v-2.2"/>',
    upload: '<path d="M12 14.6v-10"/><path d="M8 8.4l4-4 4 4"/><path d="M4.6 16.6v2.2c0 1 .8 1.8 1.8 1.8h11.2c1 0 1.8-.8 1.8-1.8v-2.2"/>',

    // 文件夹
    folder: '<path d="M3.6 8a2 2 0 0 1 2-2h3.8l2 2.4h7a2 2 0 0 1 2 2v7.4a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z"/>',

    // 菜单 / 关闭
    menu: '<path d="M4.6 7h14.8M4.6 12h14.8M4.6 17h14.8"/>',
    close: '<path d="M6.6 6.6l10.8 10.8M17.4 6.6L6.6 17.4"/>',

    // 柱状图（统计）
    chart: '<path d="M5.8 19V12.4M11 19V6.8M16.2 19v-8.8"/><path d="M4 19.4h16"/>',

    // 记忆（脑袋里装着一颗心）
    memory: '<circle cx="12" cy="12" r="8.2"/><path d="M12 15.6c-2-1.3-3.4-2.5-3.4-4 0-1.2 1-2 2-2 .6 0 1.1.3 1.4.8.3-.5.8-.8 1.4-.8 1 0 2 .8 2 2 0 1.5-1.4 2.7-3.4 4Z"/>',

    // 文档
    doc: '<path d="M7.4 3.6h6.2L18 8v11.4c0 .9-.7 1.6-1.6 1.6H7.4c-.9 0-1.6-.7-1.6-1.6V5.2c0-.9.7-1.6 1.6-1.6Z"/><path d="M13.4 3.8V8H18"/><path d="M9 12.6h6M9 15.6h6"/>',

    // 保存（软盘）
    disk: '<path d="M5 6.4c0-.9.7-1.6 1.6-1.6h9L20 9.2v8.4c0 .9-.7 1.6-1.6 1.6H6.6c-.9 0-1.6-.7-1.6-1.6Z"/><path d="M8.4 4.9V8.6h6.4V5"/><rect x="8" y="12.6" width="8" height="6.4" rx="1"/>',

    // 聊天泡（碎碎念）
    chat: '<path d="M12 4.6c-4.6 0-8.3 2.9-8.3 6.6 0 2.1 1.2 4 3.2 5.2-.2 1.1-.7 2.2-1.5 3 1.6-.2 3-.8 4.2-1.6.8.2 1.6.3 2.4.3 4.6 0 8.3-2.9 8.3-6.7S16.6 4.6 12 4.6Z"/><circle cx="8.6" cy="11.4" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="11.4" r=".8" fill="currentColor" stroke="none"/><circle cx="15.4" cy="11.4" r=".8" fill="currentColor" stroke="none"/>',

    // 小锁（私密）
    lock: '<rect x="5.6" y="10.4" width="12.8" height="9.4" rx="2"/><path d="M8.6 10.4V7.9a3.4 3.4 0 0 1 6.8 0v2.5"/><circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/>',

    // 云朵（记忆库）
    cloud: '<path d="M7.2 18.6h9.6a3.9 3.9 0 0 0 1-7.7 5.4 5.4 0 0 0-10.5-1.2 4.1 4.1 0 0 0-.1 8.9Z"/>',

    // 图片
    image: '<rect x="3.6" y="5" width="16.8" height="14" rx="2.4"/><circle cx="9" cy="10" r="1.5"/><path d="M4.6 17.4l4.3-4.3 3 3 3.4-3.4 4.1 4.1"/>',

    // 日历
    calendar: '<rect x="4" y="5.6" width="16" height="14" rx="2.2"/><path d="M4 10h16M8.4 3.6v3.4M15.6 3.6v3.4"/>',

    // 爱心
    heart: '<path d="M12 19.4c-4.3-2.9-7.3-5.6-7.3-8.9 0-2.6 1.9-4.1 4-4.1 1.3 0 2.5.6 3.3 1.7.8-1.1 2-1.7 3.3-1.7 2.1 0 4 1.5 4 4.1 0 3.3-3 6-7.3 8.9Z"/>',

    // 上下小箭头（搜索跳转）
    chevUp: '<path d="M6.6 14.6 12 9.2l5.4 5.4"/>',
    chevDown: '<path d="M6.6 9.4 12 14.8l5.4-5.4"/>',
  };

  function icon(name, size, extra) {
    const body = PATHS[name];
    if (!body) return '';
    const s = size || 18;
    return `<svg class="arc-icon${extra ? ' ' + extra : ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  window.ArcIcons = {
    icon,
    has: (name) => !!PATHS[name],
  };

  // HTML 里的 <span data-arc-icon="xxx" data-arc-size="20"> 自动填充
  function hydrate() {
    document.querySelectorAll('[data-arc-icon]').forEach(el => {
      el.innerHTML = icon(el.dataset.arcIcon, parseInt(el.dataset.arcSize) || 18);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else {
    hydrate();
  }
})();
