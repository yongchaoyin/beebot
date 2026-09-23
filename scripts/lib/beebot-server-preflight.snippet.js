/* Additive Settings extension: keep PR #8's Servers/security component unchanged.
 * Read-only preflight and installation preview. No apply, pairing or model readiness. */
(function () {
  if (window.__beebotPreflightBound) return;
  window.__beebotPreflightBound = true;
  const original = window.__beebotMountServersSettings;
  if (typeof original !== "function") return;
  const t = (cn, en) => window.__sandUiLanguage === "zh" ? cn : en;
  const errors = {
    INVALID_INSTALL_OPTIONS: ["请输入不含协议或路径的小写域名，以及 1–100 字的服务器名称。", "Enter a lowercase DNS hostname without scheme/path and a 1–100 character server name."],
    PREFLIGHT_REQUIRED: ["请先重新核对服务器身份并检查环境。", "Verify the server identity and check prerequisites first."],
    EXPIRED_PREFLIGHT: ["环境检查已过期，请重新核对后生成计划。", "The prerequisite observation expired. Verify again before preparing a plan."],
    INVALID_CATALOG: ["发行记录无法确认，没有选择安装版本。", "The release catalog could not be verified. No version was selected."],
    INVALID_RELEASE: ["发行清单格式不受支持，未使用该版本。", "The release manifest is unsupported and was not used."],
    UNTRUSTED_RELEASE: ["发行来源或签名无法确认，未使用该版本。", "The release origin or signature could not be verified."],
    EXPIRED_RELEASE: ["发行清单已过期，需要新的可信发行版本。", "The release manifest expired. An approved current release is required."],
    RELEASE_ROLLBACK: ["发行版本低于客户端允许的最低版本，未使用该版本。", "The release is below the client's approved sequence and was not used."],
    INVALID_TARGET: ["请填写直接可达的主机名或 IP、SSH 用户和有效端口，不支持跳板或 SSH 别名。", "Enter a direct hostname/IP, SSH user and valid port. Jump hosts and SSH aliases are not supported."],
    SSH_UNAVAILABLE: ["没有找到系统 SSH 工具；尚未连接或安装。", "System SSH tools are unavailable. Nothing was connected or installed."],
    NO_HOST_KEY: ["未读到 ED25519 主机密钥，请检查地址、端口和网络。", "No ED25519 host key was found. Check the address, port and network."],
    AMBIGUOUS_HOST_KEY: ["服务器返回了不同的主机密钥，请先向管理员核实。", "Multiple host keys were returned. Verify the server with its administrator."],
    INVALID_HOST_KEY: ["主机密钥格式无效，连接已停止。", "Invalid host key. The connection was stopped."],
    EXPIRED_CHALLENGE: ["本次身份确认已失效，请重新读取并核对指纹。", "This confirmation expired. Read and verify the fingerprint again."],
    FINGERPRINT_MISMATCH: ["指纹不一致，未使用 SSH 密钥连接。", "The fingerprints differ. No SSH authentication was attempted."],
    AUTHENTICATION_FAILED: ["SSH 密钥认证失败。请确认用户、公钥授权或本机 SSH agent；不会请求服务器密码。", "SSH key authentication failed. Check the account, authorized key or local SSH agent. Server passwords are not collected."],
    HOST_KEY_CHANGED: ["服务器身份发生变化，已停止连接。请先核实，不要直接信任新指纹。", "The server identity changed. Connection stopped. Verify it before trusting a new fingerprint."],
    CONNECTION_FAILED: ["未能完成检查，输入已保留。没有安装或重置服务。", "The check could not finish. Your input is retained. No service was installed or reset."],
    TIMEOUT: ["检查超时，已结束本次连接。现有服务未被停止。", "The check timed out and its connection was closed. Existing services were not stopped."],
    OUTPUT_LIMIT: ["服务器输出超出检查范围，已停止本次连接。", "Server output exceeded the check limit. This connection was stopped."],
    CANCELLED: ["本次检查已取消，现有 Bot 工作不受影响。", "This check was cancelled. Existing Bot work is unaffected."],
    INVALID_REPORT: ["检查结果格式无法确认，未将服务器标记为就绪。", "The report could not be verified. The server was not marked ready."],
    INVALID_KEY_FILE: ["请选择属于当前用户、仅本人可读的普通密钥文件，不支持符号链接。加密密钥请先加入 SSH agent。", "Choose a private regular key file owned by you, not a symlink. Load encrypted keys into your SSH agent first."],
  };
  const blockers = {
    release_unavailable: ["尚无客户端认可的正式发行包；不会改用未知镜像或 latest 标签。", "No client-approved release is available. Unknown images and latest tags are not substituted."],
    release_platform_unavailable: ["暂无适用于这台服务器架构的可信版本。", "No approved release supports this server architecture."],
    release_disk_low: ["可用空间低于该发行版本的最低要求。", "Available storage is below this release's minimum requirement."],
    execution_not_enabled: ["当前只提供安装计划；实际安装、设备绑定与模型配置尚未开放。", "This version previews installation only. Installation, device enrollment and model setup are not enabled."],
    unsupported_platform: ["当前安装器需要 Linux x86_64 或 ARM64。", "The current installer requires Linux x86_64 or ARM64."],
    bash_missing: ["未找到 Bash。", "Bash was not found."],
    docker_missing: ["未安装 Docker；本次不会自动安装系统依赖。", "Docker is missing. This check does not install system dependencies."],
    docker_unavailable: ["无法访问本机 Docker，请检查服务或当前用户权限。", "Local Docker is unavailable. Check the service and this user's access."],
    docker_unsupported: ["Docker 不是 Linux 容器引擎。", "Docker is not a Linux container engine."],
    docker_remote_context: ["Docker 指向另一台机器，未访问该引擎。", "Docker targets another machine. That engine was not contacted."],
    compose_missing: ["未找到可用的 Docker Compose。", "Docker Compose is unavailable."],
    home_readonly: ["当前用户的主目录不可写。", "This user's home directory is not writable."],
    home_unavailable: ["无法检查主目录。", "The home directory could not be checked."],
    installation_managed_present: ["默认目录已有安装记录；应连接或核查原服务，不要覆盖。", "Installation records exist at the default path. Connect to or inspect the original service; do not overwrite it."],
    installation_occupied: ["默认目录已有其他内容，不能直接安装。", "The default directory contains existing data. Do not install over it."],
    installation_locked: ["发现安装锁，可能有其他安装正在运行。不会自动删除锁。", "An installation lock exists. Another install may be active. The lock will not be removed automatically."],
    installation_symlink: ["默认路径包含符号链接，需要先核查。", "The default path contains a symlink and needs inspection."],
    installation_unknown: ["未能确认默认目录状态。", "The default directory could not be inspected."],
    disk_low: ["主目录所在磁盘可用空间不足 2 GiB，需要先检查容量。", "The home filesystem has less than 2 GiB available. Review storage capacity."],
    disk_unknown: ["无法确认可用磁盘空间。", "Available disk space could not be checked."],
  };
  window.__beebotMountServersSettings = function (host, options) {
    const disposeOriginal = original(host, options);
    const bridge = window.desktop?.serverPreflight;
    const workbench = host?.querySelector("#beebot-node-workbench");
    if (!bridge || !workbench) return disposeOriginal;
    const priorClose = window.__beebotCloseNodeWorkbench;
    let alive = true, sequence = 0, sessionId = null, challenge = null, result = null, busy = false, errorCode = null, keyLabel = null, composing = false;
    let plan = null, planBusy = false, planError = null, planSequence = 0;
    const translations = [];
    const el = (tag, cn, en, cls) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (cn !== undefined) { const apply = () => { node.textContent = t(cn, en); }; translations.push(apply); apply(); }
      return node;
    };
    const button = (action, cn, en, click) => { const node = el("button", cn, en); node.type = "button"; node.dataset.preflightAction = action; node.onclick = click; return node; };
    const root = el("details", undefined, undefined, "bb-preflight"); root.dataset.serverPreflight = "true";
    const summary = el("summary", "准备自己的服务器：检查环境与安装计划", "Prepare your server: prerequisites & install plan"); root.append(summary);
    const body = el("div", undefined, undefined, "bb-preflight-body"); root.append(body);
    body.append(el("p", "本阶段提供只读检查与安装方案预览，不安装软件、不配置模型，也不更改已有服务。", "This stage only checks prerequisites. It does not install software, configure a model or change an existing service.", "bb-muted"));
    const form = el("form"); form.noValidate = true;
    const fields = el("div", undefined, undefined, "bb-preflight-fields");
    function field(name, cn, en, value, placeholder) {
      const label = el("label"); label.append(el("span", cn, en));
      const input = el("input"); input.dataset.preflightField = name; input.value = value; input.placeholder = placeholder; input.autocomplete = "off"; input.spellcheck = false;
      input.maxLength = name === "host" ? 253 : name === "user" ? 33 : 5;
      if (name === "port") input.inputMode = "numeric";
      translations.push(() => input.setAttribute("aria-label", t(cn, en))); input.setAttribute("aria-label", t(cn, en));
      input.oninput = invalidate; label.append(input); fields.append(label); return input;
    }
    const hostname = field("host", "SSH 主机", "SSH host", "", "192.0.2.10");
    const username = field("user", "登录用户", "SSH user", "", "operator");
    const port = field("port", "端口", "Port", "22", "22");
    form.append(fields);
    const credentials = el("div", undefined, undefined, "bb-actions"), identity = el("span", undefined, undefined, "bb-muted");
    const chooseKey = button("chooseKey", "选择本机密钥", "Choose local key", null);
    const useAgent = button("useAgent", "使用 SSH agent", "Use SSH agent", null);
    credentials.append(identity, chooseKey, useAgent); form.append(credentials);
    form.append(el("p", "仅支持直连与密钥认证。密钥文件由系统选择器选取，私钥内容不会进入聊天或页面。", "Direct connections and key authentication only. A system picker selects the file; private key bytes never enter chat or this page.", "bb-muted"));
    const actions = el("div", undefined, undefined, "bb-actions");
    const scan = button("scan", "读取主机指纹", "Read host fingerprint", null); scan.type = "submit"; scan.className = "bb-primary";
    const cancel = button("cancel", "取消检查", "Cancel check", () => { invalidate(); errorCode = "CANCELLED"; update(); });
    actions.append(scan, cancel); form.append(actions); body.append(form);
    const confirm = el("section", undefined, undefined, "bb-preflight-confirm"); confirm.hidden = true;
    confirm.append(el("strong", "核对服务器身份", "Verify server identity"));
    const fingerprint = el("code"); confirm.append(fingerprint);
    confirm.append(el("p", "请与服务器管理面板或管理员提供的指纹核对。网络读取本身不能证明身份；指纹变化时应停止。", "Compare with the fingerprint from your server console or administrator. Discovery alone does not prove identity. Stop if the fingerprint changed.", "bb-muted"));
    const trustLabel = el("label", undefined, undefined, "bb-preflight-trust"), trust = el("input"); trust.type = "checkbox"; trust.dataset.preflightField = "trust";
    trustLabel.append(trust, el("span", "我已从可信来源核对该指纹", "I verified this fingerprint using a trusted source")); confirm.append(trustLabel);
    const inspect = button("inspect", "确认身份并检查环境", "Confirm identity & check", null); inspect.className = "bb-primary"; confirm.append(inspect); body.append(confirm);
    const notice = el("p", undefined, undefined, "bb-preflight-notice"); notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite"); body.append(notice);
    const output = el("section", undefined, undefined, "bb-preflight-result"); body.append(output);
    const planning = el("details", undefined, undefined, "bb-install-plan"); planning.hidden = true; planning.dataset.installPlan = "true";
    planning.append(el("summary", "下一步：查看安装计划", "Next: preview installation"));
    const planBody = el("div", undefined, undefined, "bb-preflight-body"); planning.append(planBody);
    planBody.append(el("p", "先看清将创建什么、哪些条件还缺少。生成计划不会登录服务器或执行安装。当前路径需要域名；SSH 隧道接入尚未开放。", "Review proposed changes and missing prerequisites. Preparing a plan does not connect or install. This path requires a domain; SSH API tunneling is not enabled.", "bb-muted"));
    const planForm = el("form"); planForm.dataset.installPlanForm = "true";
    const domainLabel = el("label"), nameLabel = el("label");
    domainLabel.append(el("span", "服务器域名", "Server domain"));
    const domain = el("input"); domain.type = "text"; domain.autocomplete = "off"; domain.spellcheck = false; domain.maxLength = 253; domain.placeholder = "bot.example.com"; domain.dataset.installField = "domain"; domain.required = true; domainLabel.append(domain);
    nameLabel.append(el("span", "服务器名称", "Server name"));
    const serverName = el("input"); serverName.type = "text"; serverName.autocomplete = "off"; serverName.maxLength = 100; serverName.value = "My BeeBot"; serverName.dataset.installField = "name"; serverName.required = true; nameLabel.append(serverName);
    const preview = button("preview-install", "生成只读计划", "Preview only", null); preview.type = "submit";
    planForm.append(domainLabel, nameLabel, preview); planBody.append(planForm);
    const planNotice = el("p", undefined, undefined, "bb-preflight-notice"); planNotice.setAttribute("role", "status"); planNotice.setAttribute("aria-live", "polite"); planBody.append(planNotice);
    const planResult = el("section", undefined, undefined, "bb-preflight-result"); planBody.append(planResult); body.append(planning);
    function clearPlan() { planSequence++; plan = null; planError = null; planBusy = false; }
    domain.oninput = serverName.oninput = () => { clearPlan(); updatePlan(); };
    function updatePlan() {
      planning.hidden = !result; preview.disabled = busy || planBusy || !result;
      planNotice.dataset.error = String(!!planError);
      planNotice.textContent = planError ? t(...errors[planError]) : planBusy ? t("正在核对安装方案…", "Preparing the installation preview…") : "";
      planResult.replaceChildren();
      if (!plan) return;
      const add = (tag, text) => { const n = document.createElement(tag); n.textContent = text; planResult.append(n); return n; };
      add("strong", t("安装计划 · 尚未执行", "Installation plan · not executed"));
      add("p", `${plan.target.user}@${plan.target.host}:${plan.target.port} → ${plan.origin}`);
      add("code", plan.fingerprint);
      add("p", t("安装位置：", "Install location: ") + plan.directory);
      add("p", plan.release ? t("已核对发行签名：", "Release signature verified: ") + plan.release.version : t("正式发行包：尚不可用", "Approved release: unavailable"));
      add("p", t("计划创建：独立数据目录、存储卷和网络，以及 Node 与 HTTPS 服务；拟使用 80/443 入站端口。", "Proposed: private installation files, dedicated volumes/networks, and Node/HTTPS services on inbound ports 80/443."));
      add("p", t("不会更改：已有服务或数据、系统账号、防火墙、Docker 配置和模型凭据。", "Unchanged: existing services/data, OS accounts, firewall, Docker configuration and model credentials."));
      const ul = document.createElement("ul");
      for (const code of plan.blockers) { const n = document.createElement("li"); n.textContent = t(...(blockers[code] || ["该项需要进一步核对。", "This item needs further verification."])); ul.append(n); } planResult.append(ul);
      add("p", t("仍需验证：DNS、网络连通、镜像可用性、设备授权与模型执行。计划不表示服务已就绪。", "Still unverified: DNS, reachability, image availability, device authorization and model execution. A plan does not mean the service is ready."));
      add("p", t("计划有效至：", "Preview expires at: ") + new Date(plan.expiresAt).toLocaleTimeString());
    }
    planForm.onsubmit = event => {
      event.preventDefault(); if (composing || busy || planBusy || !result || !sessionId) return;
      const at = ++planSequence, checked = result, id = sessionId;
      const options = { domain: domain.value.trim().toLowerCase(), name: serverName.value.trim() };
      planBusy = true; plan = null; planError = null; updatePlan();
      void (async () => {
        try {
          const next = await call("previewInstall", { sessionId: id, options });
          if (!alive || at !== planSequence || sessionId !== id || result !== checked) return;
          if (next?.schemaVersion !== 1 || next.status !== "review_only" || next.canInstall !== false || next.installed !== false || next.executionProbe !== "not_run" ||
              next.fingerprint !== checked.fingerprint || next.target?.host !== checked.target.host || next.target?.port !== checked.target.port || next.target?.user !== checked.target.user ||
              next.options?.domain !== options.domain || next.options?.name !== options.name || next.origin !== "https://" + options.domain || next.directory !== "$HOME/.local/share/beebot/server" || next.checkedAt !== checked.checkedAt || !Array.isArray(next.blockers) || !next.blockers.includes("execution_not_enabled") ||
              typeof next.specificationDigest !== "string" || !/^[a-f0-9]{64}$/.test(next.specificationDigest) || !Number.isFinite(next.expiresAt) || next.expiresAt <= Date.now() || next.expiresAt > checked.checkedAt + 300000) throw { code: "INVALID_REPORT" };
          plan = next;
        } catch (error) { if (alive && at === planSequence) planError = Object.hasOwn(errors, error?.code) ? error.code : "CONNECTION_FAILED"; }
        finally { if (alive && at === planSequence) { planBusy = false; updatePlan(); } }
      })();
    };
    planForm.addEventListener("compositionstart", () => { composing = true; }); planForm.addEventListener("compositionend", () => { composing = false; });
    const style = el("style");
    style.textContent = `#beebot-node-workbench .bb-install-plan{border-top:1px solid var(--bb-line);padding-top:12px;margin-top:8px}#beebot-node-workbench .bb-install-plan p{margin:0;line-height:1.6}#beebot-node-workbench .bb-install-plan form{grid-template-columns:minmax(0,1fr)}#beebot-node-workbench .bb-preflight{border:1px solid var(--bb-line);border-radius:12px;padding:14px 16px;margin:0 0 20px;background:var(--bb-surface)}#beebot-node-workbench .bb-preflight summary{cursor:pointer;font-weight:600;min-height:24px}#beebot-node-workbench .bb-preflight-body,#beebot-node-workbench .bb-preflight form{display:grid;gap:12px;margin-top:12px}#beebot-node-workbench .bb-preflight-fields{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) 70px;gap:10px}#beebot-node-workbench .bb-preflight label{display:grid;gap:5px;min-width:0}#beebot-node-workbench .bb-preflight-confirm{display:grid;gap:10px;border-top:1px solid var(--bb-line);padding-top:14px}#beebot-node-workbench .bb-preflight code{display:block;font-size:12px;overflow-wrap:anywhere;padding:9px;border-radius:7px;background:var(--bb-surface);border:1px solid var(--bb-line)}#beebot-node-workbench .bb-preflight .bb-preflight-trust{display:flex;align-items:flex-start;font-weight:400}#beebot-node-workbench .bb-preflight input[type=checkbox]{width:16px;height:16px;min-height:16px;margin:3px 4px 0 0;flex:none}#beebot-node-workbench .bb-preflight-result{display:grid;gap:8px;overflow-wrap:anywhere}#beebot-node-workbench .bb-preflight-result ul{margin:0;padding-inline-start:20px}#beebot-node-workbench .bb-preflight-result li{margin:5px 0}#beebot-node-workbench .bb-preflight-notice{font-size:12px;overflow-wrap:anywhere}#beebot-node-workbench .bb-preflight-notice[data-error=true]{color:var(--cursor-error,#AF2D38)}@container bb-server-panel (max-width:440px){#beebot-node-workbench .bb-preflight-fields{grid-template-columns:minmax(0,1fr) 70px}#beebot-node-workbench .bb-preflight-fields>label:first-child{grid-column:1/-1}#beebot-node-workbench .bb-preflight{padding:12px}#beebot-node-workbench .bb-preflight .bb-actions{gap:6px}}`;
    root.prepend(style);
    workbench.querySelector(".bb-intro")?.after(root);
    if (!root.isConnected) workbench.prepend(root);

    async function call(action, data = {}) {
      let reply;
      try { reply = await bridge.request({ action, ...data }); } catch { throw { code: "CONNECTION_FAILED" }; }
      if (!reply?.ok) throw { code: Object.hasOwn(errors, reply?.error?.code) ? reply.error.code : "CONNECTION_FAILED" };
      return reply.value;
    }
    const target = () => ({ host: hostname.value.trim(), user: username.value.trim(), port: Number(port.value) });
    function invalidate() {
      clearPlan();
      sequence++; challenge = null; result = null; errorCode = null; busy = false; trust.checked = false;
      if (sessionId) void call("cancel", { sessionId }).catch(() => {});
      update();
    }
    async function execute(operation) {
      if (!alive || busy) return;
      clearPlan();
      const at = ++sequence; busy = true; challenge = null; trust.checked = false; result = null; errorCode = null; update();
      try {
        if (!sessionId) {
          const opened = await call("open");
          if (typeof opened?.sessionId !== "string" || !opened.sessionId || opened.sessionId.length > 128) throw { code: "INVALID_REPORT" };
          if (!alive || at !== sequence) { void call("close", { sessionId: opened.sessionId }).catch(() => {}); return; }
          sessionId = opened.sessionId;
        }
        // Every asynchronous assignment in an operation goes through this guard.
        const value = await operation(sessionId, () => alive && at === sequence);
        if (!alive || at !== sequence) return;
        if (value?.fingerprint) {
          const expected = target();
          if (typeof value.id !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint) || value.target?.host !== expected.host.toLowerCase() || value.target?.user !== expected.user || value.target?.port !== expected.port) throw { code: "INVALID_REPORT" };
          challenge = value;
        }
      } catch (error) { if (alive && at === sequence) errorCode = Object.hasOwn(errors, error?.code) ? error.code : "CONNECTION_FAILED"; }
      finally { if (alive && at === sequence) { busy = false; update(); } }
    }
    // Separate guarded assignments: closing/editing while awaiting IPC must not
    // let old identity/results leak into the next server's form.
    chooseKey.onclick = () => void execute(async (id, current) => { const picked = await call("chooseKey", { sessionId: id }); if (current() && !picked.canceled) keyLabel = picked.label; });
    useAgent.onclick = () => void execute(async (id, current) => { await call("useAgent", { sessionId: id }); if (current()) keyLabel = null; });
    inspect.onclick = () => {
      if (!challenge || !trust.checked || busy) return;
      const selected = challenge;
      void execute(async (id, current) => { const next = await call("inspect", { sessionId: id, challengeId: selected.id, fingerprint: selected.fingerprint }); if (current()) {
        if (next?.fingerprint !== selected.fingerprint || next?.target?.host !== selected.target.host || next?.target?.port !== selected.target.port || next?.target?.user !== selected.target.user) throw { code: "INVALID_REPORT" };
        result = next;
      } });
    };
    form.onsubmit = event => { event.preventDefault(); if (composing || busy) return; const selected = target(); void execute(id => call("scan", { sessionId: id, target: selected })); };
    form.addEventListener("compositionstart", () => { composing = true; }); form.addEventListener("compositionend", () => { composing = false; });
    trust.onchange = update;
    function update() {
      if (!alive) return;
      updatePlan();
      scan.disabled = busy; chooseKey.disabled = busy; useAgent.disabled = busy || !keyLabel; cancel.hidden = !busy;
      identity.textContent = keyLabel ? t("本机密钥：", "Local key: ") + keyLabel : t("使用本机 SSH agent", "Using the local SSH agent");
      confirm.hidden = !challenge; fingerprint.textContent = challenge?.fingerprint || ""; inspect.disabled = busy || !trust.checked || !challenge;
      notice.dataset.error = String(!!errorCode);
      notice.textContent = errorCode ? t(...errors[errorCode]) : busy ? t("正在检查，请勿重复提交…", "Checking. Do not submit again…") : "";
      output.replaceChildren();
      if (result) {
        if (!result.report || !Array.isArray(result.blockers) || !Number.isFinite(result.checkedAt) || result.installed !== false || result.executionProbe !== "not_run") { result = null; errorCode = "INVALID_REPORT"; update(); return; }
        const line = (tag, cn, en, cls) => { const node = document.createElement(tag); node.textContent = t(cn, en); if (cls) node.className = cls; return node; };
        output.append(line("strong", result.blockers.length ? "检查完成，有事项需要处理" : "已观察到基础安装条件", result.blockers.length ? "Check complete — action needed" : "Basic prerequisites observed"));
        const info = document.createElement("p"); info.className = "bb-muted";
        const disk = result.report.diskKiB === null ? t("未知", "unknown") : (result.report.diskKiB / 1048576).toFixed(1) + " GiB";
        info.textContent = `${result.target.host}:${result.target.port} · ${result.report.os} / ${result.report.arch} · ${t("可用空间", "Free space")} ${disk} · ${new Date(result.checkedAt).toLocaleTimeString()}`; output.append(info);
        const list = document.createElement("ul");
        for (const code of result.blockers) { const item = blockers[code] || ["该项需要进一步检查。", "This item needs further inspection."]; list.append(line("li", ...item)); } output.append(list);
        output.append(line("p", "没有安装或变更服务。仅检查默认安装目录；证书、设备授权、模型与完整运行环境尚未验证。", "No service was installed or changed. Only the default installation path was checked; certificates, device authorization, model and full runtime remain unverified.", "bb-muted"));
      }
    }
    function localize() { translations.forEach(apply => apply()); update(); }
    window.addEventListener("sand-ui-language-changed", localize);
    root.addEventListener("toggle", () => {
      if (root.open || !alive) return;
      invalidate(); const old = sessionId; sessionId = null; keyLabel = null;
      if (old) void call("close", { sessionId: old }).catch(() => {}); update();
    });
    const expiryTimer = setInterval(() => {
      if (plan && Date.now() >= plan.expiresAt) { clearPlan(); planError = "EXPIRED_PREFLIGHT"; updatePlan(); }
    }, 1000);
    const close = () => {
      if (!alive) return;
      alive = false; sequence++; clearPlan();
      if (sessionId) void call("close", { sessionId }).catch(() => {});
      clearInterval(expiryTimer);
      window.removeEventListener("sand-ui-language-changed", localize); observer.disconnect(); root.remove(); priorClose?.();
      if (window.__beebotCloseNodeWorkbench === close) delete window.__beebotCloseNodeWorkbench;
    };
    const observer = new MutationObserver(() => { if (!root.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__beebotCloseNodeWorkbench = close; update();
    return close;
  };
})();
