/* ══════════════════════════════════════════════
   voice.js —— 听你说（SpeechRecognition）

   Yumo 不用合成的嗓子说话。它只在这里听。
   它回给你的，是文字——安静地落在水面上。
   ══════════════════════════════════════════════ */

export class Listener {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    this.SR = SR;
    this.rec = null;
    this.active = false;
    this.finalText = '';
    this.onPartial = null;
    this.onFinal = null;
    this.onEnd = null;
    this.onError = null;
  }

  start() {
    if (!this.supported || this.active) return false;
    const rec = new this.SR();
    rec.lang = 'zh-CN';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let final = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.finalText = final;
      this.onPartial?.(final + interim);
    };
    rec.onerror = (e) => {
      // no-speech / aborted 属于正常收尾
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.onError?.(e.error);
    };
    rec.onend = () => {
      this.active = false;
      const text = (this.finalText || '').trim();
      this.onFinal?.(text);
      this.onEnd?.();
    };

    try {
      rec.start();
      this.rec = rec;
      this.active = true;
      this.finalText = '';
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.rec && this.active) {
      try { this.rec.stop(); } catch { /* noop */ }
    }
  }

  abort() {
    if (this.rec) {
      try { this.rec.abort(); } catch { /* noop */ }
    }
    this.active = false;
  }
}
