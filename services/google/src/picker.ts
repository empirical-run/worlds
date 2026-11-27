const SHIM = String.raw`(() => {
  const ORIGIN = __ORIGIN__;
  const ViewId = {
    DOCS: "all", DOCS_IMAGES: "docs-images", DOCS_IMAGES_AND_VIDEOS: "docs-images-and-videos",
    DOCS_VIDEOS: "docs-videos", DOCUMENTS: "documents", DRAWINGS: "drawings", FOLDERS: "folders",
    FORMS: "forms", PDFS: "pdfs", PRESENTATIONS: "presentations", RECENTLY_PICKED: "recently-picked",
    SPREADSHEETS: "spreadsheets",
  };
  const Action = { CANCEL: "cancel", PICKED: "picked", LOADED: "loaded", ERROR: "error" };
  const Feature = {
    MINE_ONLY: "mineOnly", MULTISELECT_ENABLED: "multiselectEnabled", NAV_HIDDEN: "navHidden",
    SIMPLE_UPLOAD_ENABLED: "simpleUploadEnabled", SUPPORT_DRIVES: "supportDrives",
    SUPPORT_TEAM_DRIVES: "supportTeamDrives",
  };
  const Response = { ACTION: "action", DOCUMENTS: "docs", PARENTS: "parents", VIEW: "viewToken" };
  const Document = {
    ADDRESS_LINES: "addressLines", AUDIENCE: "audience", DESCRIPTION: "description", DURATION: "duration",
    EMBEDDABLE_URL: "embedUrl", ICON_URL: "iconUrl", ID: "id", IS_NEW: "isNew",
    LAST_EDITED_UTC: "lastEditedUtc", LATITUDE: "latitude", LONGITUDE: "longitude", MIME_TYPE: "mimeType",
    NAME: "name", NUM_CHILDREN: "numChildren", PARENT_ID: "parentId", PHONE_NUMBERS: "phoneNumbers",
    READ_ONLY: "readOnly", SERVICE_ID: "serviceId", THUMBNAILS: "thumbnails", TYPE: "type", URL: "url",
  };
  const Type = {
    ALBUM: "album", DOCUMENT: "document", FOLDER: "folder", LOCATION: "location", PHOTO: "photo",
    SPREADSHEET: "spreadsheet", PRESENTATION: "presentation", URL: "url", VIDEO: "video", FILE: "file",
  };
  const DocsViewMode = { GRID: "grid", LIST: "list" };

  class View {
    constructor(viewId) { this.viewId = viewId || ViewId.DOCS; this.options = {}; }
    getId() { return this.viewId; }
    setMimeTypes(mimeTypes) { this.options.mimeTypes = mimeTypes; return this; }
    setQuery(query) { this.options.query = query; return this; }
  }
  class DocsView extends View {
    setSelectFolderEnabled(enabled) { this.options.selectFolder = enabled; return this; }
    setIncludeFolders(included) { this.options.includeFolders = included; return this; }
    setParent(parent) { this.options.parent = parent; return this; }
    setOwnedByMe(owned) { this.options.ownedByMe = owned; return this; }
    setStarred(starred) { this.options.starred = starred; return this; }
    setMode(mode) { this.options.mode = mode; return this; }
    setEnableDrives(enabled) { this.options.enableDrives = enabled; return this; }
    setFileIds(fileIds) { this.options.fileIds = fileIds; return this; }
  }
  class DocsUploadView extends View {
    constructor() { super("upload"); }
    setIncludeFolders(included) { this.options.includeFolders = included; return this; }
    setParent(parent) { this.options.parent = parent; return this; }
  }

  class Picker {
    constructor(config) { this.config = config; this.visible = false; this.overlay = null; this.listener = null; }
    isVisible() { return this.visible; }
    setCallback(callback) { this.config.callback = callback; return this; }
    setRelayUrl() { return this; }
    setTitle(title) { this.config.title = title; return this; }
    setVisible(visible) {
      if (visible && !this.overlay) { this.open(); }
      if (!visible && this.overlay) { this.close(); }
      return this;
    }
    dispose() { this.close(); }
    open() {
      const overlay = document.createElement("div");
      overlay.setAttribute("data-worlds-picker", "");
      overlay.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(32,33,36,.6);display:flex;align-items:center;justify-content:center";
      const frame = document.createElement("iframe");
      const width = this.config.width || 1051;
      const height = this.config.height || 650;
      frame.style.cssText = "border:0;border-radius:8px;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.3);width:min(" + width + "px,95vw);height:min(" + height + "px,92vh)";
      frame.title = this.config.title || "Google Picker";
      frame.src = ORIGIN + "/picker?origin=" + encodeURIComponent(location.origin);
      overlay.appendChild(frame);
      document.body.appendChild(overlay);
      this.overlay = overlay;
      this.visible = true;
      this.listener = (event) => {
        if (event.origin !== ORIGIN || event.source !== frame.contentWindow || !event.data) { return; }
        const message = event.data;
        if (message.type === "worlds-picker:ready") {
          frame.contentWindow.postMessage({ type: "worlds-picker:config", config: this.serializable() }, ORIGIN);
        } else if (message.type === "worlds-picker:loaded") {
          this.emit({ action: Action.LOADED });
        } else if (message.type === "worlds-picker:result") {
          this.close();
          this.emit(message.data);
        }
      };
      window.addEventListener("message", this.listener);
    }
    close() {
      if (this.listener) { window.removeEventListener("message", this.listener); }
      if (this.overlay) { this.overlay.remove(); }
      this.overlay = null;
      this.listener = null;
      this.visible = false;
    }
    emit(data) {
      const callback = this.config.callback;
      if (typeof callback === "function") { callback.call(this.config.callbackContext || null, data); }
    }
    serializable() {
      const { callback, callbackContext, ...rest } = this.config;
      return {
        ...rest,
        views: rest.views.map((view) => ({ viewId: view.viewId, options: view.options })),
      };
    }
  }

  class PickerBuilder {
    constructor() { this.config = { views: [], features: [] }; }
    addView(view) { this.config.views.push(typeof view === "string" ? new View(view) : view); return this; }
    addViewGroup(group) { for (const view of group.views || []) { this.addView(view); } return this; }
    build() {
      if (this.config.views.length === 0) { this.config.views.push(new DocsView()); }
      return new Picker({ ...this.config, views: [...this.config.views], features: [...this.config.features] });
    }
    disableFeature(feature) { this.config.features = this.config.features.filter((name) => name !== feature); return this; }
    enableFeature(feature) { if (!this.config.features.includes(feature)) { this.config.features.push(feature); } return this; }
    getRelayUrl() { return undefined; }
    getTitle() { return this.config.title; }
    hideTitleBar() { this.config.hideTitleBar = true; return this; }
    isFeatureEnabled(feature) { return this.config.features.includes(feature); }
    setAppId(appId) { this.config.appId = String(appId); return this; }
    setCallback(callback) { this.config.callback = callback; return this; }
    setCallbackContext(context) { this.config.callbackContext = context; return this; }
    setDeveloperKey(key) { this.config.developerKey = key; return this; }
    setDocument() { return this; }
    setLocale(locale) { this.config.locale = locale; return this; }
    setMaxItems(max) { this.config.maxItems = max; return this; }
    setOAuthToken(token) { this.config.oauthToken = token; return this; }
    setOrigin(origin) { this.config.origin = origin; return this; }
    setRelayUrl() { return this; }
    setSelectableMimeTypes(mimeTypes) { this.config.selectableMimeTypes = mimeTypes; return this; }
    setSize(width, height) { this.config.width = width; this.config.height = height; return this; }
    setTitle(title) { this.config.title = title; return this; }
    toUri() { return ORIGIN + "/picker"; }
  }
  class ViewGroup {
    constructor(view) { this.views = [typeof view === "string" ? new View(view) : view]; }
    addLabel() { return this; }
    addView(view) { this.views.push(typeof view === "string" ? new View(view) : view); return this; }
    addViewGroup(group) { this.views.push(...group.views); return this; }
  }

  const picker = {
    Action, Document, DocsUploadView, DocsView, DocsViewMode, Feature, Picker, PickerBuilder,
    Response, Type, View, ViewGroup, ViewId,
  };
  window.google = window.google || {};
  window.google.picker = picker;

  const gapi = window.gapi || {};
  gapi.load = (libraries, done) => {
    const callback = typeof done === "function" ? done : done && done.callback;
    setTimeout(() => { if (callback) { callback(); } }, 0);
  };
  window.gapi = gapi;
})();
`;

