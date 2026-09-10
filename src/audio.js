// Motor de audio: pitidos del monitor (QRS / pulso SpO2), tonos de
// alarma y aviso de carga/descarga del DESA, y voz del DESA vía Web Speech
// API. La voz es siempre un refuerzo: el texto en pantalla (desaVoiceText)
// es la única fuente de verdad de la instrucción — ver README.

export class AudioEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this._voice = null;
    this._voicesReady = false;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        this._voice =
          voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('es')) || voices[0] || null;
        this._voicesReady = true;
      };
      pick();
      window.speechSynthesis.onvoiceschanged = pick;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    return this.ctx;
  }

  /** Debe llamarse tras un gesto del usuario (clic) para desbloquear audio en iOS/Safari. */
  unlock() {
    const ctx = this._ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  _tone({ freq, duration, type = 'sine', gain = 0.08, startGain, endFreq }) {
    if (!this.enabled) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (endFreq) {
      osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + duration);
    }
    amp.gain.setValueAtTime(0, ctx.currentTime);
    amp.gain.linearRampToValueAtTime(startGain ?? gain, ctx.currentTime + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(amp).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /** Pitido de QRS (síncrono con el complejo QRS del trazado ECG). */
  beepQRS() {
    this._tone({ freq: 880, duration: 0.09, type: 'sine', gain: 0.07 });
  }

  /** Tono de pulso/SpO2 — el tono varía sutilmente con la saturación. */
  beepPulse(spo2) {
    const clamped = spo2 == null ? 85 : Math.max(70, Math.min(100, spo2));
    const freq = 420 + (clamped - 70) * 6; // ~600-600? mapeado suave
    this._tone({ freq, duration: 0.07, type: 'sine', gain: 0.045 });
  }

  /** Aviso corto de alarma (bradicardia/taquicardia extrema, hipoxia...). */
  alarmBeep(critical = false) {
    this._tone({
      freq: critical ? 1100 : 740,
      duration: critical ? 0.16 : 0.11,
      type: 'square',
      gain: critical ? 0.06 : 0.04,
    });
  }

  /** Barrido ascendente mientras el DESA "carga". */
  chargeSweep(durationSec) {
    this._tone({ freq: 220, endFreq: 900, duration: durationSec, type: 'sawtooth', gain: 0.05 });
  }

  /** Golpe grave de descarga administrada. */
  shockThump() {
    this._tone({ freq: 90, endFreq: 40, duration: 0.35, type: 'square', gain: 0.16 });
  }

  /**
   * Metrónomo de compresiones torácicas (100-120/min según ERC/AHA).
   * `onTick(count, isVentilationCue)` se dispara en cada clic para que la
   * UI sincronice el pulso visual; cada 30ª compresión marca el cambio a
   * 2 ventilaciones (ciclo 30:2) con un tono distinto.
   */
  startMetronome(bpm = 110, onTick) {
    this.stopMetronome();
    const intervalMs = 60000 / bpm;
    let count = 0;
    this._metronomeId = setInterval(() => {
      count += 1;
      const isVentilationCue = count % 30 === 0;
      this._tone({
        freq: isVentilationCue ? 1500 : 1000,
        duration: isVentilationCue ? 0.13 : 0.04,
        type: 'square',
        gain: isVentilationCue ? 0.09 : 0.05,
      });
      if (onTick) onTick(count, isVentilationCue);
    }, intervalMs);
  }

  stopMetronome() {
    if (this._metronomeId) {
      clearInterval(this._metronomeId);
      this._metronomeId = null;
    }
  }

  get metronomeRunning() {
    return this._metronomeId != null;
  }

  /**
   * Voz del DESA. Devuelve una Promise que se resuelve cuando termina de
   * hablar (o inmediatamente si Web Speech API no está disponible / está
   * desactivado el sonido) — nunca bloquea el flujo de la app.
   */
  speak(text) {
    return new Promise((resolve) => {
      if (!this.enabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'es-ES';
        utter.rate = 0.98;
        utter.pitch = 1.0;
        if (this._voice) utter.voice = this._voice;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
        // Salvaguarda: si el navegador nunca dispara onend (ocurre en
        // algunos Android/Safari), no dejamos el flujo colgado.
        setTimeout(resolve, Math.max(2500, text.length * 90));
      } catch {
        resolve();
      }
    });
  }
}
