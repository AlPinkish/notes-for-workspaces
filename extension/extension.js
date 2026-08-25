const vscode = require('vscode');
const crypto = require('crypto');

const KEY_TEXT  = 'workspaceNotes.markdown';
const KEY_TITLE = 'workspaceNotes.title';

class NotesViewProvider {
  constructor(extensionUri, context) {
    this._uri = extensionUri;
    this._context = context;
  }

  resolveWebviewView(view) {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._uri]
    };
    view.webview.html = this._html(view.webview);

    view.webview.onDidReceiveMessage(async (m) => {
      const ws = this._context.workspaceState;
      switch (m.type) {
        case 'ready':
          view.webview.postMessage({
            type: 'init',
            text:  ws.get(KEY_TEXT)  || '',
            title: ws.get(KEY_TITLE) || ''
          });
          break;
        case 'save':
          await ws.update(KEY_TEXT, m.text);
          await ws.update(KEY_TITLE, m.title || '');
          view.webview.postMessage({ type: 'saved' });
          break;
        case 'copy':
          await vscode.env.clipboard.writeText(m.text);
          view.webview.postMessage({ type: 'copied' });
          break;
        case 'open':
          if (/^https?:\/\//i.test(m.url || '')) {
            try { vscode.env.openExternal(vscode.Uri.parse(m.url)); } catch (_) {}
          }
          break;
      }
    });
  }

  _html(webview) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._uri, 'extension', 'webview.js')
    );
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: 13px;
    color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  button { font-family: inherit; }

  #app { display: flex; flex-direction: column; height: 100vh; position: relative; }

  /* ---------- testata ---------- */
  header { display: flex; align-items: flex-start; gap: 4px; padding: 14px 12px 4px 16px; }
  #title {
    flex: 1; min-width: 0; outline: none; padding: 2px 4px; margin-left: -4px;
    font-size: 19px; font-weight: 700; line-height: 1.3; border-radius: 4px;
  }
  #title:empty::before {
    content: attr(data-ph);
    color: var(--vscode-descriptionForeground); font-weight: 400; opacity: .55;
  }
  .iconbtn {
    background: transparent; border: none; cursor: pointer; padding: 0;
    width: 26px; height: 26px; border-radius: 5px; flex: none;
    display: flex; align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground);
  }
  .iconbtn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.15));
    color: var(--vscode-foreground);
  }
  .iconbtn.active { background: var(--vscode-list-activeSelectionBackground, rgba(128,128,128,.25)); color: var(--vscode-foreground); }
  .iconbtn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  #save-status { font-size: 10.5px; color: var(--vscode-descriptionForeground); padding-top: 8px; min-width: 66px; text-align: right; white-space: nowrap; }

  #hint { padding: 2px 16px 10px; font-size: 10.5px; color: var(--vscode-descriptionForeground); }
  #hint kbd {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 10px;
    background: var(--vscode-input-background, rgba(128,128,128,.1));
    border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 0 4px;
  }

  /* ---------- corpo ---------- */
  #scroller { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; }
  #scroller::-webkit-scrollbar { width: 10px; }
  #scroller::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background); border-radius: 5px;
    border: 2px solid transparent; background-clip: content-box;
  }
  #note-list { position: static; padding: 2px 14px 45vh 30px; min-height: 100%; }

  .block { position: relative; display: flex; align-items: flex-start; margin: 2px 0; }
  .bcontent { flex: 1; min-width: 0; display: flex; align-items: flex-start; }

  .bt {
    flex: 1; min-width: 0; outline: none; padding: 1px 0; line-height: 1.55;
    white-space: pre-wrap; word-break: break-word;
  }
  .bt:focus:empty::before { content: attr(data-ph); color: var(--vscode-descriptionForeground); opacity: .5; }

  /* il testo NON è trascinabile: il drag dei blocchi parte solo dall'handle.
     Senza questa regola, trascinare per selezionare avvia il drag nativo del testo. */
  .bt, .code-area, .math-area, .cell, .img-src, .lcurl {
    -webkit-user-drag: none; user-select: text;
  }
  .handle, .marker, .checkbox, .tarrow, .cicon, .tblbar { -webkit-user-select: none; user-select: none; }

  .block.t-h1 { margin-top: 14px; } .block.t-h1 .bt { font-size: 22px; font-weight: 700; line-height: 1.25; }
  .block.t-h2 { margin-top: 11px; } .block.t-h2 .bt { font-size: 18px; font-weight: 650; line-height: 1.3; }
  .block.t-h3 { margin-top: 8px; }  .block.t-h3 .bt { font-size: 15px; font-weight: 650; }

  .block.t-quote .bcontent { border-left: 3px solid var(--vscode-foreground); padding-left: 10px; opacity: .92; }

  .marker { flex: none; min-width: 18px; padding: 1px 3px 0 0; color: var(--vscode-descriptionForeground); }
  .marker.olm { min-width: 20px; }

  .checkbox {
    flex: none; width: 15px; height: 15px; margin: 4px 8px 0 0; padding: 0; cursor: pointer;
    border: 1.5px solid var(--vscode-descriptionForeground); border-radius: 4px;
    background: transparent; display: flex; align-items: center; justify-content: center;
  }
  .checkbox svg { width: 10px; height: 10px; opacity: 0; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .checkbox.on { background: var(--vscode-focusBorder, #4a7eb5); border-color: var(--vscode-focusBorder, #4a7eb5); }
  .checkbox.on svg { opacity: 1; }
  .block.t-todo.done .bt { text-decoration: line-through; color: var(--vscode-descriptionForeground); }

  .tarrow {
    flex: none; width: 18px; height: 18px; margin: 2px 6px 0 -6px; padding: 0; cursor: pointer;
    background: transparent; border: none; color: var(--vscode-descriptionForeground);
    display: flex; align-items: center; justify-content: center;
  }
  .tarrow svg { width: 11px; height: 11px; fill: currentColor; transition: transform .12s ease; }
  .block.t-toggle:not(.closed) .tarrow svg { transform: rotate(90deg); }

  .callout { display: flex; gap: 9px; padding: 9px 12px; border-radius: 6px; margin: 5px 0; width: 100%; }
  .callout .cicon { flex: none; padding-top: 1px; }
  .callout .cicon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .callout.v-note   { background: rgba(90,140,200,.09);  border-left: 3px solid rgba(90,140,200,.65);  color: #6ea3e0; }
  .callout.v-tip    { background: rgba(90,175,120,.09);  border-left: 3px solid rgba(90,175,120,.65);  color: #66c087; }
  .callout.v-warn   { background: rgba(200,150,60,.10);  border-left: 3px solid rgba(200,150,60,.65);  color: #d3a04f; }
  .callout.v-danger { background: rgba(205,90,80,.10);   border-left: 3px solid rgba(205,90,80,.65);   color: #dd7a6e; }
  .callout .bt { color: var(--vscode-foreground); }

  .block.t-divider { padding: 9px 0; }
  .block.t-divider .bcontent { display: block; width: 100%; }
  .block.t-divider hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 0; }

  .codewrap { width: 100%; margin: 4px 0; border: 1px solid var(--vscode-panel-border); border-radius: 6px; overflow: hidden; background: var(--vscode-textCodeBlock-background, rgba(128,128,128,.08)); }
  .codehead { display: flex; justify-content: flex-end; padding: 3px 6px; border-bottom: 1px solid var(--vscode-panel-border); background: rgba(128,128,128,.06); }
  .codehead select { background: transparent; border: none; outline: none; color: var(--vscode-descriptionForeground); font-size: 10px; cursor: pointer; }
  .langtag { font-size: 10px; color: var(--vscode-descriptionForeground); padding: 1px 3px; }
  .code-area {
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, Consolas, monospace);
    font-size: 12px; line-height: 1.5; padding: 8px 10px; outline: none;
    white-space: pre-wrap; word-break: break-word; min-height: 21px;
  }

  .math-area { width: 100%; text-align: center; padding: 8px 4px; outline: none; white-space: pre-wrap; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 15px; }
  .mathpv { text-align: center; padding: 8px 4px; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 15px; }

  .imgwrap { width: 100%; }
  .imgwrap img { max-width: 100%; border-radius: 5px; display: block; margin: 4px 0; }
  .img-src { font-size: 11px; font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); outline: none; padding: 2px 0; }

  .tblwrap { width: 100%; }
  .tblbar { display: flex; gap: 4px; justify-content: flex-end; margin-bottom: 3px; opacity: 0; transition: opacity .12s; }
  .block:hover .tblbar { opacity: 1; }
  .mini {
    font-size: 10px; padding: 1px 7px; cursor: pointer; border-radius: 4px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-input-background); color: var(--vscode-descriptionForeground);
  }
  .mini:hover { color: var(--vscode-foreground); }
  table.tbl { border-collapse: collapse; width: 100%; margin: 4px 0; }
  .tbl th, .tbl td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; text-align: left; vertical-align: top; }
  .tbl th { background: rgba(128,128,128,.09); font-weight: 600; }
  .cell { outline: none; min-width: 30px; }

  .linkcard { display: flex; flex-direction: column; gap: 2px; padding: 8px 11px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin: 4px 0; text-decoration: none; color: var(--vscode-textLink-foreground); }
  .linkcard svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.4; }
  .lcurl { font-size: 10px; color: var(--vscode-descriptionForeground); }

  .bt a, .tbl a { color: var(--vscode-textLink-foreground); }
  .bt code, .tbl code { font-family: var(--vscode-editor-font-family, monospace); font-size: .92em; background: rgba(128,128,128,.14); border-radius: 3px; padding: 1px 4px; }
  .bt mark { background: var(--vscode-editor-findMatchHighlightBackground, rgba(255,213,0,.35)); color: inherit; border-radius: 2px; }
  .bt del { opacity: .6; }

  /* ---------- handle blocco ---------- */
  .handle {
    position: absolute; left: -20px; top: 1px; width: 17px; height: 20px; padding: 0;
    border: none; background: transparent; cursor: grab; opacity: 0;
    display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground);
  }
  .block:hover > .handle { opacity: .55; }
  .handle:hover { opacity: 1 !important; }
  .handle svg { width: 12px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }

  /* ---------- menu '/' ---------- */
  #slash-menu, #block-menu {
    position: absolute; z-index: 60; display: none; width: 280px; max-height: 330px; overflow-y: auto;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,.3); padding: 4px 0;
  }
  #slash-menu.open, #block-menu.open { display: block; }
  #block-menu { width: 216px; }
  .sgroup { font-size: 10px; text-transform: uppercase; letter-spacing: .07em; color: var(--vscode-descriptionForeground); padding: 8px 12px 3px; }
  .sitem { display: flex; gap: 10px; align-items: center; padding: 5px 10px; cursor: pointer; }
  .sitem.sel { background: var(--vscode-list-hoverBackground); border-radius: 5px; }
  .sicon { flex: none; width: 30px; height: 30px; border: 1px solid var(--vscode-panel-border); border-radius: 5px; display: flex; align-items: center; justify-content: center; color: var(--vscode-descriptionForeground); background: rgba(128,128,128,.06); }
  .sicon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linecap: round; stroke-linejoin: round; }
  .stxt { min-width: 0; }
  .slabel { display: block; font-size: 12.5px; }
  .sdesc { display: block; font-size: 10.5px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .snone { padding: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
  .bmitem { display: flex; gap: 9px; align-items: center; padding: 6px 12px; font-size: 12px; cursor: pointer; }
  .bmitem:hover { background: var(--vscode-list-hoverBackground); }
  .bmitem.danger { color: var(--vscode-errorForeground, #e5534b); }
  .bmi svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }

  /* ---------- toolbar selezione ---------- */
  #sel-toolbar {
    position: fixed; z-index: 70; display: none; gap: 2px; padding: 2px;
    background: var(--vscode-editorWidget-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px; box-shadow: 0 6px 18px rgba(0,0,0,.3);
  }
  #sel-toolbar.open { display: flex; }
  .fbtn { min-width: 25px; height: 24px; border: none; background: transparent; color: var(--vscode-foreground); border-radius: 4px; cursor: pointer; font-size: 12.5px; display: flex; align-items: center; justify-content: center; }
  .fbtn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.18)); }
  .fbtn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }

  /* ---------- conferma svuota ---------- */
  #clear-pop {
    position: absolute; top: 46px; right: 14px; z-index: 80; display: none; width: 210px;
    background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,.3); padding: 12px; font-size: 12px;
  }
  #clear-pop.open { display: block; }
  #clear-pop .row { display: flex; gap: 6px; margin-top: 10px; justify-content: flex-end; }
  #clear-pop button { font-size: 11.5px; padding: 3px 10px; border-radius: 5px; cursor: pointer; border: 1px solid var(--vscode-panel-border); background: var(--vscode-input-background); color: var(--vscode-foreground); }
  #clear-pop .danger { background: var(--vscode-errorForeground, #c4392f); border-color: transparent; color: #fff; }
