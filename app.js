import { APP, METRICS } from './js/config.js';
import { ApiError, isAbortError, isConfigured, recognizeProblem, testConnection } from './js/api.js';
import { StudentAgent, TeacherAgent, humanTurnCount } from './js/agents.js';
import {
  ClassroomStore,
  STATUS,
  clearSettings,
  loadSettings,
  maskKey
} from './js/store.js';
import { SpeechInput } from './js/speech.js';
import { HandwritingPad } from './js/canvas.js';
import {
  archiveSession,
  clearHistory,
  deleteRecord,
  loadHistory,
  reportToText,
  summarizeHistory
} from './js/history.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const TEXT_ONLY_MODELS = new Set([
  'deepseek/deepseek-chat-v3-0324',
  'qwen/qwen3.7-flash'
]);

function isTextOnlyModel(model) {
  return TEXT_ONLY_MODELS.has(String(model || '').trim().toLowerCase());
}

function warnTextOnlyModel() {
  toast('当前模型只支持文字，看不了图片。请到设置把模型换成 qwen/qwen3-vl-30b-a3b-instruct。', 'warm', 8000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineFormat(value) {
  return escapeHtml(value)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s（(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function renderMarkdown(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let list = null;

  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    let match = trimmed.match(/^[-*•]\s+(.*)$/);
    if (match) {
      if (list !== 'ul') {
        closeList();
        html += '<ul>';
        list = 'ul';
      }
      html += `<li>${inlineFormat(match[1])}</li>`;
      continue;
    }

    match = trimmed.match(/^\d+[.、)]\s+(.*)$/);
    if (match) {
      if (list !== 'ol') {
        closeList();
        html += '<ol>';
        list = 'ol';
      }
      html += `<li>${inlineFormat(match[1])}</li>`;
      continue;
    }

    closeList();

    if (/^[-—_=]{3,}$/.test(trimmed)) {
      html += '<hr>';
      continue;
    }
    if ((match = trimmed.match(/^#{1,6}\s+(.*)$/))) {
      html += `<p><strong>${inlineFormat(match[1])}</strong></p>`;
      continue;
    }
    if ((match = trimmed.match(/^>\s?(.*)$/))) {
      html += `<blockquote>${inlineFormat(match[1])}</blockquote>`;
      continue;
    }
    html += `<p>${inlineFormat(line)}</p>`;
  }

  closeList();
  return html;
}

function plainText(raw) {
  return escapeHtml(raw || '').replace(/\n/g, '<br>');
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/* -------------------------------------------------------------------------- */
/* DOM references                                                             */
/* -------------------------------------------------------------------------- */

const refs = {
  brandHome: $('#brandHome'),
  topbarSession: $('#topbarSession'),
  topbarTopic: $('#topbarTopic'),
  connectionPill: $('#connectionPill'),
  connectionLabel: $('#connectionLabel'),
  settingsBtn: $('#settingsBtn'),
  historyBtn: $('#historyBtn'),
  homeHistoryBtn: $('#homeHistoryBtn'),
  homeHistoryMeta: $('#homeHistoryMeta'),
  endSessionBtn: $('#endSessionBtn'),
  homeScreen: $('#homeScreen'),
  chatScreen: $('#chatScreen'),
  topicInput: $('#topicInput'),
  exampleChips: $('#exampleChips'),
  topicImageInput: $('#topicImageInput'),
  topicImageBtn: $('#topicImageBtn'),
  topicImageHint: $('#topicImageHint'),
  topicImagePreview: $('#topicImagePreview'),
  topicImageThumb: $('#topicImageThumb'),
  removeTopicImage: $('#removeTopicImage'),
  startBtn: $('#startBtn'),
  roundBadge: $('#roundBadge'),
  callTeacherMobile: $('#callTeacherMobile'),
  callTeacherMobileLabel: $('#callTeacherMobileLabel'),
  chatBody: $('#chatBody'),
  topicCard: $('#topicCard'),
  topicCardBody: $('#topicCardBody'),
  topicCardText: $('#topicCardText'),
  topicCardImage: $('#topicCardImage'),
  topicToggleBtn: $('#topicToggleBtn'),
  messageList: $('#messageList'),
  typingIndicator: $('#typingIndicator'),
  composer: $('#composer'),
  pendingImages: $('#pendingImages'),
  messageInput: $('#messageInput'),
  chatImageInput: $('#chatImageInput'),
  attachBtn: $('#attachBtn'),
  handwritingBtn: $('#handwritingBtn'),
  micBtn: $('#micBtn'),
  micLabel: $('#micLabel'),
  sendBtn: $('#sendBtn'),
  callTeacherBtn: $('#callTeacherBtn'),
  callTeacherLabel: $('#callTeacherLabel'),
  viewLastReportBtn: $('#viewLastReportBtn'),
  sideStatusDot: $('#sideStatusDot'),
  sideModelName: $('#sideModelName'),
  sideModelHint: $('#sideModelHint'),
  statTurns: $('#statTurns'),
  statQuestions: $('#statQuestions'),
  reportModal: $('#reportModal'),
  reportLoading: $('#reportLoading'),
  reportError: $('#reportError'),
  reportErrorText: $('#reportErrorText'),
  retryReportBtn: $('#retryReportBtn'),
  reportContent: $('#reportContent'),
  reportTopic: $('#reportTopic'),
  overallRing: $('#overallRing'),
  overallScore: $('#overallScore'),
  reportVerdict: $('#reportVerdict'),
  metricGrid: $('#metricGrid'),
  misconceptionList: $('#misconceptionList'),
  nextStepList: $('#nextStepList'),
  strengthsSection: $('#strengthsSection'),
  strengthList: $('#strengthList'),
  reportEncouragement: $('#reportEncouragement'),
  copyReportBtn: $('#copyReportBtn'),
  restartFromReportBtn: $('#restartFromReportBtn'),
  historyModal: $('#historyModal'),
  historyEmpty: $('#historyEmpty'),
  historyContent: $('#historyContent'),
  historySummary: $('#historySummary'),
  historyTrendChart: $('#historyTrendChart'),
  historyTrendMeta: $('#historyTrendMeta'),
  historyDimensions: $('#historyDimensions'),
  historyList: $('#historyList'),
  clearHistoryBtn: $('#clearHistoryBtn'),
  settingsModal: $('#settingsModal'),
  settingsForm: $('#settingsForm'),
  apiKeyInput: $('#apiKeyInput'),
  toggleKeyBtn: $('#toggleKeyBtn'),
  modelInput: $('#modelInput'),
  modelPresets: $('#modelPresets'),
  temperatureInput: $('#temperatureInput'),
  temperatureValue: $('#temperatureValue'),
  baseUrlInput: $('#baseUrlInput'),
  proxyUrlInput: $('#proxyUrlInput'),
  accessCodeInput: $('#accessCodeInput'),
  settingsStatus: $('#settingsStatus'),
  testKeyBtn: $('#testKeyBtn'),
  clearKeyBtn: $('#clearKeyBtn'),
  saveSettingsBtn: $('#saveSettingsBtn'),
  handwritingModal: $('#handwritingModal'),
  handwritingCanvas: $('#handwritingCanvas'),
  padPlaceholder: $('#padPlaceholder'),
  eraserBtn: $('#eraserBtn'),
  undoBtn: $('#undoBtn'),
  clearPadBtn: $('#clearPadBtn'),
  insertHandwritingBtn: $('#insertHandwritingBtn'),
  imageLightbox: $('#imageLightbox'),
  lightboxImage: $('#lightboxImage'),
  closeLightbox: $('#closeLightbox'),
  toastStack: $('#toastStack')
};

/* -------------------------------------------------------------------------- */
/* Runtime state                                                              */
/* -------------------------------------------------------------------------- */

const store = new ClassroomStore();
const studentAgent = new StudentAgent();
const teacherAgent = new TeacherAgent();

let pendingImages = [];
let topicImage = null;
let studentAbort = null;
let teacherAbort = null;
let activeModalId = null;
let lastFocused = null;
let startAfterSettings = false;
let connectionIssue = false;
let currentReport = null;
let currentReportTopic = '';
let reportFromArchive = false;
let openHistoryIds = new Set();
let pad = null;
let speech = null;
let speechBase = '';
let renderedSessionId = null;
let lastPersistenceWarning = '';

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

init();

function init() {
  populateExamples();
  populateModelPresets();
  fillSettingsForm();
  setupSpeech();
  bindEvents();
  renderHistoryEntry();

  if (store.session) {
    renderedSessionId = store.session.id;
    renderSession();
    showScreen('chat');
    requestAnimationFrame(() => scrollToBottom(true));
    if (store.restored) {
      setTimeout(() => toast('已恢复上次讲课，可以接着讲。', 'success', 3600), 450);
    }
  } else {
    showScreen('home');
  }

  renderConnection();
  store.subscribe(onStoreChange);
  maybeWelcome();
}

function populateExamples() {
  for (const sample of APP.samples) {
    const chip = el('button', 'example-chip', sample);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      refs.topicInput.value = sample;
      refs.topicInput.focus();
      autoGrowTopic();
    });
    refs.exampleChips.append(chip);
  }
}

function populateModelPresets() {
  for (const preset of APP.modelPresets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.label = preset.label;
    refs.modelPresets.append(option);
  }
}

function maybeWelcome() {
  if (isConfigured(store.settings)) return;
  try {
    if (localStorage.getItem(APP.storage.welcomed)) return;
    localStorage.setItem(APP.storage.welcomed, '1');
  } catch {
    /* Storage may be unavailable. */
  }
  setTimeout(() => {
    toast('第一次来？点右上角「设置」填入 API Key，就可以开课了。', 'warm', 8500);
  }, 1400);
}

/* -------------------------------------------------------------------------- */
/* Store → UI                                                                 */
/* -------------------------------------------------------------------------- */

function onStoreChange() {
  const session = store.session;
  const sessionId = session?.id || null;

  if (sessionId !== renderedSessionId) {
    renderedSessionId = sessionId;
    if (session) renderSession();
  }

  if (!session || store.state.status === STATUS.HOME) {
    showScreen('home');
  } else {
    showScreen('chat');
  }

  syncChrome();

  if (store.persistenceWarning && store.persistenceWarning !== lastPersistenceWarning) {
    lastPersistenceWarning = store.persistenceWarning;
    toast(store.persistenceWarning, 'warm', 7000);
  }
  if (!store.persistenceWarning) lastPersistenceWarning = '';
}

function showScreen(name) {
  const isChat = name === 'chat';
  refs.homeScreen.hidden = isChat;
  refs.chatScreen.hidden = !isChat;
  document.body.classList.toggle('is-chat', isChat);
  refs.topbarSession.hidden = !isChat;
  refs.endSessionBtn.hidden = !isChat;
  if (isChat) {
    refs.topbarTopic.textContent = store.session?.topic || '';
    document.title = store.session ? `${store.session.topic} · 费曼小课堂` : '费曼小课堂';
  } else {
    document.title = '费曼小课堂 · 讲给一个会追问的学生听';
  }
}

function syncChrome() {
  const session = store.session;
  const evaluating = store.state.status === STATUS.EVALUATING;
  const busy = store.busy;
  const hasReport = Boolean(session?.report);

  refs.topbarTopic.textContent = session?.topic || '';
  renderTopicCard(session);
  const turns = session ? humanTurnCount(session) : 0;
  const questions = session
    ? session.messages.filter((message) => !message.hidden && message.role === 'assistant').length
    : 0;

  refs.roundBadge.textContent = `第 ${turns} 轮`;
  refs.statTurns.textContent = String(turns);
  refs.statQuestions.textContent = String(questions);

  refs.callTeacherBtn.disabled = !session || busy || evaluating;
  refs.callTeacherMobile.disabled = !session || busy || evaluating;
  refs.callTeacherLabel.textContent = evaluating
    ? '陈老师正在看…'
    : hasReport
      ? '更新诊断报告'
      : '呼叫 AI 老师点评';
  refs.callTeacherMobileLabel.textContent = evaluating
    ? '老师在看…'
    : hasReport
      ? '更新报告'
      : '呼叫老师';

  refs.viewLastReportBtn.hidden = !hasReport;
  refs.viewLastReportBtn.textContent = hasReport ? '查看报告 →' : '';

  const sendLabel = refs.sendBtn.querySelector('span');
  if (sendLabel) sendLabel.textContent = busy ? '停止' : '发送';
  refs.sendBtn.classList.toggle('is-stop', busy);
  refs.sendBtn.setAttribute('aria-label', busy ? '停止生成' : '发送讲解');

  refs.attachBtn.disabled = busy;
  refs.handwritingBtn.disabled = busy;
  refs.micBtn.disabled = busy;
  refs.messageInput.disabled = busy;

  refs.endSessionBtn.hidden = !session;
  refs.topbarSession.hidden = !session;

  renderConnection();
  updateSettingsButtonState();
}

function renderTopicCard(session) {
  if (!refs.topicCard) return;
  const topic = (session?.topic || '').trim();
  const image = session?.messages?.[0]?.images?.[0] || '';

  refs.topicCard.hidden = !topic;
  if (refs.topbarTopic) refs.topbarTopic.title = topic;

  if (refs.topicCardText && refs.topicCardText.textContent !== topic) {
    refs.topicCardText.textContent = topic;
    refs.topicCard.classList.remove('is-collapsed');
    if (refs.topicToggleBtn) refs.topicToggleBtn.textContent = '收起';
  }

  if (refs.topicCardImage && refs.topicCardImage.dataset.src !== image) {
    refs.topicCardImage.dataset.src = image;
    if (image) {
      refs.topicCardImage.src = image;
      refs.topicCardImage.hidden = false;
    } else {
      refs.topicCardImage.removeAttribute('src');
      refs.topicCardImage.hidden = true;
    }
  }

  updateTopicToggle();
}

function updateTopicToggle() {
  if (!refs.topicCard || !refs.topicCardBody || !refs.topicToggleBtn) return;
  if (refs.topicCard.hidden) {
    refs.topicToggleBtn.hidden = true;
    return;
  }
  requestAnimationFrame(() => {
    if (!refs.topicCard || !refs.topicCardBody || !refs.topicToggleBtn) return;
    if (refs.topicCard.hidden) return;
    const body = refs.topicCardBody;
    const collapsed = refs.topicCard.classList.contains('is-collapsed');
    // scrollHeight is the full content height even while collapsed.
    const limit = Math.min(window.innerHeight * 0.34, 240);
    const tall = body.scrollHeight > limit + 2;
    refs.topicToggleBtn.hidden = !tall;
    refs.topicToggleBtn.textContent = collapsed ? '展开全文' : '收起';
  });
}

function toggleTopicCard() {
  if (!refs.topicCard || !refs.topicCardBody || !refs.topicToggleBtn) return;
  const collapsed = refs.topicCard.classList.toggle('is-collapsed');
  refs.topicToggleBtn.textContent = collapsed ? '展开全文' : '收起';
  if (collapsed) {
    refs.topicCardBody.scrollTop = 0;
  }
  updateTopicToggle();
}

function renderConnection() {
  const connected = isConfigured(store.settings);
  const healthy = connected && !connectionIssue;

  refs.connectionPill.classList.toggle('is-connected', healthy);
  refs.connectionPill.classList.toggle('is-error', connected && connectionIssue);
  refs.connectionLabel.textContent = connected ? (connectionIssue ? '连接异常' : 'AI 已连接') : '未连接';

  refs.sideStatusDot.classList.toggle('is-connected', healthy);
  refs.sideStatusDot.classList.toggle('is-error', connected && connectionIssue);
  refs.sideModelName.textContent = connected ? store.settings.model : '未连接 AI';
  refs.sideModelHint.textContent = connected
    ? store.settings.proxyUrl
      ? '课堂共享代理 · 无需 Key'
      : `${maskKey(store.settings.apiKey)} · Key 仅存本机`
    : '在设置中填入 API Key，或使用课堂共享代理';
}

function updateSettingsButtonState() {
  refs.settingsBtn.classList.toggle('has-key', isConfigured(store.settings));
}

/* -------------------------------------------------------------------------- */
/* Session rendering                                                          */
/* -------------------------------------------------------------------------- */

function visibleMessages() {
  return store.session ? store.session.messages.filter((message) => !message.hidden) : [];
}

function renderSession() {
  const session = store.session;
  if (!session) return;

  refs.topbarTopic.textContent = session.topic;
  refs.messageList.replaceChildren();

  for (const message of visibleMessages()) {
    refs.messageList.append(renderMessage(message));
  }

  refs.typingIndicator.hidden = true;
  syncChrome();
  requestAnimationFrame(() => scrollToBottom(true));
}

function renderMessage(message) {
  const isUser = message.role === 'user';
  const row = el('article', `message-row ${isUser ? 'user' : 'student'}`);
  row.id = `msg-${message.id}`;
  row.dataset.id = message.id;

  const avatar = el('div', `message-avatar ${isUser ? 'user-avatar' : 'student-avatar'}`, isUser ? '我' : '问');
  avatar.setAttribute('aria-hidden', 'true');

  const main = el('div', 'message-main');
  const meta = el('div', 'message-meta');
  meta.append(
    el('span', 'message-name', isUser ? '我 · 老师' : '小问 · AI 学生'),
    el('span', 'message-time', formatTime(message.createdAt))
  );

  const bubble = el('div', 'bubble');

  if (Array.isArray(message.images) && message.images.length) {
    const gallery = el('div', 'bubble-images');
    message.images.forEach((src, index) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = `上传的图片 ${index + 1}`;
      img.loading = 'lazy';
      img.dataset.zoom = 'true';
      gallery.append(img);
    });
    bubble.append(gallery);
  }

  const content = el('div', 'bubble-content');
  if (isUser) {
    content.innerHTML = plainText(message.content);
  } else {
    content.innerHTML = renderMarkdown(message.content);
  }
  bubble.append(content);

  if (message.streaming) {
    bubble.append(el('span', 'stream-cursor'));
  }

  main.append(meta, bubble);
  row.append(avatar, main);
  return row;
}

function appendMessageElement(message) {
  if (!message || message.hidden) return;
  refs.messageList.append(renderMessage(message));
  scrollToBottom(true);
}

function updateStreamingMessage(id, text) {
  const row = document.getElementById(`msg-${id}`);
  if (!row) return;
  const content = row.querySelector('.bubble-content');
  if (content) {
    content.innerHTML = `${renderMarkdown(text)}<span class="stream-cursor"></span>`;
  }
  scrollToBottom();
}

function finalizeMessageElement(id) {
  const message = store.session?.messages.find((item) => item.id === id);
  const row = document.getElementById(`msg-${id}`);
  if (message && row) {
    row.replaceWith(renderMessage(message));
  }
}

function appendNotice(text) {
  const notice = el('div', 'system-notice', text);
  refs.messageList.append(notice);
  scrollToBottom(true);
}

function scrollToBottom(force = false) {
  if (!refs.chatBody) return;
  const body = refs.chatBody;
  const near = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
  if (force || near) {
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
    });
  }
}

