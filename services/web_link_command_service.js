'use strict';

const webPortalAuthService = require('./web_portal_auth_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[！!？?。．.,，、:\-ー_\s]/g, '');
}

function isWebLinkCommand(text) {
  const raw = normalizeText(text);
  if (!raw) return false;

  const loose = normalizeLoose(raw);
  const exactPatterns = [
    'web接続コード',
    'webコード',
    'web接続',
    'webログインコード',
    'web連携コード',
    'ウェブ接続コード',
    'ウェブコード',
    'ウェブ接続',
    '接続コード',
    'ログインコード'
  ];

  if (exactPatterns.some((pattern) => loose === pattern)) return true;
  if (loose.includes('web接続コード')) return true;
  if (loose.includes('ウェブ接続コード')) return true;
  if (loose.includes('webログインコード')) return true;
  if (loose.includes('web連携コード')) return true;
  if ((loose.includes('web') || loose.includes('ウェブ')) && (loose.includes('コード') || loose.includes('接続'))) return true;
  return false;
}

function getBaseUrl() {
  const explicit = normalizeText(process.env.WEB_PUBLIC_URL || process.env.APP_PUBLIC_URL || '');
  if (explicit) return explicit.replace(/\/$/, '');
  const render = normalizeText(process.env.RENDER_EXTERNAL_URL || '');
  if (render) return render.replace(/\/$/, '');
  return '';
}

function getWebPortalUrl() {
  const base = getBaseUrl();
  if (!base) return '/web';
  if (/\/web$/i.test(base)) return base;
  return `${base}/web`;
}

function buildAutoConnectUrl(code) {
  const baseUrl = getWebPortalUrl();
  if (!baseUrl.startsWith('http')) return baseUrl;
  return `${baseUrl}?code=${encodeURIComponent(code)}`;
}

async function buildWebLinkReplyByLineUser(lineUserId) {
  const issued = await webPortalAuthService.createLinkCodeForLineUser(lineUserId);
  const webUrl = getWebPortalUrl();
  const autoConnectUrl = buildAutoConnectUrl(issued.code);
  const debug = typeof webPortalAuthService.getStorageDebugInfo === 'function'
    ? webPortalAuthService.getStorageDebugInfo()
    : { mode: issued?.storageMode || 'stateless', fallbackReason: '' };

  return {
    ok: true,
    replyText: [
      'WEB接続コードを発行しました。',
      `接続コード: ${issued.code}`,
      `有効期限: 約${webPortalAuthService.LINK_CODE_MINUTES}分`,
      `WEB: ${webUrl}`,
      `自動接続URL: ${autoConnectUrl}`,
      '一番かんたんなのは、自動接続URLをそのまま開く方法です。',
      'コード入力欄には、接続コードだけでなく自動接続URL全体を貼っても大丈夫です。'
    ].join('\n'),
    internal: {
      intentType: 'web_link_code',
      responseMode: 'support',
      webLinkStorageMode: debug.mode || issued?.storageMode || 'stateless',
      webLinkFallbackReason: debug.fallbackReason || '',
      webPortalUrl: webUrl,
      autoConnectUrl
    }
  };
}

module.exports = {
  isWebLinkCommand,
  getWebPortalUrl,
  buildAutoConnectUrl,
  buildWebLinkReplyByLineUser
};
