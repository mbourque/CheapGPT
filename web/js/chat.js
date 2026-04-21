/**
 * CheapGPT front-end — ChatGPT-like UI.
 * Wire /api/chat (or similar) when the Python + Ollama server exists.
 */

(function () {
  const STORAGE_KEY = "cheapgpt_chats_v1";
  const THEME_KEY = "cheapgpt_theme";
  const MODEL_KEY = "cheapgpt_model";
  const THINKING_KEY = "cheapgpt_thinking_mode";
  const TEMP_CHAT_KEY = "cheapgpt_temporary_chat_mode";
  const SIDEBAR_KEY = "cheapgpt_sidebar_hidden";

  const suggestions = [
    { title: "Explain a concept", text: "Explain how attention works in transformers in simple terms." },
    { title: "Draft an email", text: "Draft a short professional email postponing a meeting by one day." },
    { title: "Debug help", text: "What are common causes of a 502 from a reverse proxy to an upstream app?" },
    { title: "Summarize", text: "Summarize the key differences between REST and GraphQL APIs." },
  ];

  const els = {
    sidebar: document.getElementById("sidebar"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    btnSidebarOpen: document.getElementById("btnSidebarOpen"),
    btnSidebarToggle: document.getElementById("btnSidebarToggle"),
    btnRailToggle: document.getElementById("btnRailToggle"),
    btnRailNewChat: document.getElementById("btnRailNewChat"),
    btnRailRecents: document.getElementById("btnRailRecents"),
    btnNewChat: document.getElementById("btnNewChat"),
    chatList: document.getElementById("chatList"),
    archivedSection: document.getElementById("archivedSection"),
    archivedChatList: document.getElementById("archivedChatList"),
    emptyState: document.getElementById("emptyState"),
    messages: document.getElementById("messages"),
    thread: document.getElementById("thread"),
    btnScrollBottom: document.getElementById("btnScrollBottom"),
    temporaryChatNotice: document.getElementById("temporaryChatNotice"),
    suggestionGrid: document.getElementById("suggestionGrid"),
    composerForm: document.getElementById("composerForm"),
    messageInput: document.getElementById("messageInput"),
    btnStop: document.getElementById("btnStop"),
    btnSend: document.getElementById("btnSend"),
    btnTopNewChat: document.getElementById("btnTopNewChat"),
    modelPicker: document.getElementById("modelPicker"),
    modelPickerBtn: document.getElementById("modelPickerBtn"),
    modelPickerMenu: document.getElementById("modelPickerMenu"),
    modelPickerLabel: document.getElementById("modelPickerLabel"),
    btnTemporaryChat: document.getElementById("btnTemporaryChat"),
    chatMenu: document.getElementById("chatMenu"),
    btnChatMenu: document.getElementById("btnChatMenu"),
    chatMenuPanel: document.getElementById("chatMenuPanel"),
    menuShare: document.getElementById("menuShare"),
    shareModalRoot: document.getElementById("shareModalRoot"),
    shareModalBackdrop: document.getElementById("shareModalBackdrop"),
    shareModal: document.getElementById("shareModal"),
    shareModalTitle: document.getElementById("shareModalTitle"),
    shareModalPreview: document.getElementById("shareModalPreview"),
    shareModalClose: document.getElementById("shareModalClose"),
    shareBtnCopyThread: document.getElementById("shareBtnCopyThread"),
    menuPinChat: document.getElementById("menuPinChat"),
    menuArchiveChat: document.getElementById("menuArchiveChat"),
    menuDeleteChat: document.getElementById("menuDeleteChat"),
    themeDark: document.getElementById("themeDark"),
    themeLight: document.getElementById("themeLight"),
    app: document.getElementById("app"),
  };

  /** @type {{ id: string, title: string, pinned?: boolean, archived?: boolean, messages: { role: string, content: string, feedback?: "up" | "down" | null }[] }[]} */
  let chats = [];
  let activeId = null;

  /** @type {{name: string, supportsThinking: boolean}[]} */
  let availableModels = [];
  /** @type {string} */
  let selectedModel = "";
  let modelMenuOpen = false;
  let thinkingMode = false;
  let temporaryChatMode = false;
  let temporaryChat = null;
  let autoScrollLockedToBottom = true;
  let chatMenuOpen = false;
  /** @type {(typeof chats)[0] | null} */
  let shareModalChat = null;
  /** @type {AbortController | null} */
  let streamAbortController = null;
  /** @type {ReadableStreamDefaultReader<Uint8Array> | null} */
  let activeReader = null;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.chats)) chats = data.chats;
        if (data.activeId && chats.some((c) => c.id === data.activeId)) activeId = data.activeId;
      }
    } catch {
      chats = [];
    }
    if (chats.length === 0) {
      const id = uid();
      chats.push({ id, title: "New chat", messages: [] });
      activeId = id;
      save();
    } else if (!activeId) {
      activeId = chats[0].id;
    }
  }

  function save() {
    if (temporaryChatMode) return;
    // Keep history clean: drop non-active chats that have no messages.
    chats = chats.filter((c) => c.id === activeId || (Array.isArray(c.messages) && c.messages.length > 0));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ chats, activeId }));
    } catch {
      /* ignore quota */
    }
  }

  function ensureTemporaryChat() {
    if (!temporaryChat) {
      temporaryChat = { id: "temporary", title: "Temporary chat", messages: [] };
    }
    return temporaryChat;
  }

  function activeChat() {
    if (temporaryChatMode) return ensureTemporaryChat();
    return chats.find((c) => c.id === activeId) || null;
  }

  function truncateTitle(text, max = 36) {
    const t = text.trim().replace(/\s+/g, " ");
    if (t.length <= max) return t || "New chat";
    return t.slice(0, max - 1) + "…";
  }

  function renderChatList() {
    els.chatList.innerHTML = "";
    if (els.archivedChatList) els.archivedChatList.innerHTML = "";

    const visibleChats = chats
      .filter((c) => Array.isArray(c.messages) && c.messages.length > 0)
      .filter((c) => !c.archived)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    visibleChats.forEach((c) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-item" + (c.id === activeId ? " is-active" : "");
      btn.role = "listitem";
      btn.textContent = (c.pinned ? "📌 " : "") + (c.title || "New chat");
      btn.title = (c.pinned ? "Pinned: " : "") + (c.title || "New chat");
      btn.addEventListener("click", () => selectChat(c.id));
      els.chatList.appendChild(btn);
    });

    const archived = chats.filter((c) => c.archived && Array.isArray(c.messages) && c.messages.length > 0);
    if (els.archivedChatList) {
      archived.forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chat-item" + (c.id === activeId ? " is-active" : "");
        btn.role = "listitem";
        btn.textContent = c.title || "Archived chat";
        btn.title = "Archived: " + (c.title || "Archived chat");
        btn.addEventListener("click", () => selectChat(c.id));
        els.archivedChatList.appendChild(btn);
      });
    }
    if (els.archivedSection) {
      els.archivedSection.hidden = archived.length === 0;
      els.archivedSection.setAttribute("aria-hidden", archived.length === 0 ? "true" : "false");
    }
  }

  function updateEmptyState() {
    const chat = activeChat();
    const empty = !chat || chat.messages.length === 0;
    const hasDraftPrompt = !!(els.messageInput && els.messageInput.value.trim().length > 0);
    const showTemporaryNotice = temporaryChatMode && empty;
    els.emptyState.hidden = !empty || showTemporaryNotice;
    els.messages.hidden = empty;
    if (els.suggestionGrid) {
      // Show built-in prompt cards only for a fresh chat with no typed draft.
      els.suggestionGrid.hidden = !empty || hasDraftPrompt || temporaryChatMode;
    }
    if (els.temporaryChatNotice) {
      els.temporaryChatNotice.hidden = !showTemporaryNotice;
    }
    updateScrollBottomButton();
  }

  let markedCodeBlocksConfigured = false;

  function formatCodeLangLabel(langRaw) {
    const l = (langRaw || "").trim().split(/\s/)[0];
    if (!l) return "Code";
    const low = l.toLowerCase();
    if (low === "plaintext" || low === "text") return "Plain text";
    if (low === "js" || low === "javascript") return "JavaScript";
    if (low === "ts" || low === "typescript") return "TypeScript";
    if (low === "py" || low === "python") return "Python";
    if (low === "sh" || low === "shell" || low === "bash") return "Shell";
    if (low === "cpp" || low === "c++") return "C++";
    return l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();
  }

  function ensureMarkedCodeBlocks() {
    if (markedCodeBlocksConfigured || typeof marked === "undefined" || !marked.use) return;
    markedCodeBlocksConfigured = true;
    marked.use({
      renderer: {
        code({ text, lang, escaped }) {
          const langRaw = (lang || "").trim();
          const langSlug = langRaw.split(/\s/)[0].replace(/[^a-zA-Z0-9_-]/g, "") || "";
          const label = escapeHtml(formatCodeLangLabel(langRaw));
          const r = text.replace(/\n$/, "") + "\n";
          const codeHtml = escaped ? r : escapeHtml(r);
          const langClass = langSlug ? "language-" + escapeHtml(langSlug) : "";
          return (
            '<div class="md-code-frame">' +
            '<div class="md-code-toolbar">' +
            '<span class="md-code-toolbar-left">' +
            '<span class="md-code-lang-icon" aria-hidden="true"></span>' +
            '<span class="md-code-lang-label">' +
            label +
            "</span></span>" +
            '<button type="button" class="md-code-copy-btn" title="Copy code" aria-label="Copy code">' +
            '<span class="md-code-copy-icon" aria-hidden="true"></span></button>' +
            "</div>" +
            '<pre class="md-code-pre"><code' +
            (langClass ? ' class="' + langClass + '"' : "") +
            ">" +
            codeHtml +
            "</code></pre></div>\n"
          );
        },
      },
    });
  }

  function renderMarkdown(html) {
    ensureMarkedCodeBlocks();
    if (typeof marked !== "undefined" && marked.parse) {
      return marked.parse(html, { breaks: true });
    }
    const d = document.createElement("div");
    d.textContent = html;
    return d.innerHTML;
  }

  function appendMessage(role, content, { streaming, messageIndex } = { streaming: false, messageIndex: -1 }) {
    const row = document.createElement("div");
    row.className = "msg-row msg-row--" + role;
    const inner = document.createElement("div");
    inner.className = "msg-row-inner";

    const av = document.createElement("div");
    av.className = "msg-avatar";
    av.textContent = role === "user" ? "You" : "AI";
    av.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "msg-body msg-body--" + role;

    let avatarMount = av;
    if (role === "assistant") {
      const avCol = document.createElement("div");
      avCol.className = "msg-avatar-col";
      avCol.appendChild(av);
      if (streaming) {
        const thinking = document.createElement("div");
        thinking.className = "msg-thinking-dots";
        thinking.setAttribute("role", "status");
        thinking.setAttribute("aria-label", "Assistant is composing a reply");
        for (let i = 0; i < 3; i++) {
          const dot = document.createElement("span");
          dot.className = "msg-thinking-dot";
          dot.setAttribute("aria-hidden", "true");
          thinking.appendChild(dot);
        }
        avCol.appendChild(thinking);
      }
      avatarMount = avCol;
    }

    if (role === "assistant") {
      const md = document.createElement("div");
      md.className = "markdown-body";
      if (streaming) {
        md.innerHTML = "";
      } else {
        md.innerHTML = renderMarkdown(content);
      }
      body.appendChild(md);
      if (!streaming) {
        body.appendChild(createAssistantActions(content, messageIndex));
      }
    } else {
      body.textContent = content;
      if (canEditUserMessage(messageIndex)) {
        const tools = document.createElement("div");
        tools.className = "msg-user-tools";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "msg-user-edit-btn";
        editBtn.innerHTML = '<span class="msg-action-icon icon-edit" aria-hidden="true"></span><span>Edit</span>';
        editBtn.title = "Edit and resend";
        editBtn.addEventListener("click", () => editLastUserMessage(messageIndex));
        tools.appendChild(editBtn);
        body.appendChild(tools);
      }
    }

    inner.appendChild(avatarMount);
    inner.appendChild(body);
    row.appendChild(inner);
    els.messages.appendChild(row);
    scrollThreadToBottom();
    return { row, body };
  }

  function canEditUserMessage(messageIndex) {
    const chat = activeChat();
    if (!chat || messageIndex < 0 || messageIndex >= chat.messages.length) return false;
    const msg = chat.messages[messageIndex];
    const next = chat.messages[messageIndex + 1];
    return (
      msg &&
      msg.role === "user" &&
      next &&
      next.role === "assistant" &&
      messageIndex === chat.messages.length - 2
    );
  }

  function editLastUserMessage(messageIndex) {
    const chat = activeChat();
    if (!chat || !canEditUserMessage(messageIndex) || isSending) return;
    const original = chat.messages[messageIndex].content;
    chat.messages.splice(messageIndex, 2);
    save();
    renderMessages();
    updateEmptyState();
    els.messageInput.value = original;
    autosize();
    updateSendState();
    els.messageInput.focus();
  }

  function createAssistantActions(content, messageIndex) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "msg-action-btn";
    copyBtn.innerHTML =
      '<span class="msg-action-icon icon-copy" aria-hidden="true"></span><span class="msg-action-label">Copy</span>';
    copyBtn.title = "Copy response";
    copyBtn.addEventListener("click", async () => {
      const ok = await copyToClipboard(content);
      copyBtn.querySelector(".msg-action-label").textContent = ok ? "Copied" : "Failed";
      setTimeout(() => {
        copyBtn.querySelector(".msg-action-label").textContent = "Copy";
      }, 1200);
    });

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "msg-action-btn";
    upBtn.innerHTML = '<span class="msg-action-icon icon-thumb-up" aria-hidden="true"></span>';
    upBtn.title = "Good response";

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "msg-action-btn";
    downBtn.innerHTML = '<span class="msg-action-icon icon-thumb-down" aria-hidden="true"></span>';
    downBtn.title = "Bad response";

    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "msg-action-btn";
    regenBtn.innerHTML = '<span class="msg-action-icon icon-refresh" aria-hidden="true"></span>';
    regenBtn.title = "Regenerate";
    regenBtn.disabled = !canRegenerate(messageIndex);
    regenBtn.addEventListener("click", () => regenerateLatest());

    const applyFeedbackUi = () => {
      const chat = activeChat();
      const msg = chat && chat.messages ? chat.messages[messageIndex] : null;
      const val = msg && msg.feedback ? msg.feedback : null;
      upBtn.classList.toggle("is-active", val === "up");
      downBtn.classList.toggle("is-active", val === "down");
    };

    upBtn.addEventListener("click", () => {
      toggleFeedback(messageIndex, "up");
      applyFeedbackUi();
    });
    downBtn.addEventListener("click", () => {
      toggleFeedback(messageIndex, "down");
      applyFeedbackUi();
    });
    applyFeedbackUi();

    actions.appendChild(copyBtn);
    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(regenBtn);
    return actions;
  }

  function canRegenerate(messageIndex) {
    const chat = activeChat();
    if (!chat || messageIndex < 1 || messageIndex >= chat.messages.length) return false;
    const msg = chat.messages[messageIndex];
    const prev = chat.messages[messageIndex - 1];
    return (
      msg &&
      prev &&
      msg.role === "assistant" &&
      prev.role === "user" &&
      messageIndex === chat.messages.length - 1
    );
  }

  function onMarkdownCodeCopyClick(e) {
    const btn = e.target.closest(".md-code-copy-btn");
    if (!btn) return;
    const inThread = els.messages.contains(btn);
    const inSharePreview = els.shareModalRoot && els.shareModalRoot.contains(btn);
    if (!inThread && !inSharePreview) return;
    e.preventDefault();
    const frame = btn.closest(".md-code-frame");
    const codeEl = frame && frame.querySelector("pre.md-code-pre code");
    if (!codeEl) return;
    const src = codeEl.textContent || "";
    copyToClipboard(src).then((ok) => {
      btn.classList.toggle("is-copied", ok);
      btn.setAttribute("aria-label", ok ? "Copied" : "Copy failed");
      window.setTimeout(() => {
        btn.classList.remove("is-copied");
        btn.setAttribute("aria-label", "Copy code");
      }, 1600);
    });
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  function toggleFeedback(messageIndex, value) {
    const chat = activeChat();
    if (!chat || !chat.messages[messageIndex] || chat.messages[messageIndex].role !== "assistant") return;
    const current = chat.messages[messageIndex].feedback || null;
    chat.messages[messageIndex].feedback = current === value ? null : value;
    save();
  }

  async function regenerateLatest() {
    const chat = activeChat();
    if (!chat || chat.messages.length < 2 || isSending) return;
    const last = chat.messages[chat.messages.length - 1];
    const prev = chat.messages[chat.messages.length - 2];
    if (last.role !== "assistant" || prev.role !== "user") return;
    const prompt = prev.content;
    chat.messages.pop();
    save();
    renderMessages();
    await sendMessage(prompt, { regenerate: true });
  }

  function isThreadNearBottom() {
    if (!els.thread) return true;
    return els.thread.scrollHeight - els.thread.scrollTop - els.thread.clientHeight < 80;
  }

  function updateScrollBottomButton() {
    if (!els.btnScrollBottom || !els.thread) return;
    const chat = activeChat();
    const hasMessages = !!(chat && Array.isArray(chat.messages) && chat.messages.length > 0);
    const show = hasMessages && !isThreadNearBottom();
    els.btnScrollBottom.hidden = !show;
  }

  function scrollThreadToBottom(force = false) {
    requestAnimationFrame(() => {
      if (!force && !autoScrollLockedToBottom) {
        updateScrollBottomButton();
        return;
      }
      els.thread.scrollTop = els.thread.scrollHeight;
      updateScrollBottomButton();
    });
  }

  function renderMessages() {
    els.messages.innerHTML = "";
    const chat = activeChat();
    if (!chat) {
      updateScrollBottomButton();
      return;
    }
    chat.messages.forEach((m, i) => {
      appendMessage(m.role, m.content, { messageIndex: i });
    });
    autoScrollLockedToBottom = true;
    scrollThreadToBottom(true);
  }

  function selectChat(id) {
    if (temporaryChatMode) {
      setTemporaryChatMode(false);
    }
    closeChatMenu();
    closeModelMenu();
    closeShareModal();
    activeId = id;
    save();
    renderChatList();
    renderMessages();
    updateEmptyState();
    closeSidebarMobile();
  }

  function openSidebarMobile() {
    closeModelMenu();
    els.sidebar.classList.add("is-open");
    els.sidebarBackdrop.classList.add("is-open");
  }

  function closeSidebarMobile() {
    els.sidebar.classList.remove("is-open");
    els.sidebarBackdrop.classList.remove("is-open");
  }

  function isMobileView() {
    return window.matchMedia("(max-width: 768px)").matches;
  }

  function applySidebarDesktopState(hidden) {
    const app = document.getElementById("app");
    if (!app) return;
    app.classList.toggle("sidebar-hidden", !!hidden);
  }

  function getSavedSidebarHidden() {
    // Always start expanded on page refresh.
    return false;
  }

  function toggleSidebar() {
    if (isMobileView()) {
      if (els.sidebar.classList.contains("is-open")) closeSidebarMobile();
      else openSidebarMobile();
      return;
    }
    const app = document.getElementById("app");
    if (!app) return;
    const hidden = !app.classList.contains("sidebar-hidden");
    applySidebarDesktopState(hidden);
    try {
      localStorage.setItem(SIDEBAR_KEY, hidden ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  function newChat() {
    closeChatMenu();
    closeModelMenu();
    closeShareModal();
    if (temporaryChatMode) {
      temporaryChat = { id: "temporary", title: "Temporary chat", messages: [] };
      renderMessages();
      updateEmptyState();
      closeSidebarMobile();
      els.messageInput.focus();
      return;
    }
    const existing = activeChat();
    if (existing && Array.isArray(existing.messages) && existing.messages.length === 0) {
      // Reuse current empty draft chat instead of creating history clutter.
      closeSidebarMobile();
      els.messageInput.focus();
      return;
    }
    const id = uid();
    chats.unshift({ id, title: "New chat", messages: [] });
    activeId = id;
    save();
    renderChatList();
    renderMessages();
    updateEmptyState();
    closeSidebarMobile();
    els.messageInput.focus();
  }

  function ensureTitleFromFirstMessage(text) {
    if (temporaryChatMode) return;
    const chat = activeChat();
    if (!chat || chat.messages.length > 1) return;
    chat.title = truncateTitle(text, 40);
    save();
    renderChatList();
  }

  let isSending = false;

  function setComposerBusy(busy) {
    isSending = busy;
    els.messageInput.disabled = busy;
    els.btnSend.disabled = busy || els.messageInput.value.trim().length === 0;
    if (els.btnStop) {
      els.btnStop.hidden = !busy;
      els.btnStop.disabled = !busy;
    }
    if (els.btnSend) els.btnSend.hidden = busy;
    if (els.modelPickerBtn) {
      els.modelPickerBtn.disabled = busy || availableModels.length === 0;
    }
  }

  function updateModelPickerLabel() {
    if (!els.modelPickerLabel) return;
    els.modelPickerLabel.innerHTML = '<span class="model-picker-label-brand">CheapGPT</span>';
  }

  function formatThreadForClipboard(chat) {
    const title = (chat.title || "Chat").trim() || "Chat";
    const lines = [title, ""];
    if (!chat.messages || chat.messages.length === 0) {
      lines.push("(No messages in this chat yet.)");
      return lines.join("\n");
    }
    chat.messages.forEach((m) => {
      const who = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
      lines.push(who + ":", (m.content != null ? m.content : "").trimEnd(), "");
    });
    return lines.join("\n").trimEnd() + "\n";
  }

  let toastHideTimer = 0;

  function showAppToast(message) {
    const root = els.app || document.body;
    let el = document.getElementById("cheapgptToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "cheapgptToast";
      el.className = "app-toast";
      el.setAttribute("role", "status");
      root.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-visible");
    window.clearTimeout(toastHideTimer);
    toastHideTimer = window.setTimeout(() => {
      el.classList.remove("is-visible");
    }, 2600);
  }

  function setTemporaryChatMode(enabled, { persist } = { persist: true }) {
    temporaryChatMode = !!enabled;
    if (temporaryChatMode) {
      ensureTemporaryChat();
    }
    if (els.app) {
      els.app.classList.toggle("is-temporary-chat", temporaryChatMode);
    }
    if (els.btnTemporaryChat) {
      els.btnTemporaryChat.classList.toggle("is-active", temporaryChatMode);
      els.btnTemporaryChat.setAttribute("aria-pressed", temporaryChatMode ? "true" : "false");
      els.btnTemporaryChat.title = temporaryChatMode ? "Temporary chat mode: on" : "Temporary chat mode";
    }
    if (persist) {
      try {
        localStorage.setItem(TEMP_CHAT_KEY, temporaryChatMode ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
    }
    if (els.messageInput) {
      els.messageInput.placeholder = temporaryChatMode ? "Temporary chat" : "Ask CheapGPT";
    }
    renderMessages();
    renderChatList();
    updateChatMenuState();
    updateEmptyState();
  }

  function renderSharePreview(chat) {
    if (!els.shareModalPreview) return;
    const root = els.shareModalPreview;
    root.innerHTML = "";
    const scroll = document.createElement("div");
    scroll.className = "share-modal-preview-scroll";
    if (!chat.messages || chat.messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "share-modal-preview-empty";
      empty.textContent = "No messages in this chat yet.";
      scroll.appendChild(empty);
    } else {
      chat.messages.forEach((m) => {
        const row = document.createElement("div");
        row.className = "share-preview-turn share-preview-turn--" + m.role;
        if (m.role === "user") {
          const bubble = document.createElement("div");
          bubble.className = "share-preview-user-bubble";
          bubble.textContent = m.content;
          row.appendChild(bubble);
        } else {
          const block = document.createElement("div");
          block.className = "share-preview-assistant markdown-body";
          block.innerHTML = renderMarkdown(m.content || "");
          row.appendChild(block);
        }
        scroll.appendChild(row);
      });
    }
    root.appendChild(scroll);
  }

  function onShareModalBackdropClick() {
    closeShareModal();
  }

  function onShareModalKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeShareModal();
    }
  }

  function closeShareModal() {
    if (!els.shareModalRoot || !els.shareModalRoot.classList.contains("is-open")) return;
    els.shareModalRoot.classList.remove("is-open");
    els.shareModalRoot.setAttribute("aria-hidden", "true");
    shareModalChat = null;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onShareModalKeyDown, true);
    if (els.shareModalBackdrop) els.shareModalBackdrop.removeEventListener("click", onShareModalBackdropClick);
    if (els.btnChatMenu) els.btnChatMenu.focus();
  }

  function openShareModal() {
    const chat = activeChat();
    if (!chat || !els.shareModalRoot) return;
    if (els.shareModalRoot.classList.contains("is-open")) closeShareModal();
    shareModalChat = chat;
    closeChatMenu();
    if (els.shareModalTitle) els.shareModalTitle.textContent = chat.title || "Share";
    renderSharePreview(chat);
    els.shareModalRoot.classList.add("is-open");
    els.shareModalRoot.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onShareModalKeyDown, true);
    if (els.shareModalBackdrop) els.shareModalBackdrop.addEventListener("click", onShareModalBackdropClick);
    if (els.shareBtnCopyThread) {
      const lab = els.shareBtnCopyThread.querySelector(".share-modal-action-label");
      if (lab) lab.textContent = "Copy conversation";
    }
    requestAnimationFrame(() => {
      if (els.shareModal) els.shareModal.focus();
    });
  }

  async function copyThreadFromShareModal() {
    const chat = shareModalChat || activeChat();
    if (!chat) return;
    const text = formatThreadForClipboard(chat);
    const ok = await copyToClipboard(text);
    if (ok) {
      showAppToast("Conversation copied to clipboard");
      const lab = els.shareBtnCopyThread && els.shareBtnCopyThread.querySelector(".share-modal-action-label");
      if (lab) lab.textContent = "Copied!";
      window.setTimeout(() => {
        if (lab) lab.textContent = "Copy conversation";
      }, 1600);
    } else {
      window.alert("Could not copy to clipboard. Try a secure (https) connection or paste permissions.");
    }
  }

  function updateChatMenuState() {
    const chat = activeChat();
    const hasChat = !!chat && !temporaryChatMode;
    if (els.menuShare) {
      els.menuShare.disabled = !hasChat;
    }
    if (els.menuPinChat) {
      els.menuPinChat.disabled = !hasChat;
      const label = els.menuPinChat.querySelector(".chat-menu-item-label");
      if (label) label.textContent = chat && chat.pinned ? "Unpin chat" : "Pin chat";
    }
    if (els.menuArchiveChat) {
      els.menuArchiveChat.disabled = !hasChat;
      const label = els.menuArchiveChat.querySelector(".chat-menu-item-label");
      if (label) label.textContent = chat && chat.archived ? "Unarchive chat" : "Archive chat";
    }
    if (els.menuDeleteChat) {
      els.menuDeleteChat.disabled = !hasChat;
    }
  }

  function closeChatMenu() {
    if (!chatMenuOpen) return;
    chatMenuOpen = false;
    if (els.chatMenuPanel) els.chatMenuPanel.hidden = true;
    if (els.btnChatMenu) els.btnChatMenu.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onChatMenuDocMouseDown, true);
    document.removeEventListener("keydown", onChatMenuKeyDown, true);
  }

  function openChatMenu() {
    if (chatMenuOpen) return;
    chatMenuOpen = true;
    updateChatMenuState();
    if (els.chatMenuPanel) els.chatMenuPanel.hidden = false;
    if (els.btnChatMenu) els.btnChatMenu.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", onChatMenuDocMouseDown, true);
    document.addEventListener("keydown", onChatMenuKeyDown, true);
  }

  function toggleChatMenu() {
    if (chatMenuOpen) closeChatMenu();
    else openChatMenu();
  }

  function onChatMenuDocMouseDown(e) {
    if (els.chatMenu && !els.chatMenu.contains(e.target)) {
      closeChatMenu();
    }
  }

  function onChatMenuKeyDown(e) {
    if (e.key === "Escape") {
      closeChatMenu();
      if (els.btnChatMenu) els.btnChatMenu.focus();
    }
  }

  function pinOrUnpinChat() {
    if (temporaryChatMode) return;
    const chat = activeChat();
    if (!chat) return;
    chat.pinned = !chat.pinned;
    save();
    renderChatList();
    updateChatMenuState();
  }

  function archiveOrUnarchiveChat() {
    if (temporaryChatMode) return;
    const chat = activeChat();
    if (!chat) return;
    chat.archived = !chat.archived;
    if (chat.archived) {
      const next = chats.find((c) => c.id !== chat.id && !c.archived);
      if (next) {
        activeId = next.id;
      } else {
        const id = uid();
        chats.push({ id, title: "New chat", messages: [] });
        activeId = id;
      }
    }
    save();
    renderChatList();
    renderMessages();
    updateEmptyState();
    updateChatMenuState();
  }

  function deleteActiveChat() {
    if (temporaryChatMode) return;
    const chat = activeChat();
    if (!chat) return;
    const ok = window.confirm("Delete this chat?");
    if (!ok) return;
    const idx = chats.findIndex((c) => c.id === chat.id);
    if (idx >= 0) chats.splice(idx, 1);
    const next = chats.find((c) => !c.archived) || chats[0];
    if (!next) {
      const id = uid();
      chats.push({ id, title: "New chat", messages: [] });
      activeId = id;
    } else {
      activeId = next.id;
    }
    save();
    renderChatList();
    renderMessages();
    updateEmptyState();
    updateChatMenuState();
    closeChatMenu();
    closeShareModal();
  }

  function populateModelMenu() {
    if (!els.modelPickerMenu) return;
    els.modelPickerMenu.innerHTML = "";
    const supportsThinking = modelSupportsThinking(selectedModel);
    const label = document.createElement("div");
    label.className = "model-picker-section-label";
    label.textContent = "Mode";
    els.modelPickerMenu.appendChild(label);

    const instant = document.createElement("button");
    instant.type = "button";
    instant.className = "model-picker-option model-picker-option--with-desc" + (!thinkingMode ? " is-selected" : "");
    instant.innerHTML =
      '<span class="model-picker-check" aria-hidden="true">✓</span><span class="model-picker-option-text"><span class="model-picker-option-title">Instant</span><span class="model-picker-option-desc">For everyday chats</span></span>';
    instant.addEventListener("click", () => setThinkingMode(false));
    els.modelPickerMenu.appendChild(instant);

    const thinking = document.createElement("button");
    thinking.type = "button";
    thinking.className =
      "model-picker-option model-picker-option--with-desc" +
      (thinkingMode ? " is-selected" : "") +
      (supportsThinking ? "" : " is-disabled");
    thinking.innerHTML =
      '<span class="model-picker-check" aria-hidden="true">✓</span><span class="model-picker-option-text"><span class="model-picker-option-title">Thinking</span><span class="model-picker-option-desc">' +
      (supportsThinking ? "For complex questions" : "Not supported by current model") +
      "</span></span>";
    thinking.disabled = !supportsThinking;
    thinking.addEventListener("click", () => setThinkingMode(true));
    els.modelPickerMenu.appendChild(thinking);

    const sep = document.createElement("div");
    sep.className = "model-picker-separator";
    els.modelPickerMenu.appendChild(sep);

    const modelLabel = document.createElement("div");
    modelLabel.className = "model-picker-section-label";
    modelLabel.textContent = "Models";
    els.modelPickerMenu.appendChild(modelLabel);

    const orderedModels = availableModels.slice().sort((a, b) => {
      if (a.name === selectedModel) return -1;
      if (b.name === selectedModel) return 1;
      return 0;
    });

    orderedModels.forEach((model) => {
      const name = model.name;
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "model-picker-option" + (name === selectedModel ? " is-selected" : "");
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", name === selectedModel ? "true" : "false");
      const check = document.createElement("span");
      check.className = "model-picker-check";
      check.textContent = "✓";
      check.setAttribute("aria-hidden", "true");
      const lab = document.createElement("span");
      lab.className = "model-picker-option-label";
      lab.textContent = name;
      opt.appendChild(check);
      opt.appendChild(lab);
      opt.addEventListener("click", () => selectModel(name));
      els.modelPickerMenu.appendChild(opt);
    });
  }

  function onModelMenuDocMouseDown(e) {
    if (els.modelPicker && !els.modelPicker.contains(e.target)) {
      closeModelMenu();
    }
  }

  function onModelMenuKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModelMenu();
      if (els.modelPickerBtn) els.modelPickerBtn.focus();
    }
  }

  function closeModelMenu() {
    if (!modelMenuOpen) return;
    modelMenuOpen = false;
    if (els.modelPickerMenu) els.modelPickerMenu.hidden = true;
    if (els.modelPickerBtn) els.modelPickerBtn.setAttribute("aria-expanded", "false");
    if (els.modelPicker) els.modelPicker.classList.remove("is-open");
    document.removeEventListener("mousedown", onModelMenuDocMouseDown, true);
    document.removeEventListener("keydown", onModelMenuKeydown, true);
  }

  function openModelMenu() {
    if (modelMenuOpen || availableModels.length === 0) return;
    modelMenuOpen = true;
    populateModelMenu();
    if (els.modelPickerMenu) els.modelPickerMenu.hidden = false;
    if (els.modelPickerBtn) els.modelPickerBtn.setAttribute("aria-expanded", "true");
    if (els.modelPicker) els.modelPicker.classList.add("is-open");
    document.addEventListener("mousedown", onModelMenuDocMouseDown, true);
    document.addEventListener("keydown", onModelMenuKeydown, true);
  }

  function toggleModelMenu() {
    if (modelMenuOpen) closeModelMenu();
    else openModelMenu();
  }

  function selectModel(name) {
    if (!availableModels.some((m) => m.name === name)) return;
    selectedModel = name;
    if (!modelSupportsThinking(name)) {
      setThinkingMode(false, { persist: false });
    }
    try {
      localStorage.setItem(MODEL_KEY, selectedModel);
    } catch (e) {
      /* ignore */
    }
    updateModelPickerLabel();
    populateModelMenu();
    closeModelMenu();
  }

  function modelSupportsThinking(name) {
    const m = availableModels.find((x) => x.name === name);
    return !!(m && m.supportsThinking);
  }

  function setThinkingMode(enabled, { persist } = { persist: true }) {
    thinkingMode = !!enabled && modelSupportsThinking(selectedModel);
    if (persist) {
      try {
        localStorage.setItem(THINKING_KEY, thinkingMode ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
    }
    updateModelPickerLabel();
    populateModelMenu();
    closeModelMenu();
  }

  async function loadModels() {
    if (!els.modelPickerLabel || !els.modelPickerBtn) return;
    try {
      const r = await fetch("/api/models");
      if (!r.ok) {
        let msg = r.statusText;
        const t = await r.text();
        if (t) {
          try {
            const errJson = JSON.parse(t);
            if (errJson.detail != null) {
              msg = typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
            } else {
              msg = t.slice(0, 200);
            }
          } catch (e) {
            msg = t.slice(0, 200);
          }
        }
        throw new Error(msg);
      }
      const j = await r.json();
      availableModels = (j.models || [])
        .map(function (m) {
          if (!m || !m.name) return null;
          return { name: m.name, supportsThinking: !!m.supports_thinking };
        })
        .filter(Boolean);

      let stored = null;
      try {
        stored = localStorage.getItem(MODEL_KEY);
      } catch (e) {
        /* ignore */
      }

      if (stored && availableModels.some((m) => m.name === stored)) {
        selectedModel = stored;
      } else if (j.default_model && availableModels.some((m) => m.name === j.default_model)) {
        selectedModel = j.default_model;
      } else {
        selectedModel = availableModels[0] ? availableModels[0].name : "";
      }

      if (selectedModel) {
        try {
          localStorage.setItem(MODEL_KEY, selectedModel);
        } catch (e) {
          /* ignore */
        }
      }

      try {
        thinkingMode = localStorage.getItem(THINKING_KEY) === "1";
      } catch (e) {
        thinkingMode = false;
      }
      if (!modelSupportsThinking(selectedModel)) {
        thinkingMode = false;
      }

      populateModelMenu();
      updateModelPickerLabel();
      els.modelPickerBtn.disabled = availableModels.length === 0 || isSending;
    } catch (e) {
      availableModels = [];
      selectedModel = "";
      updateModelPickerLabel();
      if (els.modelPickerMenu) els.modelPickerMenu.innerHTML = "";
      els.modelPickerBtn.disabled = true;
    }
  }

  /**
   * @param {{ role: string, content: string }[]} messages
   * @param {(accumulated: string) => void} onDelta
   * @returns {Promise<string>}
   */
  async function streamChat(messages, onDelta) {
    streamAbortController = new AbortController();
    activeReader = null;
    let res;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel || null,
          messages:
            thinkingMode && modelSupportsThinking(selectedModel)
              ? [{ role: "system", content: "Thinking mode: reason step by step internally and provide a concise final answer." }].concat(messages)
              : messages,
        }),
        signal: streamAbortController.signal,
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new Error("Network error: " + (e && e.message ? e.message : String(e)));
    }
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "HTTP " + res.status);
    }
    const reader = res.body.getReader();
    activeReader = reader;
    const dec = new TextDecoder();
    let acc = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += dec.decode(value, { stream: true });
      onDelta(acc);
    }
    acc += dec.decode();
    onDelta(acc);
    return acc;
  }

  async function sendMessage(text, { regenerate } = { regenerate: false }) {
    const chat = activeChat();
    if (!chat || !text.trim() || isSending) return;

    const userText = text.trim();
    if (!regenerate) {
      chat.messages.push({ role: "user", content: userText });
      ensureTitleFromFirstMessage(userText);
    }

    updateEmptyState();
    renderMessages();

    const { body } = appendMessage("assistant", "", { streaming: true, messageIndex: chat.messages.length });
    const md = body.querySelector(".markdown-body");
    if (!md) return;

    setComposerBusy(true);
    const shouldShowThinking = thinkingMode && modelSupportsThinking(selectedModel);
    let thinkingTimer = null;
    let thinkingStart = 0;
    if (shouldShowThinking) {
      thinkingStart = Date.now();
      md.innerHTML =
        '<div class="thinking-banner"><span class="thinking-dot" aria-hidden="true"></span><span>Thinking</span><span class="thinking-time" id="thinkingTime">0s</span></div>';
      thinkingTimer = setInterval(() => {
        const t = md.querySelector("#thinkingTime");
        if (t) t.textContent = formatThinkingSeconds(Date.now() - thinkingStart);
      }, 250);
    }

    const renderAccumulated = (full) => {
      if (thinkingTimer) {
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
      const row = md.closest(".msg-row");
      const dots = row && row.querySelector(".msg-thinking-dots");
      const hasStreamText = full.trim().length > 0;
      if (dots && (hasStreamText || full.startsWith("[error]"))) {
        dots.remove();
      }
      if (full.startsWith("[error]")) {
        md.innerHTML = '<p class="chat-error"></p>';
        md.querySelector(".chat-error").textContent = full;
      } else {
        md.innerHTML = renderMarkdown(full);
      }
      scrollThreadToBottom();
    };

    let reply = "";
    let latestAccumulated = "";
    try {
      reply = await streamChat(chat.messages, (full) => {
        latestAccumulated = full;
        renderAccumulated(full);
      });
    } catch (e) {
      if (e && e.name === "AbortError") {
        reply = latestAccumulated || "[stopped]";
      } else {
        reply = "[error] " + (e && e.message ? e.message : String(e));
        renderAccumulated(reply);
      }
    } finally {
      if (thinkingTimer) {
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
      if (activeReader) {
        try {
          await activeReader.cancel();
        } catch (e) {
          /* ignore */
        }
      }
      activeReader = null;
      streamAbortController = null;
    }

    chat.messages.push({ role: "assistant", content: reply, feedback: null });
    save();
    // Re-render so the completed assistant message gets its action toolbar.
    renderMessages();
    setComposerBusy(false);
    updateSendState();
  }

  function buildSuggestions() {
    els.suggestionGrid.innerHTML = "";
    suggestions.forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "suggestion-card";
      b.innerHTML = "<strong>" + escapeHtml(s.title) + "</strong>" + escapeHtml(s.text);
      b.addEventListener("click", () => {
        els.messageInput.value = s.text;
        autosize();
        updateSendState();
        els.messageInput.focus();
      });
      els.suggestionGrid.appendChild(b);
    });
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function autosize() {
    const ta = els.messageInput;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }

  function updateSendState() {
    const v = els.messageInput.value.trim();
    els.btnSend.disabled = isSending || v.length === 0;
  }

  function formatThinkingSeconds(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return s + "s";
  }

  function getStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "light" || t === "dark") return t;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function syncThemeUi(theme) {
    const dark = theme === "dark";
    if (els.themeDark) els.themeDark.setAttribute("aria-pressed", dark ? "true" : "false");
    if (els.themeLight) els.themeLight.setAttribute("aria-pressed", dark ? "false" : "true");
  }

  function setTheme(theme) {
    const t = theme === "light" ? "light" : "dark";
    if (t === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch (e) {
      /* ignore */
    }
    syncThemeUi(t);
  }

  function initTheme() {
    const stored = getStoredTheme();
    if (stored === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      syncThemeUi("dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
      syncThemeUi("light");
    }
  }

  /* Init */
  initTheme();
  applySidebarDesktopState(getSavedSidebarHidden());
  load();
  buildSuggestions();
  renderChatList();
  renderMessages();
  updateEmptyState();
  updateChatMenuState();
  loadModels();

  if (els.modelPickerBtn) {
    els.modelPickerBtn.addEventListener("click", function () {
      if (els.modelPickerBtn.disabled) return;
      toggleModelMenu();
    });
  }

  if (els.btnChatMenu) {
    els.btnChatMenu.addEventListener("click", () => toggleChatMenu());
  }
  if (els.menuShare) {
    els.menuShare.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openShareModal();
    });
  }
  if (els.shareModalClose) {
    els.shareModalClose.addEventListener("click", () => closeShareModal());
  }
  if (els.shareBtnCopyThread) {
    els.shareBtnCopyThread.addEventListener("click", () => {
      void copyThreadFromShareModal();
    });
  }
  if (els.menuPinChat) {
    els.menuPinChat.addEventListener("click", () => {
      pinOrUnpinChat();
      closeChatMenu();
    });
  }
  if (els.menuArchiveChat) {
    els.menuArchiveChat.addEventListener("click", () => {
      archiveOrUnarchiveChat();
      closeChatMenu();
    });
  }
  if (els.menuDeleteChat) {
    els.menuDeleteChat.addEventListener("click", deleteActiveChat);
  }

  if (els.btnSidebarOpen) {
    els.btnSidebarOpen.addEventListener("click", () => {
      if (isMobileView()) openSidebarMobile();
      else applySidebarDesktopState(false);
    });
  }
  if (els.btnSidebarToggle) {
    els.btnSidebarToggle.addEventListener("click", toggleSidebar);
  }
  if (els.btnRailToggle) {
    els.btnRailToggle.addEventListener("click", toggleSidebar);
  }
  if (els.btnRailNewChat) {
    els.btnRailNewChat.addEventListener("click", newChat);
  }
  if (els.btnTopNewChat) {
    els.btnTopNewChat.addEventListener("click", newChat);
  }
  if (els.btnTemporaryChat) {
    els.btnTemporaryChat.addEventListener("click", () => {
      setTemporaryChatMode(!temporaryChatMode);
    });
  }
  if (els.btnRailRecents) {
    els.btnRailRecents.addEventListener("click", () => {
      if (isMobileView()) {
        openSidebarMobile();
      } else {
        applySidebarDesktopState(false);
        try {
          localStorage.setItem(SIDEBAR_KEY, "0");
        } catch (e) {
          /* ignore */
        }
      }
    });
  }
  if (els.btnScrollBottom) {
    els.btnScrollBottom.addEventListener("click", () => {
      autoScrollLockedToBottom = true;
      scrollThreadToBottom(true);
    });
  }
  els.sidebarBackdrop.addEventListener("click", closeSidebarMobile);
  els.btnNewChat.addEventListener("click", newChat);
  if (els.btnStop) {
    els.btnStop.addEventListener("click", async () => {
      if (!isSending) return;
      if (streamAbortController) streamAbortController.abort();
      if (activeReader) {
        try {
          await activeReader.cancel();
        } catch (e) {
          /* ignore */
        }
      }
    });
  }

  if (els.themeDark) els.themeDark.addEventListener("click", () => setTheme("dark"));
  if (els.themeLight) els.themeLight.addEventListener("click", () => setTheme("light"));

  els.messages.addEventListener("click", onMarkdownCodeCopyClick);
  if (els.shareModalRoot) {
    els.shareModalRoot.addEventListener("click", onMarkdownCodeCopyClick);
  }

  els.composerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = els.messageInput.value;
    if (!text.trim()) return;
    els.messageInput.value = "";
    autosize();
    updateSendState();
    await sendMessage(text);
  });

  els.messageInput.addEventListener("input", () => {
    autosize();
    updateSendState();
    updateEmptyState();
  });

  els.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!els.btnSend.disabled) els.composerForm.requestSubmit();
    }
  });
  if (els.thread) {
    els.thread.addEventListener(
      "scroll",
      () => {
        autoScrollLockedToBottom = isThreadNearBottom();
        updateScrollBottomButton();
      },
      { passive: true }
    );
  }

  updateSendState();
  updateScrollBottomButton();
  try {
    setTemporaryChatMode(localStorage.getItem(TEMP_CHAT_KEY) === "1", { persist: false });
  } catch (e) {
    setTemporaryChatMode(false, { persist: false });
  }
  if (els.btnStop) {
    els.btnStop.hidden = true;
    els.btnStop.disabled = true;
  }
  autosize();
})();
