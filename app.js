import {
  AI_MODES,
  APP,
  BUILTIN_QUESTIONS,
  DIFFICULTIES,
  INTENSITIES,
  METRICS,
  PERSONAS,
  SOURCES,
  STUDENT_MODES,
  SUBJECT_LIST,
  SUBJECT_KEYS,
  EXERCISE_PROMPT,
  FAREWELL_PROMPT,
  aiDisplayName,
  aiModeInfo,
  difficultyInfo,
  intensityInfo,
  modeInfo,
  normalizeTags,
  personaInfo,
  sessionMeta,
  sourceInfo,
  subjectInfo
} from './js/config.js';
import { ApiError, isAbortError, isConfigured, recognizeProblem, testConnection, completeChat } from './js/api.js';
import { StudentAgent, TeacherAgent, TutorAgent, humanTurnCount } from './js/agents.js';
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
  deleteRecords,
  loadHistory,
  reportToText,
  summarizeActivity,
  summarizeBySubject,
  summarizeHistory,
  summarizeInteractions,
  summarizeTags
} from './js/history.js';
import {
  buildQuestionsExport,
  deleteQuestion,
  importQuestions,
  listQuestions,
  questionKey,
  saveQuestion
} from './js/bank.js';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const $ = (selector, root = document) => root.querySelector(selector);

const TOPIC_IMAGE_HINT =
  '支持截图粘贴、拖拽上传；原图保存在本机，识别或发送时会交给你配置的 AI 模型；手写识别效果有限，识别后请校对文字';
const TOPIC_IMAGE_READY_HINT = '已添加题目图片，可点「识别文字」自动转写，或直接开始讲课';

const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
const STORAGE_WARN_RATIO = 0.8;
const STORAGE_CRITICAL_RATIO = 0.94;

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
  abandonSessionBtn: $('#abandonSessionBtn'),
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
  subjectTabs: $('#subjectTabs'),
  subjectHint: $('#subjectHint'),
  difficultySelect: $('#difficultySelect'),
  tagInput: $('#tagInput'),
  tagOptions: $('#tagOptions'),
  quickTags: $('#quickTags'),
  noteInput: $('#noteInput'),
  sourceNote: $('#sourceNote'),
  topicImageInput: $('#topicImageInput'),
  topicCameraInput: $('#topicCameraInput'),
  topicImageBtn: $('#topicImageBtn'),
  topicCameraBtn: $('#topicCameraBtn'),
  recognizeBtn: $('#recognizeBtn'),
  saveBankBtn: $('#saveBankBtn'),
  openBankBtn: $('#openBankBtn'),
  openBankSquareBtn: $('#openBankSquareBtn'),
  topicImageHint: $('#topicImageHint'),
  topicImagePreview: $('#topicImagePreview'),
  topicImageThumb: $('#topicImageThumb'),
  removeTopicImage: $('#removeTopicImage'),
  ocrStatus: $('#ocrStatus'),
  homeCard: $('.home-card'),
  startBtn: $('#startBtn'),
  chatSub: $('#chatSub'),
  roundBadge: $('#roundBadge'),
  callTeacherMobile: $('#callTeacherMobile'),
  callTeacherMobileLabel: $('#callTeacherMobileLabel'),
  chatBody: $('#chatBody'),
  topicCard: $('#topicCard'),
  topicCardBody: $('#topicCardBody'),
  topicCardText: $('#topicCardText'),
  topicCardImage: $('#topicCardImage'),
  topicMeta: $('#topicMeta'),
  topicToggleBtn: $('#topicToggleBtn'),
  messageList: $('#messageList'),
  typingIndicator: $('#typingIndicator'),
  chatPanel: $('.chat-panel'),
  classroomFab: $('#classroomFab'),
  undoTurnBtn: $('#undoTurnBtn'),
  markStuckBtn: $('#markStuckBtn'),
  endAndReportBtn: $('#endAndReportBtn'),
  stuckBadge: $('#stuckBadge'),
  composer: $('#composer'),
  draftCard: $('#draftCard'),
  draftToggleBtn: $('#draftToggleBtn'),
  draftBody: $('#draftBody'),
  draftInput: $('#draftInput'),
  draftPreview: $('#draftPreview'),
  draftEditTab: $('#draftEditTab'),
  draftPreviewTab: $('#draftPreviewTab'),
  draftHint: $('#draftHint'),
  draftMobileBtn: $('#draftMobileBtn'),
  draftScrim: $('#draftScrim'),
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
  reportMeta: $('#reportMeta'),
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
  historySubjectFilter: $('#historySubjectFilter'),
  historyRangeFilter: $('#historyRangeFilter'),
  historySourceFilter: $('#historySourceFilter'),
  historyActivity: $('#historyActivity'),
  historyActivityMeta: $('#historyActivityMeta'),
  historySubjectOverview: $('#historySubjectOverview'),
  historyHabits: $('#historyHabits'),
  historyHabitMeta: $('#historyHabitMeta'),
  historyAdviceBlock: $('#historyAdviceBlock'),
  historyAdvice: $('#historyAdvice'),
  historyTagStats: $('#historyTagStats'),
  historyTagMeta: $('#historyTagMeta'),
  historyTrendChart: $('#historyTrendChart'),
  historyTrendMeta: $('#historyTrendMeta'),
  historyDimensions: $('#historyDimensions'),
  historyList: $('#historyList'),
  historySelectBtn: $('#historySelectBtn'),
  historyBulkBar: $('#historyBulkBar'),
  historyBulkCount: $('#historyBulkCount'),
  historySelectAllBtn: $('#historySelectAllBtn'),
  historyBulkDeleteBtn: $('#historyBulkDeleteBtn'),
  historyBulkCancelBtn: $('#historyBulkCancelBtn'),
  replayModal: $('#replayModal'),
  replayTitle: $('#replayTitle'),
  replayMeta: $('#replayMeta'),
  replayList: $('#replayList'),
  replayNote: $('#replayNote'),
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
  studentPersonaSelect: $('#studentPersonaSelect'),
  studentPersonaHint: $('#studentPersonaHint'),
  studentModeSelect: $('#studentModeSelect'),
  studentModeHint: $('#studentModeHint'),
  studentIntensitySelect: $('#studentIntensitySelect'),
  studentIntensityHint: $('#studentIntensityHint'),
  aiModeSettingsNote: $('#aiModeSettingsNote'),
  lockSubjectToggle: $('#lockSubjectToggle'),
  themeSwitch: $('#themeSwitch'),
  exportDataBtn: $('#exportDataBtn'),
  clearArchiveDataBtn: $('#clearArchiveDataBtn'),
  storageUsage: $('#storageUsage'),
  storagePanel: $('#storagePanel'),
  storageBadge: $('#storageBadge'),
  storageMeter: $('#storageMeter'),
  storageMeterFill: $('#storageMeterFill'),
  storageHint: $('#storageHint'),
  storageBanner: $('#storageBanner'),
  storageBannerMark: $('#storageBannerMark'),
  storageBannerTitle: $('#storageBannerTitle'),
  storageBannerText: $('#storageBannerText'),
  storageBannerExport: $('#storageBannerExport'),
  storageBannerManage: $('#storageBannerManage'),
  storageBannerClose: $('#storageBannerClose'),
  replayOnboardingBtn: $('#replayOnboardingBtn'),
  onboardingModal: $('#onboardingModal'),
  onboardingDots: $('#onboardingDots'),
  onboardingSteps: $('#onboardingSteps'),
  onboardingStatus: $('#onboardingStatus'),
  onboardingPrevBtn: $('#onboardingPrevBtn'),
  onboardingNextBtn: $('#onboardingNextBtn'),
  onboardingSkipBtn: $('#onboardingSkipBtn'),
  helpBtn: $('#helpBtn'),
  helpModal: $('#helpModal'),
  helpSearch: $('#helpSearch'),
  helpSearchMeta: $('#helpSearchMeta'),
  helpGroups: $('#helpGroups'),
  helpEmpty: $('#helpEmpty'),
  helpReplayOnboarding: $('#helpReplayOnboarding'),
  helpOpenSettings: $('#helpOpenSettings'),
  helpOpenHistory: $('#helpOpenHistory'),
  personaPicker: $('#personaPicker'),
  homePersonaHint: $('#homePersonaHint'),
  homePersonaBlock: $('#homePersonaBlock'),
  aiModePicker: $('#aiModePicker'),
  aiModeHint: $('#aiModeHint'),
  homeSubtitle: $('#homeSubtitle'),
  homeTeacherHint: $('#homeTeacherHint'),
  homeTeacherHintText: $('#homeTeacherHintText'),
  startBtnLabel: $('#startBtnLabel'),
  chatKicker: $('#chatKicker'),
  typingLabel: $('#typingLabel'),
  statTurnsLabel: $('#statTurnsLabel'),
  statQuestionsLabel: $('#statQuestionsLabel'),
  chatPersonaRow: $('#chatPersonaRow'),
  chatIntensityRow: $('#chatIntensityRow'),
  chatModeRow: $('#chatModeRow'),
  progressCard: $('#progressCard'),
  teacherCallCard: $('#teacherCallCard'),
  chatSubjectSelect: $('#chatSubjectSelect'),
  chatPersonaSelect: $('#chatPersonaSelect'),
  chatIntensitySelect: $('#chatIntensitySelect'),
  chatModeSelect: $('#chatModeSelect'),
  practiceLockHint: $('#practiceLockHint'),
  bankModal: $('#bankModal'),
  bankTitle: $('#bankTitle'),
  bankIntro: $('#bankIntro'),
  bankTabSquare: $('#bankTabSquare'),
  bankTabMine: $('#bankTabMine'),
  bankSquareCount: $('#bankSquareCount'),
  bankMineCount: $('#bankMineCount'),
  bankSearch: $('#bankSearch'),
  bankSubjectFilter: $('#bankSubjectFilter'),
  bankSourceFilter: $('#bankSourceFilter'),
  bankMineActions: $('#bankMineActions'),
  bankImportBtn: $('#bankImportBtn'),
  bankExportBtn: $('#bankExportBtn'),
  bankImportInput: $('#bankImportInput'),
  bankEmpty: $('#bankEmpty'),
  bankEmptyTitle: $('#bankEmptyTitle'),
  bankEmptyText: $('#bankEmptyText'),
  bankEmptyAction: $('#bankEmptyAction'),
  bankList: $('#bankList'),
  bankNote: $('#bankNote'),
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
  exerciseBtn: $('#exerciseBtn'),
  exerciseModal: $('#exerciseModal'),
  exerciseLoading: $('#exerciseLoading'),
  exerciseError: $('#exerciseError'),
  exerciseErrorText: $('#exerciseErrorText'),
  retryExerciseBtn: $('#retryExerciseBtn'),
  exerciseContent: $('#exerciseContent'),
  exerciseTitleText: $('#exerciseTitleText'),
  exerciseList: $('#exerciseList'),
  toastStack: $('#toastStack')
};

/* -------------------------------------------------------------------------- */
/* Runtime state                                                              */
/* -------------------------------------------------------------------------- */

const store = new ClassroomStore();
const studentAgent = new StudentAgent();
const teacherAgent = new TeacherAgent();
const tutorAgent = new TutorAgent();

let pendingImages = [];
let topicImage = null;
let studentAbort = null;
let teacherAbort = null;
let endingSession = false;
let activeModalId = null;
let lastFocused = null;
let modalStack = [];
let startAfterSettings = false;
let connectionIssue = false;
let currentReport = null;
let currentReportTopic = '';
let currentReportMeta = '';
let currentReportRecord = null;
let reportFromArchive = false;
let replayReturnHistory = false;
let openHistoryIds = new Set();
let onboardingStep = 0;
let onboardingStacked = false;
let pad = null;
let speech = null;
let speechBase = '';
let renderedSessionId = null;
let lastPersistenceWarning = '';
let lastStorageToastLevel = '';
let composerObserver = null;
let draftState = { sessionId: '', text: '', open: true, mode: 'edit' };
let draftSaveTimer = null;
let draftDrawerOpen = false;
let homeSource = 'custom';
let bankEditingId = '';
let bankCache = [];
let historyFilter = { subject: 'all', source: 'all', range: 'all' };
const HISTORY_RANGE_DAYS = { all: 0, 30: 30, 7: 7 };
let historySelectMode = false;
let historySelection = new Set();
let bankFilter = { subject: 'all', source: 'all', query: '' };
let bankView = 'square';

const DRAFT_SYMBOLS = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  omega: 'ω',
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  neq: '≠',
  approx: '≈',
  infty: '∞',
  to: '→',
  rightarrow: '→',
  leftarrow: '←',
  angle: '∠',
  triangle: '△',
  degree: '°',
  sum: '∑',
  int: '∫'
};

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                  */
/* -------------------------------------------------------------------------- */

init();

function init() {
  applyTheme(store.settings.theme);
  populateExamples();
  populateModelPresets();
  populatePracticeControls();
  fillSettingsForm();
  setupSpeech();
  bindEvents();
  setupComposerObserver();
  loadDraft();
  renderHistoryEntry();
  setHomeSource('custom');

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
  maybeOnboard();
  setTimeout(() => checkStoragePressure(), 1000);
}

function populateExamples() {
  for (const sample of APP.samples) {
    const chip = el('button', 'example-chip', sample);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      refs.topicInput.value = sample;
      setHomeSource('builtin');
      const tag = inferTag(sample);
      if (tag) refs.tagInput.value = tag;
      refs.topicInput.focus();
      autoGrowTopic();
    });
    refs.exampleChips.append(chip);
  }
}

function populatePracticeControls() {
  populateSubjectTabs();

  refs.difficultySelect.replaceChildren();
  for (const difficulty of DIFFICULTIES) {
    const option = document.createElement('option');
    option.value = difficulty.key;
    option.textContent = `${difficulty.label} · ${difficulty.hint}`;
    refs.difficultySelect.append(option);
  }

  populateSelect(refs.studentPersonaSelect, PERSONAS);
  populateAiModePicker();
  populateSelect(refs.studentModeSelect, STUDENT_MODES);
  populateSelect(refs.studentIntensitySelect, INTENSITIES);
  populatePersonaPicker();
  populateSelect(refs.chatPersonaSelect, PERSONAS);
  populateSelect(refs.chatModeSelect, STUDENT_MODES);
  populateSelect(refs.chatIntensitySelect, INTENSITIES);
  populateSelect(refs.chatSubjectSelect, SUBJECT_LIST);

  refs.historySourceFilter.replaceChildren();
  const allSources = document.createElement('option');
  allSources.value = 'all';
  allSources.textContent = '全部来源';
  refs.historySourceFilter.append(allSources);
  for (const source of Object.values(SOURCES)) {
    const option = document.createElement('option');
    option.value = source.key;
    option.textContent = source.full;
    refs.historySourceFilter.append(option);
  }

  refs.bankSubjectFilter.replaceChildren();
  const allSubjects = document.createElement('option');
  allSubjects.value = 'all';
  allSubjects.textContent = '全部学科';
  refs.bankSubjectFilter.append(allSubjects);
  for (const subject of SUBJECT_LIST) {
    const option = document.createElement('option');
    option.value = subject.key;
    option.textContent = subject.label;
    refs.bankSubjectFilter.append(option);
  }

  refs.bankSourceFilter.replaceChildren();
  const bankAll = document.createElement('option');
  bankAll.value = 'all';
  bankAll.textContent = '全部来源';
  refs.bankSourceFilter.append(bankAll);
  for (const source of Object.values(SOURCES)) {
    const option = document.createElement('option');
    option.value = source.key;
    option.textContent = source.label;
    refs.bankSourceFilter.append(option);
  }

  refs.historySubjectFilter.replaceChildren();
  const historyAll = el('button', 'filter-tab', '全部');
  historyAll.type = 'button';
  historyAll.dataset.subject = 'all';
  refs.historySubjectFilter.append(historyAll);
  for (const subject of SUBJECT_LIST) {
    const button = el('button', 'filter-tab', subject.short);
    button.type = 'button';
    button.dataset.subject = subject.key;
    refs.historySubjectFilter.append(button);
  }

  renderPracticeUI();
}

function populateSelect(select, items) {
  if (!select) return;
  select.replaceChildren();
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.key;
    option.textContent = item.label;
    select.append(option);
  }
}

