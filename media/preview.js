// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  const status = document.getElementById('status');

  let config = { mermaidTheme: 'default', enableEdit: true };

  function initMermaid() {
    if (!window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false,
      theme: config.mermaidTheme,
      securityLevel: 'loose',
    });
  }

  const cache = new Map();
  let currentBlocks = [];
  let editingIndex = -1;
  let activeEdit = null;

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = kind || '';
    if (text) {
      setTimeout(() => {
        if (status.textContent === text) status.textContent = '';
      }, 1500);
    }
  }

  function makeBlockEl(block, index) {
    let el = cache.get(block.hash);
    if (el) {
      el.dataset.index = String(index);
      return el;
    }
    el = document.createElement('div');
    el.className = 'block block-' + block.type;
    el.dataset.hash = block.hash;
    el.dataset.index = String(index);

    if (block.type === 'mermaid') {
      const container = document.createElement('div');
      container.className = 'mermaid-container';
      container.textContent = 'rendering…';
      el.appendChild(container);
      renderMermaid(container, block.html);
    } else if (block.type === 'math') {
      try {
        window.katex.render(block.html, el, { displayMode: true, throwOnError: false });
      } catch {
        el.textContent = block.raw;
      }
    } else {
      el.innerHTML = block.html;
      el.querySelectorAll('p, li, td, th').forEach((node) => renderInlineMath(node));
    }

    if (config.enableEdit) {
      el.addEventListener('click', () => {
        if (activeEdit && activeEdit.index !== Number(el.dataset.index)) {
          startEdit(Number(el.dataset.index));
        }
      });
      el.addEventListener('dblclick', () => startEdit(Number(el.dataset.index)));
    }
    cache.set(block.hash, el);
    return el;
  }

  async function renderMermaid(container, code) {
    try {
      const id = 'm' + Math.random().toString(36).slice(2);
      const { svg } = await window.mermaid.render(id, code);
      container.innerHTML = svg;
    } catch (e) {
      container.innerHTML = '<pre class="mermaid-error">' + escapeHtml(String(e)) + '</pre>';
    }
  }

  function renderInlineMath(node) {
    if (node.closest('code, pre, .katex')) return;
    const re = /(?<!\\)\$([^$\n]+?)\$/g;
    const text = node.textContent || '';
    if (!re.test(text)) return;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      try {
        window.katex.render(m[1], span, { throwOnError: false });
      } catch {
        span.textContent = m[0];
      }
      frag.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.textContent = '';
    node.appendChild(frag);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fullRender(blocks) {
    cache.clear();
    currentBlocks = blocks;
    root.innerHTML = '';
    blocks.forEach((b, i) => root.appendChild(makeBlockEl(b, i)));
  }

  function applyPatch(patch) {
    const newBlocks = patch.blocks;
    const ops = patch.ops;
    const scrollY = window.scrollY;
    const frag = document.createDocumentFragment();
    let touched = 0;

    if (activeEdit) {
      const sameBlockIndex = newBlocks.findIndex((b) => b.hash === activeEdit.block.hash);
      if (sameBlockIndex >= 0) {
        activeEdit.index = sameBlockIndex;
        editingIndex = sameBlockIndex;
      }
    }

    newBlocks.forEach((b, i) => {
      if (activeEdit && i === activeEdit.index) {
        frag.appendChild(activeEdit.wrap);
        return;
      }
      frag.appendChild(makeBlockEl(b, i));
    });
    ops.forEach((op) => {
      if (op.op !== 'keep') touched++;
    });
    if (activeEdit && touched > 0) markExternalUpdate();
    root.innerHTML = '';
    root.appendChild(frag);
    currentBlocks = newBlocks;
    window.scrollTo(0, scrollY);
    if (touched > 0) setStatus(`updated ${touched} block(s)`, 'ok');
  }

  function startEdit(index) {
    if (!config.enableEdit) return;
    if (activeEdit) {
      if (activeEdit.index === index) return;
      finishEdit(true);
    }
    const block = currentBlocks[index];
    if (!block) return;
    editingIndex = index;
    vscode.postMessage({ type: 'editStart' });

    const el = root.children[index];
    const ta = document.createElement('textarea');
    ta.className = 'block-editor';
    ta.value = block.raw;
    ta.rows = Math.max(3, block.raw.split('\n').length + 1);

    const bar = document.createElement('div');
    bar.className = 'block-editor-bar';
    const save = document.createElement('button');
    save.textContent = 'Save (Ctrl+Enter)';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel (Esc)';
    const updateIcon = document.createElement('span');
    updateIcon.className = 'edit-update-indicator';
    updateIcon.textContent = '!';
    updateIcon.title = 'This file changed while you are editing.';
    updateIcon.setAttribute('aria-label', 'File changed while editing');
    updateIcon.hidden = true;
    bar.appendChild(save);
    bar.appendChild(cancel);
    bar.appendChild(updateIcon);

    const wrap = document.createElement('div');
    wrap.className = 'block block-editing';
    wrap.appendChild(ta);
    wrap.appendChild(bar);
    el.replaceWith(wrap);
    ta.focus();
    activeEdit = { index, block, wrap, ta, updateIcon };

    save.addEventListener('click', () => finishEdit(true));
    cancel.addEventListener('click', () => finishEdit(false));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finishEdit(false);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishEdit(true);
    });
  }

  function markExternalUpdate() {
    if (!activeEdit) return;
    activeEdit.updateIcon.hidden = false;
    activeEdit.wrap.classList.add('block-editing-updated');
  }

  function finishEdit(saveIfChanged) {
    if (!activeEdit) return;
    const { index, block, wrap, ta } = activeEdit;
    const newRaw = ta.value;
    const changed = newRaw !== block.raw;
    const latestBlock = currentBlocks[index] || block;

    activeEdit = null;
    editingIndex = -1;

    if (saveIfChanged && changed) {
      vscode.postMessage({ type: 'editSave', index, newRaw });
    } else {
      wrap.replaceWith(makeBlockEl(latestBlock, index));
      vscode.postMessage({ type: 'editCancel' });
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'fullRender') {
      if (msg.config) {
        config = msg.config;
        initMermaid();
      }
      fullRender(msg.blocks);
    } else if (msg.type === 'patch') {
      applyPatch(msg.patch);
    } else if (msg.type === 'undoResult') {
      setStatus(msg.ok ? 'undone' : 'nothing to undo', msg.ok ? 'ok' : 'warn');
    } else if (msg.type === 'config') {
      const old = config;
      config = msg.config;
      if (old.mermaidTheme !== config.mermaidTheme) {
        initMermaid();
        cache.clear();
        fullRender(currentBlocks);
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTextInput =
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    if (isTextInput) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      vscode.postMessage({ type: 'undoEdit' });
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
