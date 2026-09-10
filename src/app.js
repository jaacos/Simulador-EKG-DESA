import { RHYTHMS, RHYTHM_ORDER, RhythmEngine } from './rhythms.js';
import { AudioEngine } from './audio.js';

const SWEEP_SECONDS = 6; // ventana de trazado visible, a 25 mm/s (etiqueta ya fija en el HTML)
const MM_PER_SECOND = 25;
const CPR_CYCLE_SECONDS = 24; // "2 minutos de RCP" comprimidos para ritmo de aula; ver btnSkipWait
const ANALYSIS_DWELL_MS = 2800;

const CLINICAL_SCENARIOS = {
  parada_fv: {
    rhythmId: 'vfib_coarse',
    hr: 0,
    noise: 15,
    label: 'Caso: Parada en FV',
    context: 'Colapso súbito presenciado en gimnasio. Inconsciente, no respira con normalidad. DESA urgente.',
  },
  bradi_bloqueo: {
    rhythmId: 'avblock3',
    hr: 32,
    noise: 8,
    label: 'Caso: Bradicardia Severa',
    context: 'Mareo extremo y síncope. Consciente pero muy sintomático. Bloqueo AV completo, 32 lpm.',
  },
  taqui_inestable: {
    rhythmId: 'vt_pulse',
    hr: 178,
    noise: 5,
    label: 'Caso: Taquicardia Inestable',
    context: 'Palpitaciones intensas de inicio brusco. Paciente consciente, con pulso. No es parada cardiorrespiratoria.',
  },
  asistolia_rcp: {
    rhythmId: 'asystole',
    hr: 0,
    noise: 10,
    label: 'Caso: Asistolia',
    context: 'RCP en curso desde hace 4 minutos. Línea isoeléctrica confirmada en dos derivaciones.',
  },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad2 = (n) => String(Math.floor(n)).padStart(2, '0');
const shuffle = (arr, rnd = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class App {
  constructor() {
    this.audio = new AudioEngine();
    this.mode = 'teacher';
    this.rhythmId = 'sinus_normal';
    this.engine = new RhythmEngine(this.rhythmId);
    this.hr = RHYTHMS[this.rhythmId].defaultHR;
    this.noiseLevel = 5;
    this.respRate = 16;

    this.desaState = 'idle';
    this.cprSecondsLeft = 0;
    this.scenarioLabel = 'Caso Activo #1';
    this.scenarioContext = null;

    this.measuredHR = this.hr;
    this._beatHistory = [];
    this.spo2 = 98;
    this._spo2Walk = 0;
    this.nibpSys = 120;
    this.nibpDia = 80;
    this.nibpSecondsLeft = 30;

    this.quiz = {
      score: 0,
      total: 0,
      currentRhythmId: null,
      selectedGuess: null,
      decisionGiven: false,
    };

    this._simTime = 0;
    this._lastFrameTs = null;
    this._lastWriteCol = null;
    this._bufW = 0;

    this._cacheDom();
    this._buildRhythmButtons();
    this._buildQuizRhythmOptions();
    this._wireEvents();
    this._resizeCanvases();
    this._startClock();
    this._resetDesaBanner();
    this._updateShockableBadge();
    requestAnimationFrame((ts) => this._renderLoop(ts));
  }

  // ---------------------------------------------------------------- DOM --

  _cacheDom() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      btnAudioToggle: $('btnAudioToggle'),
      audioIcon: $('audioIcon'),
      audioLabel: $('audioLabel'),
      tabModeTeacher: $('tabModeTeacher'),
      tabModeQuiz: $('tabModeQuiz'),
      btnFullscreen: $('btnFullscreen'),
      gridCanvas: $('gridCanvas'),
      wavesCanvas: $('wavesCanvas'),
      qrsFilterStatus: $('qrsFilterStatus'),
      patientStatusBadge: $('patientStatusBadge'),
      clockDisplay: $('clockDisplay'),
      valHR: $('valHR'),
      alarmHRTag: $('alarmHRTag'),
      valSpO2: $('valSpO2'),
      perfIndex: $('perfIndex'),
      valSys: $('valSys'),
      valDia: $('valDia'),
      valMap: $('valMap'),
      nibpTimer: $('nibpTimer'),
      valRR: $('valRR'),
      rhythmShockableBadge: $('rhythmShockableBadge'),
      desaBanner: $('desaBanner'),
      desaVoiceText: $('desaVoiceText'),
      desaGuidanceSubtext: $('desaGuidanceSubtext'),
      btnAnalyzeDESA: $('btnAnalyzeDESA'),
      btnShockDESA: $('btnShockDESA'),
      shockBtnText: $('shockBtnText'),
      panelTitle: $('panelTitle'),
      scenarioIndicator: $('scenarioIndicator'),
      panelTeacher: $('panelTeacher'),
      rhythmButtonsContainer: $('rhythmButtonsContainer'),
      sliderHR: $('sliderHR'),
      sliderHRVal: $('sliderHRVal'),
      sliderNoise: $('sliderNoise'),
      sliderNoiseVal: $('sliderNoiseVal'),
      panelQuiz: $('panelQuiz'),
      quizScore: $('quizScore'),
      quizRhythmOptions: $('quizRhythmOptions'),
      quizShockYes: $('quizShockYes'),
      quizShockNo: $('quizShockNo'),
      quizFeedbackBox: $('quizFeedbackBox'),
      quizFeedbackTitle: $('quizFeedbackTitle'),
      quizFeedbackText: $('quizFeedbackText'),
      anatomyModal: $('anatomyModal'),
    };
    this.gridCtx = this.dom.gridCanvas.getContext('2d');
    this.wavesCtx = this.dom.wavesCanvas.getContext('2d');
  }

  _wireEvents() {
    this.dom.btnAudioToggle.addEventListener('click', () => this._toggleAudio());
    this.dom.tabModeTeacher.addEventListener('click', () => this._switchMode('teacher'));
    this.dom.tabModeQuiz.addEventListener('click', () => this._switchMode('quiz'));
    this.dom.btnFullscreen.addEventListener('click', () => this._toggleFullscreen());
    this.dom.btnAnalyzeDESA.addEventListener('click', () => {
      this.audio.unlock();
      this._analyzeDESA();
    });
    this.dom.btnShockDESA.addEventListener('click', () => {
      this.audio.unlock();
      this._deliverShock();
    });
    this.dom.sliderHR.addEventListener('input', (e) => this._onHRSlider(Number(e.target.value)));
    this.dom.sliderNoise.addEventListener('input', (e) => this._onNoiseSlider(Number(e.target.value)));
    window.addEventListener('resize', () => this._resizeCanvases());
  }

  // ------------------------------------------------------------ Layout ---

  _resizeCanvases() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    for (const canvas of [this.dom.gridCanvas, this.dom.wavesCanvas]) {
      const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
      const cssH = canvas.clientHeight || canvas.parentElement.clientHeight;
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    }
    this.cssW = this.dom.wavesCanvas.clientWidth;
    this.cssH = this.dom.wavesCanvas.clientHeight;
    this.gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.wavesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.pxPerSecond = this.cssW / SWEEP_SECONDS;
    this.pxPerMM = this.pxPerSecond / MM_PER_SECOND;

    this._bufW = Math.max(1, Math.round(this.cssW));
    this.ecgBuf = new Float32Array(this._bufW);
    this.plethBuf = new Float32Array(this._bufW);
    this.respBuf = new Float32Array(this._bufW);
    this.colValid = new Uint8Array(this._bufW);
    this._lastWriteCol = null;

    this._drawGrid();
  }

  _drawGrid() {
    const ctx = this.gridCtx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0, 0, w, h);
    if (!this.pxPerMM || this.pxPerMM <= 0) return;

    ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x += this.pxPerMM) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y < h; y += this.pxPerMM) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(16, 185, 129, 0.22)';
    ctx.beginPath();
    const majorStep = this.pxPerMM * 5;
    for (let x = 0; x < w; x += majorStep) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y < h; y += majorStep) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
  }

  // --------------------------------------------------------- Render loop --

  _renderLoop(ts) {
    if (this._lastFrameTs == null) this._lastFrameTs = ts;
    let dt = (ts - this._lastFrameTs) / 1000;
    this._lastFrameTs = ts;
    dt = clamp(dt, 0, 0.25); // evita saltos tras pestaña en segundo plano

    this._simTime += dt;
    this._advanceSweep();
    this._drawWaves();

    requestAnimationFrame((next) => this._renderLoop(next));
  }

  /**
   * Único acumulador de tiempo real: gobierna a la vez el avance del
   * puntero (en píxeles) y el avance fisiológico del ritmo cardíaco. Cada
   * columna de píxel recién barrida avanza el motor exactamente 1/pxPerSecond
   * segundos, así que puntero y forma de onda nunca pueden desincronizarse,
   * sea cual sea el framerate real del dispositivo.
   */
  _advanceSweep() {
    if (!this.pxPerSecond || !this._bufW) return;
    const writePosFloat = this._simTime * this.pxPerSecond;
    const writeCol = Math.floor(writePosFloat);
    if (this._lastWriteCol == null) {
      this._lastWriteCol = writeCol - 1;
    }
    const colDt = 1 / this.pxPerSecond;
    const gap = Math.max(2, Math.round(this.pxPerMM * 1.5));

    let steps = writeCol - this._lastWriteCol;
    if (steps > this._bufW) steps = this._bufW; // recuperación tras inactividad prolongada

    for (let i = 0; i < steps; i++) {
      const col = this._lastWriteCol + 1 + i;
      const sample = this.engine.advance(colDt, this._effectiveHR(), this.respRate, this.noiseLevel);

      if (sample.beatTrigger) this._onBeat();

      const actualCol = ((col % this._bufW) + this._bufW) % this._bufW;
      this.ecgBuf[actualCol] = sample.ecg;
      this.plethBuf[actualCol] = sample.pleth;
      this.respBuf[actualCol] = sample.resp;
      this.colValid[actualCol] = 1;

      for (let g = 1; g <= gap; g++) {
        const gc = ((actualCol + g) % this._bufW + this._bufW) % this._bufW;
        this.colValid[gc] = 0;
      }
    }
    this._lastWriteCol = writeCol;
  }

  _drawWaves() {
    const ctx = this.wavesCtx;
    const w = this.cssW;
    const h = this.cssH;
    ctx.clearRect(0, 0, w, h);
    if (!this._bufW) return;

    const ecgBand = { top: 0, height: h * 0.48, baseline: 0.62, scale: 0.4 };
    const plethBand = { top: h * 0.48, height: h * 0.26, baseline: 0.82, scale: 0.62 };
    const respBand = { top: h * 0.74, height: h * 0.26, baseline: 0.5, scale: 0.38 };

    this._drawTrace(ctx, this.ecgBuf, ecgBand, '#22e07f', 1.6);
    this._drawTrace(ctx, this.plethBuf, plethBand, '#2dd4ee', 1.4);
    this._drawTrace(ctx, this.respBuf, respBand, '#facc15', 1.2);
  }

  _drawTrace(ctx, buf, band, color, lineWidth) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;

    const baseY = band.top + band.height * band.baseline;
    const ampPx = band.height * band.scale;
    let drawing = false;
    ctx.beginPath();
    for (let x = 0; x < this._bufW; x++) {
      if (!this.colValid[x]) {
        drawing = false;
        continue;
      }
      const y = baseY - buf[x] * ampPx;
      if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ------------------------------------------------------------- Vitals --

  _effectiveHR() {
    const def = RHYTHMS[this.rhythmId];
    if (def.wave === 'flat' || def.wave === 'chaotic-coarse' || def.wave === 'chaotic-fine') return 1;
    return Math.max(1, this.hr);
  }

  _onBeat() {
    const now = this._simTime;
    this._beatHistory.push(now);
    if (this._beatHistory.length > 6) this._beatHistory.shift();
    if (this._beatHistory.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this._beatHistory.length; i++) {
        intervals.push(this._beatHistory[i] - this._beatHistory[i - 1]);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgInterval > 0.15) {
        const instHR = 60 / avgInterval;
        this.measuredHR = lerp(this.measuredHR, instHR, 0.35);
      }
    }
    if (this.audio.enabled) this.audio.beepQRS();
  }

  _tickVitals(dtSeconds) {
    const def = RHYTHMS[this.rhythmId];
    const noBeat = def.wave === 'flat' || def.wave === 'chaotic-coarse' || def.wave === 'chaotic-fine';
    if (noBeat) {
      this.measuredHR = lerp(this.measuredHR, 0, 0.2);
      this._beatHistory.length = 0;
    }

    if (def.hasPulse && def.spo2Range) {
      this._spo2Walk += (Math.random() - 0.5) * 0.15;
      this._spo2Walk = clamp(this._spo2Walk, -1.5, 1.5);
      const mid = (def.spo2Range[0] + def.spo2Range[1]) / 2;
      const target = clamp(mid + this._spo2Walk - this.noiseLevel / 40, 70, 100);
      // Si no había señal válida (this.spo2 === null), el pulsioxímetro la
      // reacquiere en pocos segundos, no arrastrando una media desde 0.
      this.spo2 = this.spo2 == null ? target : lerp(this.spo2, target, 0.03);
    } else {
      this.spo2 = null;
    }

    if (def.hasPulse && def.respRange) {
      const mid = (def.respRange[0] + def.respRange[1]) / 2;
      // Igual que con SpO2: si veníamos de apnea/parada (respRate en 0), no
      // arrastrar la media desde ahí — la respiración espontánea se
      // restablece en segundos, no minutos.
      this.respRate = this.respRate < 2 ? mid : lerp(this.respRate, mid, 0.02) + (Math.random() - 0.5) * 0.4;
    } else {
      this.respRate = 0;
    }

    this.nibpSecondsLeft -= dtSeconds;
    if (this.nibpSecondsLeft <= 0) {
      this.nibpSecondsLeft = 30;
      this._measureNIBP();
    }

    this._renderVitals();
  }

  _measureNIBP() {
    const def = RHYTHMS[this.rhythmId];
    if (!def.hasPulse) {
      this.nibpSys = null;
      this.nibpDia = null;
      return;
    }
    let baseSys = 120;
    let baseDia = 80;
    if (def.category === 'bradi') {
      baseSys = 85;
      baseDia = 55;
    } else if (def.id === 'vt_pulse' || def.category === 'taqui') {
      baseSys = 92;
      baseDia = 60;
    }
    this.nibpSys = Math.round(baseSys + (Math.random() - 0.5) * 8);
    this.nibpDia = Math.round(baseDia + (Math.random() - 0.5) * 6);
  }

  _renderVitals() {
    const def = RHYTHMS[this.rhythmId];
    const d = this.dom;

    const hrDisplay = Math.round(this.measuredHR);
    d.valHR.textContent = def.wave === 'flat' || def.wave === 'chaotic-coarse' || def.wave === 'chaotic-fine' ? '0' : String(hrDisplay);
    const hrCritical = !def.hasPulse || hrDisplay < 40 || hrDisplay > 160 || hrDisplay === 0;
    d.valHR.classList.toggle('text-red-500', hrCritical);
    d.valHR.classList.toggle('text-ecg', !hrCritical);
    d.valHR.classList.toggle('animate-flash-critical', hrCritical);

    // Umbrales clínicos universales (60-100 lpm), no el rango propio de cada
    // ritmo: una bradicardia sinusal a 45 lpm debe seguir alarmando como
    // bradicardia, no leerse como "normal" solo porque encaja en su rango.
    if (!def.hasPulse) {
      d.alarmHRTag.textContent = '¡SIN PULSO DETECTABLE!';
      d.alarmHRTag.className = 'text-[10px] font-mono text-red-400 truncate animate-flash-critical';
    } else if (hrDisplay < 60) {
      d.alarmHRTag.textContent = 'BRADICARDIA';
      d.alarmHRTag.className = 'text-[10px] font-mono text-amber-400 truncate';
    } else if (hrDisplay > 100) {
      d.alarmHRTag.textContent = 'TAQUICARDIA';
      d.alarmHRTag.className = 'text-[10px] font-mono text-amber-400 truncate';
    } else {
      d.alarmHRTag.textContent = 'RITMO NORMAL';
      d.alarmHRTag.className = 'text-[10px] font-mono text-emerald-400 truncate';
    }

    if (this.spo2 == null) {
      d.valSpO2.textContent = '- -';
      d.perfIndex.textContent = 'SIN PERFUSIÓN';
      d.perfIndex.className = 'text-[10px] font-mono text-red-400 animate-flash-critical';
    } else {
      d.valSpO2.textContent = String(Math.round(this.spo2));
      d.perfIndex.textContent = `PI: ${(1.5 + Math.random() * 3.5).toFixed(1)}`;
      d.perfIndex.className = 'text-[10px] font-mono text-cyan-400';
    }

    if (this.nibpSys == null) {
      d.valSys.textContent = '--';
      d.valDia.textContent = '--';
      d.valMap.textContent = '--';
    } else {
      d.valSys.textContent = String(this.nibpSys);
      d.valDia.textContent = String(this.nibpDia);
      d.valMap.textContent = String(Math.round((this.nibpSys + 2 * this.nibpDia) / 3));
    }
    const nibpM = Math.floor(Math.max(0, this.nibpSecondsLeft) / 60);
    const nibpS = Math.max(0, this.nibpSecondsLeft) % 60;
    d.nibpTimer.textContent = `${pad2(nibpM)}:${pad2(nibpS)}`;

    d.valRR.textContent = def.hasPulse ? String(Math.round(this.respRate)) : '0';

    const arrestState = !def.hasPulse;
    if (arrestState) {
      d.patientStatusBadge.textContent = '¡PARADA CARDIORRESPIRATORIA!';
      d.patientStatusBadge.className =
        'px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-700/60 animate-flash-critical';
    } else if (def.notArrestState) {
      d.patientStatusBadge.textContent = 'CONSCIENTE — VALORAR URGENTE';
      d.patientStatusBadge.className =
        'px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-700/60';
    } else {
      d.patientStatusBadge.textContent = 'PACIENTE MONITORIZADO';
      d.patientStatusBadge.className =
        'px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700/50';
    }
  }

  _updateShockableBadge() {
    const badge = this.dom.rhythmShockableBadge;
    if (this.mode === 'quiz') {
      badge.textContent = 'Oculto';
      badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-800 text-slate-500';
      return;
    }
    const def = RHYTHMS[this.rhythmId];
    if (def.shockable) {
      badge.textContent = 'Desfibrilable';
      badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-red-950 text-red-400 border border-red-700/50';
    } else {
      badge.textContent = 'No Desfibrilable';
      badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-800 text-slate-400';
    }
  }

  _startClock() {
    const tick = () => {
      this.dom.clockDisplay.textContent = new Date().toLocaleTimeString('es-ES', { hour12: false });
      this._tickVitals(1);
    };
    tick();
    setInterval(tick, 1000);
  }

  // --------------------------------------------------------------- UI ---

  _toggleAudio() {
    this.audio.unlock();
    this.audio.setEnabled(!this.audio.enabled);
    const on = this.audio.enabled;
    this.dom.audioIcon.textContent = on ? '🔊' : '🔇';
    this.dom.audioLabel.textContent = `Sonido: ${on ? 'ACTIVO' : 'SILENCIADO'}`;
    this.dom.btnAudioToggle.classList.toggle('text-emerald-400', on);
    this.dom.btnAudioToggle.classList.toggle('border-emerald-600/60', on);
    this.dom.btnAudioToggle.classList.toggle('bg-emerald-950/60', on);
    this.dom.btnAudioToggle.classList.toggle('text-slate-400', !on);
    this.dom.btnAudioToggle.classList.toggle('border-slate-700', !on);
    this.dom.btnAudioToggle.classList.toggle('bg-slate-800', !on);
  }

  _toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  toggleModal(show) {
    this.dom.anatomyModal.classList.toggle('hidden', !show);
  }

  _switchMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    const teacherActive = mode === 'teacher';
    this.dom.tabModeTeacher.className = teacherActive
      ? 'px-2.5 py-1 rounded-md font-medium transition-all bg-emerald-600 text-white shadow'
      : 'px-2.5 py-1 rounded-md font-medium transition-all text-slate-400 hover:text-slate-200';
    this.dom.tabModeQuiz.className = !teacherActive
      ? 'px-2.5 py-1 rounded-md font-medium transition-all bg-amber-500 text-slate-950 shadow'
      : 'px-2.5 py-1 rounded-md font-medium transition-all text-slate-400 hover:text-slate-200';
    this.dom.panelTeacher.classList.toggle('hidden', !teacherActive);
    this.dom.panelQuiz.classList.toggle('hidden', teacherActive);
    this.dom.panelTitle.innerHTML = teacherActive
      ? '<span>⚙️ Panel del Docente / Escenario</span>'
      : '<span>🎓 Reto Clínico del Alumno</span>';

    if (teacherActive) {
      this.dom.scenarioIndicator.textContent = this.scenarioLabel;
      this._resetDesaBanner();
      this.dom.btnAnalyzeDESA.disabled = false;
    } else {
      this._nextQuizQuestionInternal();
    }
    this._updateShockableBadge();
  }

  // ------------------------------------------------------- Teacher mode --

  _buildRhythmButtons() {
    const container = this.dom.rhythmButtonsContainer;
    container.innerHTML = '';
    for (const id of RHYTHM_ORDER) {
      const def = RHYTHMS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.rhythmId = id;
      btn.className = this._rhythmBtnClass(id === this.rhythmId);
      btn.innerHTML = `<span>${def.label}</span><span class="text-[9px] font-mono ${def.shockable ? 'text-red-400' : 'text-slate-500'}">${def.shockable ? '⚡ DESFIB.' : ''}</span>`;
      btn.addEventListener('click', () => {
        this.scenarioLabel = `Ritmo manual: ${def.label}`;
        this.scenarioContext = null;
        this.dom.scenarioIndicator.textContent = this.scenarioLabel;
        this.selectRhythm(id);
      });
      container.appendChild(btn);
    }
  }

  _rhythmBtnClass(active) {
    return `flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-medium text-left transition-all ${
      active
        ? 'bg-emerald-600/20 border-emerald-500/70 text-emerald-300'
        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
    }`;
  }

  _refreshRhythmButtons() {
    for (const btn of this.dom.rhythmButtonsContainer.children) {
      btn.className = this._rhythmBtnClass(btn.dataset.rhythmId === this.rhythmId);
    }
  }

  selectRhythm(id) {
    const def = RHYTHMS[id];
    if (!def) return;
    this.rhythmId = id;
    this.engine.setRhythm(id);
    this.hr = def.defaultHR || (def.hrRange ? Math.round((def.hrRange[0] + def.hrRange[1]) / 2) : 75);
    this.dom.sliderHR.min = String(def.hrRange ? Math.max(10, def.hrRange[0] - 10) : 20);
    this.dom.sliderHR.max = String(def.hrRange ? def.hrRange[1] + 20 : 220);
    this.dom.sliderHR.value = String(this.hr);
    this.dom.sliderHR.disabled = def.wave === 'flat' || def.wave === 'chaotic-coarse' || def.wave === 'chaotic-fine';
    this.dom.sliderHRVal.textContent = this.dom.sliderHR.disabled ? 'N/A' : `${this.hr} lpm`;
    this._beatHistory.length = 0;
    this.measuredHR = this.dom.sliderHR.disabled ? 0 : this.hr;
    this.spo2 = null; // fuerza reacquisición de señal (evita arrastrar la SpO2 del ritmo anterior)
    this._measureNIBP(); // lectura inmediata: nunca dejar una TA "válida" de un ritmo anterior tras cambiar a uno sin pulso
    this.nibpSecondsLeft = 30;
    this._refreshRhythmButtons();
    this._resetDesaBanner();
    this._updateShockableBadge();
  }

  _onHRSlider(val) {
    this.hr = val;
    this.dom.sliderHRVal.textContent = `${val} lpm`;
  }

  _onNoiseSlider(val) {
    this.noiseLevel = val;
    const label = val < 15 ? 'Bajo' : val < 45 ? 'Moderado' : val < 75 ? 'Alto' : 'Muy alto';
    this.dom.sliderNoiseVal.textContent = label;
  }

  loadClinicalScenario(key) {
    const scenario = CLINICAL_SCENARIOS[key];
    if (!scenario) return;
    if (this.mode !== 'teacher') this._switchMode('teacher');
    this.scenarioLabel = scenario.label;
    this.scenarioContext = scenario.context;
    this.dom.scenarioIndicator.textContent = scenario.label;
    this.selectRhythm(scenario.rhythmId);
    if (!this.dom.sliderHR.disabled) {
      this.hr = scenario.hr;
      this.dom.sliderHR.value = String(scenario.hr);
      this.dom.sliderHRVal.textContent = `${scenario.hr} lpm`;
      this.measuredHR = scenario.hr;
    }
    this.dom.sliderNoise.value = String(scenario.noise);
    this._onNoiseSlider(scenario.noise);
    this.dom.desaGuidanceSubtext.textContent = scenario.context;
  }

  // ------------------------------------------------------------ DESA ----

  _resetDesaBanner() {
    if (this._cprInterval) {
      clearInterval(this._cprInterval);
      this._cprInterval = null;
    }
    if (this.dom.skipWaitBtn) this.dom.skipWaitBtn.classList.add('hidden');
    this.desaState = 'idle';
    this.dom.desaVoiceText.textContent = '"Electrodos adheridos. Monitorizando ritmo del paciente..."';
    this.dom.desaGuidanceSubtext.textContent =
      this.scenarioContext || 'Evalúe consciencia, pulso carotídeo y respiración antes de proceder.';
    this.dom.btnAnalyzeDESA.disabled = this.mode === 'quiz' && !this.quiz.decisionGiven;
    this.dom.btnShockDESA.disabled = true;
    this.dom.btnShockDESA.className =
      'px-4 py-1.5 rounded-lg bg-slate-700 text-slate-400 font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5';
    this.dom.shockBtnText.textContent = 'DESCARGA';
  }

  async _analyzeDESA() {
    if (this.desaState === 'analyzing' || this.desaState === 'cpr-wait') return;
    this.desaState = 'analyzing';
    this.dom.btnAnalyzeDESA.disabled = true;
    this.dom.btnShockDESA.disabled = true;
    this.dom.desaVoiceText.textContent = '"Analizando ritmo cardíaco. No toque al paciente."';
    this.dom.desaGuidanceSubtext.textContent = 'Analizando…';

    await Promise.all([
      this.audio.speak('Analizando ritmo cardíaco. No toque al paciente.'),
      delay(ANALYSIS_DWELL_MS),
    ]);

    const def = RHYTHMS[this.rhythmId];

    if (def.notArrestState) {
      this.desaState = 'result-not-arrest';
      this.dom.desaVoiceText.textContent =
        '"Se detecta pulso y consciencia. El algoritmo DESA no está indicado."';
      this.dom.desaGuidanceSubtext.textContent =
        'No es una parada cardiorrespiratoria: solicite ayuda médica avanzada urgente. No inicie RCP ni desfibrile.';
      this.dom.btnAnalyzeDESA.disabled = false;
      return;
    }

    if (def.shockable) {
      this.desaState = 'result-shockable';
      this.dom.desaVoiceText.textContent = '"Descarga recomendada. Cargando. Aléjense del paciente."';
      this.dom.desaGuidanceSubtext.textContent = 'Confirme que nadie toca al paciente y pulse DESCARGA.';
      this.audio.speak('Descarga recomendada. Cargando. Aléjense del paciente.');
      this.dom.btnShockDESA.disabled = false;
      this.dom.btnShockDESA.className =
        'px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-wider transition-all active:scale-95 animate-pulse-ring flex items-center gap-1.5';
    } else {
      this.desaState = 'result-not-shockable';
      this.dom.desaVoiceText.textContent = '"No se recomienda descarga. Reanude la RCP."';
      this.dom.desaGuidanceSubtext.textContent = 'Continúe compresiones torácicas de alta calidad, 30:2.';
      this.audio.speak('No se recomienda descarga. Reanude la reanimación cardiopulmonar de inmediato.');
      this._startCprCycle();
    }
  }

  async _deliverShock() {
    if (this.desaState !== 'result-shockable') return;
    this.desaState = 'shocked';
    this.dom.btnShockDESA.disabled = true;
    this.dom.shockBtnText.textContent = 'DESCARGANDO…';
    this._flashShock();
    this.audio.shockThump();

    const success = Math.random() < 0.7;
    await delay(350);
    if (success) {
      this.rhythmId = 'sinus_tachy';
      this.engine.setRhythm(this.rhythmId);
      this.hr = RHYTHMS[this.rhythmId].defaultHR;
      this.measuredHR = this.hr;
      this._refreshRhythmButtons();
      this._updateShockableBadge();
    }

    this.dom.desaVoiceText.textContent = '"Descarga administrada. Reanude la RCP y continúe durante dos minutos."';
    this.dom.desaGuidanceSubtext.textContent = success
      ? 'Descarga aplicada. Aunque el ritmo cambie, reanude compresiones inmediatamente: no compruebe el pulso todavía.'
      : 'Descarga aplicada sin conversión aparente. Reanude compresiones inmediatamente y prepare la siguiente descarga.';
    this.audio.speak('Descarga administrada. Reanude la reanimación cardiopulmonar de inmediato.');

    this.dom.shockBtnText.textContent = 'DESCARGA';
    this._startCprCycle();
  }

  _flashShock() {
    const flash = document.createElement('div');
    flash.style.cssText =
      'position:fixed;inset:0;background:#fff;opacity:0.85;z-index:9999;pointer-events:none;transition:opacity 220ms ease-out;';
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 260);
    });
  }

  _startCprCycle() {
    this.desaState = 'cpr-wait';
    this.dom.btnAnalyzeDESA.disabled = true;
    this.dom.btnShockDESA.disabled = true;
    this.cprSecondsLeft = CPR_CYCLE_SECONDS;

    if (this._cprInterval) clearInterval(this._cprInterval);
    if (!this.dom.skipWaitBtn) this._injectSkipWaitButton();
    this.dom.skipWaitBtn.classList.remove('hidden');

    const tick = () => {
      this.cprSecondsLeft -= 1;
      this.dom.desaGuidanceSubtext.textContent = `RCP en curso — próximo análisis disponible en ${Math.max(0, this.cprSecondsLeft)} s (simulación acelerada de los 2 min reales).`;
      if (this.cprSecondsLeft <= 0) this._endCprCycle();
    };
    tick();
    this._cprInterval = setInterval(tick, 1000);
  }

  _injectSkipWaitButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Saltar espera (modo aula) ⏭';
    btn.className =
      'mt-1 w-full text-[10px] font-mono text-slate-400 hover:text-slate-200 underline decoration-dotted';
    btn.addEventListener('click', () => this._endCprCycle());
    this.dom.desaBanner.appendChild(btn);
    this.dom.skipWaitBtn = btn;
  }

  _endCprCycle() {
    if (this._cprInterval) clearInterval(this._cprInterval);
    this.cprSecondsLeft = 0;
    if (this.dom.skipWaitBtn) this.dom.skipWaitBtn.classList.add('hidden');
    this.desaState = 'idle';
    this.dom.btnAnalyzeDESA.disabled = this.mode === 'quiz' && !this.quiz.decisionGiven;
    this.dom.btnShockDESA.disabled = true;
    this.dom.desaVoiceText.textContent = '"Ciclo de RCP completado. Analice el ritmo cuando esté listo."';
    this.dom.desaGuidanceSubtext.textContent = this.scenarioContext || 'Pulse "Analizar Ritmo" para continuar el algoritmo.';
  }

  // ------------------------------------------------------------- Quiz ---

  _buildQuizRhythmOptions(order = RHYTHM_ORDER) {
    const container = this.dom.quizRhythmOptions;
    container.innerHTML = '';
    for (const id of order) {
      const def = RHYTHMS[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.rhythmId = id;
      btn.className = this._quizOptionClass(false);
      btn.textContent = def.label;
      btn.addEventListener('click', () => {
        if (this.quiz.decisionGiven) return;
        this.quiz.selectedGuess = id;
        for (const b of container.children) {
          b.className = this._quizOptionClass(b.dataset.rhythmId === id);
        }
      });
      container.appendChild(btn);
    }
  }

  _quizOptionClass(active) {
    return `px-2.5 py-1.5 rounded-lg border text-[11px] text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
      active
        ? 'bg-emerald-600/20 border-emerald-500/70 text-emerald-300'
        : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-800/60'
    }`;
  }

  _nextQuizQuestionInternal() {
    const id = RHYTHM_ORDER[Math.floor(Math.random() * RHYTHM_ORDER.length)];
    this.quiz.currentRhythmId = id;
    this.quiz.selectedGuess = null;
    this.quiz.decisionGiven = false;
    this.scenarioLabel = 'Caso clínico aleatorio';
    this.scenarioContext = null;
    this.selectRhythm(id);
    this._buildQuizRhythmOptions(shuffle(RHYTHM_ORDER));
    this.dom.quizShockYes.disabled = false;
    this.dom.quizShockNo.disabled = false;
    this.dom.quizShockYes.classList.remove('opacity-40', 'pointer-events-none');
    this.dom.quizShockNo.classList.remove('opacity-40', 'pointer-events-none');
    this.dom.quizFeedbackBox.classList.add('hidden');
    this.dom.scenarioIndicator.textContent = 'Reto en curso';
  }

  nextQuizQuestion() {
    this._nextQuizQuestionInternal();
  }

  submitStudentDecision(shockChoice) {
    if (this.mode !== 'quiz' || this.quiz.decisionGiven) return;
    if (!this.quiz.selectedGuess) {
      this.dom.quizFeedbackBox.classList.remove('hidden');
      this.dom.quizFeedbackBox.className = 'p-3 rounded-lg border text-[11px] space-y-1.5 transition-all bg-amber-950/30 border-amber-700/50';
      this.dom.quizFeedbackTitle.textContent = '⚠️ Selecciona primero un ritmo';
      this.dom.quizFeedbackText.textContent = 'Identifica el trazado del monitor en la pregunta 1 antes de decidir la conducta con el DESA.';
      return;
    }

    const def = RHYTHMS[this.quiz.currentRhythmId];
    const rhythmCorrect = this.quiz.selectedGuess === this.quiz.currentRhythmId;
    const correctShockChoice = def.shockable === true;
    const shockCorrect = shockChoice === correctShockChoice;
    const fullyCorrect = rhythmCorrect && shockCorrect;

    this.quiz.total += 1;
    if (fullyCorrect) this.quiz.score += 1;
    this.quiz.decisionGiven = true;
    this.dom.quizScore.textContent = `Aciertos: ${this.quiz.score} / ${this.quiz.total}`;

    for (const b of this.dom.quizRhythmOptions.children) b.disabled = true;
    this.dom.quizShockYes.disabled = true;
    this.dom.quizShockNo.disabled = true;
    this.dom.quizShockYes.classList.add('opacity-40', 'pointer-events-none');
    this.dom.quizShockNo.classList.add('opacity-40', 'pointer-events-none');
    this.dom.btnAnalyzeDESA.disabled = false;

    const box = this.dom.quizFeedbackBox;
    box.classList.remove('hidden');
    box.className = `p-3 rounded-lg border text-[11px] space-y-1.5 transition-all ${
      fullyCorrect ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-red-950/30 border-red-700/50'
    }`;
    this.dom.quizFeedbackTitle.textContent = fullyCorrect ? '✅ Correcto' : '❌ Revisa el caso';
    const parts = [];
    parts.push(
      rhythmCorrect
        ? `Ritmo identificado correctamente: ${def.label}.`
        : `El ritmo mostrado era: ${def.label} (seleccionaste ${RHYTHMS[this.quiz.selectedGuess]?.label ?? '—'}).`
    );
    parts.push(
      shockCorrect
        ? 'Decisión sobre el DESA correcta.'
        : `Decisión sobre el DESA incorrecta: lo adecuado era ${correctShockChoice ? 'APLICAR DESCARGA' : 'NO DESCARGAR'}.`
    );
    parts.push(def.quizExplanation);
    this.dom.quizFeedbackText.innerHTML = parts.join(' ');

    this.selectRhythm(this.quiz.currentRhythmId);
  }
}