function populatePersonaPicker() {
  if (!refs.personaPicker) return;
  refs.personaPicker.replaceChildren();
  for (const persona of PERSONAS) {
    const button = el('button', 'persona-option', persona.label);
    button.type = 'button';
    button.dataset.persona = persona.key;
    button.setAttribute('role', 'radio');
    button.title = `${persona.label}：${persona.prompt}`;
    button.addEventListener('click', () => selectPersona(persona.key));
    button.addEventListener('pointerenter', () => showPersonaHint(persona.key));
    button.addEventListener('focus', () => showPersonaHint(persona.key));
    button.addEventListener('pointerleave', () => showPersonaHint(store.practice.persona));
    button.addEventListener('blur', () => showPersonaHint(store.practice.persona));
    button.addEventListener('keydown', handlePersonaKeydown);
    refs.personaPicker.append(button);
  }
}

function populateAiModePicker() {
  if (!refs.aiModePicker) return;
  refs.aiModePicker.replaceChildren();
  for (const mode of AI_MODES) {
    const button = el('button', 'persona-option', mode.label);
    button.type = 'button';
    button.dataset.aiMode = mode.key;
    button.setAttribute('role', 'radio');
    button.title = `${mode.label}：${mode.hint}`;
    button.addEventListener('click', () => selectAiMode(mode.key));
    button.addEventListener('keydown', handleAiModeKeydown);
    refs.aiModePicker.append(button);
  }
}

function selectAiMode(key) {
  const mode = aiModeInfo(key);
  store.updatePractice({ aiMode: mode.key });
  renderPracticeUI();
}

function handleAiModeKeydown(event) {
  const keys = AI_MODES.map((mode) => mode.key);
  const current = keys.indexOf(store.practice.aiMode);
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (current + 1) % keys.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (current - 1 + keys.length) % keys.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = keys.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  selectAiMode(keys[next]);
  refs.aiModePicker?.querySelector(`[data-ai-mode="${keys[next]}"]`)?.focus();
}

function selectPersona(key) {
  const persona = personaInfo(key);
  store.updatePractice({ persona: persona.key });
  if (store.session) store.updateSessionMeta({ studentPersona: persona.key });
  renderPracticeUI();
}

function showPersonaHint(key) {
  if (!refs.homePersonaHint) return;
  const persona = personaInfo(key);
  refs.homePersonaHint.textContent = `${persona.label}：${persona.prompt}`;
}

function handlePersonaKeydown(event) {
  const keys = PERSONAS.map((persona) => persona.key);
  const current = keys.indexOf(store.practice.persona);
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (current + 1) % keys.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (current - 1 + keys.length) % keys.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = keys.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  selectPersona(keys[next]);
  refs.personaPicker?.querySelector(`[data-persona="${keys[next]}"]`)?.focus();
}

function populateSubjectTabs() {
  if (!refs.subjectTabs) return;
  refs.subjectTabs.replaceChildren();
  for (const subject of SUBJECT_LIST) {
    const button = el('button', 'subject-tab', subject.label);
    button.type = 'button';
    button.dataset.subject = subject.key;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => {
      if (store.session && store.practice.lockSubject) {
        toast('这节课的学科已经锁定；到设置里关闭锁定后才能换。', 'warm');
        return;
      }
      store.updatePractice({ subject: subject.key });
      renderPracticeUI();
    });
    refs.subjectTabs.append(button);
  }
}