function showTyping(show) {
  refs.typingIndicator.hidden = !show;
  if (show) scrollToBottom(true);
}

/* -------------------------------------------------------------------------- */
/* Start, send, student agent                                                 */
/* -------------------------------------------------------------------------- */

async function handleStart() {
  if (store.busy) return;
  let topic = refs.topicInput.value.trim();
  const image = topicImage;

  if (!topic && !image) {
    toast('写一个数学主题/题目，或者直接上传题目图片。', 'warm');
    refs.topicInput.focus();
    return;
  }
  if (topic && topic.length < 2) {
    toast('主题太短了，再具体一点。', 'warm');
    refs.topicInput.focus();
    return;
  }
  if (!isConfigured(store.settings)) {
    startAfterSettings = true;
    fillSettingsForm();
    openModal('settingsModal');
    toast('先连接你的 AI：填入 API Key，或使用课堂共享代理，保存后会自动开课。', 'warm', 6500);
    return;
  }

  if (image && isTextOnlyModel(store.settings.model)) {
    warnTextOnlyModel();
    startAfterSettings = true;
    fillSettingsForm();
    openModal('settingsModal');
    return;
  }

  if (!topic && image) {
    topic = await recognizeTopicFromImage(image);
    if (!topic) return;
  }

  store.start(topic, image);
  refs.topicInput.value = '';
  clearTopicImage();
  showScreen('chat');
  requestAnimationFrame(() => scrollToBottom(true));
  requestStudent();
}

