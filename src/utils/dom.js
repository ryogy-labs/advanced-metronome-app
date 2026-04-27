const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
