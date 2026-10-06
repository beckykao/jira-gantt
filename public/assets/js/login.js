// Full-screen sign-in: each person logs in with their OWN Jira email + API
// token. The token is checked against the company Jira on the server and
// stored encrypted; the browser only keeps an HttpOnly session cookie.

import { api } from './api.js';

const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let shown = false;

export async function showLoginScreen({ message = '' } = {}) {
  if (shown) return;
  shown = true;

  let config = { method: 'jira', jiraBaseUrl: null };
  try {
    config = await api.getAuthConfig();
  } catch {
    /* show the form anyway; login will report the real error */
  }

  if (config.method === 'access') {
    // Cloudflare Access handles sign-in; a reload sends the person through it.
    location.reload();
    return;
  }

  const root = document.createElement('div');
  root.id = 'login-screen';
  root.innerHTML = `
    <style>
      #login-screen { position: fixed; inset: 0; z-index: 1000; background: var(--color-bg, #f5f6f8);
        display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto;
        font-family: var(--font-sans, system-ui, sans-serif); }
      #login-screen .login-card { width: 100%; max-width: 420px; background: var(--color-surface, #fff);
        border: 1px solid var(--color-border, #e2e5eb); border-radius: var(--radius-lg, 14px);
        box-shadow: var(--shadow-md); padding: 28px 24px; }
      #login-screen h1 { font-size: 20px; margin: 0 0 4px; color: var(--color-text, #1c2230); }
      #login-screen h1 .accent { color: var(--color-primary, #3355ee); }
      #login-screen .sub { color: var(--color-text-muted, #6b7280); font-size: 13px; margin: 0 0 20px; line-height: 1.6; }
      #login-screen label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; color: var(--color-text, #1c2230); }
      #login-screen .input { width: 100%; box-sizing: border-box; }
      #login-screen .hint { font-size: 12px; color: var(--color-text-muted, #6b7280); margin-top: 6px; line-height: 1.6; }
      #login-screen .hint a { color: var(--color-primary, #3355ee); }
      #login-screen .site { font-size: 12.5px; background: var(--color-primary-bg, #eef1ff); color: var(--color-primary-dark, #2542c4);
        border-radius: var(--radius-sm, 6px); padding: 8px 10px; word-break: break-all; }
      #login-screen .err { display: none; margin-top: 14px; font-size: 13px; color: var(--color-danger, #dc2626);
        background: var(--color-danger-bg, #fdecec); border-radius: var(--radius-sm, 6px); padding: 8px 10px; }
      #login-screen .btn-primary { width: 100%; margin-top: 20px; justify-content: center; padding: 10px; font-size: 14px; }
      #login-screen details { margin-top: 18px; font-size: 12.5px; color: var(--color-text-muted, #6b7280); }
      #login-screen details summary { cursor: pointer; color: var(--color-text, #1c2230); }
      #login-screen details ol { padding-left: 20px; margin: 8px 0 0; line-height: 1.8; }
    </style>
    <form class="login-card" novalidate>
      <h1><span class="accent">Jira</span> 甘特圖</h1>
      <p class="sub">請用<strong>你自己的</strong> Jira 帳號登入。系統只會用你的權限讀取 Jira，Token 會加密保存，不會顯示給任何人。</p>

      ${config.jiraBaseUrl ? `<div class="site">Jira 站台：${esc(config.jiraBaseUrl)}</div>` : ''}

      <label for="login-email">Jira 登入 Email</label>
      <input class="input" id="login-email" type="email" autocomplete="username" placeholder="you@company.com" required />

      <label for="login-token">Jira API Token</label>
      <input class="input" id="login-token" type="password" autocomplete="current-password" placeholder="貼上你的 API Token" required />
      <div class="hint">不是 Jira 密碼。到 <a href="${TOKEN_PAGE}" target="_blank" rel="noopener">Atlassian 帳號 → Security → API tokens</a> 建立。</div>

      <div class="err" role="alert">${esc(message)}</div>
      <button class="btn btn-primary" type="submit">登入</button>

      <details>
        <summary>第一次使用？如何取得 API Token</summary>
        <ol>
          <li>打開 <a href="${TOKEN_PAGE}" target="_blank" rel="noopener">API tokens 頁面</a>，用公司 Jira 帳號登入</li>
          <li>按「Create API token」，名稱填「甘特圖」，到期日依公司規定</li>
          <li>按「Copy」複製 Token（只會顯示這一次）</li>
          <li>回到這裡，貼上 Token 並登入</li>
        </ol>
      </details>
    </form>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('form');
  const emailInput = root.querySelector('#login-email');
  const tokenInput = root.querySelector('#login-token');
  const errBox = root.querySelector('.err');
  const submit = root.querySelector('button[type=submit]');

  const showErr = (msg) => {
    errBox.textContent = msg;
    errBox.style.display = msg ? 'block' : 'none';
  };
  showErr(message);

  try {
    emailInput.value = localStorage.getItem('jira-gantt:lastLoginEmail') || '';
  } catch {
    /* storage unavailable */
  }
  (emailInput.value ? tokenInput : emailInput).focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const jiraEmail = emailInput.value.trim();
    const token = tokenInput.value.trim();
    if (!jiraEmail) return showErr('請填入你登入 Jira 用的 email。');
    if (!token) return showErr('請貼上你的 Jira API Token。');

    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span> 驗證中...';
    showErr('');
    try {
      await api.login({ jiraEmail, token });
      try {
        localStorage.setItem('jira-gantt:lastLoginEmail', jiraEmail);
      } catch {
        /* storage unavailable */
      }
      location.reload();
    } catch (err) {
      showErr(err.message || '登入失敗，請稍後再試。');
      submit.disabled = false;
      submit.textContent = '登入';
      tokenInput.select();
    }
  });
}