async function recognizeTopicFromImage(image) {
  const label = refs.startBtn.querySelector('span') || refs.startBtn;
  const original = label.textContent;
  refs.startBtn.disabled = true;
  label.textContent = '正在识别题目…';
  toast('正在从图片里识别题目，请稍等。', 'busy', 4000);

  try {
    const text = await recognizeProblem({ settings: store.settings, image });
    refs.topicInput.value = text;
    autoGrowTopic();
    return text;
  } catch (error) {
    handleApiError(error, { openSettingsOnAuth: false });
    refs.topicInput.focus();
    return '';
  } finally {
    refs.startBtn.disabled = false;
    label.textContent = original;
  }
}

function handleSend(event) {
  event?.preventDefault();
  if (store.busy) {
    studentAbort?.abort();
    return;
  }
  if (!store.session) return;

  const content = refs.messageInput.value.trim();
  const images = pendingImages.slice(0, APP.limits.maxImages);
  if (!content && !images.length) {
    toast('写点什么再发给小问吧。', 'warm');
    refs.messageInput.focus();
    return;
  }
  if (images.length && isTextOnlyModel(store.settings.model)) {
    warnTextOnlyModel();
    return;
  }
  if (!ensureKey()) return;

  if (speech?.listening) speech.stop();

  const message = store.addMessage('user', content, images);
  if (!message) return;

  refs.messageInput.value = '';
  pendingImages = [];
  renderPendingImages();
  autoGrowMessage();
  speechBase = '';
  appendMessageElement(message);
  requestStudent();
}

async function requestStudent() {
  if (!store.session || store.busy) return;
  if (!ensureKey()) return;

  const sessionId = store.session.id;
  store.setBusy(true);
  showTyping(true);

  const controller = new AbortController();
  studentAbort = controller;
  let assistant = null;
  let received = false;

  try {
    await studentAgent.reply({
      session: store.session,
      settings: store.settings,
      signal: controller.signal,
      onDelta: (delta) => {
        if (!store.session || store.session.id !== sessionId) return;
        received = true;
        if (!assistant) {
          showTyping(false);
          assistant = store.addMessage('assistant', '', []);
          if (assistant) appendMessageElement(assistant);
        }
        if (!assistant) return;
        store.appendToMessage(assistant.id, delta, { persist: false });
        updateStreamingMessage(assistant.id, assistant.content);
      }
    });

    if (assistant) {
      const message = store.session?.messages.find((item) => item.id === assistant.id);
      if (message) message.content = message.content.trim();
      store.touch();
      finalizeMessageElement(assistant.id);
    }
    connectionIssue = false;
    renderConnection();
  } catch (error) {
    const aborted = isAbortError(error);
    if (assistant) {
      const message = store.session?.messages.find((item) => item.id === assistant.id);
      if (message) message.content = message.content.trim();
      if (message && message.content) {
        store.touch();
        finalizeMessageElement(assistant.id);
      } else {
        store.removeMessage(assistant.id);
        document.getElementById(`msg-${assistant.id}`)?.remove();
      }
    }
    if (!aborted) {
      handleApiError(error);
      appendNotice(`小问这次没有回答：${error.message || '未知错误'}`);
    } else if (!received) {
      toast('已停止生成。', 'warm');
    }
  } finally {
    showTyping(false);
    store.setBusy(false);
    studentAbort = null;
    scrollToBottom();
  }
}

