/**
 * Thin wrapper around the Web Speech API.
 * Works in Chrome/Edge and Safari (webkit-prefixed). Requires HTTPS or localhost.
 */
export class SpeechInput {
  constructor({ lang = 'zh-CN', onFinal, onInterim, onStateChange, onError } = {}) {
    this.lang = lang;
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.recognition = null;
    this.listening = false;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(Recognition);
    this.Recognition = Recognition;
  }

  ensureRecognition() {
    if (!this.supported) return null;
    if (this.recognition) return this.recognition;

    const recognition = new this.Recognition();
    recognition.lang = this.lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.listening = true;
      this.onStateChange(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript || '';
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (final) this.onFinal(final.trim());
      if (interim) this.onInterim(interim.trim());
    };

    recognition.onerror = (event) => {
      const messages = {
        'not-allowed': '麦克风权限被拒绝。请在浏览器地址栏允许麦克风后再试。',
        'service-not-allowed': '当前浏览器不允许语音识别，请换用 Chrome 或 Edge。',
        'no-speech': '没有听到声音，请靠近麦克风再试一次。',
        'audio-capture': '找不到麦克风，请检查设备连接。',
        'network': '语音识别需要联网，请检查网络。',
        'aborted': ''
      };
      const message = messages[event.error] ?? `语音识别出错：${event.error}`;
      if (message) this.onError(message);
    };

    recognition.onend = () => {
      this.listening = false;
      this.onStateChange(false);
    };

    this.recognition = recognition;
    return recognition;
  }

  start() {
    if (!this.supported) {
      this.onError('当前浏览器不支持语音输入，建议使用 Chrome / Edge / Safari。');
      return false;
    }
    if (!window.isSecureContext) {
      this.onError('语音输入需要 HTTPS 或 localhost 环境。');
      return false;
    }
    if (this.listening) return true;
    try {
      this.ensureRecognition().start();
      return true;
    } catch {
      this.onError('语音识别没有成功启动，请再点一次。');
      return false;
    }
  }

  stop() {
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      /* Ignore. */
    }
  }

  toggle() {
    if (this.listening) {
      this.stop();
      return false;
    }
    return this.start();
  }
}