export function pickerScript(origin: string): Response {
  return new Response(SHIM.replace("__ORIGIN__", JSON.stringify(origin)), {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

const PAGE_STYLE = `
:root { color-scheme: light; --text: #1f1f1f; --muted: #5f6368; --border: #dadce0; --hover: #f1f3f4; --selected: #c2e7ff; --accent: #0b57d0; --panel: #fff; --skeleton: #e8eaed; font: 14px/20px "Google Sans", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --text: #e3e3e3; --muted: #9aa0a6; --border: #444746; --hover: #2d2f31; --selected: #004a77; --accent: #a8c7fa; --panel: #1f1f1f; --skeleton: #303134; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--panel); }
.picker { display: flex; flex-direction: column; height: 100%; }
header { display: flex; align-items: center; gap: 16px; padding: 16px 24px 8px; }
header h1 { font-size: 22px; line-height: 28px; font-weight: 400; margin: 0; flex: 1; }
.close { border: 0; background: transparent; color: var(--muted); font-size: 22px; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; }
.close:hover { background: var(--hover); }
.toolbar { display: flex; align-items: center; gap: 12px; padding: 4px 24px 12px; border-bottom: 1px solid var(--border); }
.tabs { display: flex; gap: 4px; }
.tab { border: 0; background: transparent; color: var(--muted); font: inherit; padding: 6px 12px; border-radius: 16px; cursor: pointer; }
.tab[aria-selected="true"] { background: var(--selected); color: var(--text); }
.search { margin-left: auto; width: 280px; max-width: 45%; height: 36px; border-radius: 18px; border: 1px solid var(--border); background: var(--hover); color: var(--text); padding: 0 16px; font: inherit; }
.crumbs { padding: 10px 24px 0; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; min-height: 30px; }
.crumbs button { border: 0; background: none; color: var(--accent); font: inherit; padding: 0; cursor: pointer; }
.list { flex: 1; overflow: auto; padding: 8px 12px; }
.row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 180px 110px; align-items: center; gap: 12px; height: 44px; padding: 0 12px; border-radius: 8px; cursor: pointer; user-select: none; }
.row:hover { background: var(--hover); }
.row[aria-selected="true"] { background: var(--selected); }
.row[aria-disabled="true"] { opacity: .45; cursor: default; }
.row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .meta { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { width: 20px; height: 20px; border-radius: 4px; display: grid; place-items: center; font-size: 11px; font-weight: 700; color: #fff; }
.icon.folder { background: #5f6368; border-radius: 0; clip-path: polygon(0 18%, 38% 18%, 48% 30%, 100% 30%, 100% 88%, 0 88%); } .icon.document { background: #4285f4; } .icon.spreadsheet { background: #0f9d58; } .icon.presentation { background: #f4b400; } .icon.file { background: #9aa0a6; }
.skeleton { background: var(--skeleton); border-radius: 4px; height: 12px; }
.state { padding: 48px 24px; text-align: center; color: var(--muted); }
.state.error { color: #d93025; }
footer { display: flex; justify-content: flex-start; gap: 8px; padding: 12px 24px 16px; border-top: 1px solid var(--border); }
footer button { font: inherit; font-weight: 500; height: 36px; padding: 0 24px; border-radius: 18px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--accent); }
footer button.primary { background: var(--accent); border-color: var(--accent); color: var(--panel); }
footer button:disabled { opacity: .4; cursor: default; }
@media (max-width: 640px) { .row { grid-template-columns: 28px minmax(0, 1fr) 90px; } .row .owner { display: none; } .search { width: 100%; max-width: none; margin-left: 0; } .toolbar { flex-wrap: wrap; } }
`;

const PAGE_SCRIPT = String.raw`(() => {
  const params = new URLSearchParams(location.search);
  const parentOrigin = params.get("origin");
  const $ = (selector) => document.querySelector(selector);
  const ui = { title: $("#title"), tabs: $("#tabs"), search: $("#search"), crumbs: $("#crumbs"), list: $("#list"), select: $("#select"), cancel: $("#cancel"), close: $("#close") };
  let config = null;
  let listing = null;
  let failure = null;
  let tab = "mine";
  let folder = null;
  let query = "";
  const selected = new Set();

  const send = (message) => parent.postMessage(message, parentOrigin);
  const escape = (text) => String(text).replace(/[&<>"']/g, (char) => "&#" + char.charCodeAt(0) + ";");
  const multi = () => config.features.includes("multiselectEnabled");
  const maxItems = () => (multi() ? config.maxItems || Infinity : 1);
  const view = () => config.views[0] || { viewId: "all", options: {} };
  const treeMode = () => view().viewId === "folders" || view().options.includeFolders || view().options.selectFolder;
  const selectable = (file) => (file.folder ? view().viewId === "folders" || !!view().options.selectFolder : true);
  const iconFor = (file) => file.folder ? "folder" : file.kind;
  const letters = { folder: "", document: "W", spreadsheet: "S", presentation: "P", file: "F" };

  function visible() {
    if (!listing) { return []; }
    const files = listing.files;
    if (query) {
      const needle = query.toLowerCase();
      return files.filter((file) => file.name.toLowerCase().includes(needle) && (treeMode() || !file.folder));
    }
    if (tab === "shared") { return files.filter((file) => !file.mine && (treeMode() || !file.folder)); }
    if (!treeMode()) { return files.filter((file) => !file.folder && file.mine); }
    const parentId = folder ? folder.id : listing.root_id;
    return files.filter((file) => file.parent_id === parentId);
  }

  function renderCrumbs() {
    if (!treeMode() || query || tab !== "mine") { ui.crumbs.innerHTML = ""; return; }
    const trail = [];
    let current = folder;
    while (current) { trail.unshift(current); current = listing.files.find((file) => file.id === current.parent_id) || null; }
    ui.crumbs.innerHTML = '<button data-crumb="">My Drive</button>' + trail.map((item) => ' › <button data-crumb="' + escape(item.id) + '">' + escape(item.name) + "</button>").join("");
  }

  function render() {
    ui.select.disabled = selected.size === 0;
    if (failure) {
      ui.list.innerHTML = '<div class="state error" role="alert">' + escape(failure) + "</div>";
      return;
    }
    if (!listing) {
      ui.list.innerHTML = Array.from({ length: 6 }, () => '<div class="row" aria-hidden="true"><span class="skeleton" style="width:20px;height:20px"></span><span class="skeleton" style="width:60%"></span><span class="skeleton owner" style="width:70%"></span><span class="skeleton" style="width:60%"></span></div>').join("");
      return;
    }
    renderCrumbs();
    const files = visible();
    if (files.length === 0) {
      ui.list.innerHTML = '<div class="state">' + (query ? "No results" : "No files here") + "</div>";
      return;
    }
    ui.list.innerHTML = files.map((file) => {
      const disabled = !selectable(file) && !(file.folder && treeMode());
      return '<div class="row" role="option" data-id="' + escape(file.id) + '" aria-selected="' + selected.has(file.id) + '" aria-disabled="' + disabled + '"><span class="icon ' + iconFor(file) + '">' + letters[iconFor(file)] + '</span><span class="name">' + escape(file.name) + '</span><span class="meta owner">' + escape(file.mine ? "me" : file.owner) + '</span><span class="meta">' + escape(new Date(file.modified).toLocaleDateString()) + "</span></div>";
    }).join("");
  }

  function toggle(file) {
    if (!selectable(file)) { return; }
    if (selected.has(file.id)) { selected.delete(file.id); }
    else {
      if (selected.size >= maxItems()) { if (maxItems() === 1) { selected.clear(); } else { return; } }
      selected.add(file.id);
    }
    for (const row of ui.list.querySelectorAll(".row[data-id]")) {
      row.setAttribute("aria-selected", String(selected.has(row.dataset.id)));
    }
    ui.select.disabled = selected.size === 0;
  }

  async function api(path, body) {
    const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + config.oauthToken }, body: JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) { throw new Error(json.error && json.error.message ? json.error.message : "The picker couldn't load your files."); }
    return json;
  }

  async function load() {
    render();
    try {
      listing = await api("/picker/api/files", { developerKey: config.developerKey || null, view: view() });
      send({ type: "worlds-picker:loaded" });
    } catch (error) {
      failure = error.message;
    }
    render();
  }

  async function pick() {
    ui.select.disabled = true;
    try {
      const data = await api("/picker/api/pick", { developerKey: config.developerKey || null, appId: config.appId || null, view: view(), ids: [...selected] });
      send({ type: "worlds-picker:result", data });
    } catch (error) {
      failure = error.message;
      render();
    }
  }

  const cancel = () => send({ type: "worlds-picker:result", data: { action: "cancel" } });

  ui.list.addEventListener("click", (event) => {
    const row = event.target.closest(".row[data-id]");
    const file = row && listing.files.find((candidate) => candidate.id === row.dataset.id);
    if (file) { toggle(file); }
  });
  ui.list.addEventListener("dblclick", (event) => {
    const row = event.target.closest(".row[data-id]");
    const file = row && listing.files.find((candidate) => candidate.id === row.dataset.id);
    if (!file) { return; }
    if (file.folder && treeMode()) { folder = file; tab = "mine"; query = ""; ui.search.value = ""; selected.clear(); render(); return; }
    if (selectable(file)) { selected.clear(); selected.add(file.id); pick(); }
  });
  ui.crumbs.addEventListener("click", (event) => {
    const crumb = event.target.closest("button[data-crumb]");
    if (!crumb) { return; }
    folder = crumb.dataset.crumb ? listing.files.find((file) => file.id === crumb.dataset.crumb) : null;
    render();
  });
  ui.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) { return; }
    tab = button.dataset.tab;
    folder = null;
    for (const other of ui.tabs.querySelectorAll("button")) { other.setAttribute("aria-selected", String(other === button)); }
    render();
  });
  ui.search.addEventListener("input", () => { query = ui.search.value.trim(); render(); });
  ui.select.addEventListener("click", pick);
  ui.cancel.addEventListener("click", cancel);
  ui.close.addEventListener("click", cancel);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { cancel(); } });

  window.addEventListener("message", (event) => {
    if (event.origin !== parentOrigin || event.source !== parent || !event.data || event.data.type !== "worlds-picker:config" || config) { return; }
    config = event.data.config;
    if (config.title) { ui.title.textContent = config.title; }
    ui.select.textContent = "Select";
    load();
  });
  render();
  if (parentOrigin) { send({ type: "worlds-picker:ready" }); }
})();`;

export function pickerPage(): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Google Picker</title><style>${PAGE_STYLE}</style></head><body><div class="picker"><header><h1 id="title">Select a file</h1><button class="close" id="close" aria-label="Close">×</button></header><div class="toolbar"><div class="tabs" id="tabs" role="tablist"><button class="tab" data-tab="mine" role="tab" aria-selected="true">My Drive</button><button class="tab" data-tab="shared" role="tab" aria-selected="false">Shared with me</button></div><input class="search" id="search" type="search" placeholder="Search in Drive" aria-label="Search in Drive"></div><nav class="crumbs" id="crumbs" aria-label="Folder"></nav><div class="list" id="list" role="listbox"></div><footer><button class="primary" id="select" disabled>Select</button><button id="cancel">Cancel</button></footer></div><script>${PAGE_SCRIPT}</script></body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-worlds-banner": "off",
      },
    },
  );
}