/* -------------------------------------------------------------------------- */
/* Teacher agent & report                                                     */
/* -------------------------------------------------------------------------- */

async function handleCallTeacher() {
  if (!store.session) return;
  if (store.busy || store.state.status === STATUS.EVALUATING) return;
  if (!ensureKey()) return;

  const turns = humanTurnCount(store.session);
  if (turns < 1) {
    toast('先向小问讲一两轮，老师才有东西可看。', 'warm');
    refs.messageInput.focus();
    return;
  }
  if (turns < 3) {
    toast('对话还比较短，老师会给一个保守的诊断。', 'warm', 5000);
  }

  store.setStatus(STATUS.EVALUATING);
  openReportLoading();

  const controller = new AbortController();
  teacherAbort = controller;

  try {
    const report = await teacherAgent.evaluate({
      session: store.session,
      settings: store.settings,
      signal: controller.signal
    });
    if (!store.session) return;
    store.setReport(report);
    archiveCurrentLesson();
    presentReport(report);
    store.setStatus(STATUS.REPORT);
    connectionIssue = false;
    renderConnection();
  } catch (error) {
    if (isAbortError(error)) {
      if (store.state.status === STATUS.EVALUATING) store.setStatus(STATUS.TEACHING);
      return;
    }
    if (store.state.status === STATUS.EVALUATING) store.setStatus(STATUS.TEACHING);
    showReportError(error.message || 'AI 老师暂时没有给出报告。');
    handleApiError(error, { openSettingsOnAuth: false });
  } finally {
    teacherAbort = null;
    syncChrome();
  }
}

function openReportLoading() {
  openModal('reportModal');
  refs.reportLoading.hidden = false;
  refs.reportError.hidden = true;
  refs.reportContent.hidden = true;
  refs.reportModal.querySelector('.modal').scrollTop = 0;
}

function showReportError(message) {
  refs.reportLoading.hidden = true;
  refs.reportContent.hidden = true;
  refs.reportError.hidden = false;
  refs.reportErrorText.textContent = message;
  refs.reportModal.querySelector('.modal').scrollTop = 0;
}

function presentReport(report, { topic = '', archived = false } = {}) {
  if (!report) return;
  currentReport = report;
  currentReportTopic = topic || store.session?.topic || '';
  reportFromArchive = archived;
  openModal('reportModal');
  refs.reportLoading.hidden = true;
  refs.reportError.hidden = true;
  refs.reportContent.hidden = false;
  refs.reportModal.querySelector('.modal').scrollTop = 0;
  renderReport(report, currentReportTopic);
}

function renderReport(report, topicOverride) {
  const topic = topicOverride ?? store.session?.topic ?? '';
  refs.reportTopic.replaceChildren(document.createTextNode(topic));
  if (report.lowEvidence) {
    refs.reportTopic.append(el('span', 'evidence-note', '证据有限 · 已保守评分'));
  }

  refs.restartFromReportBtn.textContent = reportFromArchive ? '返回学习档案' : '换个主题，重新开始';

  const overall = Math.max(0, Math.min(100, Math.round(report.overallScore || 0)));
  // Set the final value immediately. requestAnimationFrame is paused in
  // background tabs, which would otherwise leave the score stuck at zero.
  refs.overallRing.style.setProperty('--score', String(overall));
  refs.overallScore.textContent = String(overall);

  refs.reportVerdict.textContent = report.verdict || '';
  refs.reportEncouragement.textContent = report.encouragement || '';

  refs.metricGrid.replaceChildren();
  for (const metric of METRICS) {
    const score = Math.max(0, Math.min(100, Math.round(report.scores?.[metric.key] || 0)));
    const card = el('div', `metric-card${score < 60 ? ' is-low' : ''}`);
    const top = el('div', 'metric-top');
    const labels = el('div');
    labels.append(el('span', 'metric-name', metric.label), el('span', 'metric-en', metric.en));
    const value = el('span', 'metric-score', String(score));
    top.append(labels, value);

    const bar = el('div', 'metric-bar');
    const fill = el('div', 'metric-fill');
    fill.style.width = `${score}%`;
    bar.append(fill);
    card.append(top, bar, el('p', 'metric-caption', metric.caption));
    refs.metricGrid.append(card);
  }

  refs.misconceptionList.replaceChildren();
  (report.misconceptions || []).forEach((gap, index) => {
    const card = el('article', 'misconception-card');
    card.append(el('span', 'gap-index', String(index + 1).padStart(2, '0')));

    const body = el('div');
    body.append(el('h4', '', gap.title || `理解缺口 ${index + 1}`));
    if (gap.evidence) {
      body.append(el('p', 'gap-evidence', `“${gap.evidence}”`));
    }
    if (gap.why) {
      const row = el('div', 'gap-row');
      row.append(el('b', '', '为什么'), el('span', '', gap.why));
      body.append(row);
    }
    if (gap.fix) {
      const row = el('div', 'gap-row');
      row.append(el('b', '', '怎么补'), el('span', '', gap.fix));
      body.append(row);
    }
    card.append(body);
    refs.misconceptionList.append(card);
  });

  refs.nextStepList.replaceChildren();
  (report.nextSteps || []).forEach((step, index) => {
    const card = el('article', 'next-step-card');
    card.append(el('span', 'next-index', String(index + 1)));

    const body = el('div');
    body.append(el('h4', '', step.title || `下一步 ${index + 1}`));
    if (step.action) body.append(el('p', 'next-action', step.action));
    if (step.example) body.append(el('p', 'next-example', step.example));
    card.append(body);
    refs.nextStepList.append(card);
  });

  const strengths = report.strengths || [];
  refs.strengthsSection.hidden = strengths.length === 0;
  refs.strengthList.replaceChildren();
  strengths.forEach((strength) => {
    refs.strengthList.append(el('li', '', strength));
  });
}

