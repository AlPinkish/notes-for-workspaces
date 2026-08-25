/* Blobbo Note — editor a blocchi stile Notion, markdown puro, persistente per workspace.
 *
 * Modello: array di blocchi { id, type, text, indent, checked, collapsed, lang, variant, src, url, alt, cells }.
 * - Il testo è SEMPRE markdown grezzo (editato direttamente, compatibile copy/paste da Notion).
 * - Il "chrome" del blocco (checkbox, barra citazione, callout, code box, tabella…) è rendering DOM.
 * - Salvataggio: serializzazione -> markdown -> workspaceState (via extension host).
 */
(() => {
  const vscode = acquireVsCodeApi();

  const listEl   = document.getElementById('note-list');
  const scroller = document.getElementById('scroller');
  const titleEl  = document.getElementById('title');
  const statusEl = document.getElementById('save-status');
  const hintEl   = document.getElementById('hint');
  const btnPreview = document.getElementById('btn-preview');
  const btnCopy    = document.getElementById('btn-copy');
  const btnClear   = document.getElementById('btn-clear');
  const clearPop   = document.getElementById('clear-pop');
  const slashEl  = document.getElementById('slash-menu');
  const bmEl     = document.getElementById('block-menu');
  const selTb    = document.getElementById('sel-toolbar');

  const PH = "Scrivi, oppure premi '/'…";
  const TEXTY = new Set(['p','h1','h2','h3','ul','ol','todo','toggle','quote','callout','link']);
  const LANGS = ['plaintext','javascript','typescript','python','java','c','cpp','csharp','go','rust','php','ruby','swift','kotlin','sql','html','css','json','yaml','xml','markdown','bash','powershell','diff'];

  let blocks = [];
  let preview = false;
  let saveTimer = null;
  let slashMenu = null;   // { blockId, ed, query, items, sel }
  let bmBlock = null;     // id del blocco del menu ⋮
  let _uid = 1;

  /* ============ utilità blocchi ============ */
  const uid = () => 'b' + (_uid++);
  const mk = (type, text = '', extra = {}) =>
    Object.assign({ id: uid(), type, text, indent: 0, checked: false, collapsed: false, lang: 'plaintext', alt: '', src: '', url: '', variant: 'note', cells: null }, extra);
  const byId  = id => blocks.find(b => b.id === id);
  const idxOf = id => blocks.findIndex(b => b.id === id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  function olNumber(i) {
    const b = blocks[i]; let n = 1;
    for (let j = i - 1; j >= 0; j--) {
      const p = blocks[j];
      if (p.type === 'ol' && (p.indent || 0) === (b.indent || 0)) n++; else break;
    }
    return n;
  }

  /* ============ icone SVG ============ */
  const T = (s) => '<text x="8" y="12" text-anchor="middle" font-size="9" font-weight="700" font-family="inherit" fill="currentColor" stroke="none">' + s + '</text>';
  const ICON = {
    text:   '<path d="M2.5 4h11M2.5 8h11M2.5 12h7"/>',
    h1: T('H1'), h2: T('H2'), h3: T('H3'),
    ul:     '<path d="M3.5 4h.01M3.5 8h.01M3.5 12h.01"/><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/>',
    ol:     '<text x="3" y="6" font-size="5.5" fill="currentColor" stroke="none">1</text><text x="3" y="12.5" font-size="5.5" fill="currentColor" stroke="none">2</text><path d="M6.5 4h7M6.5 10.5h7"/>',
    todo:   '<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.5 8l2 2 3.5-4"/>',
    toggle: '<path d="M5 3.5v9l6.5-4.5z" fill="currentColor" stroke="none"/><path d="M13 6h.01M13 8h.01M13 10h.01"/>',
    quote:  '<text x="8" y="12.5" text-anchor="middle" font-size="13" font-weight="700" fill="currentColor" stroke="none">"</text>',
    code:   '<path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"/>',
    table:  '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M5.5 6.5V13M10.5 6.5V13"/>',
    image:  '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="5.5" cy="6" r="1"/><path d="M13 11l-3.5-4-3 3.5L5 9l-3 3"/>',
    link:   '<path d="M6.5 9.5l3-3"/><path d="M5.6 7.2L4.4 8.4a2.4 2.4 0 0 0 3.4 3.4l1.2-1.2"/><path d="M10.4 8.8l1.2-1.2a2.4 2.4 0 0 0-3.4-3.4L7 5.4"/>',
    divider:'<path d="M2.5 4.5h2M11.5 4.5h2M2.5 11.5h2M11.5 11.5h2M2.5 8h11"/>',
    math:   '<text x="8" y="12" text-anchor="middle" font-size="10" fill="currentColor" stroke="none">∑</text>',
    date:   '<rect x="2" y="3.5" width="12" height="10" rx="1.5"/><path d="M2 6.5h12M5.5 2.5v2M10.5 2.5v2"/>',
    info:   '<circle cx="8" cy="8" r="5.8"/><path d="M8 7.5V11M8 5.2v.01"/>',
    tip:    '<path d="M5.5 10.5a3.5 3.5 0 1 1 5 0v1h-5z"/><path d="M6.3 13.2h3.4"/>',
    warn:   '<path d="M8 2.6L14.4 13H1.6z"/><path d="M8 6.5v3M8 11.5v.01"/>',
    danger: '<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V9M8 11.3v.01"/>',
    check:  '<path d="M2.5 8.5l3 3L13 4"/>',
    arrow:  '<path d="M4 2.5v11l8-5.5z"/>',
    dots:   '<path d="M6 3h.01M10 3h.01M6 8h.01M10 8h.01M6 13h.01M10 13h.01"/>',
    dup:    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3"/>',
    up:     '<path d="M8 13V3M4.5 6.5L8 3l3.5 3.5"/>',
    down:   '<path d="M8 3v10M4.5 9.5L8 13l3.5-3.5"/>',
    trash:  '<path d="M2.5 4h11M6.2 4V2.5h3.6V4M4 4l.7 9.5h6.6L12 4"/>'
  };
  const svg = (inner) => '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  const CAL = { note: ICON.info, tip: ICON.tip, warn: ICON.warn, danger: ICON.danger };

  /* ============ voci del menu '/' ============ */
  const RAW_ITEMS = [
    { group: 'Blocchi di base' },
    { id: 'p',       label: 'Testo',                 desc: 'Inizia a scrivere con testo semplice.',          kw: ['testo','text','paragrafo','p'] },
    { id: 'h1',      label: 'Titolo 1',              desc: 'Titolo di sezione grande.',                      kw: ['h1','titolo','heading','grande'] },
    { id: 'h2',      label: 'Titolo 2',              desc: 'Titolo di sezione medio.',                       kw: ['h2','titolo','heading'] },
    { id: 'h3',      label: 'Titolo 3',              desc: 'Titolo di sezione piccolo.',                     kw: ['h3','titolo','heading'] },
    { id: 'ul',      label: 'Elenco puntato',        desc: 'Crea un semplice elenco.',                      kw: ['elenco','puntato','lista','bullet','list'] },
    { id: 'ol',      label: 'Elenco numerato',       desc: 'Crea un elenco con numerazione.',               kw: ['elenco','numerato','lista','number'] },
    { id: 'todo',    label: 'To-do',                 desc: 'Traccia le attività con una casella.',          kw: ['todo','task','checkbox','casella','compito'] },
    { id: 'toggle',  label: 'Toggle',                desc: 'Blocco a compressa con contenuto nascosto.',    kw: ['toggle','compressione','collapse'] },
    { id: 'quote',   label: 'Citazione',             desc: 'Evidenzia una citazione.',                      kw: ['citazione','quote','blockquote'] },
    { id: 'divider', label: 'Divisore',              desc: 'Separa visivamente i contenuti.',               kw: ['divisore','divisione','linea','hr','separator'] },
    { group: 'Blocchi avanzati' },
    { id: 'callout-note',   label: 'Callout · Nota',        desc: 'Riquadro informativo.',           kw: ['callout','nota','note','info'] },
    { id: 'callout-tip',    label: 'Callout · Suggerimento', desc: 'Riquadro con un consiglio.',     kw: ['callout','suggerimento','tip','consiglio'] },
    { id: 'callout-warn',   label: 'Callout · Avviso',       desc: 'Riquadro di attenzione.',        kw: ['callout','avviso','warning','attenzione'] },
    { id: 'callout-danger', label: 'Callout · Pericolo',     desc: 'Riquadro critico.',              kw: ['callout','pericolo','danger','errore'] },
    { id: 'code',    label: 'Blocco di codice',      desc: 'Codice con evidenziazione lingua.',              kw: ['codice','code','snippet'] },
    { id: 'table',   label: 'Tabella',               desc: 'Aggiungi una tabella modificabile.',             kw: ['tabella','table','griglia'] },
    { id: 'math',    label: 'Blocco formula',        desc: 'Formula matematica ($$…$$).',                    kw: ['formula','math','matematica','equation','latex'] },
    { group: 'Media e link' },
    { id: 'image',   label: 'Immagine',              desc: 'Incorpora un\'immagine da URL.',                kw: ['immagine','image','foto','img'] },
    { id: 'link',    label: 'Segnalibro (link)',     desc: 'Collegamento in stile bookmark.',               kw: ['link','segnalibro','bookmark','url','collegamento'] }
  ];

  /* mappa emoji-callout usata da Notion nel copy/paste in testo semplice */
  const CAL_EMOJI = { '💡':'tip','📝':'note','ℹ️':'note','ℹ':'note','⚠️':'warn','⚠':'warn','❗':'danger','❕':'danger','🚫':'danger','‼️':'danger' };
  const CAL_MD = { note:'NOTE', tip:'TIP', warn:'WARNING', danger:'CAUTION' };

  /* ============ serializzazione → markdown ============ */
  function tableMd(b) {
    const rows = b.cells || [];
    if (!rows.length) return '';
    const line = (r) => '| ' + r.map(c => (c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |';
    const out = [line(rows[0])];
    if (rows.length > 1) {
      out.push('|' + rows[0].map(() => ' --- |').join(''));
      for (let r = 1; r < rows.length; r++) out.push(line(rows[r]));
    }
    return out.join('\n');
  }

  function blockToMd(b, i) {
    const ind = '  '.repeat(b.indent || 0);
    const t = (b.text || '').replace(/\n+$/, '');
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return '#'.repeat(+b.type[1]) + ' ' + t;
      case 'p':     return b.indent ? ind + '- ' + t : t;
      case 'ul':    return ind + '- ' + t;
      case 'toggle':return ind + '- ' + t;               /* Notion esporta i toggle come liste */
      case 'ol':    return ind + olNumber(i) + '. ' + t;
      case 'todo':  return ind + '- [' + (b.checked ? 'x' : ' ') + '] ' + t;
      case 'quote': return '> ' + t;
      case 'callout': return '> [!' + (CAL_MD[b.variant || 'note']) + '] ' + t;
      case 'code':  return '```' + (b.lang && b.lang !== 'plaintext' ? b.lang : '') + '\n' + (b.text || '') + '\n```';
      case 'divider': return '---';
      case 'image': return '![' + (b.alt || '') + '](' + (b.src || '') + ')';
      case 'link':  return '[' + (b.text || '') + '](' + (b.url || '') + ')';
      case 'math':  return '$$ ' + (b.text || '') + ' $$';
      case 'table': return tableMd(b);
      default:      return t;
    }
  }

  function toMarkdown() {
    return blocks.map((b, i) => blockToMd(b, i)).filter(s => s !== '').join('\n');
  }

  /* ============ parsing ← markdown (Notion-compatible) ============ */
  function parseMarkdown(md) {
    const out = [];
    if (!md || !md.trim()) return out;
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();
      if (!line.trim()) { i++; continue; }

      const ind = Math.min(3, Math.floor((raw.match(/^ */) || [''])[0].length / 2));

      /* fenced code */
      const fm = line.match(/^```(\w*)\s*$/);
      if (fm) {
        const lang = fm[1] || 'plaintext';
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push(mk('code', buf.join('\n'), { lang }));
        continue;
      }

      /* table */
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const c = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '');
          if (!/^[\s:|-]+$/.test(c)) {
            rows.push(c.split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, '|')));
          }
          i++;
        }
        if (rows.length) out.push(mk('table', '', { cells: rows }));
        continue;
      }

      /* divider */
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push(mk('divider')); i++; continue; }

      /* heading */
      const hm = line.match(/^(#{1,3})\s+(.*)$/);
      if (hm) { out.push(mk('h' + hm[1].length, hm[2])); i++; continue; }

      /* blockquote / callout */
      const qm = line.match(/^\s*>\s?(.*)$/);
      if (qm) {
        const body = qm[1];
        const cm = body.match(/^\[!(NOTE|TIP|WARNING|CAUTION)\]\s*(.*)$/i);
        if (cm) {
          const v = { note:'note', tip:'tip', warning:'warn', caution:'danger' }[cm[1].toLowerCase()];
          out.push(mk('callout', cm[2], { variant: v }));
        } else {
          const v = CAL_EMOJI[body.slice(0, 2)] !== undefined ? CAL_EMOJI[body.slice(0, 2)] : CAL_EMOJI[body[0]];
          if (v) out.push(mk('callout', body.replace(/^\S+\s*/, ''), { variant: v }));
          else out.push(mk('quote', body));
        }
        i++; continue;
      }

      /* callout "plain" di Notion: riga che inizia con emoji noto */
      const em = line.match(/^\s*(\S{1,2})\s+(.*)$/);
      if (em && CAL_EMOJI[em[1]]) {
        out.push(mk('callout', em[2], { variant: CAL_EMOJI[em[1]] }));
        i++; continue;
      }

      /* todo */
      const tm = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s?(.*)$/);
      if (tm) { out.push(mk('todo', tm[2], { indent: ind, checked: tm[1].toLowerCase() === 'x' })); i++; continue; }

      /* bullet */
      const bm = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bm) { out.push(mk('ul', bm[1], { indent: ind })); i++; continue; }

      /* ordered */
      const om = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (om) { out.push(mk('ol', om[1], { indent: ind })); i++; continue; }

      /* image standalone */
      const im = line.match(/^\s*!\[([^\]]*)\]\(([^)\s]*)\)\s*$/);
      if (im) { out.push(mk('image', '', { alt: im[1], src: im[2] })); i++; continue; }

      /* math */
      const mm = line.match(/^\s*\$\$(.+)\$\$\s*$/);
      if (mm) { out.push(mk('math', mm[1].trim())); i++; continue; }

      /* link standalone → bookmark */
      const lm = line.match(/^\s*\[([^\]]*)\]\(([^)\s]*)\)\s*$/);
      if (lm) { out.push(mk('link', lm[1], { url: lm[2] })); i++; continue; }

      out.push(mk('p', line, { indent: ind }));
      i++;
    }
    return out;
  }

  /* ============ rendering inline markdown (solo anteprima) ============ */
  function mdInline(s) {
    let out = esc(s);
    const codes = [];
    out = out.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    out = out.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    out = out.replace(/\u0000(\d+)\u0000/g, (m, k) => '<code>' + codes[k] + '</code>');
    return out;
  }

  /* ============ caret helpers ============ */
  function textCaretOffset(el, node, off) {
    const r = document.createRange();
    r.selectNodeContents(el);
    try { r.setEnd(node, off); } catch (_) { return null; }
    return r.toString().length;
  }
  function caretOffset(el) {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!el.contains(r.startContainer)) return null;
    return textCaretOffset(el, r.startContainer, r.startOffset);
  }
  function setCaretRange(el, start, end) {
    if (!el.firstChild) { el.focus(); return; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node, remaining = start, sN = null, sO = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (remaining <= len) { sN = node; sO = remaining; break; }
      remaining -= len;
    }
    const range = document.createRange();
    if (sN) range.setStart(sN, sO);
    else { range.selectNodeContents(el); range.collapse(false); }
    if (end != null) {
      /* estendi la selezione fino a end */
      let rem = end, eN = null, eO = 0;
      const w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n2;
      while ((n2 = w2.nextNode())) {
        const len = n2.textContent.length;
        if (rem <= len) { eN = n2; eO = rem; break; }
        rem -= len;
      }
      if (eN) range.setEnd(eN, eO); else { range.selectNodeContents(el); range.collapse(false); }
    } else {
      range.collapse(true);
    }
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    el.focus();
  }
  function focusEnd(b, edOverride) {
    const ed = edOverride || mainEditable(b);
    if (!ed) return;
    setCaretRange(ed, (ed.textContent || '').length);
  }
  function mainEditable(b) {
    const el = listEl.querySelector('.block[data-id="' + b.id + '"]');
    if (!el) return null;
    return el.querySelector('.bt') || el.querySelector('.code-area') || el.querySelector('.math-area') ||
           el.querySelector('.img-src') || el.querySelector('.lcurl') || el.querySelector('.cell');
  }

  /* ============ rendering blocchi (edit mode) ============ */
  const PLACEHOLDERS = {
    p: "Scrivi, oppure premi '/'…", h1: 'Titolo 1', h2: 'Titolo 2', h3: 'Titolo 3',
    ul: 'Voce di elenco', ol: 'Voce di elenco', todo: 'To-do', toggle: 'Toggle',
    quote: 'Citazione vuota', callout: 'Testo del callout…', link: 'Titolo del link'
  };

  function handleSvg() { return svg(ICON.dots); }

  function renderBlock(b, i) {
    const el = document.createElement('div');
    el.className = 'block t-' + b.type;
    el.dataset.id = b.id;
    if (b.type === 'callout') el.classList.add('v-' + (b.variant || 'note'));
    if (b.type === 'todo' && b.checked) el.classList.add('done');
    if (b.type === 'toggle' && b.collapsed) el.classList.add('closed');
    el.style.marginLeft = ((b.indent || 0) * 18) + 'px';

    /* handle drag/menu */
    const h = document.createElement('button');
    h.className = 'handle'; h.title = 'Trascina o clicca per il menu';
    h.draggable = true; h.innerHTML = handleSvg();
    el.appendChild(h);

    const mkBt = (ph) => {
      const d = document.createElement('div');
      d.className = 'bt'; d.contentEditable = 'plaintext-only'; d.dataset.ph = ph || PH;
      d.textContent = b.text || '';
      return d;
    };

    switch (b.type) {
      case 'p': case 'h1': case 'h2': case 'h3': case 'quote': {
        const c = document.createElement('div'); c.className = 'bcontent';
        c.appendChild(mkBt(PLACEHOLDERS[b.type]));
        el.appendChild(c); break;
      }
      case 'ul': {
        const c = document.createElement('div'); c.className = 'bcontent';
        const m = document.createElement('span'); m.className = 'marker'; m.textContent = '•';
        c.appendChild(m); c.appendChild(mkBt(PLACEHOLDERS.ul));
        el.appendChild(c); break;
      }
      case 'ol': {
        const c = document.createElement('div'); c.className = 'bcontent';
        const m = document.createElement('span'); m.className = 'marker olm'; m.textContent = olNumber(i) + '.';
        c.appendChild(m); c.appendChild(mkBt(PLACEHOLDERS.ol));
        el.appendChild(c); break;
      }
      case 'todo': {
        const c = document.createElement('div'); c.className = 'bcontent';
        const cb = document.createElement('button');
        cb.className = 'checkbox' + (b.checked ? ' on' : ''); cb.title = 'Completa';
        cb.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';
        c.appendChild(cb); c.appendChild(mkBt(PLACEHOLDERS.todo));
        el.appendChild(c); break;
      }
      case 'toggle': {
        const c = document.createElement('div'); c.className = 'bcontent';
        const a = document.createElement('button');
        a.className = 'tarrow'; a.title = 'Apri/chiudi';
        a.innerHTML = svg(ICON.arrow);
        c.appendChild(a); c.appendChild(mkBt(PLACEHOLDERS.toggle));
        el.appendChild(c); break;
      }
      case 'callout': {
        const box = document.createElement('div'); box.className = 'callout v-' + (b.variant || 'note');
        const ic = document.createElement('span'); ic.className = 'cicon';
        ic.innerHTML = svg(CAL[b.variant || 'note'] || ICON.info);
        box.appendChild(ic); box.appendChild(mkBt(PLACEHOLDERS.callout));
        el.appendChild(box); break;
      }
      case 'divider': {
        const c = document.createElement('div'); c.className = 'bcontent';
        c.innerHTML = '<hr>';
        el.appendChild(c); break;
      }
      case 'code': {
        const w = document.createElement('div'); w.className = 'codewrap';
        const head = document.createElement('div'); head.className = 'codehead';
        const sel = document.createElement('select');
        for (const l of LANGS) {
          const o = document.createElement('option'); o.value = l; o.textContent = l;
          if (l === (b.lang || 'plaintext')) o.selected = true;
          sel.appendChild(o);
        }
        head.appendChild(sel); w.appendChild(head);
        const ca = document.createElement('div');
        ca.className = 'code-area'; ca.contentEditable = 'plaintext-only'; ca.dataset.ph = '// codice…';
        ca.textContent = b.text || '';
        w.appendChild(ca); el.appendChild(w); break;
      }
      case 'math': {
        const m = document.createElement('div');
        m.className = 'math-area'; m.contentEditable = 'plaintext-only'; m.dataset.ph = 'Formula LaTeX…';
        m.textContent = b.text || '';
        el.appendChild(m); break;
      }
      case 'image': {
        const w = document.createElement('div'); w.className = 'imgwrap';
        if (b.src && /^(https?:\/\/|data:image)/i.test(b.src)) {
          const img = document.createElement('img'); img.src = b.src; img.alt = b.alt || '';
          w.appendChild(img);
        }
        const src = document.createElement('div');
        src.className = 'img-src'; src.contentEditable = 'plaintext-only'; src.dataset.ph = 'URL immagine…';
        src.textContent = b.src || '';
        w.appendChild(src); el.appendChild(w); break;
      }
      case 'link': {
        const card = document.createElement('div'); card.className = 'linkcard';
        const ic = document.createElement('button');
        ic.className = 'iconbtn lcopen'; ic.title = 'Apri link'; ic.style.flex = 'none';
        ic.innerHTML = svg(ICON.link);
        const wrap = document.createElement('div'); wrap.style.flex = '1'; wrap.style.minWidth = '0';
        const bt = mkBt(PLACEHOLDERS.link);
        const u = document.createElement('div');
        u.className = 'lcurl'; u.contentEditable = 'plaintext-only'; u.dataset.ph = 'https://…';
        u.textContent = b.url || '';
        wrap.appendChild(bt); wrap.appendChild(u);
        card.appendChild(ic); card.appendChild(wrap);
        el.appendChild(card); break;
      }
      case 'table': {
        const w = document.createElement('div'); w.className = 'tblwrap';
        const bar = document.createElement('div'); bar.className = 'tblbar';
        const mkMini = (act, label) => {
          const btn = document.createElement('button');
          btn.className = 'mini'; btn.dataset.act = act; btn.textContent = label;
          return btn;
        };
        bar.appendChild(mkMini('addCol', '+ Col'));
        bar.appendChild(mkMini('delCol', '− Col'));
        bar.appendChild(mkMini('addRow', '+ Riga'));
        bar.appendChild(mkMini('delRow', '− Riga'));
        w.appendChild(bar);

        const cells = b.cells || [['',''],['','']];
        const tbl = document.createElement('table'); tbl.className = 'tbl';
        cells.forEach((row, r) => {
          const tr = document.createElement('tr');
          row.forEach((cv, c) => {
            const cell = document.createElement(r === 0 ? 'th' : 'td');
            const d = document.createElement('div');
            d.className = 'cell'; d.contentEditable = 'plaintext-only';
            d.dataset.r = r; d.dataset.c = c; d.textContent = cv || '';
            cell.appendChild(d); tr.appendChild(cell);
          });
          tbl.appendChild(tr);
        });
        w.appendChild(tbl); el.appendChild(w); break;
      }
      default: {
        const c = document.createElement('div'); c.className = 'bcontent';
        c.appendChild(mkBt());
        el.appendChild(c);
      }
    }
    return el;
  }

  /* il toggle chiuso nasconde i blocchi con indent maggiore fino a indent <= suo */
  function render() {
    if (preview) return renderPreview();
    listEl.innerHTML = '';
    let hideUntilIndent = null;
    blocks.forEach((b, i) => {
      if (hideUntilIndent != null) {
        if ((b.indent || 0) > hideUntilIndent) return;   /* nascosto */
        hideUntilIndent = null;
      }
      listEl.appendChild(renderBlock(b, i));
      if (b.type === 'toggle' && b.collapsed) hideUntilIndent = b.indent || 0;
    });
  }

  /* ============ rendering anteprima ============ */
  function previewBlockHtml(b) {
    const t = mdInline(b.text || '');
    const wrap = (cls, inner) => '<div class="block ' + cls + '">' + inner + '</div>';
    switch (b.type) {
      case 'h1': case 'h2': case 'h3': return wrap('t-' + b.type, '<div class="bcontent"><div class="bt">' + (t || ' ') + '</div></div>');
      case 'p':     return wrap('t-p', '<div class="bcontent"><div class="bt">' + (t || ' ') + '</div></div>');
      case 'ul':    return wrap('t-ul', '<div class="bcontent"><span class="marker">•</span><div class="bt">' + (t || ' ') + '</div></div>');
      case 'ol':    return wrap('t-ol', '<div class="bcontent"><span class="marker olm">' + (b._n || 1) + '.</span><div class="bt">' + (t || ' ') + '</div></div>');
      case 'todo':  return wrap('t-todo' + (b.checked ? ' done' : ''),
        '<div class="bcontent"><button class="checkbox' + (b.checked ? ' on' : '') + '" disabled><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></button><div class="bt">' + (t || ' ') + '</div></div>');
      case 'toggle':return wrap('t-toggle', '<div class="bcontent"><span class="tarrow">' + svg(ICON.arrow) + '</span><div class="bt">' + (t || ' ') + '</div></div>');
      case 'quote': return wrap('t-quote', '<div class="bcontent"><div class="bt">' + (t || ' ') + '</div></div>');
      case 'callout': return wrap('t-callout', '<div class="callout v-' + (b.variant || 'note') + '"><span class="cicon">' + svg(CAL[b.variant || 'note'] || ICON.info) + '</span><div class="bt">' + (t || ' ') + '</div></div>');
      case 'divider': return wrap('t-divider', '<div class="bcontent"><hr></div>');
      case 'code':  return '<div class="block t-code"><div class="codewrap"><div class="codehead"><span class="langtag">' + esc(b.lang || '') + '</span></div><div class="code-area">' + esc(b.text || '') + '</div></div></div>';
      case 'math':  return '<div class="block t-math"><div class="mathpv">' + (t || ' ') + '</div></div>';
      case 'image': return '<div class="block t-image"><div class="imgwrap">' + (b.src && /^(https?:\/\/|data:image)/i.test(b.src) ? '<img src="' + esc(b.src) + '" alt="' + esc(b.alt || '') + '">' : '') + '</div></div>';
      case 'link':  return '<div class="block t-link"><a class="linkcard" href="' + esc(b.url || '#') + '">' + svg(ICON.link) + '<div><div class="bt">' + (mdInline(b.text || b.url || '') || ' ') + '</div><div class="lcurl">' + esc(b.url || '') + '</div></div></a></div>';
      case 'table': {
        const rows = b.cells || [];
        let htm = '<div class="block t-table"><div class="tblwrap"><table class="tbl">';
        rows.forEach((row, r) => {
          htm += '<tr>';
          row.forEach(cv => { htm += (r === 0 ? '<th>' : '<td>') + mdInline(cv || '') + (r === 0 ? '</th>' : '</td>'); });
          htm += '</tr>';
        });
        return htm + '</table></div></div>';
      }
      default: return wrap('t-p', '<div class="bcontent"><div class="bt">' + (t || ' ') + '</div></div>');
    }
  }
  function renderPreview() {
    let hideUntilIndent = null;
    let html = '';
    blocks.forEach((b, i) => {
      if (hideUntilIndent != null) {
        if ((b.indent || 0) > hideUntilIndent) return;
        hideUntilIndent = null;
      }
      b._n = b.type === 'ol' ? olNumber(i) : 1;
      html += previewBlockHtml(b);
      if (b.type === 'toggle' && b.collapsed) hideUntilIndent = b.indent || 0;
    });
    listEl.innerHTML = html || '<div style="padding:24px;color:var(--vscode-descriptionForeground)">Nota vuota.</div>';
  }

  /* ============ salvataggio ============ */
  function queueSave() {
    statusEl.textContent = 'Salvataggio…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      vscode.postMessage({ type: 'save', text: toMarkdown(), title: titleEl.textContent || '' });
    }, 600);
  }

  /* ============ sync modello ← DOM ============ */
  function updateBlockFromDom(target) {
    const blockEl = target.closest('.block');
    if (!blockEl) return null;
    const b = byId(blockEl.dataset.id);
    if (!b) return null;
    if (target.classList.contains('bt')) b.text = target.textContent;
    else if (target.classList.contains('code-area') || target.classList.contains('math-area')) b.text = target.textContent;
    else if (target.classList.contains('img-src')) b.src = target.textContent.trim();
    else if (target.classList.contains('lcurl')) b.url = target.textContent.trim();
    else if (target.classList.contains('cell')) {
      if (!b.cells) b.cells = [['',''],['','']];
      const r = +target.dataset.r, c = +target.dataset.c;
      if (b.cells[r]) b.cells[r][c] = target.textContent;
    }
    return b;
  }

  /* ============ conversione tipo (menu '/') ============ */
  function applyType(b, id) {
    if (id.startsWith('callout-')) {
      b.type = 'callout';
      b.variant = id.slice('callout-'.length);
      return;
    }
    switch (id) {
      case 'p': case 'h1': case 'h2': case 'h3':
      case 'ul': case 'ol': case 'todo': case 'toggle': case 'quote':
        b.type = id; break;
      case 'divider':
        b.type = 'divider'; b.text = ''; break;
      case 'code':
        b.type = 'code'; if (!b.lang) b.lang = 'plaintext'; break;
      case 'table':
        if (b.type !== 'table' || !b.cells) {
          b.type = 'table';
          b.cells = [[b.text || '', ''], ['', '']];
          b.text = '';
        }
        break;
      case 'math':
        b.type = 'math'; break;
      case 'image': {
        const t = (b.text || '').trim();
        b.type = 'image';
        if (/^(https?:\/\/|data:image)/i.test(t)) { b.src = t; b.text = ''; }
        else b.src = b.src || '';
        break;
      }
      case 'link': {
        const t = (b.text || '').trim();
        b.type = 'link';
        const m = t.match(/^\[([^\]]*)\]\(([^)\s]*)\)$/);
        if (m) { b.text = m[1]; b.url = m[2]; }
        else if (/^(https?:\/\/)/i.test(t)) { b.url = t; }
        break;
      }
    }
  }

  /* ============ menu '/' ============ */
  function closeSlash() {
    slashMenu = null;
    slashEl.classList.remove('open');
    slashEl.innerHTML = '';
  }

  function openSlash(blockId, ed, query) {
    const q = (query || '').toLowerCase();
    const items = RAW_ITEMS.filter(it => !it.group && (
      !q || it.label.toLowerCase().includes(q) || it.kw.some(k => k.startsWith(q))
    ));
    const anchor = getSelection();
    let rect = null;
    if (anchor.rangeCount) {
      const r = anchor.getRangeAt(0).cloneRange();
      rect = r.getBoundingClientRect();
    }
    if (!items.length) {
      slashMenu = { blockId, ed, query, items: [], sel: -1 };
      slashEl.innerHTML = '<div class="snone">Nessun blocco per "' + esc(query) + '"</div>';
      slashEl.classList.add('open');
    } else {
      slashMenu = { blockId, ed, query, items, sel: 0 };
      renderSlashItems();
      slashEl.classList.add('open');
    }
    /* posizionamento relativo allo scroller */
    const scr = scroller.getBoundingClientRect();
    let x = (rect ? rect.left : scr.left + 30) - scr.left + scroller.scrollLeft;
    let y = (rect ? rect.bottom : scr.top + 60) - scr.top + scroller.scrollTop + 5;
    if (y + 336 > scroller.clientHeight) y = (rect ? rect.top : 60) - scr.top + scroller.scrollTop - 336;
    if (y < 4) y = 4;
    if (x + 288 > scroller.clientWidth) x = Math.max(4, scroller.clientWidth - 292);
    slashEl.style.left = x + 'px';
    slashEl.style.top = y + 'px';
  }

  function renderSlashItems() {
    if (!slashMenu) return;
    const q = (slashMenu.query || '').toLowerCase();
    let html = '', lastGroup = '';
    let vi = 0;
    for (const it of RAW_ITEMS) {
      if (it.group) { lastGroup = it.group; continue; }
      if (q && !(it.label.toLowerCase().includes(q) || it.kw.some(k => k.startsWith(q)))) continue;
      if (lastGroup) { html += '<div class="sgroup">' + lastGroup + '</div>'; lastGroup = ''; }
      const selCls = vi === slashMenu.sel ? ' sel' : '';
      const ic = ICON[it.id] ||
        (it.id.startsWith('callout-') ? CAL[it.id.slice('callout-'.length)] : null) ||
        ICON[it.id.split('-')[0]] || ICON.text;
      html += '<div class="sitem' + selCls + '" data-vi="' + vi + '">'
        + '<span class="sicon">' + svg(ic) + '</span>'
        + '<span class="stxt"><span class="slabel">' + it.label + '</span><span class="sdesc">' + it.desc + '</span></span>'
        + '</div>';
      vi++;
    }
    slashEl.innerHTML = html || '<div class="snone">Nessun blocco</div>';
  }

  function maybeSlash(target) {
    if (preview) return closeSlash();
    const isTxt = target.classList.contains('bt') ||
                  target.classList.contains('code-area') ||
                  target.classList.contains('math-area');
    if (!isTxt) return closeSlash();
    const blockEl = target.closest('.block');
    if (!blockEl) return closeSlash();
    const off = caretOffset(target);
    if (off == null) return closeSlash();
    const before = (target.textContent || '').slice(0, off);
    const m = before.match(/(?:^|\s)\/([\wà-ú]*)$/);
    if (!m) return closeSlash();
    openSlash(blockEl.dataset.id, target, m[1]);
  }

  function applySlashItem(vi) {
    if (!slashMenu || !slashMenu.items[vi]) return;
    const item = slashMenu.items[vi];
    const s = slashMenu;
    closeSlash();
    const b = byId(s.blockId);
    if (!b) return;
    /* rimuovi "/query" prima del caret */
    const off = caretOffset(s.ed);
    if (off != null) {
      const text = s.ed.textContent || '';
      const cut = off - s.query.length - 1;
      if (cut >= 0 && text[cut] === '/') {
        b.text = text.slice(0, cut) + text.slice(off);
      }
    }
    applyType(b, item.id);
    render();
    queueSave();
    focusEnd(b);
  }

  slashEl.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.sitem');
    if (!it) return;
    e.preventDefault();
    applySlashItem(+it.dataset.vi);
  });

  /* ============ menu blocco (⋮) ============ */
  const TURN_ITEMS = [
    { id: 'p',             label: 'Testo' },
    { id: 'h1',            label: 'Titolo 1' },
    { id: 'h2',            label: 'Titolo 2' },
    { id: 'h3',            label: 'Titolo 3' },
    { id: 'ul',            label: 'Elenco puntato' },
    { id: 'ol',            label: 'Elenco numerato' },
    { id: 'todo',          label: 'To-do' },
    { id: 'toggle',        label: 'Toggle' },
    { id: 'quote',         label: 'Citazione' },
    { id: 'callout-note',  label: 'Callout · Nota' },
    { id: 'callout-tip',   label: 'Callout · Suggerimento' },
    { id: 'callout-warn',  label: 'Callout · Avviso' },
    { id: 'callout-danger',label: 'Callout · Pericolo' },
    { id: 'code',          label: 'Codice' }
  ];
  function closeBlockMenu() { bmBlock = null; bmEl.classList.remove('open'); }
  function openBlockMenu(blockEl, handleBtn) {
    bmBlock = blockEl.dataset.id;
    const iconOf = (id) =>
      ICON[id] || (id.startsWith('callout-') ? CAL[id.slice('callout-'.length)] : null) || ICON.text;
    const turnHtml = TURN_ITEMS.map(it =>
      '<div class="bmitem" data-act="turn:' + it.id + '">'
      + '<span class="bmi">' + svg(iconOf(it.id)) + '</span>' + it.label + '</div>'
    ).join('');
    const actions = [
      { act: 'dup',    label: 'Duplica',    icon: ICON.dup },
      { act: 'up',     label: 'Sposta su',  icon: ICON.up },
      { act: 'down',   label: 'Sposta giù', icon: ICON.down },
      { act: 'trash',  label: 'Elimina',    icon: ICON.trash, danger: true }
    ];
    const actHtml = actions.map(it =>
      '<div class="bmitem' + (it.danger ? ' danger' : '') + '" data-act="' + it.act + '">'
      + '<span class="bmi">' + svg(it.icon) + '</span>' + it.label + '</div>'
    ).join('');
    bmEl.innerHTML = '<div class="sgroup">Trasforma in</div>' + turnHtml
                   + '<div class="sgroup">Azioni</div>' + actHtml;
    bmEl.classList.add('open');
    const scr = scroller.getBoundingClientRect();
    const hr = handleBtn.getBoundingClientRect();
    bmEl.style.left = Math.max(4, hr.left - scr.left + scroller.scrollLeft - 60) + 'px';
    bmEl.style.top = (hr.bottom - scr.top + scroller.scrollTop + 4) + 'px';
  }
  bmEl.addEventListener('mousedown', (e) => {
    const it = e.target.closest('.bmitem');
    if (!it || !bmBlock) return;
    e.preventDefault();
    const id = bmBlock; const act = it.dataset.act;
    closeBlockMenu();
    blockAction(id, act);
  });
  function blockAction(id, act) {
    const i = idxOf(id);
    if (i < 0) return;
    const b = blocks[i];
    if (act.startsWith('turn:')) {
      applyType(b, act.slice(5));
      render(); queueSave(); focusEnd(b);
      return;
    }
    if (act === 'dup') {
      const copy = JSON.parse(JSON.stringify(b)); copy.id = uid();
      blocks.splice(i + 1, 0, copy);
      render(); queueSave(); focusEnd(copy);
    } else if (act === 'up' && i > 0) {
      [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
      render(); queueSave(); focusEnd(b);
    } else if (act === 'down' && i < blocks.length - 1) {
      [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]];
      render(); queueSave(); focusEnd(b);
    } else if (act === 'trash') {
      if (blocks.length === 1) { blocks = [mk('p')]; }
      else {
        const prev = blocks[i - 1] || blocks[i + 1];
        blocks.splice(i, 1);
        render(); queueSave(); focusEnd(prev);
        return;
      }
      render(); queueSave();
    }
  }

  /* ============ toolbar selezione (inline markdown) ============ */
  /* inserimento testo deterministico al posto di document.execCommand('insertText'),
     che nelle webview VS Code con contenteditable="plaintext-only" fallisce silenziosamente */
  function insertTextAtSelection(ed, text) {
    const sel = getSelection();
    let s = null, e = null;
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      if (ed.contains(r.startContainer)) {
        s = textCaretOffset(ed, r.startContainer, r.startOffset);
        e = textCaretOffset(ed, r.endContainer, r.endOffset);
      }
    }
    if (s == null || e == null) {
      const off = caretOffset(ed);
      s = e = (off == null ? (ed.textContent || '').length : off);
    }
    const full = ed.textContent || '';
    ed.textContent = full.slice(0, s) + text + full.slice(e);
    updateBlockFromDom(ed);
    setCaretRange(ed, s + text.length);
  }

  function hideSelTb() { selTb.classList.remove('open'); }
  document.addEventListener('selectionchange', () => {
    if (preview) return hideSelTb();
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return hideSelTb();
    const r = sel.getRangeAt(0);
    const node = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const ed = node && node.closest ? node.closest('.bt') : null;
    if (!ed) return hideSelTb();
    const rect = r.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return hideSelTb();
    selTb.style.left = Math.max(6, rect.left + rect.width / 2 - 105) + 'px';
    selTb.style.top = Math.max(6, rect.top - 34) + 'px';
    selTb.classList.add('open');
  });
  scroller.addEventListener('scroll', hideSelTb);

  function wrapSelection(before, after) {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const node = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    const ed = node && node.closest ? node.closest('[contenteditable]') : null;
    if (!ed) return;
    const s = textCaretOffset(ed, r.startContainer, r.startOffset);
    const e = textCaretOffset(ed, r.endContainer, r.endOffset);
    if (s == null || e == null) return;
    const txt = (ed.textContent || '').slice(s, e);
    const full = ed.textContent || '';
    ed.textContent = full.slice(0, s) + before + txt + after + full.slice(e);
    setCaretRange(ed, s + before.length, s + before.length + txt.length);
    updateBlockFromDom(ed);
    queueSave();
  }
  selTb.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('.fbtn');
    if (!btn) return;
    e.preventDefault();
    const f = btn.dataset.f;
    if (f === 'b') wrapSelection('**', '**');
    else if (f === 'i') wrapSelection('*', '*');
    else if (f === 's') wrapSelection('~~', '~~');
    else if (f === 'code') wrapSelection('`', '`');
    else if (f === 'hl') wrapSelection('==', '==');
    else if (f === 'link') wrapSelection('[', '](https://)');
  });

  /* ============ eventi: input ============ */
  listEl.addEventListener('input', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.isContentEditable) {
      updateBlockFromDom(t);
      queueSave();
      maybeSlash(t);
    }
  });

  /* cambio lingua code block */
  listEl.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT') return;
    const blockEl = e.target.closest('.block');
    const b = blockEl && byId(blockEl.dataset.id);
    if (b) { b.lang = e.target.value; queueSave(); }
  });

  /* ============ eventi: click (checkbox, toggle, handle, tabella, link) ============ */
  listEl.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const cb = t.closest('.checkbox');
    if (cb && !preview) {
      const blockEl = cb.closest('.block');
      const b = blockEl && byId(blockEl.dataset.id);
      if (b) {
        b.checked = !b.checked;
        cb.classList.toggle('on', b.checked);
        blockEl.classList.toggle('done', b.checked);
        queueSave();
      }
      return;
    }

    const ta = t.closest('.tarrow');
    if (ta && !preview) {
      const blockEl = ta.closest('.block');
      const b = blockEl && byId(blockEl.dataset.id);
      if (b) { b.collapsed = !b.collapsed; render(); queueSave(); }
      return;
    }

    const mini = t.closest('.mini');
    if (mini && !preview) {
      const blockEl = mini.closest('.block');
      const b = blockEl && byId(blockEl.dataset.id);
      if (!b) return;
      const act = mini.dataset.act;
      if (!b.cells) b.cells = [['',''],['','']];
      if (act === 'addRow') b.cells.push(b.cells[0].map(() => ''));
      else if (act === 'delRow' && b.cells.length > 1) b.cells.pop();
      else if (act === 'addCol') b.cells.forEach(r => r.push(''));
      else if (act === 'delCol' && b.cells[0].length > 1) b.cells.forEach(r => r.pop());
      render(); queueSave();
      return;
    }

    const open = t.closest('.lcopen');
    if (open) {
      const blockEl = open.closest('.block');
      const b = blockEl && byId(blockEl.dataset.id);
      if (b && b.url) vscode.postMessage({ type: 'open', url: b.url });
      return;
    }

    const handle = t.closest('.handle');
    if (handle && !preview) {
      openBlockMenu(handle.closest('.block'), handle);
      return;
    }
  });

  /* click su link nell'anteprima → apre esterno */
  listEl.addEventListener('click', (e) => {
    if (!preview) return;
    const a = e.target.closest('a');
    if (a) {
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href && /^https?:\/\//i.test(href)) vscode.postMessage({ type: 'open', url: href });
    }
  });

  /* chiudi i menu cliccando fuori */
  document.addEventListener('mousedown', (e) => {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest('#slash-menu')) closeSlash();
    if (!e.target.closest('#block-menu') && !e.target.closest('.handle')) closeBlockMenu();
    if (!e.target.closest('#clear-pop') && !e.target.closest('#btn-clear')) clearPop.classList.remove('open');
  });

  /* ============ drag & drop riordino ============ */
  let dragId = null;
  listEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest && e.target.closest('.handle');
    if (!handle) { e.preventDefault(); return; }
    const blockEl = handle.closest('.block');
    dragId = blockEl.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
  });
  listEl.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const blockEl = e.target.closest && e.target.closest('.block');
    if (!blockEl || blockEl.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = blockEl.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    clearDropMarks();
    blockEl.style.borderTop = above ? '2px solid var(--vscode-focusBorder)' : '';
    blockEl.style.borderBottom = !above ? '2px solid var(--vscode-focusBorder)' : '';
    blockEl.dataset.dropBefore = above ? '1' : '0';
  });
  listEl.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const blockEl = e.target.closest && e.target.closest('.block');
    const from = idxOf(dragId);
    clearDropMarks();
    dragId = null;
    if (from < 0) return;
    if (!blockEl) {
      /* drop in fondo */
      const moved = blocks.splice(from, 1)[0];
      blocks.push(moved);
    } else {
      let to = idxOf(blockEl.dataset.id);
      if (to < 0) return;
      const before = blockEl.dataset.dropBefore === '1';
      delete blockEl.dataset.dropBefore;
      const moved = blocks.splice(from, 1)[0];
      to = idxOf(blockEl.dataset.id);
      blocks.splice(before ? to : to + 1, 0, moved);
    }
    render(); queueSave();
  });
  listEl.addEventListener('dragend', () => { clearDropMarks(); dragId = null; });
  function clearDropMarks() {
    listEl.querySelectorAll('.block').forEach(el => { el.style.borderTop = ''; el.style.borderBottom = ''; });
  }

  /* ============ eventi: keydown ============ */
  listEl.addEventListener('keydown', (e) => {
    if (preview) return;

    /* navigazione menu '/' */
    if (slashMenu && slashEl.classList.contains('open')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (slashMenu.items.length) { slashMenu.sel = (slashMenu.sel + 1) % slashMenu.items.length; renderSlashItems(); } return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); if (slashMenu.items.length) { slashMenu.sel = (slashMenu.sel - 1 + slashMenu.items.length) % slashMenu.items.length; renderSlashItems(); } return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applySlashItem(slashMenu.sel); return; }
      if (e.key === 'Escape')    { e.preventDefault(); closeSlash(); return; }
    }

    const ed = e.target.closest && e.target.closest('[contenteditable]');
    if (!ed) return;
    const blockEl = ed.closest('.block');
    const b = blockEl && byId(blockEl.dataset.id);
    if (!b) return;
    const i = idxOf(b.id);

    /* ---- tabelle ---- */
    if (ed.classList.contains('cell')) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const r = +ed.dataset.r, c = +ed.dataset.c;
        const cells = b.cells || [];
        let nr = r, nc = c + (e.shiftKey ? -1 : 1);
        if (nc >= (cells[0] || []).length) { nc = 0; nr++; }
        if (nc < 0) { nc = (cells[0] || []).length - 1; nr--; }
        if (nr >= cells.length) {
          b.cells.push(cells[0].map(() => ''));
          render(); queueSave();
          const nel = listEl.querySelector('.block[data-id="' + b.id + '"] .cell[data-r="' + (nr) + '"][data-c="0"]');
          if (nel) focusEnd(b, nel);
          return;
        }
        if (nr < 0) { focusEnd(blocks[i - 1] || b); return; }
        const nel = listEl.querySelector('.block[data-id="' + b.id + '"] .cell[data-r="' + nr + '"][data-c="' + nc + '"]');
        if (nel) focusEnd(b, nel);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const r = +ed.dataset.r, c = +ed.dataset.c;
        const cells = b.cells || [];
        if (r + 1 >= cells.length) {
          b.cells.push(cells[0].map(() => ''));
          render(); queueSave();
          const nel = listEl.querySelector('.block[data-id="' + b.id + '"] .cell[data-r="' + (r + 1) + '"][data-c="' + c + '"]');
          if (nel) focusEnd(b, nel);
        } else {
          const nel = listEl.querySelector('.block[data-id="' + b.id + '"] .cell[data-r="' + (r + 1) + '"][data-c="' + c + '"]');
          if (nel) focusEnd(b, nel);
        }
        return;
      }
      return;
    }

    /* ---- code block ---- */
    if (ed.classList.contains('code-area')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertTextAtSelection(ed, '\n');
        b.text = ed.textContent; queueSave();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        insertTextAtSelection(ed, '  ');
        b.text = ed.textContent; queueSave();
        return;
      }
      if (e.key === 'Backspace') {
        /* Backspace su blocco vuoto → testo normale */
        if (caretOffset(ed) === 0 && !(b.text || '') && !getSelection().toString()) {
          e.preventDefault();
          b.type = 'p'; render(); queueSave(); focusEnd(b);
          return;
        }
      }
      return;
    }

    /* ---- src immagine / url link: Enter → nuovo blocco testo ---- */
    if (ed.classList.contains('img-src') || ed.classList.contains('lcurl')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const nb = mk('p', '', { indent: b.indent || 0 });
        blocks.splice(i + 1, 0, nb);
        render(); queueSave(); focusEnd(nb);
      }
      return;
    }

    /* ---- blocchi testuali ---- */
    const off = caretOffset(ed);
    const text = ed.textContent || '';

    if (e.key === 'Enter') {
      e.preventDefault();
      closeSlash();
      /* elenco vuoto → esci dalla lista */
      if ((b.type === 'ul' || b.type === 'ol' || b.type === 'todo') && !text.trim()) {
        b.type = 'p'; render(); queueSave(); focusEnd(b);
        return;
      }
      const after = text.slice(off == null ? text.length : off);
      b.text = text.slice(0, off == null ? text.length : off);
      let nt = 'p';
      if (b.type === 'ul' || b.type === 'ol' || b.type === 'todo') nt = b.type;
      let nIndent = b.indent || 0;
      if (b.type === 'toggle') nIndent = (b.indent || 0) + 1;
      const nb = mk(nt, after, { indent: nIndent });
      if (b.type === 'todo') nb.checked = false;
      blocks.splice(i + 1, 0, nb);
      render(); queueSave(); focusEnd(nb);
      return;
    }

    if (e.key === 'Backspace') {
      const selTxt = getSelection().toString();
      if (off === 0 && !selTxt) {
        e.preventDefault();
        /* trasforma in testo */
        if (b.type !== 'p' && b.type !== 'code' && TEXTY.has(b.type)) {
          if ((b.type === 'ul' || b.type === 'ol' || b.type === 'todo') && (b.indent || 0) > 0) {
            b.indent--; render(); queueSave(); focusEnd(b); return;
          }
          b.type = 'p'; b.variant = 'note';
          render(); queueSave(); focusEnd(b);
          return;
        }
        if (b.type === 'math' || b.type === 'code' || b.type === 'link') {
          b.type = 'p'; render(); queueSave(); focusEnd(b); return;
        }
        /* merge col precedente */
        const prev = blocks[i - 1];
        if (!prev) return;
        if (TEXTY.has(prev.type)) {
          const joinAt = (prev.text || '').length;
          prev.text = (prev.text || '') + (b.text || '');
          blocks.splice(i, 1);
          render(); queueSave();
          const pe = mainEditable(prev);
          if (pe) setCaretRange(pe, joinAt);
        } else if (b.type === 'p' || b.type === 'math') {
          /* blocco non testuale prima: eliminalo */
          blocks.splice(i - 1, 1);
          render(); queueSave(); focusEnd(b);
        } else {
          blocks.splice(i - 1, 1);
          render(); queueSave(); focusEnd(b);
        }
        return;
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if ((b.indent || 0) > 0) { b.indent--; render(); queueSave(); focusEnd(b); }
      } else {
        if (i > 0 && (b.indent || 0) < Math.min(3, (blocks[i - 1].indent || 0) + 1)) {
          b.indent++;
          render(); queueSave(); focusEnd(b);
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (off === 0 || (ed.getClientRects && ed.getClientRects().length <= 1)) {
        /* sposta focus al blocco precedente */
        for (let j = i - 1; j >= 0; j--) {
          const pe = mainEditable(blocks[j]);
          if (pe) { e.preventDefault(); focusEnd(blocks[j]); return; }
        }
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      if (off === text.length || (ed.getClientRects && ed.getClientRects().length <= 1)) {
        for (let j = i + 1; j < blocks.length; j++) {
          const ne = mainEditable(blocks[j]);
          if (ne) { e.preventDefault(); setCaretRange(ne, 0); return; }
        }
      }
      return;
    }

    if (e.key === 'Escape') { closeSlash(); closeBlockMenu(); }
  });

  /* ============ paste ============ */
  listEl.addEventListener('paste', (e) => {
    if (preview) return;
    const ed = e.target.closest && e.target.closest('[contenteditable]');
    if (!ed) return;
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    e.preventDefault();

    /* nei code block incolla sempre raw */
    if (ed.classList.contains('code-area')) {
      insertTextAtSelection(ed, text);
      queueSave();
      return;
    }

    /* markdown multilinea → parsing in blocchi (compatibilità Notion) */
    if (text.includes('\n') && (ed.classList.contains('bt') || ed.classList.contains('math-area'))) {
      const parsed = parseMarkdown(text);
      if (parsed.length) {
        const blockEl = ed.closest('.block');
        const b = blockEl && byId(blockEl.dataset.id);
        const i = b ? idxOf(b.id) : blocks.length;
        if (b && !(b.text || '').trim() && b.type === 'p') {
          blocks.splice(i, 1, ...parsed);
        } else {
          blocks.splice(i + 1, 0, ...parsed);
        }
        render(); queueSave();
        const lastParsed = parsed[parsed.length - 1];
        if (mainEditable(lastParsed)) focusEnd(lastParsed);
        return;
      }
    }

    insertTextAtSelection(ed, text);
    queueSave();
  });

  /* ============ copy / cut dentro l'editor ============ */
  function activeBlock() {
    const ed = document.activeElement;
    if (!(ed instanceof Element) || !ed.closest) return null;
    const blockEl = ed.closest('.block');
    return blockEl ? byId(blockEl.dataset.id) : null;
  }
  listEl.addEventListener('copy', (e) => {
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed && sel.toString()) return; /* selezione nativa → default */
    const b = activeBlock();
    if (!b) return;
    /* caret senza selezione → copia l'intero blocco in markdown (stile Notion) */
    e.clipboardData.setData('text/plain', blockToMd(b, idxOf(b.id)));
    e.preventDefault();
  });
  listEl.addEventListener('cut', (e) => {
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed && sel.toString()) {
      /* taglia la selezione col comportamento nativo, poi sincronizza il modello */
      setTimeout(() => {
        const t = document.activeElement;
        if (t instanceof Element && t.isContentEditable) { updateBlockFromDom(t); queueSave(); }
      }, 0);
      return;
    }
    const b = activeBlock();
    if (!b) return;
    e.clipboardData.setData('text/plain', blockToMd(b, idxOf(b.id)));
    e.preventDefault();
    const i = idxOf(b.id);
    if (blocks.length === 1) blocks = [mk('p')];
    else {
      const next = blocks[i - 1] || blocks[i + 1];
      blocks.splice(i, 1);
      render(); queueSave(); focusEnd(next);
      return;
    }
    render(); queueSave();
  });

  /* ============ click su area vuota → focus ultimo blocco ============ */
  scroller.addEventListener('mousedown', (e) => {
    if (preview) return;
    if (e.target !== scroller && e.target !== listEl) return;
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'p' && !(last.text || '').trim() && (last.indent || 0) === 0) {
      e.preventDefault();
      focusEnd(last);
    } else {
      e.preventDefault();
      const nb = mk('p');
      blocks.push(nb);
      render(); queueSave(); focusEnd(nb);
    }
  });

  /* ============ anteprima / copia / svuota / titolo ============ */
  btnPreview.addEventListener('click', () => {
    preview = !preview;
    btnPreview.classList.toggle('active', preview);
    btnPreview.title = preview ? 'Torna alla modifica' : 'Anteprima / modifica';
    hintEl.innerHTML = preview
      ? 'Modalità anteprima (sola lettura)'
      : 'Digita <kbd>/</kbd> per i comandi · <kbd>Tab</kbd> annida · selezioni il testo per formattarlo';
    closeSlash(); closeBlockMenu(); hideSelTb();
    render();
  });

  btnCopy.addEventListener('click', () => {
    vscode.postMessage({ type: 'copy', text: toMarkdown() });
    statusEl.textContent = 'Copio…';
  });

  btnClear.addEventListener('click', () => clearPop.classList.toggle('open'));
  document.getElementById('clear-no').addEventListener('click', () => clearPop.classList.remove('open'));
  document.getElementById('clear-yes').addEventListener('click', () => {
    clearPop.classList.remove('open');
    blocks = [mk('p')];
    render(); queueSave();
    const ed = mainEditable(blocks[0]);
    if (ed) ed.focus();
  });

  titleEl.addEventListener('input', () => queueSave());

  /* Escape globale chiude popover */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clearPop.classList.remove('open'); }
  });

  /* ============ messaggi dall'extension host ============ */
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'init') {
      titleEl.textContent = m.title || '';
      const parsed = parseMarkdown(m.text || '');
      blocks = parsed.length ? parsed : [mk('p')];
      render();
      statusEl.textContent = '';
      /* focus sul primo blocco */
      setTimeout(() => {
        const first = mainEditable(blocks[0]);
        if (first) focusEnd(blocks[0]);
      }, 60);
    } else if (m.type === 'saved') {
      statusEl.textContent = 'Salvato ✓';
      clearTimeout(statusEl._t);
      statusEl._t = setTimeout(() => { statusEl.textContent = ''; }, 1600);
    } else if (m.type === 'copied') {
      statusEl.textContent = 'Copiato ✓';
      clearTimeout(statusEl._t);
      statusEl._t = setTimeout(() => { statusEl.textContent = ''; }, 1600);
    }
  });

  /* avvio */
  vscode.postMessage({ type: 'ready' });
})();
