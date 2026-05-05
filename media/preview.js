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
  let pendingPatch = null;

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
    if (editingIndex >= 0) {
      pendingPatch = patch;
      return;
    }
    const newBlocks = patch.blocks;
    const ops = patch.ops;
    const scrollY = window.scrollY;
    const frag = document.createDocumentFragment();
    let touched = 0;
    newBlocks.forEach((b, i) => frag.appendChild(makeBlockEl(b, i)));
    ops.forEach((op) => {
      if (op.op !== 'keep') touched++;
    });
    root.innerHTML = '';
    root.appendChild(frag);
    currentBlocks = newBlocks;
    window.scrollTo(0, scrollY);
    if (touched > 0) setStatus(`updated ${touched} block(s)`, 'ok');
  }

  function startEdit(index) {
    if (editingIndex >= 0 || !config.enableEdit) return;
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
    bar.appendChild(save);
    bar.appendChild(cancel);

    const wrap = document.createElement('div');
    wrap.className = 'block block-editing';
    wrap.appendChild(ta);
    wrap.appendChild(bar);
    el.replaceWith(wrap);
    ta.focus();

    const finishCancel = () => {
      editingIndex = -1;
      vscode.postMessage({ type: 'editCancel' });
      wrap.replaceWith(makeBlockEl(block, index));
      flushPending();
    };
    const finishSave = () => {
      const newRaw = ta.value;
      editingIndex = -1;
      vscode.postMessage({ type: 'editSave', index, newRaw });
      flushPending();
    };

    save.addEventListener('click', finishSave);
    cancel.addEventListener('click', finishCancel);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finishCancel();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishSave();
    });
  }

  function flushPending() {
    if (pendingPatch) {
      const p = pendingPatch;
      pendingPatch = null;
      applyPatch(p);
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

  vscode.postMessage({ type: 'ready' });
})();