async function copyReport() {
  if (!currentReport) return;
  const report = currentReport;
  const topic = currentReportTopic || store.session?.topic || '';
  const lines = [
    '费曼小课堂 · 学习诊断报告',
    `讲课主题：${topic}`,
    `综合评分：${report.overallScore}%`,
    ...METRICS.map((metric) => `${metric.label}：${report.scores?.[metric.key] ?? 0}%`),
    '',
    `陈老师总评：${report.verdict}`,
    '',
    '关键理解缺口：',
    ...(report.misconceptions || []).map(
      (gap, index) =>
        `${index + 1}. ${gap.title}\n   证据：${gap.evidence || '—'}\n   原因：${gap.why || '—'}\n   怎么补：${gap.fix || '—'}`
    ),
    '',
    '下一次可以这样讲：',
    ...(report.nextSteps || []).map(
      (step, index) =>
        `${index + 1}. ${step.title}\n   动作：${step.action || '—'}\n   示范：${step.example || '—'}`
    ),
    '',
    `陈老师想说：${report.encouragement}`
  ];

  const ok = await copyText(lines.join('\n'));
  if (ok) {
    toast('报告已复制到剪贴板。', 'success');
  } else {
    toast('复制失败，请手动选择文字。', 'error');
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

function fillSettingsForm() {
  refs.apiKeyInput.value = store.settings.apiKey || '';
  refs.modelInput.value = store.settings.model || APP.defaults.model;
  refs.baseUrlInput.value = store.settings.baseUrl || APP.defaults.baseUrl;
  refs.proxyUrlInput.value = store.settings.proxyUrl || '';
  refs.accessCodeInput.value = store.settings.accessCode || '';
  refs.temperatureInput.value = String(store.settings.temperature ?? APP.defaults.temperature);
  refs.temperatureValue.textContent = Number(refs.temperatureInput.value).toFixed(2).replace(/0$/, '');
  refs.apiKeyInput.type = 'password';
  refs.toggleKeyBtn.textContent = '显示';
  hideSettingsStatus();
}

function readSettingsForm() {
  return {
    apiKey: refs.apiKeyInput.value.trim(),
    model: refs.modelInput.value.trim(),
    baseUrl: refs.baseUrlInput.value.trim(),
    proxyUrl: refs.proxyUrlInput.value.trim(),
    accessCode: refs.accessCodeInput.value.trim(),
    temperature: Number(refs.temperatureInput.value)
  };
}

function validateSettings(data) {
  if (!data.apiKey && !data.proxyUrl) {
    return '请填写 API Key，或填写课堂共享代理地址。';
  }
  if (!data.model) return '请填写模型名称，例如 qwen/qwen3-vl-30b-a3b-instruct。';
  try {
    const url = new URL(data.baseUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('protocol');
  } catch {
    return 'Base URL 需要是 http(s) 开头的完整地址。';
  }
  if (data.proxyUrl) {
    try {
      const proxy = new URL(data.proxyUrl);
      if (!/^https?:$/.test(proxy.protocol)) throw new Error('protocol');
    } catch {
      return '课堂代理地址需要是 http(s) 开头的完整地址。';
    }
  }
  return '';
}

function showSettingsStatus(message, type = 'busy') {
  refs.settingsStatus.hidden = false;
  refs.settingsStatus.textContent = message;
  refs.settingsStatus.className = `settings-status is-${type}`;
}

function hideSettingsStatus() {
  refs.settingsStatus.hidden = true;
  refs.settingsStatus.textContent = '';
  refs.settingsStatus.className = 'settings-status';
}

function handleSaveSettings(event) {
  event.preventDefault();
  const data = readSettingsForm();
  const error = validateSettings(data);
  if (error) {
    showSettingsStatus(error, 'error');
    return;
  }

  store.updateSettings(data);
  connectionIssue = false;
  renderConnection();
  showSettingsStatus('连接信息已保存在本机浏览器。', 'ok');
  const shouldStart = startAfterSettings;
  startAfterSettings = false;

  setTimeout(() => {
    closeModal('settingsModal');
    if (shouldStart) {
      handleStart();
    } else {
      toast('设置已保存。', 'success');
    }
  }, 380);
}

async function handleTestConnection() {
  const data = readSettingsForm();
  const error = validateSettings(data);
  if (error) {
    showSettingsStatus(error, 'error');
    return;
  }

  refs.testKeyBtn.disabled = true;
  refs.testKeyBtn.textContent = '测试中…';
  showSettingsStatus('正在连接模型服务……', 'busy');

  try {
    const result = await testConnection(data);
    showSettingsStatus(
      `连接成功 · ${result.model} · ${result.latency} ms。保存后即可开课。`,
      'ok'
    );
    connectionIssue = false;
  } catch (error) {
    showSettingsStatus(error.message || '连接失败。', 'error');
    if (error instanceof ApiError && [401, 402, 403, 404].includes(error.status)) {
      connectionIssue = true;
    }
  } finally {
    refs.testKeyBtn.disabled = false;
    refs.testKeyBtn.textContent = '测试连接';
  }
}

function handleClearKey() {
  if (!store.settings.apiKey && !store.settings.proxyUrl) {
    toast('当前没有保存 API Key 或代理设置。', 'warm');
    return;
  }
  if (!window.confirm('清除保存在浏览器里的 API Key / 代理设置？这不会影响你的服务商账户。')) return;
  clearSettings();
  store.settings = loadSettings();
  store.emit();
  fillSettingsForm();
  connectionIssue = false;
  renderConnection();
  showSettingsStatus('已清除本机保存的 API Key。', 'ok');
  toast('API Key 已清除。', 'success');
}

/* -------------------------------------------------------------------------- */
/* Images, speech, handwriting                                                */
/* -------------------------------------------------------------------------- */

async function compressImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('请选择图片文件（JPG、PNG、WebP 等）。');
  }
  if (file.size > APP.limits.maxImageBytes) {
    throw new Error('图片太大了（超过 8 MB），请压缩后再试。');
  }

  let source = null;
  let objectUrl = '';
  try {
    if ('createImageBitmap' in window) {
      try {
        source = await createImageBitmap(file);
      } catch {
        source = null;
      }
    }
    if (!source) {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('这张图片无法读取，请换一张。'));
        image.src = objectUrl;
      });
    }

    const width = source.width;
    const height = source.height;
    if (!width || !height) throw new Error('这张图片没有有效尺寸。');

    const scale = Math.min(1, APP.limits.imageMaxDimension / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', APP.limits.imageQuality);
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function handleTopicImage(file) {
  if (!file) return;
  try {
    const dataUrl = await compressImageFile(file);
    topicImage = dataUrl;
    refs.topicImageThumb.src = dataUrl;
    refs.topicImagePreview.hidden = false;
    refs.topicImageHint.textContent = '已添加题目图片，可移除后重选';
    if (isTextOnlyModel(store.settings.model)) {
      warnTextOnlyModel();
    } else {
      toast('题目图片已添加。', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function clearTopicImage() {
  topicImage = null;
  refs.topicImageThumb.removeAttribute('src');
  refs.topicImagePreview.hidden = true;
  refs.topicImageHint.textContent = '支持 JPG / PNG，可手写拍照';
  refs.topicImageInput.value = '';
}

async function handleChatImages(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const room = APP.limits.maxImages - pendingImages.length;
  if (room <= 0) {
    toast(`每条消息最多 ${APP.limits.maxImages} 张图片。`, 'warm');
    return;
  }

  let added = 0;
  for (const file of files.slice(0, room)) {
    try {
      const dataUrl = await compressImageFile(file);
      pendingImages.push(dataUrl);
      added += 1;
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  if (added) {
    renderPendingImages();
    if (isTextOnlyModel(store.settings.model)) {
      warnTextOnlyModel();
    } else {
      toast(`已添加 ${added} 张图片。`, 'success', 2200);
    }
  }
}

function renderPendingImages() {
  refs.pendingImages.replaceChildren();
  refs.pendingImages.hidden = pendingImages.length === 0;

  pendingImages.forEach((src, index) => {
    const thumb = el('div', 'pending-thumb');
    const image = document.createElement('img');
    image.src = src;
    image.alt = `待发送图片 ${index + 1}`;
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除第 ${index + 1} 张图片`);
    remove.addEventListener('click', () => {
      pendingImages.splice(index, 1);
      renderPendingImages();
    });
    thumb.append(image, remove);
    refs.pendingImages.append(thumb);
  });
}

function setupSpeech() {
  speech = new SpeechInput({
    lang: 'zh-CN',
    onFinal: (text) => {
      speechBase = `${speechBase}${text}`;
      refs.messageInput.value = speechBase;
      autoGrowMessage();
    },
    onInterim: (text) => {
      refs.messageInput.value = `${speechBase}${text}`;
      autoGrowMessage();
    },
    onStateChange: (listening) => {
      refs.micBtn.classList.toggle('is-listening', listening);
      refs.micBtn.setAttribute('aria-pressed', String(listening));
      refs.micLabel.textContent = listening ? '聆听中' : '语音';
      if (listening) {
        speechBase = refs.messageInput.value;
      }
      if (!listening) {
        refs.messageInput.value = speechBase.trim();
        autoGrowMessage();
      }
    },
    onError: (message) => {
      toast(message, 'error');
      refs.micBtn.classList.remove('is-listening');
      refs.micLabel.textContent = '语音';
    }
  });
}

function handleMic() {
  if (!speech) return;
  if (!isConfigured(store.settings)) {
    ensureKey();
    return;
  }
  if (speech.listening) {
    speech.stop();
  } else {
    speechBase = refs.messageInput.value;
    speech.start();
  }
}

function openHandwriting() {
  openModal('handwritingModal');
  // The modal is already visible, so the canvas has a measurable layout.
  // Initialize synchronously instead of relying on requestAnimationFrame,
  // which is paused in background tabs.
  if (!pad) {
    pad = new HandwritingPad(refs.handwritingCanvas, {
      placeholder: refs.padPlaceholder,
      onChange: () => {}
    });
  }
  pad.resize();
  pad.updatePlaceholder();
}

function handleInsertHandwriting() {
  if (!pad || pad.isEmpty()) {
    toast('手写板还是空的，先写点什么。', 'warm');
    return;
  }
  if (pendingImages.length >= APP.limits.maxImages) {
    toast(`每条消息最多 ${APP.limits.maxImages} 张图片。`, 'warm');
    return;
  }
  pendingImages.push(pad.toDataURL());
  renderPendingImages();
  pad.clear();
  closeModal('handwritingModal');
  toast('手写内容已插入消息。', 'success', 2200);
  refs.messageInput.focus();
}

/* -------------------------------------------------------------------------- */
/* Learning archive                                                           */
/* -------------------------------------------------------------------------- */

function archiveCurrentLesson() {
  if (!store.session) return;
  try {
    archiveSession(store.session, { model: store.settings?.model || '' });
    renderHistoryEntry();
  } catch (error) {
    console.warn('保存学习档案失败：', error);
  }
}

function renderHistoryEntry() {
  if (!refs.homeHistoryBtn) return;
  const records = loadHistory();
  refs.homeHistoryBtn.hidden = false;
  if (!records.length) {
    refs.homeHistoryMeta.textContent = '还没有记录，讲完一课就会自动保存';
    return;
  }
  const summary = summarizeHistory(records);
  const parts = [`${summary.sessions} 课记录`];
  if (Number.isFinite(summary.averageOverall)) parts.push(`平均 ${summary.averageOverall}%`);
  if (summary.activeDays > 1) parts.push(`${summary.activeDays} 天`);
  refs.homeHistoryMeta.textContent = parts.join(' · ');
}

function openHistory() {
  openHistoryIds = new Set();
  reportFromArchive = false;
  renderHistory();
  openModal('historyModal');
}

function renderHistory() {
  const records = loadHistory();
  refs.historyEmpty.hidden = records.length > 0;
  refs.historyContent.hidden = records.length === 0;
  if (!records.length) return;

  const summary = summarizeHistory(records);
  renderHistorySummary(summary);
  renderHistoryTrend(records, summary);
  renderHistoryDimensions(summary);
  renderHistoryList(records);
}

function historyStat(value, unit, label, { accent = false, text = '' } = {}) {
  const card = el('div', `history-stat${accent ? ' is-accent' : ''}`);
  const strong = el('strong');
  if (text) {
    strong.append(document.createTextNode(text));
  } else {
    strong.append(document.createTextNode(Number.isFinite(value) ? String(value) : '—'));
    if (unit && Number.isFinite(value)) strong.append(el('em', '', unit));
  }
  card.append(strong, el('small', '', label));
  return card;
}

function renderHistorySummary(summary) {
  refs.historySummary.replaceChildren();

  if (summary.delta === null) {
    refs.historySummary.append(historyStat(summary.sessions, '课', '累计讲课'));
  } else {
    const sign = summary.delta > 0 ? '+' : '';
    refs.historySummary.append(
      historyStat(summary.sessions, '课', `累计讲课 · 较前 5 课 ${sign}${summary.delta}`)
    );
  }
  refs.historySummary.append(
    historyStat(summary.averageOverall, '%', '平均综合分', { accent: true }),
    historyStat(summary.recent, '%', '最近 5 课'),
    historyStat(summary.activeDays, '天', '有记录的学习天')
  );

  if (summary.weakest) {
    refs.historySummary.append(
      historyStat(0, '', `最需要补：${summary.weakest.label}`, {
        text: `${summary.metricAverages[summary.weakest.key]}%`
      })
    );
  }
}

function renderHistoryTrend(records, summary) {
  refs.historyTrendChart.replaceChildren();
  const scored = records
    .filter((record) => record.report && Number.isFinite(record.report.overallScore))
    .slice(0, 12)
    .reverse();

  const meta = [];
  if (summary.scored) meta.push(`${summary.scored} 次诊断`);
  if (Number.isFinite(summary.averageOverall)) meta.push(`平均 ${summary.averageOverall}%`);
  if (summary.delta !== null) {
    const sign = summary.delta > 0 ? '+' : '';
    meta.push(`较前 5 课 ${sign}${summary.delta}`);
  }
  refs.historyTrendMeta.textContent = meta.join(' · ');

  if (scored.length < 2) {
    const empty = el(
      'div',
      'trend-empty',
      scored.length === 1
        ? '再完成一课诊断，就能看到评分走势。'
        : '还没有诊断报告。讲完一课后点「呼叫 AI 老师点评」，这里就会出现走势。'
    );
    refs.historyTrendChart.append(empty);
    return;
  }

  const width = 640;
  const height = 118;
  const padLeft = 30;
  const padRight = 12;
  const padTop = 10;
  const padBottom = 18;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '综合评分走势');

  for (const tick of [0, 25, 50, 75, 100]) {
    const y = padTop + plotH - (tick / 100) * plotH;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(padLeft));
    line.setAttribute('x2', String(width - padRight));
    line.setAttribute('y1', String(y));
    line.setAttribute('y2', String(y));
    line.setAttribute('class', tick === 0 ? 'trend-axis' : 'trend-grid');
    svg.append(line);

    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', String(padLeft - 6));
    label.setAttribute('y', String(y + 3));
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('class', 'trend-tick');
    label.textContent = String(tick);
    svg.append(label);
  }

  const points = scored.map((record, index) => {
    const x = padLeft + (scored.length === 1 ? plotW / 2 : (index / (scored.length - 1)) * plotW);
    const score = Math.max(0, Math.min(100, record.report.overallScore));
    const y = padTop + plotH - (score / 100) * plotH;
    return { x, y, score, record };
  });

  const area = document.createElementNS(ns, 'path');
  area.setAttribute(
    'd',
    `M${points[0].x} ${padTop + plotH} ${points
      .map((point) => `L${point.x} ${point.y}`)
      .join(' ')} L${points[points.length - 1].x} ${padTop + plotH} Z`
  );
  area.setAttribute('class', 'trend-area');
  svg.append(area);

  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
  line.setAttribute('class', 'trend-line');
  svg.append(line);

  for (const point of points) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', String(point.x));
    dot.setAttribute('cy', String(point.y));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'trend-dot');
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${point.record.topic}：${point.score}%`;
    dot.append(title);
    svg.append(dot);
  }

  const last = points[points.length - 1];
  const lastLabel = document.createElementNS(ns, 'text');
  lastLabel.setAttribute('x', String(Math.min(last.x, width - padRight - 4)));
  lastLabel.setAttribute('y', String(Math.max(last.y - 9, 11)));
  lastLabel.setAttribute('text-anchor', 'end');
  lastLabel.setAttribute('class', 'trend-last');
  lastLabel.textContent = `${last.score}%`;
  svg.append(lastLabel);

  refs.historyTrendChart.append(svg);
}

function renderHistoryDimensions(summary) {
  refs.historyDimensions.replaceChildren();
  for (const metric of METRICS) {
    const value = summary.metricAverages[metric.key];
    const row = el(
      'div',
      `dimension-row${summary.weakest?.key === metric.key ? ' is-weak' : ''}${
        summary.strongest?.key === metric.key ? ' is-strong' : ''
      }`
    );
    const track = el('div', 'dimension-track');
    const fill = el('div', 'dimension-fill');
    fill.style.setProperty('--value', `${Number.isFinite(value) ? value : 0}%`);
    track.append(fill);
    row.append(
      el('span', 'dimension-name', metric.label),
      track,
      el('span', 'dimension-value', Number.isFinite(value) ? `${value}%` : '—')
    );
    refs.historyDimensions.append(row);
  }
}

function formatArchiveDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}\n${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function renderHistoryList(records) {
  refs.historyList.replaceChildren();
  for (const record of records) {
    const item = el('article', `history-item${openHistoryIds.has(record.id) ? ' is-open' : ''}`);
    const main = el('button', 'history-item-main');
    main.type = 'button';
    main.setAttribute('aria-expanded', String(openHistoryIds.has(record.id)));

    const date = el('span', 'history-item-date', formatArchiveDate(record.endedAt));
    const body = el('div', 'history-item-body');
    body.append(el('p', 'history-item-topic', record.topic));
    const meta = [`${record.turns} 轮讲解`, `${record.questions} 个追问`];
    if (record.model) meta.push(record.model.split('/').pop());
    body.append(el('p', 'history-item-meta', meta.join(' · ')));

    const score = el(
      'span',
      `history-item-score${Number.isFinite(record.report?.overallScore) ? '' : ' is-empty'}`
    );
    score.append(
      el('strong', '', Number.isFinite(record.report?.overallScore) ? `${record.report.overallScore}%` : '—'),
      el('small', '', Number.isFinite(record.report?.overallScore) ? '综合评分' : '未诊断')
    );

    main.append(date, body, score);
    main.addEventListener('click', () => {
      if (openHistoryIds.has(record.id)) openHistoryIds.delete(record.id);
      else openHistoryIds.add(record.id);
      renderHistoryList(loadHistory());
    });

    item.append(main);
    if (openHistoryIds.has(record.id)) item.append(buildHistoryDetail(record));
    refs.historyList.append(item);
  }
}

function buildHistoryTranscript(record) {
  const messages = Array.isArray(record.messages) ? record.messages : [];
  if (!messages.length) return null;

  const block = el('section', 'history-transcript');

  const head = el('div', 'history-transcript-head');
  const title = el('div');
  title.append(el('span', 'history-detail-label', '当时的回答记录'));
  title.append(el('span', 'history-transcript-count', `共 ${messages.length} 条对话`));
  head.append(title);
  block.append(head);

  const list = el('div', 'history-transcript-list');
  const names = { user: '你', assistant: '小问' };

  messages.forEach((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const row = el('div', `history-message history-message-${role}`);
    const meta = el('div', 'history-message-meta');
    meta.append(el('span', 'history-message-name', names[role]));
    meta.append(el('span', 'history-message-index', String(index + 1)));
    row.append(meta);
    row.append(el('p', 'history-message-text', message.content || ''));
    list.append(row);
  });

  block.append(list);
  return block;
}

function buildHistoryDetail(record) {
  const detail = el('div', 'history-detail');

  const transcript = buildHistoryTranscript(record);
  if (transcript) detail.append(transcript);

  if (record.report) {
    if (record.report.verdict) {
      const verdict = el('p');
      verdict.append(el('span', 'history-detail-label', '老师总评'));
      verdict.append(document.createTextNode(record.report.verdict));
      detail.append(verdict);
    }

    if (record.report.misconceptions?.length) {
      const block = el('div');
      block.append(el('span', 'history-detail-label', '关键理解缺口'));
      const list = el('ul');
      record.report.misconceptions.slice(0, 3).forEach((gap) => {
        list.append(el('li', '', gap.title || ''));
      });
      block.append(list);
      detail.append(block);
    }

    if (record.report.nextSteps?.length) {
      const block = el('div');
      block.append(el('span', 'history-detail-label', '下一次可以这样讲'));
      const list = el('ul');
      record.report.nextSteps.slice(0, 2).forEach((step) => {
        list.append(el('li', '', step.title || step.action || ''));
      });
      block.append(list);
      detail.append(block);
    }
  } else {
    detail.append(el('p', '', '这节课还没有诊断报告。继续讲完再呼叫 AI 老师，就能拿到评分。'));
  }

  const actions = el('div', 'history-detail-actions');
  if (record.report) {
    const open = el('button', 'btn btn-primary btn-sm', '查看完整报告');
    open.type = 'button';
    open.addEventListener('click', () => {
      presentReport(record.report, { topic: record.topic, archived: true });
    });

    const copy = el('button', 'btn btn-outline btn-sm', '复制报告');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const ok = await copyText(reportToText(record));
      toast(ok ? '报告已复制到剪贴板。' : '复制失败，请手动选择文字。', ok ? 'success' : 'error');
    });

    const del = el('button', 'btn btn-ghost btn-sm', '删除记录');
    del.type = 'button';
    del.addEventListener('click', () => handleDeleteRecord(record));
    actions.append(open, copy, del);
  } else {
    const del = el('button', 'btn btn-ghost btn-sm', '删除记录');
    del.type = 'button';
    del.addEventListener('click', () => handleDeleteRecord(record));
    actions.append(del);
  }

  detail.append(actions);
  return detail;
}

function handleDeleteRecord(record) {
  if (!window.confirm(`删除「${record.topic}」的学习记录？删除后无法恢复。`)) return;
  deleteRecord(record.id);
  openHistoryIds.delete(record.id);
  renderHistory();
  renderHistoryEntry();
  toast('记录已删除。', 'success', 2400);
}

function handleClearHistory() {
  if (!loadHistory().length) return;
  if (!window.confirm('清空全部学习档案？所有历史课时和诊断报告都会被删除，无法恢复。')) return;
  clearHistory();
  openHistoryIds = new Set();
  renderHistory();
  renderHistoryEntry();
  toast('学习档案已清空。', 'success', 2600);
}

/* -------------------------------------------------------------------------- */
/* Modals & focus                                                             */
/* -------------------------------------------------------------------------- */

function openModal(id) {
  const layer = document.getElementById(id);
  if (!layer) return;
  if (activeModalId === id) {
    layer.hidden = false;
    return;
  }
  if (activeModalId && activeModalId !== id) {
    closeModal(activeModalId);
  }
  lastFocused = document.activeElement;
  layer.hidden = false;
  activeModalId = id;
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const modal = layer.querySelector('.modal');
    modal?.focus({ preventScroll: true });
  });
}

function closeModal(id) {
  const layer = document.getElementById(id);
  if (!layer || layer.hidden) return;

  if (id === 'reportModal') {
    if (store.state.status === STATUS.EVALUATING) {
      teacherAbort?.abort();
      store.setStatus(STATUS.TEACHING);
    } else if (store.state.status === STATUS.REPORT) {
      store.setStatus(STATUS.TEACHING);
    }
  }
  if (id === 'settingsModal') {
    startAfterSettings = false;
  }

  layer.hidden = true;
  if (activeModalId === id) {
    activeModalId = null;
    document.body.style.overflow = '';
    lastFocused?.focus?.({ preventScroll: true });
  }
}

function trapFocus(event) {
  if (event.key !== 'Tab' || !activeModalId) return;
  const layer = document.getElementById(activeModalId);
  if (!layer) return;
  const focusable = Array.from(
    layer.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openLightbox(src) {
  if (!src) return;
  refs.lightboxImage.src = src;
  refs.imageLightbox.hidden = false;
  document.body.style.overflow = 'hidden';
  refs.closeLightbox.focus();
}

function closeLightbox() {
  refs.imageLightbox.hidden = true;
  refs.lightboxImage.removeAttribute('src');
  if (!activeModalId) document.body.style.overflow = '';
}

/* -------------------------------------------------------------------------- */
/* Ends, reset, toast                                                         */
/* -------------------------------------------------------------------------- */

function handleEndSession() {
  if (!store.session) return;
  if (!window.confirm('结束本次讲课？本次对话会存入学习档案，API Key 会保留。')) return;

  archiveCurrentLesson();
  studentAbort?.abort();
  teacherAbort?.abort();
  if (activeModalId) closeModal(activeModalId);
  store.end();
  resetAfterSession();
  renderHistoryEntry();
  toast('本次讲课已结束，已存入学习档案。', 'success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleRestartFromReport() {
  if (reportFromArchive) {
    openHistory();
    return;
  }
  archiveCurrentLesson();
  closeModal('reportModal');
  store.end();
  resetAfterSession();
  renderHistoryEntry();
  toast('新的一课，准备好了。', 'success', 2600);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => refs.topicInput.focus(), 250);
}

function resetAfterSession() {
  studentAbort?.abort();
  teacherAbort?.abort();
  studentAbort = null;
  teacherAbort = null;
  pendingImages = [];
  topicImage = null;
  currentReport = null;
  startAfterSettings = false;
  refs.messageInput.value = '';
  refs.topicInput.value = '';
  clearTopicImage();
  renderPendingImages();
  autoGrowMessage();
  showTyping(false);
  refs.typingIndicator.hidden = true;
  refs.micBtn.classList.remove('is-listening');
  refs.micLabel.textContent = '语音';
  showScreen('home');
  syncChrome();
}

function toast(message, type = 'info', duration = 4200) {
  if (!message) return;
  const node = el('div', `toast${type === 'error' ? ' is-error' : type === 'warm' ? ' is-warm' : ''}`);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.append(el('span', '', message));
  refs.toastStack.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => node.remove(), 240);
  }, duration);
}

function handleApiError(error, { openSettingsOnAuth = true } = {}) {
  if (!error || isAbortError(error)) return;
  const status = error instanceof ApiError ? error.status : 0;
  if ([401, 402, 403, 429].includes(status) || /无法连接到模型服务/.test(error.message || '')) {
    connectionIssue = true;
    renderConnection();
  }
  toast(error.message || '出了点问题，请再试一次。', 'error', 7500);

  if (openSettingsOnAuth && (status === 401 || status === 403)) {
    fillSettingsForm();
    openModal('settingsModal');
    showSettingsStatus('连接没有通过，请检查 API Key 或模型权限。', 'error');
  }
}

function ensureKey() {
  if (isConfigured(store.settings)) return true;
  fillSettingsForm();
  openModal('settingsModal');
  toast('先连接你的 AI：填入 API Key，或使用课堂共享代理。', 'warm', 6000);
  return false;
}

/* -------------------------------------------------------------------------- */
/* Input helpers                                                              */
/* -------------------------------------------------------------------------- */

function autoGrowTopic() {
  refs.topicInput.style.height = 'auto';
  refs.topicInput.style.height = `${Math.min(refs.topicInput.scrollHeight, 260)}px`;
}

function autoGrowMessage() {
  refs.messageInput.style.height = 'auto';
  refs.messageInput.style.height = `${Math.min(refs.messageInput.scrollHeight, 190)}px`;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

function bindEvents() {
  refs.brandHome.addEventListener('click', () => {
    if (store.session) {
      toast('本次讲课还在进行中。想退出请点右上角「结束讲课」。', 'warm');
      return;
    }
    showScreen('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    refs.topicInput.focus();
  });

  refs.settingsBtn.addEventListener('click', () => {
    fillSettingsForm();
    openModal('settingsModal');
  });

  refs.historyBtn?.addEventListener('click', openHistory);
  refs.homeHistoryBtn?.addEventListener('click', openHistory);
  refs.topicToggleBtn?.addEventListener('click', toggleTopicCard);
  refs.clearHistoryBtn?.addEventListener('click', handleClearHistory);

  refs.endSessionBtn.addEventListener('click', handleEndSession);
  refs.startBtn.addEventListener('click', handleStart);
  refs.topicInput.addEventListener('input', autoGrowTopic);
  refs.topicInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleStart();
    }
  });

  refs.topicImageBtn.addEventListener('click', () => refs.topicImageInput.click());
  refs.topicImageInput.addEventListener('change', () => {
    handleTopicImage(refs.topicImageInput.files?.[0]);
    refs.topicImageInput.value = '';
  });
  refs.removeTopicImage.addEventListener('click', clearTopicImage);

  refs.composer.addEventListener('submit', handleSend);
  refs.messageInput.addEventListener('input', autoGrowMessage);
  refs.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      handleSend(event);
    }
  });

  refs.attachBtn.addEventListener('click', () => {
    if (!refs.attachBtn.disabled) refs.chatImageInput.click();
  });
  refs.chatImageInput.addEventListener('change', () => {
    handleChatImages(refs.chatImageInput.files);
    refs.chatImageInput.value = '';
  });

  refs.composer.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      refs.composer.classList.add('is-dragover');
    }
  });
  refs.composer.addEventListener('dragleave', () => refs.composer.classList.remove('is-dragover'));
  refs.composer.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    refs.composer.classList.remove('is-dragover');
    handleChatImages(event.dataTransfer.files);
  });

  refs.micBtn.addEventListener('click', handleMic);

  refs.handwritingBtn.addEventListener('click', openHandwriting);
  refs.eraserBtn.addEventListener('click', () => {
    if (!pad) return;
    const next = refs.eraserBtn.getAttribute('aria-pressed') !== 'true';
    refs.eraserBtn.setAttribute('aria-pressed', String(next));
    pad.setEraser(next);
  });
  refs.undoBtn.addEventListener('click', () => pad?.undo());
  refs.clearPadBtn.addEventListener('click', () => pad?.clear());
  refs.insertHandwritingBtn.addEventListener('click', handleInsertHandwriting);

  for (const swatch of document.querySelectorAll('.color-swatch')) {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach((item) => {
        item.classList.toggle('is-active', item === swatch);
        item.setAttribute('aria-pressed', String(item === swatch));
      });
      const color = swatch.dataset.color;
      if (color) {
        pad?.setColor(color);
        refs.eraserBtn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  refs.callTeacherBtn.addEventListener('click', handleCallTeacher);
  refs.callTeacherMobile.addEventListener('click', handleCallTeacher);
  refs.viewLastReportBtn.addEventListener('click', () => {
    if (store.session?.report) presentReport(store.session.report);
  });

  refs.retryReportBtn.addEventListener('click', handleCallTeacher);
  refs.copyReportBtn.addEventListener('click', copyReport);
  refs.restartFromReportBtn.addEventListener('click', handleRestartFromReport);

  refs.settingsForm.addEventListener('submit', handleSaveSettings);
  refs.testKeyBtn.addEventListener('click', handleTestConnection);
  refs.clearKeyBtn.addEventListener('click', handleClearKey);
  refs.toggleKeyBtn.addEventListener('click', () => {
    const showing = refs.apiKeyInput.type === 'text';
    refs.apiKeyInput.type = showing ? 'password' : 'text';
    refs.toggleKeyBtn.textContent = showing ? '显示' : '隐藏';
  });
  refs.temperatureInput.addEventListener('input', () => {
    refs.temperatureValue.textContent = Number(refs.temperatureInput.value).toFixed(2).replace(/0$/, '');
  });

  for (const closer of document.querySelectorAll('[data-close]')) {
    closer.addEventListener('click', () => closeModal(closer.dataset.close));
  }

  refs.messageList.addEventListener('click', (event) => {
    const image = event.target.closest('img[data-zoom]');
    if (image) openLightbox(image.src);
  });
  refs.closeLightbox.addEventListener('click', closeLightbox);
  refs.imageLightbox.addEventListener('click', (event) => {
    if (event.target === refs.imageLightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!refs.imageLightbox.hidden) {
        closeLightbox();
      } else if (activeModalId) {
        closeModal(activeModalId);
      }
    }
    trapFocus(event);
  });

  window.addEventListener('offline', () => {
    connectionIssue = true;
    renderConnection();
    toast('网络断开了，恢复后再试。', 'error');
  });
  window.addEventListener('online', () => {
    connectionIssue = false;
    renderConnection();
  });

  window.addEventListener('resize', () => updateTopicToggle());
  window.addEventListener('pagehide', archiveCurrentLesson);
}
