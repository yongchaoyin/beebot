/*
 * Settings → Servers. Keep connection management out of the conversation surface.
 * This readable adapter is embedded by router-renderer-patch.mjs in the pinned
 * renderer. No local onboarding flags, credentials, Bot identities or model
 * settings are created here. The trusted main-process bridge remains authoritative.
 */
(function () {
  if (window.__beebotNodeWorkbenchBound) return;
  window.__beebotNodeWorkbenchBound = true;

  const t = (cn, en) => window.__sandUiLanguage === "zh" ? cn : en;
  const api = () => window.desktop?.nodes;
  const element = (tag, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };
  const icon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const paths = {
      server: "M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 10h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2ZM7 7h.01M7 17h.01M11 7h6M11 17h6",
      shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
      arrow: "M5 12h14m-5-5 5 5-5 5",
      bot: "M8 7h8a4 4 0 0 1 4 4v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a4 4 0 0 1 4-4Zm4 0V3m-2 0h4M8 12h.01M16 12h.01M9 16h6M4 12H2m18 0h2",
      browser: "M4 4h16v16H4V4Zm0 5h16M7 6.5h.01M10 6.5h.01",
    };
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", paths[name] || paths.server);
    svg.append(path);
    return svg;
  };

  // UX validation mirrors transport.normalizeNodeUrl; it is not authorization.
  function validateAddress(raw) {
    if (!raw.trim()) return t("请填写服务器地址。", "Enter a server address.");
    if (raw.length > 2048) return t("服务器地址过长。", "The server address is too long.");
    let url;
    try { url = new URL(raw.trim()); }
    catch { return t("请输入完整地址，例如 https://bot.example.com。", "Enter a full address, such as https://bot.example.com."); }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      return t("远端服务器需要 HTTPS；HTTP 仅限 localhost、127.0.0.1 或 [::1]。", "Use HTTPS for remote servers. HTTP is allowed only for localhost, 127.0.0.1 or [::1].");
    }
    if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
      return t("只填写服务器地址和端口，不要包含路径、账号、密码或查询参数。", "Use the server origin and port only, without a path, credentials, query or fragment.");
    }
    return "";
  }

  function errorDetail(error) {
    // Render as text, limit length and redact common credential-bearing formats.
    return String(error?.message || error || "")
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
      .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
      .replace(/((?:access_token|refresh_token|api_key|code|state)=)[^&\s]+/gi, "$1[redacted]")
      .slice(0, 400);
  }

  function installStyle() {
    if (document.getElementById("beebot-node-style")) return;
    const css = element("style");
    css.id = "beebot-node-style";
    css.textContent = `
      #beebot-node-workbench{--bb-line:var(--cursor-stroke-secondary, #8884);--bb-muted:var(--cursor-text-secondary, GrayText);--bb-surface:var(--cursor-bg-secondary, transparent);--bb-accent:var(--cursor-accent, #3477c9);--bb-danger:var(--cursor-text-red-primary, #c84452);color:inherit;font:inherit;font-size:13px;line-height:1.55;min-width:0;max-width:720px;width:100%;container-type:inline-size;container-name:bb-server-panel;box-sizing:border-box;-webkit-app-region:no-drag}
      #beebot-node-workbench *{box-sizing:border-box}
      #beebot-node-workbench [hidden]{display:none!important}
      #beebot-node-workbench h2,#beebot-node-workbench h3,#beebot-node-workbench p{margin:0}
      #beebot-node-workbench h2{font-size:19px;line-height:1.35;letter-spacing:-.35px;font-weight:620}
      #beebot-node-workbench h3{font-size:13px;font-weight:600}
      #beebot-node-workbench svg{display:block;width:18px;height:18px;flex:none}
      #beebot-node-workbench button,#beebot-node-workbench input,#beebot-node-workbench select{font:inherit;color:inherit;-webkit-app-region:no-drag}
      #beebot-node-workbench button{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--bb-surface);border:1px solid var(--bb-line);border-radius:8px;padding:7px 12px;min-height:36px;cursor:pointer;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease}
      #beebot-node-workbench button:hover:not(:disabled){background:color-mix(in srgb,currentColor 6%,transparent);border-color:color-mix(in srgb,currentColor 24%,transparent)}
      #beebot-node-workbench button:disabled{opacity:.5;cursor:default}
      #beebot-node-workbench :is(button,input,select):focus-visible{outline:2px solid var(--bb-accent);outline-offset:3px}
      #beebot-node-workbench .bb-primary{background:var(--cursor-text-primary,CanvasText);border-color:var(--cursor-text-primary,CanvasText);color:var(--cursor-bg-primary,Canvas);font-weight:550}
      #beebot-node-workbench .bb-primary:hover:not(:disabled){background:var(--cursor-text-primary,CanvasText);border-color:var(--cursor-text-primary,CanvasText);box-shadow:0 0 0 3px color-mix(in srgb,CanvasText 10%,transparent)}
      #beebot-node-workbench .bb-quiet{background:transparent;border-color:transparent;color:var(--bb-muted)}
      #beebot-node-workbench .bb-danger{color:var(--bb-danger)}
      #beebot-node-workbench input,#beebot-node-workbench select{width:100%;min-width:0;max-width:100%;border:1px solid var(--bb-line);border-radius:8px;background:var(--cursor-bg-input,Canvas);padding:9px 11px;min-height:38px}
      #beebot-node-workbench input[aria-invalid="true"]{border-color:var(--bb-danger)}
      #beebot-node-workbench .bb-intro{display:grid;gap:7px;margin-bottom:23px}
      #beebot-node-workbench .bb-muted{color:var(--bb-muted);font-size:12px;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-steps{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:9px;color:var(--bb-muted);font-size:11px}
      #beebot-node-workbench .bb-step{display:inline-flex;align-items:center;gap:6px}
      #beebot-node-workbench .bb-step-number{display:grid;place-items:center;width:19px;height:19px;border:1px solid var(--bb-line);border-radius:50%;font-size:10px;font-variant-numeric:tabular-nums}
      #beebot-node-workbench .bb-step-divider{height:1px;width:20px;background:var(--bb-line)}
      #beebot-node-workbench .bb-picker{display:grid;gap:7px;margin-bottom:12px}
      #beebot-node-workbench label{display:block;font-weight:550;font-size:12px}
      #beebot-node-workbench .bb-card{border:1px solid var(--bb-line);border-radius:12px;overflow:hidden;background:var(--bb-surface)}
      #beebot-node-workbench .bb-identity{padding:17px 18px;display:flex;align-items:center;gap:12px;min-width:0}
      #beebot-node-workbench .bb-server-icon{display:grid;place-items:center;width:40px;height:40px;flex:none;border:1px solid var(--bb-line);border-radius:11px;background:color-mix(in srgb,currentColor 3%,transparent)}
      #beebot-node-workbench .bb-identity-text{flex:1;min-width:0;display:grid;gap:3px}
      #beebot-node-workbench .bb-server-name{font-size:14px;font-weight:600;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-server-url{font-size:11px;color:var(--bb-muted);overflow-wrap:anywhere}
      #beebot-node-workbench .bb-status{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:11px;padding:4px 8px;border:1px solid var(--bb-line);border-radius:6px;white-space:nowrap}
      #beebot-node-workbench .bb-status::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
      #beebot-node-workbench .bb-status[data-state="online"]{color:var(--cursor-text-green-primary,#23734f);background:color-mix(in srgb,currentColor 5%,transparent)}
      #beebot-node-workbench .bb-status[data-state="reconnecting"]{color:var(--cursor-text-yellow-primary,#946621)}
      #beebot-node-workbench .bb-status[data-state="connecting"]::before{width:8px;height:8px;background:none;border:1.5px solid currentColor;border-right-color:transparent;animation:bb-node-spin 1s linear infinite}
      #beebot-node-workbench .bb-card-body{padding:0 18px 17px;display:grid;gap:13px}
      #beebot-node-workbench .bb-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #beebot-node-workbench .bb-actions-end{margin-inline-start:auto;display:flex;gap:3px;flex-wrap:wrap}
      #beebot-node-workbench .bb-confirm{padding:15px 18px;border-top:1px solid var(--bb-line);display:grid;gap:10px;background:color-mix(in srgb,currentColor 3%,transparent)}
      #beebot-node-workbench .bb-add-toggle{margin-top:11px}
      #beebot-node-workbench .bb-add-form{padding:18px;margin-top:12px;border:1px solid var(--bb-line);border-radius:12px;display:grid;gap:10px}
      #beebot-node-workbench .bb-add-line{display:flex;align-items:flex-start;gap:8px;min-width:0}
      #beebot-node-workbench .bb-address-field{flex:1;min-width:0}
      #beebot-node-workbench .bb-add-line button{min-height:38px;white-space:nowrap}
      #beebot-node-workbench .bb-field-error{font-size:12px;color:var(--bb-danger);margin-top:6px;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-trust{display:flex;align-items:flex-start;gap:7px;font-size:11px;color:var(--bb-muted)}
      #beebot-node-workbench .bb-trust svg{width:15px;height:15px;margin-top:2px}
      #beebot-node-workbench .bb-notice{padding:12px 14px;margin:12px 0 0;border:1px solid var(--bb-line);border-radius:9px;display:grid;gap:5px;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-notice[data-tone="error"]{border-color:color-mix(in srgb,var(--bb-danger) 35%,transparent)}
      #beebot-node-workbench .bb-notice-title{font-size:12px;font-weight:550}
      #beebot-node-workbench .bb-notice-detail{color:var(--bb-muted);font-size:11px;white-space:pre-wrap}
      #beebot-node-workbench .bb-notice button{justify-self:start;font-size:12px;min-height:30px;padding:4px 9px}
      #beebot-node-workbench .bb-bots-section{margin-top:25px;padding-top:21px;border-top:1px solid var(--bb-line)}
      #beebot-node-workbench .bb-bots-heading{display:flex;gap:8px;align-items:center;margin-bottom:5px}
      #beebot-node-workbench .bb-count{font-size:10px;font-variant-numeric:tabular-nums;border:1px solid var(--bb-line);border-radius:5px;padding:0 5px;color:var(--bb-muted)}
      #beebot-node-workbench .bb-bots-list{margin-top:13px;display:grid;gap:7px}
      #beebot-node-workbench .bb-node-bot{display:flex;width:100%;min-width:0;text-align:start;justify-content:flex-start;padding:11px 12px;border-radius:9px}
      #beebot-node-workbench .bb-node-bot>.bb-bot-glyph{width:30px;height:30px;border:1px solid var(--bb-line);border-radius:9px;display:grid;place-items:center;flex:none}
      #beebot-node-workbench .bb-bot-glyph.bb-bot-persona{background:transparent;border:0}
      #beebot-node-workbench .bb-bot-glyph.bb-bot-persona svg{width:32px;height:32px}
      #beebot-node-workbench .bb-bot-copy{display:grid;gap:2px;min-width:0;flex:1}
      #beebot-node-workbench .bb-bot-name{font-weight:550;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-bot-description{color:var(--bb-muted);font-size:11px;font-weight:400;overflow-wrap:anywhere}
      #beebot-node-workbench .bb-node-bot>svg{color:var(--bb-muted);width:15px;height:15px}
      #beebot-node-workbench .bb-empty{border:1px dashed var(--bb-line);border-radius:10px;padding:22px 16px;margin-top:13px;display:grid;justify-items:center;text-align:center;gap:7px}
      #beebot-node-workbench .bb-empty>svg{color:var(--bb-muted);width:25px;height:25px;margin-bottom:3px}
      #beebot-node-workbench .bb-empty-title{font-size:12px;font-weight:550}
      #beebot-node-workbench .bb-sync{font-size:10px;color:var(--bb-muted);margin-top:10px;min-height:16px}
      #beebot-node-workbench .bb-live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
      @keyframes bb-node-spin{to{transform:rotate(360deg)}}
      @media(max-width:520px){#beebot-node-workbench .bb-identity{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:start;padding:14px}#beebot-node-workbench .bb-status{grid-column:2;justify-self:start;margin-inline-start:0}#beebot-node-workbench .bb-card-body{padding:0 14px 14px}#beebot-node-workbench .bb-add-line{flex-direction:column}#beebot-node-workbench .bb-address-field{width:100%}#beebot-node-workbench .bb-add-line button{width:100%}#beebot-node-workbench .bb-actions-end{margin-inline-start:0}#beebot-node-workbench .bb-add-form{padding:14px}}
      @container bb-server-panel (max-width:440px){#beebot-node-workbench .bb-identity{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:start}#beebot-node-workbench .bb-status{grid-column:2;justify-self:start;margin-inline-start:0}#beebot-node-workbench .bb-add-line{flex-direction:column}#beebot-node-workbench .bb-address-field,#beebot-node-workbench .bb-add-line button{width:100%}#beebot-node-workbench .bb-steps{display:grid;gap:7px}#beebot-node-workbench .bb-step-divider{display:none}#beebot-node-workbench .bb-actions-end{margin-inline-start:0}}
      @media(prefers-reduced-motion:reduce){#beebot-node-workbench *{animation:none!important;transition:none!important}}
      @media(forced-colors:active){#beebot-node-workbench .bb-primary{background:ButtonFace;color:ButtonText}#beebot-node-workbench .bb-status::before{background:CanvasText}#beebot-node-workbench .bb-card{border-color:CanvasText}}
    `;
    document.head.append(css);
  }

  window.__beebotMountServersSettings = function (host, { onOpenBot } = {}) {
    if (!api() || !host) return;
    window.__beebotCloseNodeWorkbench?.();
    installStyle();

    const bridge = api();
    const request = (action, data = {}) => bridge.request({ action, ...data });
    let alive = true, profiles = [], selected = "", initialized = false;
    let snapshot = null, snapshotOwner = "", syncedAt = 0, snapshotError = false;
    let generation = 0, listPending = false, listAgain = false, loading = true, profilesTrusted = false;
    let operation = null, confirmation = null, notice = null, showAdd = false;
    let timer, poll, unsubscribe, pickerSignature = "";
    const pendingSnapshots = new Map();
    const botRows = new Map();
    const translations = [];
    const root = element("section");
    root.id = "beebot-node-workbench";
    const text = (tag, cn, en, cls) => {
      const node = element(tag, cls);
      translations.push(() => { node.textContent = t(cn, en); });
      node.textContent = t(cn, en);
      return node;
    };
    const button = (cn, en, action, cls) => {
      const node = text("button", cn, en, cls);
      node.type = "button";
      node.onclick = action;
      return node;
    };
    const current = () => profiles.find(p => p.id === selected);
    const currentKey = () => {
      const p = current();
      return p ? `${p.id}\u0000${p.nodeId || ""}\u0000${p.baseUrl}` : "";
    };
    const close = () => {
      if (!alive) return;
      alive = false;
      operation?.abort?.abort();
      generation++;
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe?.();
      window.removeEventListener("sand-ui-language-changed", localize);
      root.remove();
      if (window.__beebotCloseNodeWorkbench === close) delete window.__beebotCloseNodeWorkbench;
    };
    window.__beebotCloseNodeWorkbench = close;

    const intro = element("header", "bb-intro");
    intro.append(text("h2", "服务器连接", "Server connections"));
    intro.append(text("p", "Bot 在服务器上工作，你在这里保持联系。", "Your Bots work on their server. Stay connected from here.", "bb-muted"));
    const steps = element("div", "bb-steps");
    [["添加服务器", "Add a server"], ["浏览器登录", "Sign in securely"], ["回到 Bot", "Return to your Bots"]].forEach(([cn, en], index) => {
      if (index) steps.append(element("span", "bb-step-divider"));
      const step = element("span", "bb-step");
      const number = element("span", "bb-step-number");
      number.textContent = String(index + 1);
      step.append(number, text("span", cn, en));
      steps.append(step);
    });
    intro.append(steps);

    const pickerBox = element("div", "bb-picker");
    const pickerLabel = text("label", "选择服务器", "Select server");
    pickerLabel.htmlFor = "bb-node-picker";
    const picker = element("select");
    picker.id = "bb-node-picker";
    pickerBox.append(pickerLabel, picker);

    const card = element("div", "bb-card");
    const identity = element("div", "bb-identity");
    const serverIcon = element("span", "bb-server-icon"); serverIcon.append(icon("server"));
    const identityText = element("div", "bb-identity-text");
    const serverName = element("div", "bb-server-name");
    const serverUrl = element("div", "bb-server-url");
    const status = element("span", "bb-status");
    identityText.append(serverName, serverUrl);
    identity.append(serverIcon, identityText, status);
    const cardBody = element("div", "bb-card-body");
    const statusHelp = element("p", "bb-muted");
    const actions = element("div", "bb-actions");
    const auth = button("登录", "Sign in", () => void run("login"), "bb-primary");
    const reconnect = button("重新连接", "Reconnect", () => void run("resume"));
    const cancelLogin = button("取消登录", "Cancel sign-in", () => void run("cancel-login"));
    const actionsEnd = element("div", "bb-actions-end");
    const logout = button("退出登录", "Sign out", () => confirm("logout"), "bb-quiet");
    const remove = button("移除连接", "Remove", () => confirm("remove"), "bb-quiet");
    actionsEnd.append(logout, remove);
    actions.append(auth, reconnect, cancelLogin, actionsEnd);
    cardBody.append(statusHelp, actions);

    const confirmBox = element("div", "bb-confirm");
    confirmBox.setAttribute("role", "group");
    confirmBox.setAttribute("aria-labelledby", "bb-node-confirm-title");
    const confirmTitle = element("h3"); confirmTitle.id = "bb-node-confirm-title";
    const confirmBody = element("p", "bb-muted");
    const confirmActions = element("div", "bb-actions");
    const keep = button("取消", "Cancel", cancelConfirmation);
    const proceed = button("确认", "Confirm", () => {
      const intent = confirmation;
      if (!intent || intent.key !== currentKey()) return;
      confirmation = null;
      void run(intent.kind);
    }, "bb-danger");
    confirmActions.append(keep, proceed);
    confirmBox.append(confirmTitle, confirmBody, confirmActions);
    card.append(identity, cardBody, confirmBox);

    const addToggle = button("＋ 添加其他服务器", "+ Add another server", () => {
      showAdd = !showAdd;
      update();
      if (showAdd) address.focus();
    }, "bb-quiet bb-add-toggle");
    addToggle.setAttribute("aria-controls", "bb-node-add-form");
    const form = element("form", "bb-add-form");
    form.id = "bb-node-add-form";
    form.noValidate = true;
    const addressLabel = text("label", "服务器地址", "Server address");
    addressLabel.htmlFor = "bb-node-address";
    const addLine = element("div", "bb-add-line");
    const addressField = element("div", "bb-address-field");
    const address = element("input");
    address.id = "bb-node-address";
    address.type = "url";
    address.placeholder = "https://bot.example.com";
    address.autocomplete = "url";
    address.spellcheck = false;
    address.maxLength = 2048;
    address.setAttribute("autocapitalize", "none");
    address.setAttribute("aria-describedby", "bb-node-address-help bb-node-address-error");
    const fieldError = element("p", "bb-field-error");
    fieldError.id = "bb-node-address-error";
    fieldError.setAttribute("aria-live", "polite");
    const add = button("添加服务器", "Add server", () => {} , "bb-primary");
    add.type = "submit";
    addressField.append(address, fieldError);
    addLine.append(addressField, add);
    const addressHelp = text("p", "填写你信任的 BeeBot 服务器地址，本机模型与 Docker 无需在此配置。", "Use a BeeBot server you trust. No local model or Docker setup is needed here.", "bb-muted");
    addressHelp.id = "bb-node-address-help";
    const trust = element("p", "bb-trust");
    trust.append(icon("shield"), text("span", "登录将在系统浏览器中完成；不要在地址里粘贴密钥。", "Sign-in opens in your system browser. Never paste credentials into the address."));
    form.append(addressLabel, addLine, addressHelp, trust);
    form.onsubmit = event => {
      event.preventDefault();
      if (operation || loading) return;
      const problem = validateAddress(address.value);
      fieldError.textContent = problem;
      address.setAttribute("aria-invalid", String(!!problem));
      if (problem) { address.focus(); return; }
      void run("add", { address: new URL(address.value.trim()).origin });
    };
    address.oninput = () => {
      fieldError.textContent = "";
      address.removeAttribute("aria-invalid");
      update();
    };

    const noticeBox = element("div", "bb-notice");
    const noticeTitle = element("p", "bb-notice-title");
    const noticeDetail = element("p", "bb-notice-detail");
    const retry = button("刷新连接状态", "Refresh connection status", () => {
      notice = null;
      snapshotError = false;
      invalidate(false);
      void refresh();
    });
    noticeBox.append(noticeTitle, noticeDetail, retry);
    const live = element("p", "bb-live"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");

    const bots = element("section", "bb-bots-section");
    const botsHeading = element("div", "bb-bots-heading");
    const botsTitle = text("h3", "此服务器上的 Bot", "Bots on this server");
    botsTitle.id = "bb-node-bots-title";
    bots.setAttribute("aria-labelledby", botsTitle.id);
    const count = element("span", "bb-count"); count.setAttribute("aria-hidden", "true");
    botsHeading.append(botsTitle, count);
    const botsHelp = text("p", "在左侧列表上方 + → 新建 Bot 中选择部署服务器。", "Choose a deployment server from + → New bot above the Bot list.", "bb-muted");
    const botList = element("div", "bb-bots-list");
    const empty = element("div", "bb-empty");
    const emptyTitle = element("p", "bb-empty-title"), emptyHelp = element("p", "bb-muted");
    empty.append(icon("bot"), emptyTitle, emptyHelp);
    const sync = element("p", "bb-sync");
    bots.append(botsHeading, botsHelp, botList, empty, sync);
    root.append(intro, pickerBox, card, addToggle, form, noticeBox, bots, live);
    host.append(root);

    function invalidate(clearNotice = true) {
      operation?.abort?.abort();
      generation++;
      profilesTrusted = false;
      snapshot = null;
      snapshotOwner = "";
      syncedAt = 0;
      snapshotError = false;
      if (clearNotice) notice = null;
      confirmation = null;
      update();
    }

    function confirm(kind) {
      if (operation || !profilesTrusted || !current()) return;
      confirmation = { kind, key: currentKey(), name: current().name };
      update();
      keep.focus();
    }

    function cancelConfirmation() {
      const kind = confirmation?.kind;
      confirmation = null;
      update();
      if (kind) (kind === "remove" ? remove : logout).focus();
    }

    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && confirmation) {
        event.preventDefault();
        event.stopPropagation();
        cancelConfirmation();
      }
    });

    function setNotice(cn, en, detail = "", tone = "error", canRetry = false) {
      notice = { cn, en, detail: errorDetail(detail), tone, canRetry };
    }

    async function run(kind, data = {}) {
      if (!alive || (operation && !(kind === "cancel-login" && operation.kind === "login"))) return;
      const p = current();
      if (kind !== "add" && (!p || (!profilesTrusted && kind !== "cancel-login"))) return;
      const op = { kind, id: p?.id, key: currentKey() };
      operation = op;
      confirmation = null;
      notice = null;
      invalidate(false);
      update();
      let succeeded = false;
      try {
        const result = await request(kind === "cancel-login" ? "logout" : kind, kind === "add" ? data : { id: op.id });
        if (!alive || operation !== op) return;
        succeeded = true;
        if (kind === "add") {
          if (!result || typeof result.id !== "string") throw new Error(t("服务器没有返回有效的连接。", "The server did not return a valid connection."));
          selected = result.id;
          initialized = true;
          address.value = "";
          showAdd = false;
          if (result.status === "online") {
            setNotice("已选择现有连接，未重复添加服务器。", "Existing connection selected. No duplicate server was added.", "", "info");
          } else {
            setNotice("服务器已添加，接下来请在浏览器中登录。", "Server added. Next, sign in with your browser.", "", "info");
          }
        } else if (kind === "remove") {
          selected = ""; // Never silently choose a different server after removal.
          if (result?.remoteRevoked === false) {
            setNotice("本机连接已移除，但服务器会话尚未撤销。", "Connection removed locally, but its server session was not revoked.", t("请在该服务器上撤销此设备会话。Bot 与运行中的任务没有被删除。", "Revoke this device session on that server. Its Bots and running tasks were not deleted."), "warning");
          } else {
            setNotice("连接已移除，服务器上的 Bot 与任务保持不变。", "Connection removed. Its Bots and tasks remain on the server.", "", "info");
          }
        } else if (kind === "logout" || kind === "cancel-login") {
          setNotice(kind === "logout" ? "已退出这台服务器。" : "登录已取消，可以重新登录。", kind === "logout" ? "Signed out of this server." : "Sign-in cancelled. You can try again.", "", "info");
        }
      } catch (error) {
        if (!alive || operation !== op) return;
        succeeded = false;
        const titles = {
          add: ["无法添加服务器，请检查地址与服务版本。", "Could not add this server. Check its address and version."],
          login: ["登录未完成，请重试。", "Sign-in did not complete. Please try again."],
          "cancel-login": ["未能确认登录已取消。", "Could not confirm that sign-in was cancelled."],
          resume: ["连接尚未恢复，任务状态没有被改写。", "The connection has not recovered. Task states were not changed."],
          logout: ["退出未完成，服务器会话可能仍然有效。", "Sign-out did not complete. The server session may still be active."],
          remove: ["移除未完成，本机连接仍被保留。", "Removal did not complete. The local connection was retained."],
        };
        setNotice(...titles[kind], error);
      } finally {
        if (alive && operation === op) {
          operation = null;
          invalidate(false);
          update();
          await refresh();
          if (alive && succeeded && kind === "add" && current()?.id === selected && current()?.status === "signed-out") auth.focus();
          if (alive && succeeded && kind === "remove") (profiles.length ? picker : address).focus();
          if (alive && succeeded && kind === "cancel-login" && !auth.hidden) auth.focus();
        }
      }
    }

    function statusText(p) {
      if (!p) return "";
      if (operation?.id === p.id) {
        const labels = {
          login: t("等待浏览器授权", "Waiting for sign-in"),
          "cancel-login": t("正在取消登录", "Cancelling sign-in"),
          resume: t("正在重新连接", "Reconnecting"),
          logout: t("正在退出", "Signing out"),
          remove: t("正在移除", "Removing connection"),
          open: t("正在打开 Bot", "Opening Bot"),
        };
        if (labels[operation.kind]) return labels[operation.kind];
      }
      return ({
        "signed-out": t("未登录", "Signed out"),
        connecting: t("正在连接", "Connecting"),
        online: t("已连接", "Connected"),
        reconnecting: t("连接中断", "Reconnecting"),
      })[p.status] || t("状态未知", "Unknown status");
    }

    function update() {
      if (!alive) return;
      const p = current(), busy = !!operation, signingIn = operation?.kind === "login";
      root.setAttribute("aria-label", t("服务器管理", "Servers"));
      picker.setAttribute("aria-label", t("选择服务器", "Select server"));
      address.setAttribute("aria-label", t("服务器地址", "Server address"));
      steps.hidden = profiles.some(item => item.status === "online");
      pickerBox.hidden = profiles.length === 0;
      picker.disabled = busy;
      const signature = JSON.stringify([window.__sandUiLanguage, profiles.map(item => [item.id, item.name, item.status])]);
      if (signature !== pickerSignature) {
        pickerSignature = signature;
        const placeholder = element("option"); placeholder.value = ""; placeholder.textContent = t("请选择服务器", "Choose a server");
        picker.replaceChildren(placeholder);
        for (const item of profiles) {
          const option = element("option"); option.value = item.id; option.textContent = `${item.name} · ${statusText(item)}`;
          picker.append(option);
        }
      }
      picker.value = selected;
      card.hidden = !p;
      if (p) {
        serverName.textContent = p.name;
        serverUrl.textContent = p.baseUrl;
        status.textContent = statusText(p);
        status.dataset.state = signingIn ? "connecting" : p.status;
        statusHelp.textContent = signingIn
          ? t("请在系统浏览器中完成授权。未出现登录页时，可取消后重试。", "Complete sign-in in your system browser. No sign-in page? Cancel and try again.")
          : p.status === "online"
          ? t("连接已就绪。选择下方的 Bot，回到熟悉的聊天界面。", "Connection ready. Choose a Bot below to return to your conversation.")
          : p.status === "reconnecting"
          ? t("正在尝试恢复连接。断线不代表任务失败，也不会切换到其他服务器。", "Trying to reconnect. Disconnection is not task failure; work is not moved to another server.")
          : p.status === "connecting"
          ? t("正在建立连接。就绪前不会读取 Bot 或发送任务。", "Establishing the connection. Bots and tasks stay unavailable until it is ready.")
          : p.status === "signed-out"
          ? t("使用这台服务器的账号登录，无需在 BeeBot 中填写模型密钥。", "Sign in with your account on this server. No model key is entered in BeeBot.")
          : t("客户端无法识别此状态，请核对服务端版本。", "This client cannot recognize the status. Check the server version.");
      }
      auth.hidden = !p || p.status !== "signed-out" || signingIn;
      auth.disabled = busy || !profilesTrusted;
      reconnect.hidden = !p || p.status !== "reconnecting" || signingIn;
      reconnect.disabled = busy || !profilesTrusted;
      cancelLogin.hidden = !signingIn;
      logout.hidden = !p || !["online", "reconnecting"].includes(p.status) || signingIn;
      logout.disabled = busy || !profilesTrusted;
      remove.disabled = busy || !profilesTrusted;
      actionsEnd.hidden = signingIn;
      addToggle.hidden = profiles.length === 0;
      addToggle.disabled = busy;
      addToggle.setAttribute("aria-expanded", String(showAdd));
      form.hidden = profiles.length > 0 && !showAdd;
      address.disabled = busy || loading;
      add.disabled = busy || loading;
      add.textContent = operation?.kind === "add" ? t("检查服务器…", "Checking server…") : t("添加服务器", "Add server");
      form.setAttribute("aria-busy", String(operation?.kind === "add"));
      proceed.disabled = busy || !profilesTrusted;
      confirmBox.hidden = !confirmation || confirmation.key !== currentKey();
      if (confirmation && !confirmBox.hidden) {
        const removing = confirmation.kind === "remove";
        confirmTitle.textContent = removing ? t(`移除「${confirmation.name}」的连接？`, `Remove the connection to ${confirmation.name}?`) : t(`退出「${confirmation.name}」？`, `Sign out of ${confirmation.name}?`);
        confirmBody.textContent = removing
          ? t("只移除本机连接并尝试撤销此设备会话；不会删除 Bot，也不会停止服务器上的任务。", "Remove this local connection and try to revoke this device session. This does not delete Bots or stop tasks on the server.")
          : t("将撤销此设备会话。Bot 与任务仍留在服务器上，需要再次登录才能查看。", "Revoke this device session. Bots and tasks stay on the server; sign in again to view them.");
        proceed.textContent = removing ? t("确认移除", "Remove connection") : t("确认退出", "Confirm sign-out");
      }
      const displayNotice = notice || (p?.error ? { cn: "连接需要处理", en: "Connection needs attention", detail: errorDetail(p.error), tone: "warning", canRetry: false } : null);
      noticeBox.hidden = !displayNotice;
      if (displayNotice) {
        noticeBox.dataset.tone = displayNotice.tone;
        noticeTitle.textContent = t(displayNotice.cn, displayNotice.en);
        noticeDetail.textContent = displayNotice.detail;
        noticeDetail.hidden = !displayNotice.detail;
        retry.hidden = !displayNotice.canRetry;
        retry.disabled = busy;
      }
      const announcement = displayNotice ? t(displayNotice.cn, displayNotice.en) : p ? `${p.name}: ${statusText(p)}` : loading ? t("正在读取连接…", "Loading connections…") : "";
      if (live.textContent !== announcement) live.textContent = announcement;
      renderBots();
    }

    function renderBots() {
      if (!alive) return;
      const p = current();
      const visible = profilesTrusted && p?.status === "online" && snapshotOwner === currentKey() && (!operation || operation.kind === "open") ? snapshot?.bots || [] : [];
      const wanted = new Set(visible.map(bot => bot.id));
      for (const [id, row] of botRows) {
        if (!wanted.has(id)) { row.button.remove(); botRows.delete(id); }
      }
      visible.forEach((bot, index) => {
        let row = botRows.get(bot.id);
        if (!row) {
          const item = element("button", "bb-node-bot"); item.type = "button";
          const glyph = element("span", "bb-bot-glyph"); glyph.append(icon("bot"));
          const copy = element("span", "bb-bot-copy");
          const name = element("span", "bb-bot-name"), description = element("span", "bb-bot-description");
          copy.append(name, description);
          item.append(glyph, copy, icon("arrow"));
          row = { button: item, glyph, name, description, bot, owner: currentKey(), avatarSignature: null };
          item.onclick = () => void openBot(row);
          botRows.set(bot.id, row);
        }
        const avatarSignature = JSON.stringify([bot.avatarShape || "blob", bot.avatarColor || "green", typeof RBotSvg]);
        if (row.avatarSignature !== avatarSignature) {
          row.avatarSignature = avatarSignature;
          const persona = typeof RBotSvg === "function";
          row.glyph.classList.toggle("bb-bot-persona", persona);
          row.glyph.replaceChildren(persona ? RBotSvg(bot.avatarShape || "blob", bot.avatarColor || "green", 32) : icon("bot"));
        }
        row.bot = bot;
        row.owner = currentKey();
        row.name.textContent = bot.name;
        row.description.textContent = bot.description || "";
        row.description.hidden = !bot.description;
        row.button.setAttribute("aria-label", bot.name);
        row.button.disabled = !!operation;
        // Stable nodes preserve keyboard focus across background polling.
        if (botList.children[index] !== row.button) botList.insertBefore(row.button, botList.children[index] || null);
      });
      count.textContent = String(visible.length);
      count.hidden = !snapshot || !p || p.status !== "online";
      botList.hidden = visible.length === 0;
      empty.hidden = visible.length > 0;
      const pending = p && pendingSnapshots.has(p.id);
      if (loading) {
        emptyTitle.textContent = t("正在读取连接…", "Loading connections…");
        emptyHelp.textContent = t("不会启动本机模型或执行任务。", "No local model or task is started.");
      } else if (!p) {
        emptyTitle.textContent = profiles.length ? t("选择一台服务器", "Choose a server") : t("让你的 Bot 保持连接", "A connection for your Bots");
        emptyHelp.textContent = profiles.length ? t("只显示你选择的服务器，不会自动改派工作。", "Only the selected server is shown. Work is never rerouted automatically.") : t("添加并登录后，这里的 Bot 会出现在原来的主列表。", "After adding a server and signing in, its Bots appear in the existing main list.");
      } else if (p.status !== "online" || operation) {
        emptyTitle.textContent = t("连接后显示这台服务器上的 Bot。", "Connect to see this server's Bots.");
        emptyHelp.textContent = t("Bot 的身份、记忆和任务留在原服务器上。", "Bot identities, memory and tasks stay on their original server.");
      } else if (snapshotError) {
        emptyTitle.textContent = t("暂时无法读取 Bot 列表", "Could not load Bots");
        emptyHelp.textContent = t("这不代表 Bot 已被删除，请刷新连接状态。", "This does not mean Bots were deleted. Refresh the connection status.");
      } else if (pending || !snapshot) {
        emptyTitle.textContent = t("正在读取 Bot…", "Loading Bots…");
        emptyHelp.textContent = t("只读取当前已登录服务器的数据。", "Reading only the currently signed-in server.");
      } else {
        emptyTitle.textContent = t("这台服务器还没有 Bot。", "This server has no Bots yet.");
        emptyHelp.textContent = t("通过原来的 + → 新建 Bot 入口创建一个长期伙伴。", "Create a lasting collaborator from the existing + → New bot entry.");
      }
      sync.textContent = syncedAt && snapshotOwner === currentKey() && p?.status === "online"
        ? `${t("最近同步", "Last synced")} ${new Date(syncedAt).toLocaleTimeString(window.__sandUiLanguage === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit" })}`
        : "";
    }

    async function openBot(row) {
      if (!alive || !profilesTrusted || operation || current()?.status !== "online" || row.owner !== currentKey() || !snapshot?.bots?.some(bot => bot.id === row.bot.id)) return;
      const id = selected, key = currentKey(), at = generation;
      const op = { kind: "open", id, key, abort: new AbortController() }; operation = op;
      update();
      try {
        if (typeof window.__beebotNodeChat?.open !== "function") throw new Error(t("此版本的聊天入口不可用。", "The conversation entry is unavailable in this build."));
        await window.__beebotNodeChat.open(id, row.bot, { signal: op.abort.signal });
        if (!alive || at !== generation || key !== currentKey()) return;
        onOpenBot?.();
        close();
      } catch (error) {
        if (alive && at === generation) setNotice("未能打开 Bot，当前设置页保持不变。", "Could not open the Bot. Settings remain open.", error);
      } finally {
        if (alive && operation === op) { operation = null; update(); }
      }
    }

    // Separate list and snapshot lanes: a slow Server A never blocks selecting B.
    async function loadSnapshot() {
      const p = current();
      if (!alive || !profilesTrusted || !p || p.status !== "online" || operation || pendingSnapshots.has(p.id)) return;
      const token = { id: p.id, key: currentKey(), generation };
      pendingSnapshots.set(p.id, token);
      renderBots();
      try {
        const next = await request("snapshot", { id: token.id });
        if (!alive || token.generation !== generation || token.key !== currentKey() || current()?.status !== "online" || operation) return;
        if (!next || !Array.isArray(next.bots)
          || next.bots.some(bot => !bot || typeof bot.id !== "string" || !bot.id || typeof bot.name !== "string" || !bot.name || (bot.description !== undefined && typeof bot.description !== "string"))
          || new Set(next.bots.map(bot => bot.id)).size !== next.bots.length
          || (p.nodeId && next.node?.id !== p.nodeId)) throw new Error(t("服务器返回的 Bot 列表或节点身份不匹配。", "The server returned an invalid Bot list or a different node identity."));
        snapshot = next;
        snapshotOwner = token.key;
        snapshotError = false;
        syncedAt = Date.now();
        if (notice?.canRetry) notice = null;
      } catch (error) {
        if (alive && token.generation === generation && token.key === currentKey()) {
          snapshot = null;
          snapshotError = true;
          setNotice("无法读取当前服务器的 Bot。", "Could not load Bots from the selected server.", error, "error", true);
        }
      } finally {
        if (pendingSnapshots.get(token.id) === token) pendingSnapshots.delete(token.id);
        if (alive) {
          update();
          // On an auth/selection change, wait for the old request to settle before
          // requesting a fresh snapshot for the same connection. Never reuse it.
          if (token.id === selected && token.generation !== generation) void loadSnapshot();
        }
      }
    }

    async function refresh() {
      if (!alive) return;
      if (listPending) { listAgain = true; return; }
      listPending = true;
      const at = generation;
      try {
        const next = await request("list");
        if (!alive) return;
        if (at !== generation) { listAgain = true; return; }
        if (!Array.isArray(next) || next.some(p => !p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || typeof p.baseUrl !== "string" || typeof p.status !== "string") || new Set(next.map(p => p.id)).size !== next.length) throw new Error(t("连接列表无效。", "Invalid connection list."));
        const before = current();
        const previousKey = currentKey();
        profiles = next;
        if (!initialized) {
          initialized = true;
          selected = profiles.find(p => p.status === "online")?.id || profiles[0]?.id || "";
        } else if (selected && !current()) {
          selected = "";
          setNotice("所选连接已移除，请重新选择。", "The selected connection was removed. Choose a connection.", "", "info");
        }
        if (previousKey !== currentKey() || (before && before.status !== current()?.status)) {
          generation++;
          snapshot = null; snapshotOwner = ""; syncedAt = 0; snapshotError = false;
          confirmation = null;
        }
        loading = false;
        profilesTrusted = true;
        update();
        void loadSnapshot();
      } catch (error) {
        if (alive && at === generation) {
          loading = false;
          profilesTrusted = false;
          snapshot = null; snapshotOwner = ""; syncedAt = 0;
          setNotice("无法读取连接状态。", "Could not read connection status.", error, "error", true);
          update();
        }
      } finally {
        listPending = false;
        if (alive && listAgain) { listAgain = false; void refresh(); }
      }
    }

    function schedule(event) {
      if (!alive) return;
      // The bridge does not expose principal IDs. Do not retain private Bot data
      // across a relevant authentication/connection change based on name alone.
      if (!event?.id || event.id === selected) invalidate(false);
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 100);
    }

    picker.onchange = () => {
      if (operation) { picker.value = selected; return; }
      selected = picker.value;
      initialized = true;
      confirmation = null;
      invalidate();
      update();
      void refresh();
    };
    function localize() {
      if (!alive) return;
      translations.forEach(apply => apply());
      if (fieldError.textContent) fieldError.textContent = validateAddress(address.value);
      update();
    }
    window.addEventListener("sand-ui-language-changed", localize);
    unsubscribe = bridge.onChanged(schedule);
    poll = setInterval(() => void refresh(), 10000);
    update();
    void refresh();
    return close;
  };

  window.__beebotOpenNodeWorkbench = function () {
    if (api()) ROpenSettings("servers");
  };
})();
