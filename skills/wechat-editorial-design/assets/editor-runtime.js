/* Standalone editor. Authored source is trusted; DOMPurify also guards drafts and paste.
   Keep this defense current. It is not a general sandbox for arbitrary untrusted pages. */
(() => {
  'use strict';
  const config = JSON.parse(document.getElementById('editor-config').textContent);
  const titleInput = document.getElementById('titleInput');
  const summaryInput = document.getElementById('summaryInput');
  const article = document.getElementById('article');
  const status = document.getElementById('status');

  function report(message, error = false) {
    status.textContent = message;
    status.dataset.kind = error ? 'error' : 'success';
  }

  if (!window.DOMPurify) { report('编辑组件未完整加载，请重新生成编辑文件。', true); return; }
  const allowedTags = ['p', 'div', 'section', 'article', 'header', 'footer', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'small', 'sup', 'sub', 'br', 'hr', 'blockquote', 'pre', 'code'];
  const allowedAttrs = ['style', 'src', 'alt', 'width', 'height', 'data-asset-id', 'href', 'title', 'colspan', 'rowspan', 'scope', 'start', 'reversed', 'align', 'valign'];
  const safeCss = new Set(['color', 'background', 'background-color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-decoration', 'text-decoration-color', 'text-decoration-line', 'text-decoration-style', 'text-transform', 'white-space', 'word-break', 'overflow-wrap', 'hyphens', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-width', 'border-style', 'border-color', 'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius', 'border-collapse', 'border-spacing', 'box-sizing', 'display', 'vertical-align', 'opacity', 'object-fit', 'object-position', 'overflow', 'list-style-type', 'list-style-position', 'table-layout']);
  const dataImage = /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml|x-icon)(?:;[a-z0-9=+.-]+)*,/i;
  function cleanStyle(value) {
    const parsed = document.createElement('span').style;
    const clean = document.createElement('span').style;
    parsed.cssText = value;
    for (let i = 0; i < parsed.length; i++) {
      const name = parsed[i];
      const cssValue = parsed.getPropertyValue(name);
      // CSS escapes/custom variables/resource functions are unnecessary for article text.
      if (safeCss.has(name) && !/[\\@]|(?:url|image(?:-set)?|expression|var|attr)\s*\(/i.test(cssValue)) clean.setProperty(name, cssValue, parsed.getPropertyPriority(name));
    }
    return clean.cssText;
  }
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    if (name === 'src' && !dataImage.test(data.attrValue.trim())) data.keepAttr = false;
    if (name === 'href' && !/^(?:https?:\/\/|mailto:|tel:|#)/i.test(data.attrValue.trim())) data.keepAttr = false;
    if (name === 'style') {
      data.attrValue = cleanStyle(data.attrValue);
      if (!data.attrValue) data.keepAttr = false;
    }
  });
  function sanitize(html) {
    const fragment = DOMPurify.sanitize(String(html || ''), {
      ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: allowedAttrs,
      ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
      FORBID_TAGS: ['style', 'script', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
      RETURN_TRUSTED_TYPE: false, RETURN_DOM_FRAGMENT: true
    });
    for (const img of fragment.querySelectorAll('img:not([src])')) img.remove();
    const holder = document.createElement('div');
    holder.appendChild(fragment);
    return holder.innerHTML;
  }

  article.innerHTML = sanitize(config.articleHtml);

  function snapshot() {
    return {
      schemaVersion: 1, assetVersion: config.assetVersion,
      title: titleInput.value, summary: summaryInput.value,
      articleHtml: sanitize(article.innerHTML)
    };
  }

  function migrateArticle(html) {
    const template = document.createElement('template');
    template.innerHTML = sanitize(html);
    for (const img of template.content.querySelectorAll('img[data-asset-id]')) {
      const id = img.getAttribute('data-asset-id');
      if (Object.prototype.hasOwnProperty.call(config.manifest, id)) img.setAttribute('src', config.manifest[id]);
    }
    return sanitize(template.innerHTML);
  }

  function restore() {
    let saved;
    try { saved = localStorage.getItem(config.storageKey); }
    catch (_) { report('浏览器暂不允许保存草稿；可以使用“下载编辑文件”保留修改。'); return; }
    if (!saved) return;
    try {
      const draft = JSON.parse(saved);
      if (draft.schemaVersion !== 1 || typeof draft.articleHtml !== 'string') throw new Error('unknown draft format');
      article.innerHTML = draft.assetVersion === config.assetVersion ? sanitize(draft.articleHtml) : migrateArticle(draft.articleHtml);
      titleInput.value = typeof draft.title === 'string' ? draft.title : config.title;
      summaryInput.value = typeof draft.summary === 'string' ? draft.summary : config.summary;
      report(draft.assetVersion === config.assetVersion ? '已恢复此浏览器中的草稿。' : '已恢复草稿并更新配图，保留您的文字修改。');
    } catch (_) { report('旧草稿无法读取，已显示制作文件中的内容。旧草稿尚未覆盖。', true); }
  }

  function save() {
    try { localStorage.setItem(config.storageKey, JSON.stringify(snapshot())); report('草稿已保存到此浏览器。'); return true; }
    catch (_) { report('浏览器无法保存草稿，请使用“下载编辑文件”保留修改。', true); return false; }
  }

  function fallbackCopy(text, html) {
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const previous = document.activeElement;
    const caret = previous && typeof previous.selectionStart === 'number'
      ? { start: previous.selectionStart, end: previous.selectionEnd, direction: previous.selectionDirection } : null;
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:pre-wrap;';
    if (html !== undefined) holder.innerHTML = html; else holder.textContent = text;
    document.body.appendChild(holder);
    const onCopy = event => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', text);
      if (html !== undefined) event.clipboardData.setData('text/html', html);
    };
    document.addEventListener('copy', onCopy);
    try {
      holder.focus({ preventScroll: true });
      const range = document.createRange(); range.selectNodeContents(holder);
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('copy')) throw new Error('copy declined');
    } finally {
      document.removeEventListener('copy', onCopy);
      holder.remove();
      if (previous && previous.focus) previous.focus({ preventScroll: true });
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
      if (caret && previous.setSelectionRange) previous.setSelectionRange(caret.start, caret.end, caret.direction);
    }
  }

  async function copy(text, html, label) {
    try {
      if (html !== undefined) {
        html = sanitize(html);
        const holder = document.createElement('div');
        holder.innerHTML = html;
        // Preserve readable paragraph boundaries in the plain-text clipboard flavor.
        for (const block of holder.querySelectorAll('p,div,section,h1,h2,h3,h4,h5,h6,li,blockquote,tr')) block.appendChild(document.createTextNode('\n'));
        for (const br of holder.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
        text = holder.textContent.replace(/\n{3,}/g, '\n\n').trim();
      }
      try {
        if (html !== undefined && navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          })]);
        } else if (html === undefined && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else throw new Error('modern clipboard unavailable');
      } catch (_) { fallbackCopy(text, html); }
      report(label + '已复制。');
    } catch (_) { report('复制未成功。请选中相应内容，使用系统复制快捷键。', true); }
  }

  article.addEventListener('paste', event => {
    event.preventDefault();
    const clipboard = event.clipboardData;
    if (!clipboard) { report('无法读取粘贴内容，请使用系统支持的浏览器重试。', true); return; }
    let source = clipboard.getData('text/html');
    if (!source) {
      const plain = document.createElement('div');
      plain.textContent = clipboard.getData('text/plain');
      source = plain.innerHTML.replace(/\r?\n/g, '<br>');
    }
    const clean = sanitize(source);
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !article.contains(selection.anchorNode)) {
      article.focus();
      const end = document.createRange(); end.selectNodeContents(article); end.collapse(false);
      selection.removeAllRanges(); selection.addRange(end);
    }
    if (!document.execCommand('insertHTML', false, clean)) {
      const template = document.createElement('template'); template.innerHTML = clean;
      const range = selection.getRangeAt(0); range.deleteContents();
      const last = template.content.lastChild;
      range.insertNode(template.content);
      if (last) { range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); }
    }
    report('已粘贴文字和支持的格式。图片需使用已嵌入的配图。');
  });
  article.addEventListener('drop', event => {
    event.preventDefault();
    report('请使用粘贴方式加入文字；配图请在制作文件中嵌入后重新生成。');
  });

  function download() {
    const current = snapshot();
    const root = document.documentElement.cloneNode(true);
    root.querySelector('#titleInput').setAttribute('value', current.title);
    root.querySelector('#summaryInput').textContent = current.summary;
    root.querySelector('#article').innerHTML = current.articleHtml;
    root.querySelector('#status').textContent = '';
    root.querySelector('title').textContent = current.title + ' · 图文编辑';
    const exportId = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    const exportedConfig = { ...config, ...current, storageKey: config.storageKey + ':export:' + exportId };
    root.querySelector('#editor-config').textContent = JSON.stringify(exportedConfig).replace(/[<>&\u2028\u2029]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    const blob = new Blob(['<!doctype html>\n' + root.outerHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (current.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || '公众号图文') + '_编辑文件.html';
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    report('已生成下载文件；请在浏览器下载列表中查看。');
  }

  for (const button of document.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      switch (button.dataset.action) {
        case 'copy-title': return copy(titleInput.value, undefined, '标题');
        case 'copy-summary': return copy(summaryInput.value, undefined, '摘要');
        case 'copy-article': return copy(article.innerText || article.textContent, article.innerHTML, '正文');
        case 'save': return save();
        case 'download': return download();
      }
    });
  }
  restore();
})();