function renderPracticeUI() {
  const practice = store.practice;
  const subject = subjectInfo(practice.subject);

  if (refs.subjectTabs) {
    for (const button of refs.subjectTabs.querySelectorAll('.subject-tab')) {
      const active = button.dataset.subject === practice.subject;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
  }

  if (refs.subjectHint) {
    refs.subjectHint.textContent = practice.lockSubject
      ? `整节课会锁定在${subject.label}`
      : `${subject.label} · 课堂中可以切换`;
  }

  if (refs.difficultySelect) refs.difficultySelect.value = practice.difficulty;

  if (refs.tagOptions) {
    refs.tagOptions.replaceChildren();
    for (const tag of subject.tags) {
      const option = document.createElement('option');
      option.value = tag;
      refs.tagOptions.append(option);
    }
  }

  renderQuickTags(subject);

  if (refs.studentPersonaSelect) refs.studentPersonaSelect.value = practice.persona;
  if (refs.studentModeSelect) refs.studentModeSelect.value = practice.mode;
  if (refs.studentIntensitySelect) refs.studentIntensitySelect.value = practice.intensity;
  if (refs.lockSubjectToggle) refs.lockSubjectToggle.checked = practice.lockSubject;

  if (refs.personaPicker) {
    for (const button of refs.personaPicker.querySelectorAll('.persona-option')) {
      const active = button.dataset.persona === practice.persona;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  const aiMode = aiModeInfo(practice.aiMode);
  const isTutor = aiMode.key === 'tutor';
  if (refs.aiModePicker) {
    for (const button of refs.aiModePicker.querySelectorAll('.persona-option')) {
      const active = button.dataset.aiMode === practice.aiMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }
  if (refs.aiModeHint) refs.aiModeHint.textContent = `${aiMode.label}：${aiMode.hint}`;
  if (refs.aiModeSettingsNote) refs.aiModeSettingsNote.hidden = !isTutor;
  if (refs.homePersonaBlock) refs.homePersonaBlock.hidden = isTutor;
  if (refs.homeSubtitle) {
    refs.homeSubtitle.textContent = isTutor
      ? 'AI 家教先短讲，再提问，你负责把每一步想明白。'
      : '你来讲，AI 持续追问，找到知识盲区。';
  }
  if (refs.homeTeacherHintText) {
    refs.homeTeacherHintText.textContent = isTutor
      ? '开始上课之后，小理会先问你已知什么、想弄懂什么，然后讲解一个关键点，再提一个问题等你回答。'
      : '开始讲课之后，需要由你先进行讲解，AI 学生等待你的发言，不会主动提问。';
  }
  if (refs.topicInput) {
    refs.topicInput.placeholder = isTutor
      ? '写下你想学的数学主题，例如：为什么判别式能判断一元二次方程根的个数？请小理一步步带我弄懂'
      : '写下你要讲解的数学主题，你作为老师来讲。例如：用配方法解 x²−6x+5=0，讲清楚每一步为什么这样做';
  }
  if (refs.startBtnLabel) refs.startBtnLabel.textContent = isTutor ? '开始上课' : '开始讲课';

  const persona = personaInfo(practice.persona);
  if (refs.homePersonaHint) {
    refs.homePersonaHint.textContent = `${persona.label}：${persona.prompt}`;
  }
  const intensity = intensityInfo(practice.intensity);
  if (refs.studentPersonaHint) {
    refs.studentPersonaHint.textContent = `${persona.label}：${persona.prompt}`;
  }
  if (refs.studentModeHint) {
    refs.studentModeHint.textContent =
      practice.mode === 'examiner'
        ? '考官模式：会更认真地核对每一步依据，但仍然一次只问一个问题。'
        : practice.mode === 'assist'
          ? '简易辅助模式：温和引导老师开口，适合完全不会讲的情况。'
          : '真实学生模式：疑问从你的讲解里自然生长，不按固定顺序。';
  }
  if (refs.studentIntensityHint) {
    refs.studentIntensityHint.textContent = `${intensity.label}：${intensity.hint}。`;
  }

  refs.historySourceFilter.value = historyFilter.source;
  renderHistoryFilterState();
  renderSourceNote();
  renderChatPractice();
}

function renderQuickTags(subject = subjectInfo(store.practice.subject)) {
  if (!refs.quickTags) return;
  refs.quickTags.replaceChildren();
  const row = refs.quickTags.closest('.quick-tag-row');
  // 小学数学不展示快捷标签，初中和高中保留。
  const show = subject.key !== 'primary';
  if (row) row.hidden = !show;
  if (!show) return;
  const selected = new Set(parseTags(refs.tagInput?.value));
  for (const tag of subject.tags) {
    const chip = el('button', 'quick-tag', tag);
    chip.type = 'button';
    chip.dataset.tag = tag;
    chip.classList.toggle('is-active', selected.has(tag));
    chip.setAttribute('aria-pressed', String(selected.has(tag)));
    chip.addEventListener('click', () => handleQuickTagClick(tag));
    refs.quickTags.append(chip);
  }
}

function handleQuickTagClick(tag) {
  toggleQuickTag(tag);
  if (!refs.topicInput) return;
  refs.topicInput.value = tag;
  setHomeSource('custom');
  refs.topicInput.focus();
  autoGrowTopic();
}

function toggleQuickTag(tag) {
  const current = parseTags(refs.tagInput?.value);
  const index = current.indexOf(tag);
  if (index >= 0) {
    current.splice(index, 1);
  } else {
    if (current.length >= 4) {
      toast('知识点最多选 4 个。', 'warm');
      return;
    }
    current.push(tag);
  }
  if (refs.tagInput) refs.tagInput.value = current.join('、');
  syncQuickTagState();
}

function syncQuickTagState() {
  if (!refs.quickTags) return;
  const selected = new Set(parseTags(refs.tagInput?.value));
  for (const chip of refs.quickTags.querySelectorAll('.quick-tag')) {
    const active = selected.has(chip.dataset.tag);
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  }
}

function renderHistoryFilterState() {
  if (refs.historySubjectFilter) {
    for (const button of refs.historySubjectFilter.querySelectorAll('.filter-tab')) {
      const active = button.dataset.subject === historyFilter.subject;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
  if (refs.historyRangeFilter) {
    for (const button of refs.historyRangeFilter.querySelectorAll('.filter-tab')) {
      const active = button.dataset.range === historyFilter.range;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

function renderSourceNote() {
  if (!refs.sourceNote) return;
  const subject = subjectInfo(store.practice.subject);
  const difficulty = difficultyInfo(store.practice.difficulty);
  const source = sourceInfo(homeSource);
  refs.sourceNote.textContent = `${subject.short} · ${difficulty.label} · ${source.label}`;
  if (refs.recognizeBtn) refs.recognizeBtn.hidden = !topicImage;
}

function setHomeSource(key) {
  homeSource = SOURCES[key] ? key : 'custom';
  renderSourceNote();
}

function inferTag(text) {
  const subject = subjectInfo(store.practice.subject);
  return subject.tags.find((tag) => String(text).includes(tag)) || '';
}

function parseTags(value) {
  return normalizeTags(
    String(value || '')
      .split(/[,，、;；]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  );
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

function onboardingSeen() {
  try {
    return Boolean(localStorage.getItem(APP.storage.onboarding));
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(APP.storage.onboarding, '1');
  } catch {
    /* Storage may be unavailable. */
  }
}

function buildOnboardingDots() {
  if (!refs.onboardingDots || refs.onboardingDots.childElementCount) return;
  for (let index = 0; index < 4; index += 1) {
    const dot = el('span', 'onboarding-dot');
    dot.setAttribute('aria-hidden', 'true');
    refs.onboardingDots.append(dot);
  }
}

function renderOnboardingStep() {
  buildOnboardingDots();
  const steps = refs.onboardingSteps
    ? Array.from(refs.onboardingSteps.querySelectorAll('.onboarding-step'))
    : [];
  const total = steps.length || 4;
  onboardingStep = Math.max(0, Math.min(total - 1, onboardingStep));

  steps.forEach((step, index) => {
    const active = index === onboardingStep;
    step.hidden = !active;
    step.classList.toggle('is-active', active);
  });

  if (refs.onboardingDots) {
    Array.from(refs.onboardingDots.children).forEach((dot, index) => {
      dot.classList.toggle('is-active', index === onboardingStep);
      dot.classList.toggle('is-done', index < onboardingStep);
    });
  }
  if (refs.onboardingStatus) {
    refs.onboardingStatus.textContent = `第 ${onboardingStep + 1} 步，共 ${total} 步`;
  }
  if (refs.onboardingPrevBtn) refs.onboardingPrevBtn.disabled = onboardingStep === 0;
  if (refs.onboardingNextBtn) {
    const last = onboardingStep === total - 1;
    refs.onboardingNextBtn.textContent = last
      ? onboardingStacked
        ? '完成'
        : '开始第一课'
      : '下一步';
  }
}

function openOnboarding({ stack = false } = {}) {
  onboardingStep = 0;
  onboardingStacked = stack;
  renderOnboardingStep();
  openModal('onboardingModal', { stack });
}

function handleOnboardingStep(delta) {
  onboardingStep += delta;
  renderOnboardingStep();
}

function finishOnboarding() {
  markOnboardingSeen();
  const stacked = onboardingStacked;
  closeModal('onboardingModal');
  onboardingStacked = false;
  if (stacked) {
    toast('新手引导看完了，随时可以在设置里重看。', 'success', 3000);
    return;
  }
  showScreen('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => {
    refs.topicInput?.focus({ preventScroll: true });
    toast('先写一个想讲的知识点，再点「开始讲课」。', 'warm', 4200);
  }, 260);
}

function maybeOnboard() {
  if (store.session) {
    maybeWelcome();
    return;
  }
  if (onboardingSeen()) {
    maybeWelcome();
    return;
  }
  setTimeout(() => {
    if (activeModalId || store.session) return;
    openOnboarding();
  }, 700);
}

/* -------------------------------------------------------------------------- */
/* Help center                                                                */
/* -------------------------------------------------------------------------- */

function helpItems() {
  if (!refs.helpGroups) return [];
  return Array.from(refs.helpGroups.querySelectorAll('.help-item'));
}

function applyHelpFilter(rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  const items = helpItems();
  const groups = refs.helpGroups
    ? Array.from(refs.helpGroups.querySelectorAll('.help-group'))
    : [];
  let matches = 0;

  for (const item of items) {
    const text = String(item.textContent || '').toLowerCase();
    const hit = !query || text.includes(query);
    item.hidden = !hit;
    if (hit) {
      matches += 1;
      if (query) item.open = true;
    }
    if (!query) item.open = false;
  }

  for (const group of groups) {
    const visible = Array.from(group.querySelectorAll('.help-item')).some((item) => !item.hidden);
    group.hidden = !visible;
  }

  if (refs.helpEmpty) refs.helpEmpty.hidden = matches > 0;
  if (refs.helpSearchMeta) {
    if (!query) {
      refs.helpSearchMeta.textContent = `共 ${items.length} 个问题`;
    } else {
      refs.helpSearchMeta.textContent = matches
        ? `找到 ${matches} 个相关问题`
        : '没有找到相关问题';
    }
  }
}

function openHelp() {
  openModal('helpModal');
  if (refs.helpSearch) {
    refs.helpSearch.value = '';
  }
  applyHelpFilter('');
}

/* -------------------------------------------------------------------------- */
/* Store → UI                                                                 */
/* -------------------------------------------------------------------------- */

function onStoreChange() {
  const session = store.session;
  const sessionId = session?.id || null;

  if (sessionId !== renderedSessionId) {
    renderedSessionId = sessionId;
    syncDraftSession(sessionId);
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
    checkStoragePressure({ source: 'session', message: store.persistenceWarning, force: true });
  }
  if (!store.persistenceWarning) lastPersistenceWarning = '';
}

function syncFabOffset() {
  if (!refs.chatPanel || !refs.composer) return;
  const height = refs.composer.offsetHeight;
  if (!height) return;
  refs.chatPanel.style.setProperty('--fab-bottom', `${height + 10}px`);
}

function setupComposerObserver() {
  syncFabOffset();
  if (!refs.composer) return;
  if ('ResizeObserver' in window) {
    composerObserver?.disconnect();
    composerObserver = new ResizeObserver(() => syncFabOffset());
    composerObserver.observe(refs.composer);
  }
  window.addEventListener('resize', syncFabOffset);
}

function readDraftRecord() {
  try {
    const raw = localStorage.getItem(APP.storage.draft);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function syncDraftSession(sessionId = store.session?.id || '') {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer);
    saveDraft();
  }
  const saved = readDraftRecord();
  const same = saved && saved.sessionId === sessionId;
  draftState = {
    sessionId,
    text: same && typeof saved.text === 'string' ? saved.text.slice(0, APP.limits.maxMessageChars) : '',
    open: same ? saved.open !== false : true,
    mode: same && saved.mode === 'preview' ? 'preview' : 'edit'
  };
  if (refs.draftInput) refs.draftInput.value = draftState.text;
  applyDraftUI();
}

function loadDraft() {
  syncDraftSession(store.session?.id || '');
}

function queueDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 220);
}

function saveDraft() {
  draftSaveTimer = null;
  try {
    localStorage.setItem(APP.storage.draft, JSON.stringify(draftState));
  } catch {
    /* Draft is best-effort; never block teaching when storage is full. */
  }
}

function applyDraftUI() {
  if (!refs.draftCard) return;
  const preview = draftState.mode === 'preview';
  refs.draftCard.classList.toggle('is-collapsed', !draftState.open);
  refs.draftBody.hidden = !draftState.open;
  refs.draftToggleBtn.setAttribute('aria-expanded', String(draftState.open));
  const toggleLabel = draftState.open ? '收起草稿板' : '展开草稿板';
  refs.draftToggleBtn.title = toggleLabel;
  refs.draftToggleBtn.setAttribute('aria-label', toggleLabel);
  refs.draftToggleBtn.classList.toggle('is-collapsed', !draftState.open);

  refs.draftInput.hidden = preview;
  refs.draftPreview.hidden = !preview;
  refs.draftEditTab.classList.toggle('is-active', !preview);
  refs.draftPreviewTab.classList.toggle('is-active', preview);
  refs.draftEditTab.setAttribute('aria-selected', String(!preview));
  refs.draftPreviewTab.setAttribute('aria-selected', String(preview));
  if (preview) renderDraftPreview();
}

function setDraftDrawer(open) {
  const next = Boolean(open);
  if (draftDrawerOpen === next) return;
  draftDrawerOpen = next;
  document.body.classList.toggle('draft-drawer-open', next);
  refs.draftMobileBtn?.setAttribute('aria-expanded', String(next));
  refs.draftMobileBtn?.setAttribute('title', next ? '收起草稿板' : '打开草稿板');
  if (refs.draftScrim) refs.draftScrim.hidden = !next;
  if (next) {
    refs.draftInput?.focus({ preventScroll: true });
  } else {
    refs.draftMobileBtn?.focus({ preventScroll: true });
  }
}

function escapeDraftHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function draftMathToHtml(raw) {
  let text = escapeDraftHtml(raw).replace(/\\[()[\]]/g, '').replace(/\$/g, '');

  text = text.replace(
    /\\sqrt\s*\{([^{}]*)\}/g,
    '<span class="math-sqrt"><span class="math-sqrt-symbol">√</span><span class="math-sqrt-body">$1</span></span>'
  );

  for (let round = 0; round < 4; round += 1) {
    const before = text;
    text = text.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
    text = text.replace(/_\{([^{}]*)\}/g, '<sub>$1</sub>');
    if (before === text) break;
  }

  for (let round = 0; round < 6; round += 1) {
    const before = text;
    text = text.replace(
      /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
      '<span class="math-frac"><span class="math-frac-num">$1</span><span class="math-frac-den">$2</span></span>'
    );
    if (before === text) break;
  }

  text = text.replace(/\^([0-9a-zA-Z+\-])/g, '<sup>$1</sup>');
  text = text.replace(/_([0-9a-zA-Z+\-])/g, '<sub>$1</sub>');
  text = text.replace(/\\([a-zA-Z]+)/g, (match, name) => DRAFT_SYMBOLS[name] || match);
  text = text.replace(/\\(left|right)/g, '');
  text = text.replace(/\\[,;:!]/g, ' ');
  return text;
}

function renderDraftPreview() {
  if (!refs.draftPreview) return;
  const source = refs.draftInput.value;
  refs.draftPreview.replaceChildren();
  if (!source.trim()) {
    refs.draftPreview.append(el('p', 'draft-preview-empty', '草稿还是空的。先在「编辑」里写几行，再回来预览。'));
    return;
  }
  const sheet = el('div', 'draft-sheet');
  const lines = source.split('\n');
  for (const line of lines) {
    const row = el('p', `draft-line${line.trim() ? '' : ' is-empty'}`);
    if (line.trim()) row.innerHTML = draftMathToHtml(line);
    else row.append(document.createTextNode(' '));
    sheet.append(row);
  }
  refs.draftPreview.append(sheet);
}

function showScreen(name) {
  const isChat = name === 'chat';
  if (!isChat) setDraftDrawer(false);
  refs.homeScreen.hidden = isChat;
  refs.chatScreen.hidden = !isChat;
  document.body.classList.toggle('is-chat', isChat);
  refs.topbarSession.hidden = !isChat;
  refs.endSessionBtn.hidden = !isChat;
  if (isChat) {
    refs.topbarTopic.textContent = store.session?.topic || '';
    document.title = store.session ? `${store.session.topic} · 费曼小课堂` : '费曼小课堂';
    requestAnimationFrame(syncFabOffset);
  } else {
    document.title = '费曼小课堂 · 讲给一个会追问的学生听';
  }
}

function currentAiMode() {
  return store.session?.aiMode || store.practice.aiMode;
}

function isTutorSession() {
  return currentAiMode() === 'tutor';
}

/**
 * Swap teacher-side chrome (labels, hints, report entry points) when the
 * session runs in AI 家教 mode. The mode is locked at session start.
 */
function applyAiModeChrome() {
  const session = store.session;
  const tutor = session?.aiMode === 'tutor';
  const name = aiDisplayName(session?.aiMode || store.practice.aiMode);

  if (refs.chatKicker) refs.chatKicker.textContent = tutor ? 'AI 家教' : '正在讲课';
  if (refs.typingLabel) refs.typingLabel.textContent = `${name}正在想`;
  if (refs.statTurnsLabel) refs.statTurnsLabel.textContent = tutor ? '你的回答' : '你的讲解';
  if (refs.statQuestionsLabel) {
    refs.statQuestionsLabel.textContent = tutor ? `${name}的提问` : '小问的追问';
  }
  if (refs.messageInput) {
    refs.messageInput.placeholder = tutor
      ? '写下你的答案…… 不确定也可以直接说哪里没懂。'
      : '把你的思路讲出来…… 不用完美，边想边说也可以。';
    refs.messageInput.setAttribute('aria-label', tutor ? '你的回答' : '你的讲解');
  }
  if (refs.sendBtn) refs.sendBtn.setAttribute('aria-label', tutor ? '发送回答' : '发送讲解');
  if (refs.endSessionBtn) {
    refs.endSessionBtn.textContent = tutor ? '结束辅导' : '结束本次讲课';
  }

  // Teacher-training surfaces have no meaning while 小理 is the one teaching.
  for (const node of [
    refs.progressCard,
    refs.teacherCallCard,
    refs.chatPersonaRow,
    refs.chatIntensityRow,
    refs.chatModeRow,
    refs.markStuckBtn,
    refs.endAndReportBtn,
    refs.callTeacherMobile
  ]) {
    if (node) node.hidden = tutor;
  }
}

function syncChrome() {
  const session = store.session;
  const busy = store.busy;
  applyAiModeChrome();
  const evaluating = store.state.status === STATUS.EVALUATING;
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
  refs.viewLastReportBtn.textContent = hasReport ? '查看上一次诊断报告 →' : '';

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
  if (refs.abandonSessionBtn) refs.abandonSessionBtn.hidden = !session;

  const stuckCount = session?.stuckPoints?.length || 0;
  if (refs.stuckBadge) {
    refs.stuckBadge.hidden = stuckCount === 0;
    refs.stuckBadge.textContent = `卡点 ${stuckCount}`;
  }
  if (refs.undoTurnBtn) refs.undoTurnBtn.disabled = !session || busy || turns < 1;
  if (refs.markStuckBtn) refs.markStuckBtn.disabled = !session || turns < 1;
  if (refs.endAndReportBtn) {
    refs.endAndReportBtn.disabled = !session || busy || evaluating || turns < 1;
  }

  renderPracticeUI();
  renderConnection();
  updateSettingsButtonState();
}

function renderTopicMeta(session) {
  if (!refs.topicMeta) return;
  refs.topicMeta.replaceChildren();
  if (!session) return;

  const meta = sessionMeta(session);
  const add = (text, kind) => {
    if (!text) return;
    refs.topicMeta.append(el('span', `topic-chip topic-chip-${kind}`, text));
  };

  add(meta.subject?.label, 'subject');
  add(meta.difficulty?.label, 'difficulty');
  for (const tag of meta.tags) add(tag, 'tag');
  add(meta.source?.full, 'source');

  const persona = personaInfo(session.studentPersona);
  const mode = modeInfo(session.studentMode);
  const tutor = session.aiMode === 'tutor';
  if (refs.chatSub) {
    const parts = [];
    if (meta.subject) parts.push(meta.subject.short);
    if (tutor) {
      parts.push('先讲再问');
    } else {
      parts.push(persona.label);
      parts.push(mode.label);
    }
    refs.chatSub.textContent = `${aiDisplayName(session.aiMode)} · ${parts.join(' · ')}`;
  }
}

function renderChatPractice() {
  const session = store.session;
  if (!session) return;
  if (refs.chatSubjectSelect) {
    refs.chatSubjectSelect.replaceChildren();
    for (const subject of SUBJECT_LIST) {
      const option = document.createElement('option');
      option.value = subject.key;
      option.textContent = subject.label;
      refs.chatSubjectSelect.append(option);
    }
    refs.chatSubjectSelect.value = session.subject;
    refs.chatSubjectSelect.disabled = Boolean(store.practice.lockSubject);
  }
  if (refs.chatPersonaSelect) refs.chatPersonaSelect.value = session.studentPersona;
  if (refs.chatIntensitySelect) refs.chatIntensitySelect.value = session.studentIntensity;
  if (refs.chatModeSelect) refs.chatModeSelect.value = session.studentMode;
  if (refs.practiceLockHint) {
    refs.practiceLockHint.textContent = store.practice.lockSubject
      ? '学科已锁定；到设置里可以关闭锁定。'
      : '学科未锁定，可以在课堂中切换。';
  }
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
  renderTopicMeta(session);
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

  renderStuckMarkers(session.stuckPoints || []);

  refs.typingIndicator.hidden = true;
  syncChrome();
  requestAnimationFrame(() => scrollToBottom(true));
}

function renderMessage(message) {
  const isUser = message.role === 'user';
  const tutor = store.session?.aiMode === 'tutor';
  const name = aiDisplayName(store.session?.aiMode);
  const row = el('article', `message-row ${isUser ? 'user' : 'student'}`);
  row.id = `msg-${message.id}`;
  row.dataset.id = message.id;

  const avatar = el(
    'div',
    `message-avatar ${isUser ? 'user-avatar' : 'student-avatar'}`,
    isUser ? '我' : tutor ? '理' : '问'
  );
  avatar.setAttribute('aria-hidden', 'true');

  const main = el('div', 'message-main');
  const meta = el('div', 'message-meta');
  meta.append(
    el(
      'span',
      'message-name',
      isUser
        ? tutor
          ? '我 · 学生'
          : '我 · 老师'
        : `${name} · ${tutor ? 'AI 家教' : 'AI 学生'}`
    ),
    el('span', 'message-time', formatTime(message.createdAt))
  );
  const copyButton = renderMessageCopy(message);
  if (copyButton) meta.append(copyButton);

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

function renderMessageCopy(message) {
  const text = String(message.content || '').trim();
  if (!text || message.streaming) return null;
  const button = el('button', 'message-copy', '复制');
  button.type = 'button';
  button.title = '复制这条消息';
  const tutor = isTutorSession();
  button.setAttribute(
    'aria-label',
    `复制${message.role === 'user' ? (tutor ? '你的回答' : '你的讲解') : `${aiDisplayName(store.session?.aiMode)}的回复`}`
  );
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const ok = await copyText(text);
    button.textContent = ok ? '已复制' : '复制失败';
    button.classList.toggle('is-done', ok);
    setTimeout(() => {
      button.textContent = '复制';
      button.classList.remove('is-done');
    }, 1500);
    toast(ok ? '这条消息已复制。' : '复制失败，请手动选择文字。', ok ? 'success' : 'error', 2000);
  });
  return button;
}

function renderStuckMarker(point, number) {
  const marker = el('div', 'stuck-marker');
  marker.dataset.stuckId = point.id;
  const label = el('span', 'stuck-marker-label', `卡点 ${number}`);
  const text = el('span', 'stuck-marker-text', '已标记，AI 老师写报告时会重点看这里');
  marker.append(label, text);
  return marker;
}

function renderStuckMarkers(points) {
  const lastByAnchor = new Map();
  (points || []).forEach((point, index) => {
    const marker = renderStuckMarker(point, index + 1);
    const anchor = point.messageId ? document.getElementById(`msg-${point.messageId}`) : null;
    const target = anchor ? lastByAnchor.get(anchor) || anchor : null;
    if (target) target.after(marker);
    else refs.messageList.append(marker);
    if (anchor) lastByAnchor.set(anchor, marker);
  });
}

function appendStuckMarker(point, number) {
  const last = visibleMessages().slice(-1)[0];
  const marker = renderStuckMarker(point, number);
  let target = last ? document.getElementById(`msg-${last.id}`) : null;
  while (target?.nextElementSibling?.classList.contains('stuck-marker')) {
    target = target.nextElementSibling;
  }
  if (target) target.after(marker);
  else refs.messageList.append(marker);
  return marker;
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

function appendNotice(text, { retry = null } = {}) {
  const notice = el('div', 'system-notice');
  notice.append(el('span', 'notice-text', text));
  if (retry) {
    const button = el('button', 'notice-retry', '重试');
    button.type = 'button';
    button.addEventListener('click', () => {
      notice.remove();
      retry();
    });
    notice.append(button);
  }
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
  const difficulty = refs.difficultySelect?.value || store.practice.difficulty;
  const tags = parseTags(refs.tagInput?.value);

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

  store.updatePractice({ difficulty });
  const source = homeSource;
  store.start(topic, image, {
    subject: store.practice.subject,
    difficulty,
    tags,
    source,
    studentPersona: store.practice.persona,
    aiMode: store.practice.aiMode
  });
  bankEditingId = '';
  refs.topicInput.value = '';
  if (refs.tagInput) refs.tagInput.value = '';
  if (refs.noteInput) refs.noteInput.value = '';
  clearTopicImage();
  setHomeSource('custom');
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
    toast(`写点什么再发给${aiDisplayName(store.session.aiMode)}吧。`, 'warm');
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
  const tutor = store.session.aiMode === 'tutor';
  const agent = tutor ? tutorAgent : studentAgent;
  const name = aiDisplayName(store.session.aiMode);
  store.setBusy(true);
  showTyping(true);

  const controller = new AbortController();
  studentAbort = controller;
  let assistant = null;
  let received = false;
  let streamedContent = '';

  try {
    const finalText = await agent.reply({
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
        streamedContent += delta;
        store.appendToMessage(assistant.id, delta, { persist: false });
        updateStreamingMessage(assistant.id, assistant.content);
      }
    });

    // If the agent returned a different text (e.g. after post-detection retry),
    // replace the streamed content with the final clean version.
    const finalClean = typeof finalText === 'string' ? finalText.trim() : '';
    if (!assistant && finalClean) {
      // The first stream produced nothing usable (or was fully rejected), but a
      // retry did return text — still show it instead of losing the turn.
      showTyping(false);
      assistant = store.addMessage('assistant', finalClean, []);
      if (assistant) appendMessageElement(assistant);
    } else if (assistant && finalClean && finalClean !== streamedContent) {
      const message = store.session?.messages.find((item) => item.id === assistant.id);
      if (message) {
        message.content = finalClean;
        updateStreamingMessage(assistant.id, finalClean);
      }
    }

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
      const retry = () => {
        if (assistant && store.session?.messages.some((item) => item.id === assistant.id)) {
          store.removeMessage(assistant.id);
          document.getElementById(`msg-${assistant.id}`)?.remove();
        }
        requestStudent();
      };
      appendNotice(
        `${name}这次没有接上话：${error.message || '未知错误'}。你的${
          tutor ? '回答' : '讲解'
        }已经保留，可以直接重试。`,
        { retry }
      );
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
  if (isTutorSession()) return;
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

function presentReport(report, { topic = '', archived = false, meta = '', record = null } = {}) {
  if (!report) return;
  currentReport = report;
  currentReportTopic = topic || store.session?.topic || '';
  currentReportMeta = meta || (store.session ? formatSessionMeta(store.session) : '');
  currentReportRecord = record;
  reportFromArchive = archived;
  openModal('reportModal');
  refs.reportLoading.hidden = true;
  refs.reportError.hidden = true;
  refs.reportContent.hidden = false;
  refs.reportModal.querySelector('.modal').scrollTop = 0;
  // Show exercise button only for live sessions (not archived reports)
  if (refs.exerciseBtn) refs.exerciseBtn.hidden = archived || !store.settings;
  renderReport(report, currentReportTopic, currentReportMeta);
}

function formatSessionMeta(session) {
  const meta = sessionMeta(session);
  const parts = [];
  if (meta.subject) parts.push(meta.subject.label);
  if (meta.difficulty) parts.push(meta.difficulty.label);
  if (meta.tags.length) parts.push(meta.tags.join('、'));
  if (meta.source) parts.push(meta.source.full);
  return parts.join(' · ');
}

function formatRecordMeta(record) {
  const parts = [];
  const subject = subjectInfo(record.subject);
  const difficulty = difficultyInfo(record.difficulty);
  const source = sourceInfo(record.source);
  if (subject) parts.push(subject.label);
  if (difficulty) parts.push(difficulty.label);
  if (record.tags?.length) parts.push(record.tags.join('、'));
  if (record.source) parts.push(source.full);
  return parts.join(' · ');
}

function normalizeEvidence(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s“”"'‘’、，。；：！？,.!?;:（）()【】\[\]…—\-]/g, '');
}

function findEvidenceIndex(messages, evidence) {
  const target = normalizeEvidence(evidence);
  if (!target) return -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'user') continue;
    const text = normalizeEvidence(message.content);
    if (!text) continue;
    if (text.includes(target)) return index;
    if (target.length >= 8) {
      for (let start = 0; start + 8 <= target.length; start += 4) {
        if (text.includes(target.slice(start, start + 8))) return index;
      }
    }
  }
  return -1;
}

function reportReplayRecord() {
  if (currentReportRecord) return currentReportRecord;
  if (!store.session) return null;
  return {
    topic: store.session.topic,
    subject: store.session.subject,
    difficulty: store.session.difficulty,
    tags: store.session.tags,
    source: store.session.source,
    messages: store.session.messages
      .filter((message) => !message.hidden && (message.role === 'user' || message.role === 'assistant'))
      .map((message) => ({ role: message.role, content: message.content }))
  };
}

function gapExerciseText(gap) {
  if (gap.exercise) return gap.exercise;
  if (gap.fix) return `照着「${gap.fix}」做一遍，再用自己的话复述这一步的依据。`;
  return `用 1 分钟把「${gap.title || '这个缺口'}」重新讲一遍，并补上每一步的依据。`;
}

function gapNextGoalText(gap) {
  if (gap.nextGoal) return gap.nextGoal;
  return `下一次讲课先补上「${gap.title || '这个缺口'}」的依据，再进入新题。`;
}

function renderReport(report, topicOverride, meta = '') {
  const topic = topicOverride ?? store.session?.topic ?? '';
  refs.reportTopic.replaceChildren(document.createTextNode(topic));
  if (report.lowEvidence) {
    refs.reportTopic.append(el('span', 'evidence-note', '证据有限 · 已保守评分'));
  }
  if (refs.reportMeta) {
    refs.reportMeta.textContent = meta;
    refs.reportMeta.hidden = !meta;
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
    const note = report.dimensions?.[metric.key] || {};
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
    if (note.evidence) {
      card.append(el('p', 'metric-evidence', `对话证据：“${note.evidence}”`));
    } else {
      card.append(el('p', 'metric-evidence is-empty', '对话证据：这次有效片段不足'));
    }
    if (note.advice) {
      card.append(el('p', 'metric-advice', `改进建议：${note.advice}`));
    } else {
      card.append(el('p', 'metric-advice is-empty', `改进建议：${metric.caption}`));
    }
    refs.metricGrid.append(card);
  }

  refs.misconceptionList.replaceChildren();
  const replayRecord = reportReplayRecord();
  const replayMessages = Array.isArray(replayRecord?.messages) ? replayRecord.messages : [];
  (report.misconceptions || []).forEach((gap, index) => {
    const card = el('article', 'misconception-card');
    card.append(el('span', 'gap-index', String(index + 1).padStart(2, '0')));

    const body = el('div');
    const titleRow = el('div', 'gap-title-row');
    titleRow.append(el('h4', '', gap.title || `理解缺口 ${index + 1}`));
    if (gap.type) {
      const typeBadge = el('span', `gap-type-badge gap-type-${gap.type.includes('知识') ? 'error' : gap.type.includes('跳跃') ? 'jump' : 'missing'}`, gap.type);
      titleRow.append(typeBadge);
    }
    if (gap.zpd) {
      const zpdBadge = el('span', `gap-zpd-badge gap-zpd-${gap.zpd === '已掌握' ? 'mastered' : gap.zpd === '未触及' ? 'unreached' : 'edge'}`, gap.zpd);
      titleRow.append(zpdBadge);
    }
    body.append(titleRow);
    if (gap.evidence) {
      body.append(el('p', 'gap-evidence', `"${gap.evidence}"`));
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

    const exercise = el('div', 'gap-action-box gap-exercise');
    exercise.append(
      el('span', 'gap-action-label', '1 分钟微练习'),
      el('p', 'gap-action-text', gapExerciseText(gap))
    );
    body.append(exercise);

    const goal = el('div', 'gap-action-box gap-goal');
    goal.append(
      el('span', 'gap-action-label', '下次讲课目标'),
      el('p', 'gap-action-text', gapNextGoalText(gap))
    );
    body.append(goal);

    const actions = el('div', 'gap-actions');
    if (replayMessages.length) {
      const focusIndex = findEvidenceIndex(replayMessages, gap.evidence);
      const replay = el(
        'button',
        'btn btn-ghost btn-sm gap-replay',
        focusIndex >= 0 ? '定位原对话' : '查看课堂回放'
      );
      replay.type = 'button';
      replay.title = focusIndex >= 0 ? '跳到这条证据对应的对话位置' : '打开课堂回放查看完整对话';
      replay.addEventListener('click', () => openReplay(replayRecord, { focusIndex }));
      actions.append(replay);
    }
    const restart = el('button', 'btn btn-outline btn-sm gap-restart', '针对缺口重新开课');
    restart.type = 'button';
    restart.addEventListener('click', () => handleRestartGap(gap));
    actions.append(restart);
    body.append(actions);
    card.append(body);
    refs.misconceptionList.append(card);
  });

  refs.nextStepList.replaceChildren();
  (report.nextSteps || []).forEach((step, index) => {
    const card = el('article', 'next-step-card');
    card.append(el('span', 'next-index', String(index + 1)));

    const body = el('div');
    const titleRow = el('div', 'gap-title-row');
    titleRow.append(el('h4', '', step.title || `下一步 ${index + 1}`));
    if (step.zpd) {
      const zpdBadge = el('span', `gap-zpd-badge gap-zpd-${step.zpd === '已掌握' ? 'mastered' : step.zpd === '未触及' ? 'unreached' : 'edge'}`, step.zpd);
      titleRow.append(zpdBadge);
    }
    body.append(titleRow);
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

/* -------------------------------------------------------------------------- */
/* Exercise generation & farewell                                             */
/* -------------------------------------------------------------------------- */

function buildExerciseMessages(report, session) {
  const topic = session?.topic || currentReportTopic || '';
  const meta = session ? sessionMeta(session) : null;
  const lines = [];

  lines.push(`讲课主题是：《${topic}》。`);
  if (meta?.subject) lines.push(`学科：${meta.subject.label}。`);
  if (meta?.difficulty) lines.push(`难度：${meta.difficulty.label}。`);
  if (meta?.tags?.length) lines.push(`知识点：${meta.tags.join('、')}。`);

  // Summarize misconceptions for the exercise prompt
  const gaps = report?.misconceptions || [];
  if (gaps.length) {
    lines.push('诊断报告中发现的薄弱点：');
    for (const gap of gaps) {
      lines.push(`- ${gap.title}（${gap.type || '步骤缺失'}，${gap.zpd || '边缘掌握'}）：${gap.fix || ''}`);
    }
  }

  const system = `${EXERCISE_PROMPT}

【本课诊断信息】
${lines.join('\n')}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: `请基于以上诊断信息，出 1-2 道巩固练习题。` }
  ];
}

function parseExercise(raw) {
  const text = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('练习题格式不正确，请再试一次。');
  }
  const object = JSON.parse(text.slice(start, end + 1));
  if (!object.exercises || !Array.isArray(object.exercises) || !object.exercises.length) {
    throw new Error('没有生成练习题，请再试一次。');
  }
  return object;
}

function renderExercise(data) {
  refs.exerciseTitleText.textContent = data.title || '巩固练习';
  refs.exerciseList.replaceChildren();

  for (const ex of data.exercises) {
    const card = el('article', 'exercise-card');
    const isChoice = ex.type === 'choice' && Array.isArray(ex.options) && ex.options.length;

    const question = el('div', 'exercise-question');
    question.append(el('span', 'exercise-type-badge', isChoice ? '选择题' : '填空题'));
    question.append(el('p', '', ex.question || ''));
    card.append(question);

    if (isChoice) {
      const options = el('div', 'exercise-options');
      for (const opt of ex.options) {
        const btn = el('button', 'exercise-option', opt);
        btn.type = 'button';
        const isCorrect = String(opt).charAt(0).toUpperCase() === String(ex.answer).toUpperCase();
        btn.addEventListener('click', () => {
          // Reveal correctness
          for (const o of options.querySelectorAll('.exercise-option')) {
            o.disabled = true;
            const letter = String(o.textContent).charAt(0).toUpperCase();
            o.classList.toggle('is-correct', letter === String(ex.answer).toUpperCase());
            o.classList.toggle('is-wrong', o === btn && !isCorrect);
          }
          toast(isCorrect ? '答对了！' : '再看看答案~', isCorrect ? 'success' : 'warm', 2600);
        });
        options.append(btn);
      }
      card.append(options);
    }

    const reveal = el('details', 'exercise-reveal');
    const summary = el('summary', '', '查看答案与提示');
    const body = el('div', 'exercise-reveal-body');
    body.append(el('p', '', `答案：${ex.answer || '—'}`));
    if (ex.hint) body.append(el('p', 'exercise-hint', `提示：${ex.hint}`));
    if (ex.targetWeakness) body.append(el('p', 'exercise-target', `对应薄弱点：${ex.targetWeakness}`));
    reveal.append(summary, body);
    card.append(reveal);

    refs.exerciseList.append(card);
  }
}

let exerciseAbort = null;

async function handleExercise() {
  if (!currentReport) {
    toast('请先生成诊断报告，再做练习。', 'warm');
    return;
  }
  if (!ensureKey()) return;

  const session = store.session;
  const report = currentReport;

  openModal('exerciseModal');
  refs.exerciseLoading.hidden = false;
  refs.exerciseError.hidden = true;
  refs.exerciseContent.hidden = true;

  const controller = new AbortController();
  exerciseAbort = controller;

  try {
    const messages = buildExerciseMessages(report, session);
    const raw = await completeChat({
      settings: store.settings,
      messages,
      maxTokens: 1200,
      temperature: 0.5,
      jsonMode: true,
      signal: controller.signal
    });
    const data = parseExercise(raw);
    refs.exerciseLoading.hidden = true;
    refs.exerciseContent.hidden = false;
    renderExercise(data);
  } catch (error) {
    if (isAbortError(error)) return;
    refs.exerciseLoading.hidden = true;
    refs.exerciseContent.hidden = true;
    refs.exerciseError.hidden = false;
    refs.exerciseErrorText.textContent = error.message || '出题失败，请稍后再试。';
  } finally {
    exerciseAbort = null;
  }
}

/**
 * Generate a farewell message from the student agent when ending a session.
 * Returns the farewell text, or empty string if generation fails.
 */
async function generateFarewell() {
  if (!store.session) return '';
  try {
    const visibleMsgs = (store.session.messages || [])
      .filter((m) => !m.hidden && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => `${m.role === 'user' ? '老师' : '小问'}：${m.content || ''}`)
      .join('\n');

    const messages = [
      { role: 'system', content: FAREWELL_PROMPT },
      { role: 'user', content: `以下是这节课的对话记录，请根据它生成告别语：\n\n${visibleMsgs.slice(-2000)}` }
    ];

    const result = await completeChat({
      settings: store.settings,
      messages,
      maxTokens: 120,
      temperature: 0.8,
      signal: AbortSignal.timeout(8000)
    });
    return String(result || '').trim();
  } catch {
    return '';
  }
}

async function copyReport() {
  if (!currentReport) return;
  const session = store.session;
  const record =
    currentReportRecord ||
    {
      topic: currentReportTopic || session?.topic || '',
      subject: session?.subject || null,
      difficulty: session?.difficulty || null,
      tags: session?.tags || [],
      source: session?.source || '',
      report: currentReport
    };
  const markdown = reportToText(record);
  const ok = await copyText(markdown);
  if (ok) {
    toast('Markdown 报告已复制到剪贴板。', 'success');
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
  renderThemeSwitch();
  updateStorageUsage();
  hideSettingsStatus();
}

function applyTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#141a18' : '#fdfdfb');
}

function renderThemeSwitch() {
  if (!refs.themeSwitch) return;
  const current = store.settings.theme === 'dark' ? 'dark' : 'light';
  for (const button of refs.themeSwitch.querySelectorAll('.theme-option')) {
    const active = button.dataset.theme === current;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
  }
}

function handleThemeKeydown(event) {
  const themes = ['light', 'dark'];
  const current = themes.indexOf(store.settings.theme === 'dark' ? 'dark' : 'light');
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (current + 1) % themes.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (current - 1 + themes.length) % themes.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = themes.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  handleThemeSelect(themes[next]);
  refs.themeSwitch?.querySelector(`[data-theme="${themes[next]}"]`)?.focus();
}

function handleThemeSelect(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  applyTheme(resolved);
  if (store.settings.theme === resolved) {
    renderThemeSwitch();
    return;
  }
  store.updateSettings({ ...store.settings, theme: resolved });
  renderThemeSwitch();
  toast(`已切换为${resolved === 'dark' ? '深色' : '浅色'}模式。`, 'success', 2200);
}

function localStorageBytes() {
  try {
    let total = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) || '';
      const value = localStorage.getItem(key) || '';
      total += (key.length + value.length) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function storageSnapshot() {
  const used = localStorageBytes();
  const ratio = Math.min(1, used / STORAGE_QUOTA_BYTES);
  const level =
    ratio >= STORAGE_CRITICAL_RATIO ? 'critical' : ratio >= STORAGE_WARN_RATIO ? 'warn' : 'ok';
  return { used, ratio, percent: Math.min(100, Math.round(ratio * 100)), level };
}

function readStorageNotice() {
  try {
    const stored = JSON.parse(localStorage.getItem(APP.storage.storageNotice) || 'null');
    if (!stored || typeof stored !== 'object') return null;
    return {
      level: stored.level === 'critical' ? 'critical' : 'warn',
      used: Number(stored.used) || 0
    };
  } catch {
    return null;
  }
}

function writeStorageNotice(snapshot) {
  try {
    localStorage.setItem(
      APP.storage.storageNotice,
      JSON.stringify({ level: snapshot.level, used: snapshot.used, at: new Date().toISOString() })
    );
  } catch {
    /* Ignore: storage is already under pressure. */
  }
}

function clearStorageNotice() {
  try {
    localStorage.removeItem(APP.storage.storageNotice);
  } catch {
    /* Ignore. */
  }
}

function storageNoticeSuppressed(snapshot) {
  const notice = readStorageNotice();
  if (!notice || notice.level !== snapshot.level) return false;
  // Show again when usage has grown meaningfully since the last dismissal.
  return snapshot.used <= notice.used * 1.08 + 200 * 1024;
}

function renderStorageMeter(snapshot = storageSnapshot()) {
  const records = loadHistory().length;

  if (refs.storageUsage) {
    refs.storageUsage.textContent = `本机已用约 ${formatBytes(snapshot.used)} / 5 MB（${snapshot.percent}%）· ${records} 条学习档案。`;
  }
  if (refs.storageMeterFill) {
    refs.storageMeterFill.style.width = `${Math.max(1, snapshot.percent)}%`;
  }
  if (refs.storageMeter) {
    refs.storageMeter.setAttribute('aria-valuenow', String(snapshot.percent));
    refs.storageMeter.setAttribute(
      'aria-valuetext',
      `已用 ${formatBytes(snapshot.used)}，约占本机存储 ${snapshot.percent}%`
    );
  }
  if (refs.storagePanel) {
    refs.storagePanel.classList.toggle('is-warn', snapshot.level === 'warn');
    refs.storagePanel.classList.toggle('is-critical', snapshot.level === 'critical');
  }
  if (refs.storageBadge) {
    refs.storageBadge.textContent =
      snapshot.level === 'critical' ? '即将用满' : snapshot.level === 'warn' ? '偏紧' : '充足';
    refs.storageBadge.dataset.level = snapshot.level;
  }
  if (refs.storageHint) {
    refs.storageHint.hidden = snapshot.level === 'ok';
    refs.storageHint.textContent =
      snapshot.level === 'critical'
        ? '空间即将用尽，新的课堂和报告可能无法保存。请先导出备份，再清理旧档案。'
        : snapshot.level === 'warn'
          ? '空间开始紧张。建议导出备份，并清理不再需要的学习档案。'
          : '';
  }
  return snapshot;
}

function storageBannerTitle(snapshot, source, eventLevel = '') {
  if (source === 'session') return '课堂没能完整保存';
  if (source === 'history') {
    const level = eventLevel || snapshot.level;
    return level === 'critical' ? '学习档案没能保存' : '学习档案已自动精简';
  }
  if (source === 'bank') return '题库没能完整保存';
  return snapshot.level === 'critical' ? '本机存储即将用满' : '本机存储开始紧张';
}

function storageBannerMessage(snapshot, message) {
  if (message) return message;
  const used = formatBytes(snapshot.used);
  if (snapshot.level === 'critical') {
    return `已用约 ${used}（${snapshot.percent}%），新的课堂和报告可能存不下。请先导出 JSON 备份，再清理旧档案。`;
  }
  return `已用约 ${used}（${snapshot.percent}%）。先导出备份，再清理不需要的学习档案或题库图片。`;
}

function showStorageBanner(snapshot, { source = 'auto', message = '', eventLevel = '' } = {}) {
  if (!refs.storageBanner) return;
  refs.storageBanner.hidden = false;
  refs.storageBanner.dataset.level = snapshot.level;
  if (refs.storageBannerTitle) {
    refs.storageBannerTitle.textContent = storageBannerTitle(snapshot, source, eventLevel);
  }
  if (refs.storageBannerText) {
    refs.storageBannerText.textContent = storageBannerMessage(snapshot, message);
  }
  if (refs.storageBannerMark) {
    refs.storageBannerMark.textContent = snapshot.level === 'critical' ? '!!' : '!';
  }
  if ((source === 'history' || source === 'bank') && lastStorageToastLevel !== snapshot.level) {
    lastStorageToastLevel = snapshot.level;
    toast(message || '本机存储空间不足，建议先导出备份。', 'warm', 6500);
  }
}

function hideStorageBanner() {
  if (refs.storageBanner) refs.storageBanner.hidden = true;
}

function dismissStorageBanner() {
  const snapshot = storageSnapshot();
  hideStorageBanner();
  if (snapshot.level !== 'ok') writeStorageNotice(snapshot);
}

function checkStoragePressure({ source = 'auto', message = '', force = false, eventLevel = '' } = {}) {
  const snapshot = renderStorageMeter();
  const forced = force || source === 'session' || source === 'history' || source === 'bank';

  if (snapshot.level === 'ok' && !forced) {
    hideStorageBanner();
    clearStorageNotice();
    lastStorageToastLevel = '';
    return snapshot;
  }

  const display =
    snapshot.level === 'ok' ? { ...snapshot, level: 'critical' } : snapshot;
  if (forced || !storageNoticeSuppressed(display)) {
    showStorageBanner(display, { source, message, eventLevel });
  }
  return snapshot;
}

function updateStorageUsage() {
  const snapshot = renderStorageMeter();
  if (snapshot.level === 'ok') {
    hideStorageBanner();
    clearStorageNotice();
    lastStorageToastLevel = '';
  }
}

function openStorageSettings() {
  fillSettingsForm();
  openModal('settingsModal');
  setTimeout(() => {
    refs.clearArchiveDataBtn?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    refs.clearArchiveDataBtn?.focus({ preventScroll: true });
  }, 340);
}

function handleStorageWarningEvent(event) {
  const detail = event?.detail || {};
  checkStoragePressure({
    source: detail.source || 'history',
    message: detail.message || '',
    force: true,
    eventLevel: detail.level || ''
  });
}

function readSettingsForm() {
  return {
    apiKey: refs.apiKeyInput.value.trim(),
    model: refs.modelInput.value.trim(),
    baseUrl: refs.baseUrlInput.value.trim(),
    proxyUrl: refs.proxyUrlInput.value.trim(),
    accessCode: refs.accessCodeInput.value.trim(),
    temperature: Number(refs.temperatureInput.value),
    theme: store.settings.theme === 'dark' ? 'dark' : 'light'
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

async function handleExportData() {
  if (!refs.exportDataBtn) return;
  refs.exportDataBtn.disabled = true;
  refs.exportDataBtn.textContent = '正在打包…';
  const bannerExport = refs.storageBannerExport;
  if (bannerExport) {
    bannerExport.disabled = true;
    bannerExport.textContent = '导出中…';
  }
  try {
    let questions = [];
    try {
      questions = await listQuestions();
    } catch {
      questions = [];
    }
    const payload = {
      app: 'Feynman Classroom',
      schema: 1,
      exportedAt: new Date().toISOString(),
      settings: { ...store.settings, apiKey: '' },
      practice: store.practice,
      session: store.session,
      history: loadHistory(),
      questions
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const link = document.createElement('a');
    link.href = url;
    link.download = `feynman-classroom-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    updateStorageUsage();
    showSettingsStatus('已导出全部 JSON。API Key 已移除，其他数据都在文件里。', 'ok');
    toast('数据已导出，请把 JSON 文件保存到安全位置。', 'success', 3200);
  } catch {
    showSettingsStatus('导出失败，可能是浏览器阻止了下载，请稍后再试。', 'error');
    toast('导出失败，请稍后再试。', 'error');
  } finally {
    refs.exportDataBtn.disabled = false;
    refs.exportDataBtn.textContent = '导出全部 JSON';
    if (bannerExport) {
      bannerExport.disabled = false;
      bannerExport.textContent = '导出备份';
    }
  }
}

function handleClearArchiveData() {
  const records = loadHistory();
  if (!records.length) {
    toast('学习档案已经是空的。', 'warm');
    return;
  }
  if (
    !window.confirm(
      `清空全部学习档案？共 ${records.length} 条记录，包含诊断报告和回放，删除后无法恢复。建议先导出 JSON 备份。`
    )
  ) {
    return;
  }
  clearHistory();
  openHistoryIds = new Set();
  renderHistory();
  renderHistoryEntry();
  checkStoragePressure();
  showSettingsStatus('学习档案已清空，课堂设置和题库没有受影响。', 'ok');
  toast('学习档案已清空。', 'success', 2600);
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

function setOcrStatus(message, type = '') {
  if (!refs.ocrStatus) return;
  const text = String(message || '').trim();
  if (!text) {
    refs.ocrStatus.hidden = true;
    refs.ocrStatus.textContent = '';
    refs.ocrStatus.className = 'ocr-status';
    return;
  }
  refs.ocrStatus.hidden = false;
  refs.ocrStatus.textContent = text;
  refs.ocrStatus.className = `ocr-status${type ? ` is-${type}` : ''}`;
}

function firstImageFile(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (file && typeof file.type === 'string' && file.type.startsWith('image/')) return file;
  }
  return null;
}

function imageFileFromClipboard(clipboardData) {
  if (!clipboardData) return null;
  for (const item of Array.from(clipboardData.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return firstImageFile(clipboardData.files);
}

function isHomeVisible() {
  return Boolean(refs.homeScreen && !refs.homeScreen.hidden);
}

function handleHomePaste(event) {
  if (!isHomeVisible()) return;
  const file = imageFileFromClipboard(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  handleTopicImage(file);
}

function handleHomeDragOver(event) {
  if (!isHomeVisible()) return;
  const types = Array.from(event.dataTransfer?.types || []);
  if (!types.includes('Files')) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  refs.homeCard?.classList.add('is-dragover');
}

function handleHomeDragLeave(event) {
  if (!refs.homeCard) return;
  if (event.relatedTarget && refs.homeCard.contains(event.relatedTarget)) return;
  refs.homeCard.classList.remove('is-dragover');
}

function handleHomeDrop(event) {
  if (!isHomeVisible()) return;
  const files = event.dataTransfer?.files;
  if (!files || !files.length) return;
  event.preventDefault();
  refs.homeCard?.classList.remove('is-dragover');
  const file = firstImageFile(files);
  if (!file) {
    toast('请拖入图片文件（JPG、PNG、WebP 等）。', 'warm');
    return;
  }
  handleTopicImage(file);
}

async function handleTopicImage(file) {
  if (!file) return;
  try {
    const dataUrl = await compressImageFile(file);
    topicImage = dataUrl;
    refs.topicImageThumb.src = dataUrl;
    refs.topicImagePreview.hidden = false;
    refs.topicImageHint.textContent = TOPIC_IMAGE_READY_HINT;
    setOcrStatus('图片已添加，原图会保留在预览里。可以点「识别文字」，也可以直接开始讲课。', 'info');
    setHomeSource('ocr');
    if (isTextOnlyModel(store.settings.model)) {
      warnTextOnlyModel();
    } else {
      toast('题目图片已添加。点「识别文字」可以把题干读出来。', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  }
}

function clearTopicImage() {
  topicImage = null;
  refs.topicImageThumb.removeAttribute('src');
  refs.topicImagePreview.hidden = true;
  refs.topicImageHint.textContent = TOPIC_IMAGE_HINT;
  setOcrStatus('');
  refs.topicImageInput.value = '';
  if (refs.topicCameraInput) refs.topicCameraInput.value = '';
  if (refs.recognizeBtn) refs.recognizeBtn.hidden = true;
  if (homeSource === 'ocr') setHomeSource('custom');
}

function describeOcrError(error) {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401 || status === 403) return '连接没有通过，请检查 API Key 或模型权限。';
  if (status === 402) return '模型额度不足，或当前模型不支持图片识别。';
  if (status === 429) return '请求太频繁了，稍等一会儿再试。';
  if (/无法连接到模型服务/.test(error?.message || '')) return '暂时连不上模型服务，请检查网络。';
  return error?.message || '没有识别出文字，请换一张更清晰的图片。';
}

async function recognizeTopicImage() {
  if (!topicImage) {
    toast('先上传、粘贴或拖入一张题目图片。', 'warm');
    return;
  }
  if (!ensureKey()) return;
  if (isTextOnlyModel(store.settings.model)) {
    warnTextOnlyModel();
    return;
  }

  const label = refs.recognizeBtn;
  const original = label.textContent;
  label.disabled = true;
  label.textContent = '识别中…';
  setOcrStatus('正在识别图片里的题目，请稍等……', 'busy');
  try {
    const text = await recognizeProblem({ settings: store.settings, image: topicImage });
    refs.topicInput.value = text;
    autoGrowTopic();
    setHomeSource('ocr');
    setOcrStatus('识别完成，题干已填入下方主题，可直接修改；原图保留在预览里。', 'ok');
    toast('识别完成，请先校对题干和公式，再开始讲课。', 'success', 6000);
    refs.topicInput.focus();
    refs.topicInput.setSelectionRange(text.length, text.length);
  } catch (error) {
    if (isAbortError(error)) return;
    const status = error instanceof ApiError ? error.status : 0;
    if ([401, 402, 403, 429].includes(status) || /无法连接到模型服务/.test(error?.message || '')) {
      connectionIssue = true;
      renderConnection();
    }
    const message = describeOcrError(error);
    setOcrStatus(`识别失败：${message} 原图已保留，你仍然可以手动输入题目，或换一张更清晰的图片再试。`, 'error');
    toast('识别没有成功，不影响手动输入题目。', 'warm', 5000);
  } finally {
    label.disabled = false;
    label.textContent = original;
  }
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
    // Do not hide a banner raised by an archive write failure; only refresh
    // pressure state when usage itself has crossed a threshold.
    const snapshot = renderStorageMeter();
    if (snapshot.level !== 'ok' && refs.storageBanner?.hidden) {
      checkStoragePressure({ source: 'archive' });
    }
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
  historySelectMode = false;
  historySelection = new Set();
  reportFromArchive = false;
  currentReportRecord = null;
  replayReturnHistory = false;
  renderHistory();
  openModal('historyModal');
}

function renderHistory() {
  const records = loadHistory();
  refs.historyEmpty.hidden = records.length > 0;
  refs.historyContent.hidden = records.length === 0;
  if (!records.length) return;

  renderHistoryFilterState();
  refs.historySourceFilter.value = historyFilter.source;

  const visible = filterHistoryRecords(records);
  const summary = summarizeHistory(visible);
  renderHistorySummary(summary);
  renderActivity(visible);
  renderSubjectOverview(visible);
  renderHabits(visible);
  renderTagStats(visible);
  renderHistoryTrend(visible, summary);
  renderHistoryDimensions(summary);
  renderHistoryAdvice(visible);
  renderHistoryBulkBar(visible);
  renderHistoryList(visible);
}

function filterHistoryRecords(records) {
  const days = HISTORY_RANGE_DAYS[historyFilter.range] || 0;
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  return records.filter((record) => {
    if (cutoff) {
      const time = new Date(record.endedAt || 0).getTime();
      if (!Number.isFinite(time) || time < cutoff) return false;
    }
    if (historyFilter.subject !== 'all' && record.subject !== historyFilter.subject) return false;
    if (historyFilter.source !== 'all' && record.source !== historyFilter.source) return false;
    return true;
  });
}

function renderSubjectOverview(records) {
  if (!refs.historySubjectOverview) return;
  refs.historySubjectOverview.replaceChildren();
  for (const entry of summarizeBySubject(records)) {
    const { subject, summary } = entry;
    const card = el('article', 'subject-overview-card');
    const head = el('div', 'subject-overview-head');
    head.append(el('strong', '', subject.label), el('span', '', subject.stage));
    card.append(head);

    if (!summary.sessions) {
      card.append(el('p', 'subject-overview-empty', '还没有练习'));
      refs.historySubjectOverview.append(card);
      continue;
    }

    const scoredRecords = records.filter(
      (record) =>
        record.subject === subject.key && Number.isFinite(record.report?.overallScore)
    );
    const best = scoredRecords.length
      ? Math.max(...scoredRecords.map((record) => record.report.overallScore))
      : null;

    const stats = el('div', 'subject-overview-stats');
    const stat = (value, label) => {
      const item = el('div');
      item.append(el('strong', '', value), el('small', '', label));
      return item;
    };
    stats.append(
      stat(summary.sessions, '课'),
      stat(Number.isFinite(summary.averageOverall) ? `${summary.averageOverall}%` : '—', '平均'),
      stat(best == null ? '—' : `${best}%`, '最高')
    );
    card.append(stats);
    refs.historySubjectOverview.append(card);
  }
}

function activityStat(value, unit, label) {
  const card = el('div', 'activity-stat');
  const strong = el('strong');
  strong.append(document.createTextNode(Number.isFinite(value) ? String(value) : '—'));
  if (unit && Number.isFinite(value)) strong.append(el('em', '', unit));
  card.append(strong, el('small', '', label));
  return card;
}

function renderActivity(records) {
  if (!refs.historyActivity) return;
  refs.historyActivity.replaceChildren();
  const activity = summarizeActivity(records);

  if (refs.historyActivityMeta) {
    refs.historyActivityMeta.textContent = activity.total
      ? `最近 ${activity.weeks} 周 · 有记录 ${activity.activeDays} 天`
      : `最近 ${activity.weeks} 周还没有练习记录`;
  }

  const stats = el('div', 'activity-stats');
  stats.append(
    activityStat(activity.current, '天', '连续学习'),
    activityStat(activity.longest, '天', '最长连续'),
    activityStat(activity.total, '课', `近 ${activity.weeks} 周`),
    activityStat(
      activity.peak.count,
      '课',
      activity.peak.count ? `单日最多 · ${activity.peak.label}` : '单日最多'
    )
  );

  const heatmap = el('div', 'activity-heatmap');
  heatmap.setAttribute('role', 'img');
  heatmap.setAttribute(
    'aria-label',
    `最近 ${activity.weeks} 周学习热力图，有记录 ${activity.activeDays} 天，共 ${activity.total} 课。`
  );
  const grid = el('div', 'heatmap-grid');
  grid.style.gridTemplateColumns = `repeat(${activity.weeks}, minmax(0, 1fr))`;
  const max = Math.max(1, ...activity.series.map((day) => day.count));
  for (const day of activity.series) {
    const cell = el('span', 'heatmap-cell');
    const level = day.count
      ? Math.min(4, 1 + Math.floor(((day.count - 1) / max) * 3.999))
      : 0;
    cell.classList.add(`is-level-${level}`);
    if (day.future) cell.classList.add('is-future');
    cell.title = day.future
      ? `${day.label} · 还没到`
      : `${day.label} · ${day.count ? `${day.count} 课` : '没有练习'}`;
    cell.setAttribute('aria-hidden', 'true');
    grid.append(cell);
  }

  const legend = el('div', 'heatmap-legend');
  legend.append(el('span', '', '少'));
  for (let level = 0; level <= 4; level += 1) {
    const dot = el('span', `heatmap-cell is-level-${level}`);
    dot.setAttribute('aria-hidden', 'true');
    legend.append(dot);
  }
  legend.append(el('span', '', '多'));

  heatmap.append(grid, legend);
  refs.historyActivity.append(stats, heatmap);
}

function habitLabel(key, list) {
  return list.find((item) => item.key === key)?.label || '未记录';
}

function buildHabitList(items, labels) {
  const list = el('div', 'habit-list');
  if (!items.length) {
    list.append(el('p', 'habit-empty', '还没有可统计的课堂。'));
    return list;
  }
  for (const item of items) {
    const row = el('div', 'habit-row');
    const head = el('div', 'habit-head');
    head.append(
      el('span', 'habit-name', habitLabel(item.key, labels)),
      el('span', 'habit-count', `${item.count} 课 · ${item.share}%`)
    );
    const track = el('div', 'habit-track');
    const fill = el('div', 'habit-fill');
    fill.style.width = `${item.share}%`;
    track.append(fill);
    row.append(head, track);
    list.append(row);
  }
  return list;
}

function renderHabits(records) {
  if (!refs.historyHabits) return;
  refs.historyHabits.replaceChildren();
  const habits = summarizeInteractions(records);

  if (refs.historyHabitMeta) {
    refs.historyHabitMeta.textContent = habits.sessions
      ? `${habits.sessions} 课 · 平均每课 ${habits.avgQuestions ?? 0} 个追问`
      : '还没有可统计的课堂';
  }

  const overview = el('article', 'habit-card');
  overview.append(el('h4', '', '每课互动'));
  const metrics = el('div', 'habit-metrics');
  const metric = (value, unit, label) => {
    const item = el('div', 'habit-metric');
    const strong = el('strong');
    strong.append(document.createTextNode(Number.isFinite(value) ? String(value) : '—'));
    if (unit && Number.isFinite(value)) strong.append(el('em', '', unit));
    item.append(strong, el('small', '', label));
    return item;
  };
  metrics.append(
    metric(habits.avgTurns, '轮', '平均讲解'),
    metric(habits.avgQuestions, '个', '平均追问'),
    metric(habits.questionsPerTurn, '个/轮', '追问密度')
  );
  overview.append(metrics);
  overview.append(
    el(
      'p',
      'habit-note',
      habits.turns
        ? `累计 ${habits.turns} 轮讲解、${habits.questions} 个追问。`
        : '完成一节课后，这里会出现互动统计。'
    )
  );

  const personaCard = el('article', 'habit-card');
  personaCard.append(el('h4', '', 'AI 学生人设'));
  personaCard.append(buildHabitList(habits.personas, PERSONAS));
  personaCard.append(el('p', 'habit-note', '人设来自每节课开课时的选择。'));

  const intensityCard = el('article', 'habit-card');
  intensityCard.append(el('h4', '', '追问强度'));
  intensityCard.append(buildHabitList(habits.intensities, INTENSITIES));
  intensityCard.append(el('p', 'habit-note', '强度越高，AI 学生追问得越紧。'));

  refs.historyHabits.append(overview, personaCard, intensityCard);
}

function renderHistoryAdvice(records) {
  if (!refs.historyAdvice || !refs.historyAdviceBlock) return;
  refs.historyAdvice.replaceChildren();

  const items = [];
  for (const record of records) {
    if (!Array.isArray(record.report?.nextSteps)) continue;
    const step = record.report.nextSteps.find((entry) => {
      const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
      const action = typeof entry?.action === 'string' ? entry.action.trim() : '';
      return Boolean(title || action);
    });
    if (!step) continue;
    const title = typeof step.title === 'string' ? step.title.trim() : '';
    const action = typeof step.action === 'string' ? step.action.trim() : '';
    items.push({
      record,
      title: title || action,
      action,
      example: typeof step.example === 'string' ? step.example.trim() : ''
    });
    if (items.length >= 4) break;
  }

  refs.historyAdviceBlock.hidden = items.length === 0;
  if (!items.length) return;

  for (const item of items) {
    const card = el('button', 'advice-card');
    card.type = 'button';
    const head = el('span', 'advice-head');
    head.append(el('strong', '', item.title), el('span', 'advice-arrow', '查看报告'));
    card.append(head);
    if (item.action && item.action !== item.title) {
      card.append(el('span', 'advice-action', item.action));
    }
    if (item.example) card.append(el('span', 'advice-example', `示范：${item.example}`));
    card.append(
      el(
        'span',
        'advice-from',
        `${item.record.topic} · ${formatArchiveDate(item.record.endedAt).replace('\n', ' ')}`
      )
    );
    card.addEventListener('click', () => {
      presentReport(item.record.report, {
        topic: item.record.topic,
        archived: true,
        meta: formatRecordMeta(item.record),
        record: item.record
      });
    });
    refs.historyAdvice.append(card);
  }
}

function renderTagStats(records) {
  if (!refs.historyTagStats) return;
  refs.historyTagStats.replaceChildren();
  const tags = summarizeTags(records).slice(0, 10);

  if (refs.historyTagMeta) {
    refs.historyTagMeta.textContent = tags.length
      ? '平均分越低越需要补 · 最多显示 10 个'
      : '讲过并标注知识点的课会出现在这里';
  }

  if (!tags.length) {
    refs.historyTagStats.append(
      el('p', 'tag-stats-empty', '还没有带知识点的记录。开课时选一个知识点，就能看到薄弱点。')
    );
    return;
  }

  for (const item of tags) {
    const subject = subjectInfo(item.subject);
    const row = el('div', 'tag-stat');
    const head = el('div', 'tag-stat-head');
    head.append(
      el('span', 'tag-stat-name', item.tag),
      el('span', 'tag-stat-subject', subject?.short || '未分科'),
      el('span', 'tag-stat-value', item.average == null ? '—' : `${item.average}%`)
    );
    const track = el('div', 'tag-stat-track');
    const fill = el('div', 'tag-stat-fill');
    fill.style.width = `${item.average == null ? 0 : item.average}%`;
    track.append(fill);
    row.append(head, track, el('small', 'tag-stat-count', `${item.sessions} 次练习`));
    refs.historyTagStats.append(row);
  }
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

function renderHistoryBulkBar(records) {
  if (!refs.historyBulkBar) return;
  refs.historyBulkBar.hidden = !historySelectMode;
  if (refs.historySelectBtn) {
    refs.historySelectBtn.textContent = historySelectMode ? '退出选择' : '批量选择';
    refs.historySelectBtn.setAttribute('aria-pressed', String(historySelectMode));
  }
  if (!historySelectMode) return;

  const visibleIds = new Set(records.map((record) => record.id));
  for (const id of [...historySelection]) {
    if (!visibleIds.has(id)) historySelection.delete(id);
  }
  const count = historySelection.size;
  if (refs.historyBulkCount) {
    refs.historyBulkCount.textContent = count ? `已选 ${count} 条` : '还没有选择记录';
  }
  if (refs.historyBulkDeleteBtn) refs.historyBulkDeleteBtn.disabled = count === 0;
  if (refs.historySelectAllBtn) {
    const allSelected = records.length > 0 && count === records.length;
    refs.historySelectAllBtn.textContent = allSelected ? '取消全选' : '全选本页';
    refs.historySelectAllBtn.disabled = records.length === 0;
  }
}

function setHistorySelectMode(on) {
  historySelectMode = Boolean(on);
  historySelection = new Set();
  if (historySelectMode) openHistoryIds = new Set();
  renderHistory();
}

function toggleHistorySelection(id) {
  if (!id) return;
  if (historySelection.has(id)) historySelection.delete(id);
  else historySelection.add(id);
  renderHistory();
}

function handleHistorySelectAll() {
  const visible = filterHistoryRecords(loadHistory());
  const allSelected = visible.length > 0 && visible.every((record) => historySelection.has(record.id));
  historySelection = allSelected ? new Set() : new Set(visible.map((record) => record.id));
  renderHistory();
}

function handleBulkDeleteHistory() {
  const ids = [...historySelection];
  if (!ids.length) {
    toast('先选择要删除的记录。', 'warm');
    return;
  }
  if (
    !window.confirm(
      `删除选中的 ${ids.length} 条学习记录？对应的诊断报告和对话回放也会一起删除，无法恢复。`
    )
  ) {
    return;
  }
  const removed = deleteRecords(ids);
  historySelection = new Set();
  for (const id of ids) openHistoryIds.delete(id);
  renderHistory();
  renderHistoryEntry();
  checkStoragePressure();
  toast(`已删除 ${removed} 条学习记录。`, 'success', 2600);
}

function renderHistoryList(records) {
  refs.historyList.replaceChildren();

  if (!records.length) {
    refs.historyList.append(
      el('p', 'history-list-empty', '当前筛选下还没有记录。换一个学科或来源试试。')
    );
    return;
  }

  for (const record of records) {
    const selected = historySelection.has(record.id);
    const item = el(
      'article',
      `history-item${openHistoryIds.has(record.id) ? ' is-open' : ''}${
        historySelectMode ? ' is-selectable' : ''
      }${selected ? ' is-selected' : ''}`
    );
    const row = el('div', 'history-item-row');
    const main = el('button', 'history-item-main');
    main.type = 'button';
    if (historySelectMode) {
      main.setAttribute('aria-pressed', String(selected));
    } else {
      main.setAttribute('aria-expanded', String(openHistoryIds.has(record.id)));
    }

    const date = el('span', 'history-item-date', formatArchiveDate(record.endedAt));
    const body = el('div', 'history-item-body');
    body.append(el('p', 'history-item-topic', record.topic));

    const subject = subjectInfo(record.subject);
    const difficulty = difficultyInfo(record.difficulty);
    const source = sourceInfo(record.source);
    const persona = personaInfo(record.studentPersona);
    const chips = el('div', 'history-item-chips');
    if (subject) chips.append(el('span', 'topic-chip topic-chip-subject', subject.label));
    if (difficulty) chips.append(el('span', 'topic-chip topic-chip-difficulty', difficulty.label));
    if (record.source) chips.append(el('span', 'topic-chip topic-chip-source', source.label));
    if (record.studentPersona) {
      const chip = el('span', 'topic-chip topic-chip-persona', persona.label);
      chip.title = `学生人设：${persona.label} · ${persona.prompt}`;
      chips.append(chip);
    }
    for (const tag of normalizeTags(record.tags)) {
      chips.append(el('span', 'topic-chip topic-chip-tag', tag));
    }
    if (chips.childElementCount) body.append(chips);

    const meta = [`${record.turns} 轮讲解`, `${record.questions} 个追问`];
    if (record.model) meta.push(record.model.split('/').pop());
    body.append(el('p', 'history-item-meta', meta.join(' · ')));

    const dimensionScores = el('div', 'history-item-dimensions');
    for (const metric of METRICS) {
      const value = Number(record.report?.scores?.[metric.key]);
      const item = el('span', `history-dimension${Number.isFinite(value) ? '' : ' is-empty'}`);
      item.append(
        el('small', '', metric.label),
        el('strong', '', Number.isFinite(value) ? `${value}%` : '—')
      );
      dimensionScores.append(item);
    }
    body.append(dimensionScores);

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
      if (historySelectMode) {
        toggleHistorySelection(record.id);
        return;
      }
      if (openHistoryIds.has(record.id)) openHistoryIds.delete(record.id);
      else openHistoryIds.add(record.id);
      renderHistoryList(filterHistoryRecords(loadHistory()));
    });

    row.append(main);
    if (historySelectMode) {
      const check = el('label', 'history-check');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected;
      box.setAttribute('aria-label', `选择「${record.topic}」`);
      box.addEventListener('change', () => toggleHistorySelection(record.id));
      check.append(box);
      row.prepend(check);
    }

    item.append(row);
    if (!historySelectMode && openHistoryIds.has(record.id)) item.append(buildHistoryDetail(record));
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

  const list = buildTranscriptList(messages);
  block.append(list);
  return block;
}

function buildTranscriptList(messages, { focusIndex = -1 } = {}) {
  const list = el('div', 'history-transcript-list');
  const names = { user: '你', assistant: '小问' };

  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    const row = el('div', `history-message history-message-${role}`);
    if (index === focusIndex) {
      row.classList.add('is-focus');
      row.setAttribute('data-focus', 'true');
    }
    const meta = el('div', 'history-message-meta');
    meta.append(el('span', 'history-message-name', names[role]));
    meta.append(el('span', 'history-message-index', String(index + 1)));
    row.append(meta);
    row.append(el('p', 'history-message-text', message.content || ''));
    list.append(row);
  });

  return list;
}

function openReplay(record, { focusIndex = -1 } = {}) {
  if (!record) return;
  replayReturnHistory = Boolean(activeModalId === 'historyModal');
  const stackOverReport = activeModalId === 'reportModal';
  refs.replayTitle.textContent = record.topic || '课堂回放';
  refs.replayMeta.textContent = formatRecordMeta(record);
  refs.replayList.replaceChildren();
  const messages = Array.isArray(record.messages) ? record.messages : [];
  let focusRow = null;
  if (messages.length) {
    const list = buildTranscriptList(messages, { focusIndex });
    refs.replayList.append(list);
    focusRow = list.querySelector('.history-message.is-focus');
    if (refs.replayNote) refs.replayNote.hidden = true;
  } else if (refs.replayNote) {
    refs.replayNote.hidden = false;
    refs.replayNote.textContent = '这节课的对话原文没有保存下来（可能是浏览器空间不足时被清理），但诊断报告仍然保留。';
  }
  openModal('replayModal', { stack: stackOverReport });
  if (focusRow) {
    const list = focusRow.parentElement;
    if (list && list.scrollHeight > list.clientHeight) {
      list.scrollTop = Math.max(
        0,
        focusRow.offsetTop - list.clientHeight / 2 + focusRow.offsetHeight / 2
      );
    }
    focusRow.classList.add('is-pulse');
  }
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
  const replay = el('button', 'btn btn-outline btn-sm', '回放这节课');
  replay.type = 'button';
  replay.addEventListener('click', () => openReplay(record));

  if (record.report) {
    const open = el('button', 'btn btn-primary btn-sm', '查看完整报告');
    open.type = 'button';
    open.addEventListener('click', () => {
      presentReport(record.report, {
        topic: record.topic,
        archived: true,
        meta: formatRecordMeta(record),
        record
      });
    });

    const copy = el('button', 'btn btn-outline btn-sm', '复制 Markdown');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const ok = await copyText(reportToText(record));
      toast(ok ? 'Markdown 报告已复制到剪贴板。' : '复制失败，请手动选择文字。', ok ? 'success' : 'error');
    });

    const del = el('button', 'btn btn-ghost btn-sm', '删除记录');
    del.type = 'button';
    del.addEventListener('click', () => handleDeleteRecord(record));
    actions.append(open, replay, copy, del);
  } else {
    const del = el('button', 'btn btn-ghost btn-sm', '删除记录');
    del.type = 'button';
    del.addEventListener('click', () => handleDeleteRecord(record));
    actions.append(replay, del);
  }

  detail.append(actions);
  return detail;
}

function handleDeleteRecord(record) {
  if (!window.confirm(`删除「${record.topic}」的学习记录？删除后无法恢复。`)) return;
  deleteRecord(record.id);
  openHistoryIds.delete(record.id);
  historySelection.delete(record.id);
  renderHistory();
  renderHistoryEntry();
  toast('记录已删除。', 'success', 2400);
}

function handleClearHistory() {
  if (!loadHistory().length) return;
  if (!window.confirm('清空全部学习档案？所有历史课时和诊断报告都会被删除，无法恢复。')) return;
  clearHistory();
  openHistoryIds = new Set();
  historySelectMode = false;
  historySelection = new Set();
  renderHistory();
  renderHistoryEntry();
  checkStoragePressure();
  toast('学习档案已清空。', 'success', 2600);
}

/* -------------------------------------------------------------------------- */
/* Custom question bank                                                       */
/* -------------------------------------------------------------------------- */

const BANK_COPY = {
  square: {
    title: '题库广场',
    intro: '按学科挑一道现成的数学题，直接开讲；也可以先存进自己的题库再改。',
    note: '广场题目来自内置精选题库，不占用你的题库空间。点「用这道题」即可载入首页。',
    placeholder: '搜索题干或知识点',
    panel: 'bankTabSquare'
  },
  mine: {
    title: '我的题库',
    intro: '手动录入、拍照识别和从广场保存的题目都存在本机，可以随时找回、修改或删除。',
    note: '题库和图片只保存在当前浏览器。建议定期导出 JSON 备份；清除浏览器数据会同时清除题库。',
    placeholder: '搜索题干、知识点或备注',
    panel: 'bankTabMine'
  }
};

async function handleSaveBank() {
  const topic = refs.topicInput.value.trim();
  if (!topic) {
    toast('先写题干，再存入题库。', 'warm');
    refs.topicInput.focus();
    return;
  }
  try {
    const wasEditing = Boolean(bankEditingId);
    const subject = store.practice.subject;
    if (!wasEditing) {
      bankCache = await listQuestions();
      if (bankCache.some((entry) => questionKey(entry) === questionKey({ topic, subject }))) {
        toast('这道题已经在我的题库里了，去「我的题库」可以编辑。', 'warm', 3600);
        return;
      }
    }
    const item = await saveQuestion({
      id: bankEditingId || undefined,
      topic,
      subject,
      difficulty: refs.difficultySelect?.value || store.practice.difficulty,
      tags: parseTags(refs.tagInput?.value),
      note: refs.noteInput?.value.trim() || '',
      image: topicImage || '',
      source: homeSource === 'ocr' ? 'ocr' : homeSource === 'builtin' ? 'builtin' : 'custom'
    });
    bankEditingId = wasEditing ? item.id : '';
    setHomeSource(item.source);
    bankCache = await listQuestions();
    toast(wasEditing ? '题目修改已保存。' : '题目已存入我的题库。', 'success');
  } catch (error) {
    toast(error.message || '保存失败，请再试一次。', 'error');
  }
}

function syncBankFilterInputs() {
  if (refs.bankSearch) refs.bankSearch.value = bankFilter.query;
  if (refs.bankSubjectFilter) refs.bankSubjectFilter.value = bankFilter.subject;
  if (refs.bankSourceFilter) refs.bankSourceFilter.value = bankFilter.source;
}

async function openBank(view = 'mine') {
  bankView = view === 'square' ? 'square' : 'mine';
  bankFilter = { ...bankFilter, query: '' };
  syncBankFilterInputs();
  try {
    bankCache = await listQuestions();
  } catch (error) {
    toast(error.message || '题库读取失败。', 'error');
    bankCache = [];
  }
  renderBank();
  openModal('bankModal');
  requestAnimationFrame(() => refs.bankSearch?.focus({ preventScroll: true }));
}

function switchBankView(view, { focus = false } = {}) {
  if (!BANK_COPY[view]) return;
  bankView = view;
  renderBank();
  if (focus) {
    (view === 'mine' ? refs.bankTabMine : refs.bankTabSquare)?.focus({ preventScroll: true });
  }
}

function handleBankTabKeydown(event) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  switchBankView(bankView === 'square' ? 'mine' : 'square', { focus: true });
}

function renderBankChrome() {
  const copy = BANK_COPY[bankView] || BANK_COPY.mine;
  const isMine = bankView === 'mine';
  if (refs.bankTitle) refs.bankTitle.textContent = copy.title;
  if (refs.bankIntro) refs.bankIntro.textContent = copy.intro;
  if (refs.bankNote) refs.bankNote.textContent = copy.note;
  if (refs.bankSearch) refs.bankSearch.placeholder = copy.placeholder;
  if (refs.bankSquareCount) refs.bankSquareCount.textContent = String(BUILTIN_QUESTIONS.length);
  if (refs.bankMineCount) refs.bankMineCount.textContent = String(bankCache.length);

  if (refs.bankTabSquare) {
    refs.bankTabSquare.classList.toggle('is-active', !isMine);
    refs.bankTabSquare.setAttribute('aria-selected', String(!isMine));
    refs.bankTabSquare.tabIndex = isMine ? -1 : 0;
  }
  if (refs.bankTabMine) {
    refs.bankTabMine.classList.toggle('is-active', isMine);
    refs.bankTabMine.setAttribute('aria-selected', String(isMine));
    refs.bankTabMine.tabIndex = isMine ? 0 : -1;
  }
  if (refs.bankSourceFilter) refs.bankSourceFilter.hidden = !isMine;
  if (refs.bankMineActions) refs.bankMineActions.hidden = !isMine;
  if (refs.bankList) refs.bankList.setAttribute('aria-labelledby', copy.panel);
}

function renderBank() {
  renderBankChrome();
  renderBankList();
}

function renderBankEmptyState(count) {
  if (!refs.bankEmpty) return;
  refs.bankEmpty.hidden = count > 0;
  if (count > 0) return;

  const hasFilter =
    Boolean(bankFilter.query.trim()) ||
    bankFilter.subject !== 'all' ||
    (bankView === 'mine' && bankFilter.source !== 'all');

  if (bankView === 'square') {
    if (refs.bankEmptyTitle) refs.bankEmptyTitle.textContent = '没有找到匹配的题';
    if (refs.bankEmptyText) refs.bankEmptyText.textContent = '换个关键词或学科，或者清空筛选看看全部题目。';
    if (refs.bankEmptyAction) refs.bankEmptyAction.textContent = '清空筛选';
  } else if (!bankCache.length) {
    if (refs.bankEmptyTitle) refs.bankEmptyTitle.textContent = '题库还是空的';
    if (refs.bankEmptyText) {
      refs.bankEmptyText.textContent = '在首页输入题目后点「存入我的题库」，也可以先去题库广场挑一道。';
    }
    if (refs.bankEmptyAction) refs.bankEmptyAction.textContent = '去题库广场挑一道';
  } else {
    if (refs.bankEmptyTitle) refs.bankEmptyTitle.textContent = '没有找到匹配的题';
    if (refs.bankEmptyText) refs.bankEmptyText.textContent = '换个关键词、学科或来源，或者清空筛选。';
    if (refs.bankEmptyAction) refs.bankEmptyAction.textContent = '清空筛选';
  }
  if (refs.bankEmptyAction) refs.bankEmptyAction.hidden = !hasFilter && bankView === 'square';
}

function renderBankList() {
  if (!refs.bankList) return;
  refs.bankList.replaceChildren();

  const base =
    bankView === 'square'
      ? BUILTIN_QUESTIONS.map((item) => ({ ...item, source: 'builtin' }))
      : bankCache;
  const query = bankFilter.query.trim().toLowerCase();
  const items = base.filter((item) => {
    if (bankFilter.subject !== 'all' && item.subject !== bankFilter.subject) return false;
    if (bankView === 'mine' && bankFilter.source !== 'all' && item.source !== bankFilter.source) {
      return false;
    }
    if (!query) return true;
    return `${item.topic} ${(item.tags || []).join(' ')} ${item.note || ''}`
      .toLowerCase()
      .includes(query);
  });

  renderBankEmptyState(items.length);

  const mineKeys = new Set(bankCache.map((item) => questionKey(item)));
  for (const item of items) {
    refs.bankList.append(buildBankItemCard(item, mineKeys));
  }
}

function buildBankItemCard(item, mineKeys) {
  const card = el('article', 'bank-item');
  if (bankView === 'mine' && bankEditingId === item.id) card.classList.add('is-editing');

  const head = el('div', 'bank-item-head');
  head.append(el('span', 'bank-item-subject', subjectInfo(item.subject)?.short || '未分科'));
  head.append(el('span', 'bank-item-difficulty', difficultyInfo(item.difficulty).label));
  head.append(el('span', 'bank-item-source', sourceInfo(item.source).label));

  if (item.image) {
    const thumb = document.createElement('img');
    thumb.className = 'bank-item-image';
    thumb.src = item.image;
    thumb.alt = '题目图片';
    thumb.loading = 'lazy';
    thumb.dataset.zoom = 'true';
    head.append(thumb);
  }

  const body = el('div', 'bank-item-body');
  body.append(el('p', 'bank-item-topic', item.topic));

  const chips = el('div', 'bank-item-tags');
  (item.tags || []).forEach((tag) => chips.append(el('span', 'topic-chip topic-chip-tag', tag)));
  if (chips.childElementCount) body.append(chips);
  if (item.note) body.append(el('p', 'bank-item-note', item.note));

  const actions = el('div', 'bank-item-actions');
  const use = el('button', 'btn btn-primary btn-sm', '用这道题');
  use.type = 'button';
  use.addEventListener('click', () => loadBankQuestion(item, false));
  actions.append(use);

  if (bankView === 'square') {
    const inBank = mineKeys.has(questionKey(item));
    const save = el(
      'button',
      `btn btn-outline btn-sm${inBank ? ' is-saved' : ''}`,
      inBank ? '已在我的题库' : '存入我的题库'
    );
    save.type = 'button';
    save.disabled = inBank;
    if (!inBank) save.addEventListener('click', () => saveBuiltinToBank(item));
    actions.append(save);
  } else {
    const edit = el('button', 'btn btn-outline btn-sm', '编辑');
    edit.type = 'button';
    edit.addEventListener('click', () => loadBankQuestion(item, true));

    const del = el('button', 'btn btn-ghost btn-sm', '删除');
    del.type = 'button';
    del.addEventListener('click', () => handleDeleteBankQuestion(item));

    actions.append(edit, del);
  }

  body.append(actions);
  card.append(head, body);
  return card;
}

async function saveBuiltinToBank(item) {
  if (bankCache.some((entry) => questionKey(entry) === questionKey(item))) {
    toast('这道题已经在我的题库里了。', 'warm', 2600);
    return;
  }
  try {
    await saveQuestion({
      topic: item.topic,
      subject: item.subject,
      difficulty: item.difficulty,
      tags: item.tags,
      note: item.note,
      image: '',
      source: 'builtin'
    });
    bankCache = await listQuestions();
    renderBank();
    toast('已存入我的题库，可以切到「我的题库」修改。', 'success', 3200);
  } catch (error) {
    toast(error.message || '保存失败，请再试一次。', 'error');
  }
}

function resetBankFilters() {
  bankFilter = { subject: 'all', source: 'all', query: '' };
  syncBankFilterInputs();
  renderBank();
}

function handleBankEmptyAction() {
  if (bankView === 'mine' && !bankCache.length) {
    switchBankView('square');
    return;
  }
  resetBankFilters();
}

async function handleBankImportFile(file) {
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    toast('备份文件超过 8 MB，请先拆分再导入。', 'error', 4200);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    toast('这个文件不是有效的 JSON 备份。', 'error', 4200);
    return;
  }

  try {
    const result = await importQuestions(payload);
    bankCache = await listQuestions();
    renderBank();
    if (result.added) {
      let message = `已导入 ${result.added} 道题`;
      if (result.skipped) message += `，跳过 ${result.skipped} 道重复题`;
      if (result.invalid) message += `，忽略 ${result.invalid} 道无效题`;
      if (result.limited) message += `；题库最多 ${result.max} 道，还有 ${result.limited} 道没导入`;
      toast(`${message}。`, result.limited ? 'warm' : 'success', 5200);
    } else if (result.skipped) {
      toast(`没有新增题目，${result.skipped} 道题已经在题库里了。`, 'warm', 4600);
    } else if (result.limited) {
      toast(`我的题库已满（${result.max} 道），先删除一些再导入。`, 'warm', 5200);
    } else {
      toast('这个备份里没有可导入的题目。', 'warm', 3600);
    }
  } catch (error) {
    toast(error.message || '导入失败，请检查文件格式。', 'error', 4800);
  }
}

function handleBankExport() {
  if (!bankCache.length) {
    toast('我的题库还是空的，先存几道题再导出。', 'warm');
    return;
  }
  try {
    const payload = buildQuestionsExport(bankCache);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date();
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(
      date.getDate()
    ).padStart(2, '0')}`;
    const link = document.createElement('a');
    link.href = url;
    link.download = `feynman-question-bank-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast(`已导出 ${payload.count} 道题，文件只保存在你的设备上。`, 'success', 4600);
  } catch {
    toast('导出失败，可能是浏览器限制了下载。', 'error', 4200);
  }
}

function loadBankQuestion(item, editing) {
  bankEditingId = editing ? item.id : '';
  store.updatePractice({ subject: item.subject, difficulty: item.difficulty });
  refs.topicInput.value = item.topic;
  if (refs.tagInput) refs.tagInput.value = (item.tags || []).join('、');
  if (refs.noteInput) refs.noteInput.value = item.note || '';
  if (item.image) {
    topicImage = item.image;
    refs.topicImageThumb.src = item.image;
    refs.topicImagePreview.hidden = false;
    refs.topicImageHint.textContent = '来自我的题库的题目图片';
  } else {
    topicImage = null;
    refs.topicImageThumb.removeAttribute('src');
    refs.topicImagePreview.hidden = true;
    refs.topicImageHint.textContent = TOPIC_IMAGE_HINT;
  }
  setHomeSource(item.source);
  autoGrowTopic();
  closeModal('bankModal');
  showScreen('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  renderBank();
  setTimeout(() => refs.topicInput.focus(), 220);
  toast(
    editing
      ? '题目已放回首页，修改后点「存入我的题库」保存。'
      : '题目已载入，检查后可开始讲课。',
    'success'
  );
}

async function handleDeleteBankQuestion(item) {
  if (!window.confirm(`从题库删除「${item.topic}」？删除后无法恢复。`)) return;
  try {
    await deleteQuestion(item.id);
    if (bankEditingId === item.id) bankEditingId = '';
    bankCache = await listQuestions();
    renderBank();
    toast('题目已从题库删除。', 'success', 2400);
  } catch (error) {
    toast(error.message || '删除失败，请再试一次。', 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Modals & focus                                                             */
/* -------------------------------------------------------------------------- */

function openModal(id, { stack = false } = {}) {
  const layer = document.getElementById(id);
  if (!layer) return;
  if (activeModalId === id) {
    layer.hidden = false;
    return;
  }
  if (activeModalId && activeModalId !== id) {
    if (stack) {
      modalStack.push({
        id: activeModalId,
        focus: document.activeElement,
        lastFocused
      });
    } else {
      modalStack = [];
      closeModal(activeModalId);
    }
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

  const returnToHistory = id === 'replayModal' && replayReturnHistory;
  if (returnToHistory) replayReturnHistory = false;

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
  if (id === 'onboardingModal') {
    markOnboardingSeen();
    onboardingStacked = false;
    setTimeout(() => maybeWelcome(), 600);
  }

  layer.hidden = true;
  if (activeModalId === id) {
    const previous = modalStack.pop();
    if (previous) {
      activeModalId = previous.id;
      lastFocused = previous.lastFocused || previous.focus || null;
      document.body.style.overflow = 'hidden';
      const previousLayer = document.getElementById(previous.id);
      const previousModal = previousLayer?.querySelector('.modal');
      requestAnimationFrame(() => {
        if (previous.focus && previous.focus.isConnected && previous.focus.offsetParent !== null) {
          previous.focus.focus({ preventScroll: true });
        } else {
          previousModal?.focus({ preventScroll: true });
        }
      });
    } else {
      activeModalId = null;
      document.body.style.overflow = '';
      lastFocused?.focus?.({ preventScroll: true });
    }
  }
  if (returnToHistory) {
    renderHistory();
    openModal('historyModal');
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

function handleAbandonSession() {
  if (!store.session) return;
  if (
    !window.confirm(
      '放弃本次课堂？\n本次对话会被清空，不会存入学习档案。此操作无法恢复。'
    )
  ) {
    return;
  }
  studentAbort?.abort();
  teacherAbort?.abort();
  if (activeModalId) closeModal(activeModalId);
  // 清掉可能由旧版“关闭页面自动归档”留下的未诊断记录。
  const abandonedId = store.session.id;
  const stale = loadHistory().find((record) => record.id === abandonedId && !record.report);
  if (stale) deleteRecord(stale.id);
  store.end();
  resetAfterSession();
  renderHistoryEntry();
  toast('本次课堂已放弃，没有存入学习档案。', 'warm');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function handleEndSession() {
  if (!store.session || endingSession) return;
  const tutor = isTutorSession();
  const confirmText = tutor
    ? '结束这次辅导？本次对话不会存入学习档案。'
    : '结束本次讲课？本次对话会存入学习档案，API Key 会保留。';
  if (!window.confirm(confirmText)) return;

  endingSession = true;
  if (refs.endSessionBtn) refs.endSessionBtn.disabled = true;
  try {
    // Stop any in-flight generation first.
    studentAbort?.abort();
    teacherAbort?.abort();

    let farewell = '';
    if (!tutor && humanTurnCount(store.session) > 0 && isConfigured(store.settings)) {
      // 小问 says goodbye only in AI 学生 mode; tutoring sessions just close.
      showTyping(true);
      farewell = await generateFarewell();
      showTyping(false);
    }
    if (farewell) {
      const msg = store.addMessage('assistant', farewell, []);
      if (msg) appendMessageElement(msg);
    }

    if (!tutor) archiveCurrentLesson();
    if (activeModalId) closeModal(activeModalId);
    store.end();
    resetAfterSession();
    renderHistoryEntry();
    toast(
      tutor
        ? '这次辅导结束了，没有存入学习档案。'
        : farewell
          ? '小问跟你告别了，本次讲课已存入学习档案。'
          : '本次讲课已结束，已存入学习档案。',
      'success',
      4000
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    showTyping(false);
    endingSession = false;
    if (refs.endSessionBtn) refs.endSessionBtn.disabled = false;
  }
}

function handleUndoTurn() {
  if (!store.session) return;
  if (store.busy) {
    toast(`${aiDisplayName(store.session?.aiMode)}还在回复，等它说完再回退这一轮。`, 'warm');
    return;
  }
  const removed = store.undoLastTurn();
  if (!removed?.length) {
    toast(`还没有可以回退的${isTutorSession() ? '回答' : '讲解'}。`, 'warm');
    return;
  }
  const userMessage = removed.find((message) => message.role === 'user');
  if (userMessage) {
    refs.messageInput.value = userMessage.content || '';
    pendingImages = Array.isArray(userMessage.images)
      ? userMessage.images.slice(0, APP.limits.maxImages)
      : [];
    renderPendingImages();
    autoGrowMessage();
    refs.messageInput.focus();
  }
  renderSession();
  toast('已回退上一轮，讲解放回输入框，可以修改后重新发送。', 'success', 4600);
}

function handleMarkStuck() {
  if (!store.session) return;
  if (!visibleMessages().length) {
    toast('先讲一段，再标记卡点。', 'warm');
    return;
  }
  const last = visibleMessages().slice(-1)[0];
  const point = store.addStuckPoint(last?.id || '');
  if (!point) return;
  const count = store.session.stuckPoints.length;
  appendStuckMarker(point, count);
  syncChrome();
  scrollToBottom(true);
  toast(`已标记卡点 ${count}，AI 老师写报告时会重点看这里。`, 'success', 4200);
}

function handleEndAndReport() {
  if (!store.session || isTutorSession()) return;
  if (store.busy || store.state.status === STATUS.EVALUATING) return;
  if (humanTurnCount(store.session) < 1) {
    toast('先向小问讲一段，再生成诊断报告。', 'warm');
    refs.messageInput.focus();
    return;
  }
  if (
    !window.confirm(
      '结束本次课堂并生成诊断报告？生成后本次对话会存入学习档案，你可以在报告里针对缺口重新开课。'
    )
  ) {
    return;
  }
  handleCallTeacher();
}

function handleRestartGap(gap) {
  const title = String(gap?.title || '这个缺口').trim();
  const sourceSession = store.session;
  const record = currentReportRecord;
  const liveSession = Boolean(sourceSession) && !reportFromArchive;

  if (reportFromArchive && sourceSession) {
    toast('当前还有一节未结束的课，请先结束或放弃它，再从档案里重新开课。', 'warm', 5200);
    return;
  }

  const prompt = liveSession
    ? `结束当前课堂，并针对「${title}」重新开课？\n当前对话会先存入学习档案。`
    : `针对「${title}」重新开课？`;
  if (!window.confirm(prompt)) {
    return;
  }

  const baseTopic = currentReportTopic || record?.topic || sourceSession?.topic || '';
  const subject = record?.subject || sourceSession?.subject || store.practice.subject;
  const difficulty = record?.difficulty || sourceSession?.difficulty || store.practice.difficulty;
  const tags = record?.tags || sourceSession?.tags || [];
  const nextTopic = `补讲「${title}」：${baseTopic}`.slice(0, APP.limits.maxTopicChars);

  if (liveSession) {
    archiveCurrentLesson();
    studentAbort?.abort();
    teacherAbort?.abort();
    closeModal('reportModal');
    if (activeModalId) closeModal(activeModalId);
    store.end();
    resetAfterSession();
  } else {
    closeModal('reportModal');
    if (activeModalId) closeModal(activeModalId);
    currentReportRecord = null;
    resetAfterSession();
  }

  store.updatePractice({ subject, difficulty });
  refs.topicInput.value = nextTopic;
  if (refs.tagInput) refs.tagInput.value = (tags || []).join('、');
  if (refs.noteInput) {
    refs.noteInput.value = baseTopic ? `针对缺口重新开课。原课题：${baseTopic}` : '针对缺口重新开课';
  }
  autoGrowTopic();
  setHomeSource('custom');
  renderPracticeUI();
  renderHistoryEntry();
  showScreen('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast('新课题已准备好，确认后点「开始讲课」。', 'success', 3000);
  setTimeout(() => refs.topicInput.focus(), 250);
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
  currentReportMeta = '';
  currentReportRecord = null;
  reportFromArchive = false;
  startAfterSettings = false;
  bankEditingId = '';
  refs.messageInput.value = '';
  refs.topicInput.value = '';
  if (refs.tagInput) refs.tagInput.value = '';
  if (refs.noteInput) refs.noteInput.value = '';
  clearTopicImage();
  setHomeSource('custom');
  renderPendingImages();
  autoGrowMessage();
  showTyping(false);
  refs.typingIndicator.hidden = true;
  refs.micBtn.classList.remove('is-listening');
  refs.micLabel.textContent = '语音';
  showScreen('home');
  renderPracticeUI();
  syncChrome();
}

function toast(message, type = 'info', duration = 3000) {
  if (!message) return;
  const node = el('div', `toast${type === 'error' ? ' is-error' : type === 'warm' ? ' is-warm' : ''}`);
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.append(el('span', 'toast-text', message));

  let timer = null;
  const dismiss = () => {
    if (!node.isConnected) return;
    if (timer) clearTimeout(timer);
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => node.remove(), 240);
  };

  const close = el('button', 'toast-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭提示');
  close.addEventListener('click', dismiss);
  node.append(close);

  refs.toastStack.append(node);
  const ttl = Math.min(Math.max(Number(duration) || 3000, 1200), 3000);
  timer = setTimeout(dismiss, ttl);
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

  refs.helpBtn?.addEventListener('click', openHelp);
  refs.helpSearch?.addEventListener('input', () => applyHelpFilter(refs.helpSearch.value));
  refs.helpReplayOnboarding?.addEventListener('click', () => openOnboarding({ stack: true }));
  refs.helpOpenSettings?.addEventListener('click', () => {
    fillSettingsForm();
    openModal('settingsModal');
  });
  refs.helpOpenHistory?.addEventListener('click', openHistory);

  refs.storageBannerExport?.addEventListener('click', handleExportData);
  refs.storageBannerManage?.addEventListener('click', openStorageSettings);
  refs.storageBannerClose?.addEventListener('click', dismissStorageBanner);
  window.addEventListener('feynman:storage-warning', handleStorageWarningEvent);

  refs.replayOnboardingBtn?.addEventListener('click', () => {
    openOnboarding({ stack: true });
  });
  refs.onboardingPrevBtn?.addEventListener('click', () => handleOnboardingStep(-1));
  refs.onboardingNextBtn?.addEventListener('click', () => {
    const total = refs.onboardingSteps?.querySelectorAll('.onboarding-step').length || 4;
    if (onboardingStep >= total - 1) {
      finishOnboarding();
      return;
    }
    handleOnboardingStep(1);
  });
  refs.onboardingSkipBtn?.addEventListener('click', () => closeModal('onboardingModal'));

  refs.historyBtn?.addEventListener('click', openHistory);
  refs.homeHistoryBtn?.addEventListener('click', openHistory);
  refs.topicToggleBtn?.addEventListener('click', toggleTopicCard);
  refs.clearHistoryBtn?.addEventListener('click', handleClearHistory);

  refs.endSessionBtn.addEventListener('click', handleEndSession);
  refs.abandonSessionBtn?.addEventListener('click', handleAbandonSession);
  refs.undoTurnBtn?.addEventListener('click', handleUndoTurn);
  refs.markStuckBtn?.addEventListener('click', handleMarkStuck);
  refs.endAndReportBtn?.addEventListener('click', handleEndAndReport);
  refs.exerciseBtn?.addEventListener('click', handleExercise);
  refs.retryExerciseBtn?.addEventListener('click', handleExercise);
  refs.startBtn.addEventListener('click', handleStart);
  refs.topicInput.addEventListener('input', autoGrowTopic);
  refs.topicInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      handleStart();
    }
  });

  refs.difficultySelect?.addEventListener('change', () => {
    store.updatePractice({ difficulty: refs.difficultySelect.value });
  });
  refs.tagInput?.addEventListener('change', () => {
    refs.tagInput.value = parseTags(refs.tagInput.value).join('、');
    syncQuickTagState();
  });
  refs.tagInput?.addEventListener('input', syncQuickTagState);

  refs.topicImageBtn.addEventListener('click', () => refs.topicImageInput.click());
  refs.topicImageInput.addEventListener('change', () => {
    handleTopicImage(refs.topicImageInput.files?.[0]);
    refs.topicImageInput.value = '';
  });
  refs.topicCameraBtn?.addEventListener('click', () => refs.topicCameraInput?.click());
  refs.topicCameraInput?.addEventListener('change', () => {
    handleTopicImage(refs.topicCameraInput.files?.[0]);
    refs.topicCameraInput.value = '';
  });
  refs.recognizeBtn?.addEventListener('click', recognizeTopicImage);
  refs.removeTopicImage.addEventListener('click', clearTopicImage);

  document.addEventListener('paste', handleHomePaste);
  refs.homeCard?.addEventListener('dragover', handleHomeDragOver);
  refs.homeCard?.addEventListener('dragleave', handleHomeDragLeave);
  refs.homeCard?.addEventListener('drop', handleHomeDrop);

  refs.saveBankBtn?.addEventListener('click', handleSaveBank);
  refs.openBankBtn?.addEventListener('click', () => openBank('mine'));
  refs.openBankSquareBtn?.addEventListener('click', () => openBank('square'));
  refs.bankTabSquare?.addEventListener('click', () => switchBankView('square'));
  refs.bankTabMine?.addEventListener('click', () => switchBankView('mine'));
  refs.bankTabSquare?.addEventListener('keydown', handleBankTabKeydown);
  refs.bankTabMine?.addEventListener('keydown', handleBankTabKeydown);
  refs.bankSearch?.addEventListener('input', () => {
    bankFilter.query = refs.bankSearch.value;
    renderBank();
  });
  refs.bankSubjectFilter?.addEventListener('change', () => {
    bankFilter.subject = refs.bankSubjectFilter.value;
    renderBank();
  });
  refs.bankSourceFilter?.addEventListener('change', () => {
    bankFilter.source = refs.bankSourceFilter.value;
    renderBank();
  });
  refs.bankEmptyAction?.addEventListener('click', handleBankEmptyAction);
  refs.bankImportBtn?.addEventListener('click', () => refs.bankImportInput?.click());
  refs.bankImportInput?.addEventListener('change', async () => {
    const file = refs.bankImportInput.files?.[0];
    refs.bankImportInput.value = '';
    if (file) await handleBankImportFile(file);
  });
  refs.bankExportBtn?.addEventListener('click', handleBankExport);
  refs.bankList?.addEventListener('click', (event) => {
    const image = event.target.closest('img[data-zoom]');
    if (image) openLightbox(image.src);
  });

  refs.composer.addEventListener('submit', handleSend);
  refs.messageInput.addEventListener('input', autoGrowMessage);
  refs.messageInput.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      handleSend(event);
    }
  });

  refs.draftInput?.addEventListener('input', () => {
    draftState.text = refs.draftInput.value.slice(0, APP.limits.maxMessageChars);
    queueDraftSave();
    if (draftState.mode === 'preview') renderDraftPreview();
  });
  refs.draftToggleBtn?.addEventListener('click', () => {
    draftState.open = !draftState.open;
    applyDraftUI();
    queueDraftSave();
  });
  refs.draftMobileBtn?.addEventListener('click', () => {
    setDraftDrawer(!draftDrawerOpen);
  });
  refs.draftScrim?.addEventListener('click', () => setDraftDrawer(false));
  window.addEventListener('pagehide', saveDraft);
  refs.draftEditTab?.addEventListener('click', () => {
    draftState.mode = 'edit';
    applyDraftUI();
    queueDraftSave();
    refs.draftInput?.focus({ preventScroll: true });
  });
  refs.draftPreviewTab?.addEventListener('click', () => {
    draftState.text = refs.draftInput?.value || '';
    draftState.mode = 'preview';
    applyDraftUI();
    queueDraftSave();
  });
  for (const tab of [refs.draftEditTab, refs.draftPreviewTab]) {
    tab?.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const next = draftState.mode === 'preview' ? refs.draftEditTab : refs.draftPreviewTab;
      next?.click();
      next?.focus({ preventScroll: true });
    });
  }

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
  refs.themeSwitch?.addEventListener('click', (event) => {
    const button = event.target.closest('.theme-option');
    if (!button) return;
    handleThemeSelect(button.dataset.theme);
  });
  refs.themeSwitch?.addEventListener('keydown', handleThemeKeydown);
  refs.exportDataBtn?.addEventListener('click', handleExportData);
  refs.clearArchiveDataBtn?.addEventListener('click', handleClearArchiveData);
  refs.studentPersonaSelect?.addEventListener('change', () => {
    store.updatePractice({ persona: refs.studentPersonaSelect.value });
    if (store.session) store.updateSessionMeta({ studentPersona: refs.studentPersonaSelect.value });
    renderPracticeUI();
  });
  refs.studentModeSelect?.addEventListener('change', () => {
    store.updatePractice({ mode: refs.studentModeSelect.value });
    if (store.session) store.updateSessionMeta({ studentMode: refs.studentModeSelect.value });
    renderPracticeUI();
  });
  refs.studentIntensitySelect?.addEventListener('change', () => {
    store.updatePractice({ intensity: refs.studentIntensitySelect.value });
    if (store.session) {
      store.updateSessionMeta({ studentIntensity: refs.studentIntensitySelect.value });
    }
    renderPracticeUI();
  });
  refs.lockSubjectToggle?.addEventListener('change', () => {
    store.updatePractice({ lockSubject: refs.lockSubjectToggle.checked });
    renderPracticeUI();
  });

  refs.chatSubjectSelect?.addEventListener('change', () => {
    if (store.practice.lockSubject) {
      refs.chatSubjectSelect.value = store.session?.subject || store.practice.subject;
      toast('学科已锁定；到设置里关闭锁定后才能换。', 'warm');
      return;
    }
    store.updateSessionMeta({ subject: refs.chatSubjectSelect.value });
    store.updatePractice({ subject: refs.chatSubjectSelect.value });
    toast('已切换学科，接下来会按新学科追问和评分。', 'success', 3200);
  });
  refs.chatPersonaSelect?.addEventListener('change', () => {
    store.updateSessionMeta({ studentPersona: refs.chatPersonaSelect.value });
    store.updatePractice({ persona: refs.chatPersonaSelect.value });
  });
  refs.chatIntensitySelect?.addEventListener('change', () => {
    store.updateSessionMeta({ studentIntensity: refs.chatIntensitySelect.value });
    store.updatePractice({ intensity: refs.chatIntensitySelect.value });
  });
  refs.chatModeSelect?.addEventListener('change', () => {
    store.updateSessionMeta({ studentMode: refs.chatModeSelect.value });
    store.updatePractice({ mode: refs.chatModeSelect.value });
  });

  refs.historySubjectFilter?.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-tab');
    if (!button) return;
    historyFilter.subject = button.dataset.subject || 'all';
    openHistoryIds = new Set();
    historySelection = new Set();
    renderHistory();
  });
  refs.historyRangeFilter?.addEventListener('click', (event) => {
    const button = event.target.closest('.filter-tab');
    if (!button) return;
    const range = button.dataset.range;
    if (!(range in HISTORY_RANGE_DAYS)) return;
    historyFilter.range = range;
    openHistoryIds = new Set();
    historySelection = new Set();
    renderHistory();
  });
  refs.historySourceFilter?.addEventListener('change', () => {
    historyFilter.source = refs.historySourceFilter.value;
    openHistoryIds = new Set();
    historySelection = new Set();
    renderHistory();
  });
  refs.historySelectBtn?.addEventListener('click', () => setHistorySelectMode(!historySelectMode));
  refs.historyBulkCancelBtn?.addEventListener('click', () => setHistorySelectMode(false));
  refs.historySelectAllBtn?.addEventListener('click', handleHistorySelectAll);
  refs.historyBulkDeleteBtn?.addEventListener('click', handleBulkDeleteHistory);

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
      } else if (draftDrawerOpen) {
        setDraftDrawer(false);
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

  window.addEventListener('resize', () => {
    updateTopicToggle();
    if (draftDrawerOpen && window.innerWidth > 980) setDraftDrawer(false);
  });
}
