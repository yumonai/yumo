/* ══════════════════════════════════════════════
   voice.js —— 声音的两个方向
     · 听你说（SpeechRecognition）
     · 说给你听（SpeechSynthesis）
   ══════════════════════════════════════════════ */

/* ── 听 ── */
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

/* ── 说 ── */
export class Speaker {
  constructor() {
    this.supported = typeof speechSynthesis !== 'undefined';
    this.voices = [];
    this.rate = 1.0;
    this.voice = null;
    this._ready = false;
  }

  load() {
    if (!this.supported) return;
    const pick = () => {
      const all = speechSynthesis.getVoices() || [];
      if (!all.length) return;
      this.voices = all;
      // 优先中文的女声/柔和音色
      const zh = all.filter((v) => /zh|Chinese|中文/i.test(v.lang + v.name));
      const pref = zh.find((v) => /Tingting|Ting-Ting|婷婷|Meijia|Sinji|Yaoyao|Huihui|晓晓|Xiaoxiao|Yunxi|云希|Female|女/i.test(v.name))
        || zh[0] || all[0];
      this.voice = pref || null;
      this._ready = true;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  get availableVoices() { return this.voices; }

  setVoice(name) {
    if (!name) { this.voice = null; return; }
    const v = this.voices.find((x) => x.name === name);
    if (v) this.voice = v;
  }

  /** 朗读。返回一个可取消的句柄 */
  speak(text, { rate } = {}) {
    if (!this.supported || !text) return null;
    this.cancel();
    const u = new SpeechSynthesisUtterance(stripMarkdown(text));
    u.lang = 'zh-CN';
    u.rate = rate ?? this.rate;
    u.pitch = 0.96;      // 略低，更沉静
    u.volume = 0.92;
    if (this.voice) u.voice = this.voice;
    u.onend = () => { this.speaking = false; };
    u.onerror = () => { this.speaking = false; };
    this.speaking = true;
    speechSynthesis.speak(u);
    return u;
  }

  pause() { if (this.supported && this.speaking) { speechSynthesis.pause(); } }
  resume() { if (this.supported) { speechSynthesis.resume(); } }
  cancel() { if (this.supported) { try { speechSynthesis.cancel(); } catch { /* noop */ } this.speaking = false; } }
}

/** 去掉让朗读变别扭的记号 */
export function stripMarkdown(s) {
  return String(s)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/[*_~`#>]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\n{2,}/g, '。\n')
    .replace(/\n/g, '，')
    .trim();
}