</style>
</head>
<body>
  <div id="app">
    <header>
      <div id="title" contenteditable="plaintext-only" data-ph="Senza titolo"></div>
      <button class="iconbtn" id="btn-preview" title="Anteprima / modifica">
        <svg viewBox="0 0 16 16"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>
      </button>
      <button class="iconbtn" id="btn-copy" title="Copia tutta la nota (markdown)">
        <svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 3H4.2A1.2 1.2 0 0 0 3 4.2v6.3"/></svg>
      </button>
      <button class="iconbtn" id="btn-clear" title="Svuota la nota">
        <svg viewBox="0 0 16 16"><path d="M2.5 4h11M6.2 4V2.5h3.6V4M4 4l.7 9.5h6.6L12 4M6.5 7v4M9.5 7v4"/></svg>
      </button>
      <span id="save-status"></span>
    </header>
    <div id="hint">Digita <kbd>/</kbd> per i comandi · <kbd>Tab</kbd> annida · selezioni il testo per formattarlo</div>
    <div id="scroller">
      <div id="note-list"></div>
      <div id="slash-menu"></div>
      <div id="block-menu"></div>
    </div>
    <div id="clear-pop">
      Svuotare tutto il blocco note?
      <div class="row">
        <button id="clear-no">Annulla</button>
        <button id="clear-yes" class="danger">Svuota</button>
      </div>
    </div>
  </div>
  <div id="sel-toolbar">
    <button class="fbtn" data-f="b" title="Grassetto **"><b>B</b></button>
    <button class="fbtn" data-f="i" title="Corsivo *"><i>I</i></button>
    <button class="fbtn" data-f="s" title="Barrato ~~"><s>S</s></button>
    <button class="fbtn" data-f="code" title="Codice \`"><svg viewBox="0 0 16 16"><path d="M6 4L2.5 8 6 12M10 4l3.5 4L10 12"/></svg></button>
    <button class="fbtn" data-f="hl" title="Evidenziato =="><svg viewBox="0 0 16 16"><path d="M3 13l.8-3 7.4-7.4 2.2 2.2L6 12.2z"/><path d="M9.5 4.5l2 2"/></svg></button>
    <button class="fbtn" data-f="link" title="Link"><svg viewBox="0 0 16 16"><path d="M6.5 9.5l3-3"/><path d="M5.6 7.2L4.4 8.4a2.4 2.4 0 0 0 3.4 3.4l1.2-1.2"/><path d="M10.4 8.8l1.2-1.2a2.4 2.4 0 0 0-3.4-3.4L7 5.4"/></svg></button>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new NotesViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('workspaceNotes.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('workspaceNotes.open', () =>
      vscode.commands.executeCommand('workspaceNotes.panel.focus')
    )
  );
}

function deactivate() {}

module.exports = { activate, deactivate };