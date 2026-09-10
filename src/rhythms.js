// Motor fisiológico del simulador: define cada ritmo ECG y genera, latido a
// latido, la forma de onda de ECG / pletismografía (SpO2) / respiración.
//
// Todo el tiempo del simulador fluye por un único acumulador (ver
// `RhythmEngine.advance` y `app.js` `renderLoop`): no existe un contador de
// píxeles independiente del reloj cardíaco, así que el puntero de barrido y
// la fase de la onda nunca pueden desincronizarse, sea cual sea el framerate.

function gauss(x, mu, sigma) {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}

// PRNG determinista (mulberry32) — mismo aspecto "orgánico" en cada sesión,
// sin depender de Math.random() para poder tener sesiones reproducibles.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rnd() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sinusBeatShape(p) {
  let v = 0;
  v += 0.16 * gauss(p, 0.15, 0.02); // P
  v += -0.1 * gauss(p, 0.295, 0.006); // Q
  v += 1.0 * gauss(p, 0.315, 0.009); // R
  v += -0.28 * gauss(p, 0.336, 0.009); // S
  v += 0.3 * gauss(p, 0.58, 0.05); // T
  return v;
}

function narrowNoPShape(p) {
  // QRS estrecho + T, sin onda P (FA, AESP, bloqueo AV completo escape)
  let v = 0;
  v += -0.08 * gauss(p, 0.295, 0.006);
  v += 0.95 * gauss(p, 0.315, 0.009);
  v += -0.22 * gauss(p, 0.335, 0.008);
  v += 0.26 * gauss(p, 0.58, 0.05);
  return v;
}

function wideBeatShape(p) {
  // QRS ancho y "en bloque", sin P ni T diferenciadas (TV)
  let v = 0;
  v += 1.15 * gauss(p, 0.3, 0.04);
  v += -0.45 * gauss(p, 0.44, 0.035);
  return v;
}

function flutterBeatShape(p) {
  let v = 0;
  v += -0.09 * gauss(p, 0.295, 0.006);
  v += 0.92 * gauss(p, 0.315, 0.009);
  v += -0.2 * gauss(p, 0.335, 0.008);
  v += 0.22 * gauss(p, 0.58, 0.05);
  return v;
}

function plethShape(p) {
  let v = 0;
  v += 1.0 * gauss(p, 0.1, 0.045); // pico sistólico
  v += 0.28 * gauss(p, 0.34, 0.07); // muesca dicrota
  return v;
}

// Definición de cada ritmo. `wave` selecciona la familia de generación en
// RhythmEngine. `shockable` es la verdad clínica (algoritmo DESA/ERC-AHA).
// `hasPulse` determina si hay onda de pulso/SpO2/TA válidas.
export const RHYTHMS = {
  sinus_normal: {
    id: 'sinus_normal',
    label: 'Ritmo Sinusal Normal',
    shortLabel: 'RSN',
    category: 'normal',
    wave: 'sinus',
    shockable: false,
    hasPulse: true,
    defaultHR: 75,
    hrRange: [60, 100],
    spo2Range: [96, 99],
    respRange: [12, 18],
    desc: 'Ritmo sinusal normal: onda P seguida de QRS estrecho, regular, 60-100 lpm. Paciente estable.',
    quizExplanation:
      'Ritmo sinusal normal: onda P antes de cada QRS estrecho, frecuencia regular entre 60-100 lpm. No es un ritmo de parada; no se aplica el DESA.',
  },
  sinus_brady: {
    id: 'sinus_brady',
    label: 'Bradicardia Sinusal',
    shortLabel: 'Bradi. Sinusal',
    category: 'bradi',
    wave: 'sinus',
    shockable: false,
    hasPulse: true,
    defaultHR: 45,
    hrRange: [35, 59],
    spo2Range: [94, 98],
    respRange: [10, 16],
    desc: 'Ritmo sinusal por debajo de 60 lpm. Puede requerir atropina o marcapasos si es sintomática.',
    quizExplanation:
      'Bradicardia sinusal: morfología sinusal normal pero con frecuencia &lt;60 lpm. Con pulso presente, no es un ritmo desfibrilable.',
  },
  sinus_tachy: {
    id: 'sinus_tachy',
    label: 'Taquicardia Sinusal',
    shortLabel: 'Taqui. Sinusal',
    category: 'taqui',
    wave: 'sinus',
    shockable: false,
    hasPulse: true,
    defaultHR: 130,
    hrRange: [101, 150],
    spo2Range: [95, 99],
    respRange: [16, 24],
    desc: 'Ritmo sinusal acelerado, típicamente reactivo (dolor, fiebre, hipovolemia, ansiedad).',
    quizExplanation:
      'Taquicardia sinusal: P-QRS-T conservados, frecuencia &gt;100 lpm. Con pulso presente; no está indicado el DESA, se trata la causa subyacente.',
  },
  afib: {
    id: 'afib',
    label: 'Fibrilación Auricular',
    shortLabel: 'FA',
    category: 'taqui',
    wave: 'afib',
    shockable: false,
    hasPulse: true,
    defaultHR: 118,
    hrRange: [90, 160],
    spo2Range: [93, 98],
    respRange: [14, 20],
    desc: 'Ausencia de ondas P (línea fibrilatoria) con respuesta ventricular irregularmente irregular.',
    quizExplanation:
      'Fibrilación auricular: no hay ondas P, línea de base fibrilatoria, QRS estrecho con RR irregular ("irregularmente irregular"). Con pulso; no es indicación de DESA salvo inestabilidad extrema que requiera cardioversión sincronizada por personal cualificado (no modo DESA/AED).',
  },
  aflutter: {
    id: 'aflutter',
    label: 'Flutter Auricular',
    shortLabel: 'Flutter',
    category: 'taqui',
    wave: 'aflutter',
    shockable: false,
    hasPulse: true,
    defaultHR: 100,
    hrRange: [75, 150],
    spo2Range: [94, 98],
    respRange: [14, 20],
    desc: 'Ondas "en dientes de sierra" (ondas F) a ~300/min con conducción ventricular regular (2:1, 3:1...).',
    quizExplanation:
      'Flutter auricular: ondas F en "dientes de sierra" entre los QRS, respuesta ventricular regular. Con pulso; no es indicación de DESA.',
  },
  vt_pulse: {
    id: 'vt_pulse',
    label: 'Taquicardia Ventricular con Pulso',
    shortLabel: 'TV con pulso',
    category: 'letal',
    wave: 'wide',
    shockable: false,
    hasPulse: true,
    notArrestState: true,
    defaultHR: 175,
    hrRange: [150, 200],
    spo2Range: [90, 96],
    respRange: [18, 26],
    desc: 'QRS ancho y regular a alta frecuencia. Paciente consciente y con pulso: NO es una parada cardiorrespiratoria.',
    quizExplanation:
      'Taquicardia ventricular CON pulso: QRS ancho (&gt;0,12s) y regular, pero el paciente está consciente y tiene pulso — no hay parada cardiorrespiratoria. El DESA en modo automático no se aplica aquí: requiere valoración médica urgente / cardioversión sincronizada por personal cualificado, nunca un choque de AED sin confirmar antes ausencia de consciencia, pulso y respiración normal.',
  },
  vt_pulseless: {
    id: 'vt_pulseless',
    label: 'Taquicardia Ventricular sin Pulso (TVSP)',
    shortLabel: 'TVSP',
    category: 'letal',
    wave: 'wide',
    shockable: true,
    hasPulse: false,
    defaultHR: 210,
    hrRange: [180, 250],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'QRS ancho, regular, muy rápido. Sin pulso: parada cardiorrespiratoria. Ritmo desfibrilable.',
    quizExplanation:
      'Taquicardia ventricular SIN pulso (TVSP): mismo QRS ancho y regular que la TV, pero sin pulso ni signos de circulación → parada cardiorrespiratoria. Es un ritmo DESFIBRILABLE: descarga inmediata + RCP.',
  },
  vfib_coarse: {
    id: 'vfib_coarse',
    label: 'Fibrilación Ventricular Gruesa',
    shortLabel: 'FV gruesa',
    category: 'letal',
    wave: 'chaotic-coarse',
    shockable: true,
    hasPulse: false,
    defaultHR: 0,
    hrRange: [0, 0],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'Actividad eléctrica caótica de amplitud alta, sin complejos identificables. Máxima prioridad de DESA.',
    quizExplanation:
      'Fibrilación ventricular gruesa: trazado caótico de amplitud grande, sin P-QRS-T reconocibles, sin pulso. Ritmo DESFIBRILABLE — descarga inmediata.',
  },
  vfib_fine: {
    id: 'vfib_fine',
    label: 'Fibrilación Ventricular Fina',
    shortLabel: 'FV fina',
    category: 'letal',
    wave: 'chaotic-fine',
    shockable: true,
    hasPulse: false,
    defaultHR: 0,
    hrRange: [0, 0],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'FV de baja amplitud: a veces se confunde con asistolia. Confirmar en más de una derivación / subir ganancia.',
    quizExplanation:
      'Fibrilación ventricular fina: igual de caótica que la FV gruesa pero de amplitud mucho menor — puede parecer una línea casi plana. Sigue siendo DESFIBRILABLE; ante la duda con asistolia, nunca se retrasa el DESA, que analiza el ritmo automáticamente.',
  },
  torsades: {
    id: 'torsades',
    label: 'Torsade de Pointes',
    shortLabel: 'Torsades',
    category: 'letal',
    wave: 'torsades',
    shockable: true,
    hasPulse: false,
    defaultHR: 220,
    hrRange: [200, 250],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'TV polimórfica con amplitud del QRS "trenzándose" alrededor de la línea de base. Asociada a QT largo.',
    quizExplanation:
      'Torsade de Pointes: TV polimórfica en la que los complejos parecen girar en torno a la línea isoeléctrica ("trenzado"). Sin pulso es DESFIBRILABLE.',
  },
  asystole: {
    id: 'asystole',
    label: 'Asistolia',
    shortLabel: 'Asistolia',
    category: 'no-desfibrilable',
    wave: 'flat',
    shockable: false,
    hasPulse: false,
    defaultHR: 0,
    hrRange: [0, 0],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'Línea isoeléctrica, ausencia de actividad eléctrica organizada. RCP + adrenalina; nunca se desfibrila.',
    quizExplanation:
      'Asistolia: línea plana (isoeléctrica), sin actividad eléctrica. NO es desfibrilable — RCP continua + adrenalina cada 3-5 min. Confirmar el diagnóstico revisando cables/ganancia antes de asumirlo.',
  },
  pea: {
    id: 'pea',
    label: 'Actividad Eléctrica Sin Pulso (AESP)',
    shortLabel: 'AESP',
    category: 'no-desfibrilable',
    wave: 'narrow',
    shockable: false,
    hasPulse: false,
    defaultHR: 70,
    hrRange: [40, 100],
    spo2Range: null,
    respRange: [0, 0],
    desc: 'El monitor muestra un ritmo organizado (a veces casi normal) pero el paciente no tiene pulso palpable.',
    quizExplanation:
      'AESP: el ECG puede parecer organizado, incluso casi normal, pero NO hay pulso palpable ni signos de circulación. No es desfibrilable — RCP + adrenalina + buscar y tratar causas reversibles (4H/4T). Es la trampa clásica: "si tiene complejos en el monitor, tiene pulso" es FALSO.',
  },
  avblock3: {
    id: 'avblock3',
    label: 'Bloqueo AV Completo (3er grado)',
    shortLabel: 'BAV 3er grado',
    category: 'bradi',
    wave: 'block3',
    shockable: false,
    hasPulse: true,
    defaultHR: 34,
    hrRange: [25, 40],
    spo2Range: [88, 95],
    respRange: [10, 16],
    desc: 'Disociación completa entre ondas P (a su propio ritmo) y QRS de escape, lento y regular.',
    quizExplanation:
      'Bloqueo AV completo: las ondas P y los QRS "van cada uno por su lado" (disociación AV), QRS de escape lento y regular. Con pulso presente pero inestable: no se desfibrila, se trata con atropina/marcapasos transcutáneo urgente.',
  },
};

export const RHYTHM_ORDER = [
  'sinus_normal',
  'sinus_brady',
  'sinus_tachy',
  'afib',
  'aflutter',
  'avblock3',
  'vt_pulse',
  'vt_pulseless',
  'vfib_coarse',
  'vfib_fine',
  'torsades',
  'asystole',
  'pea',
];

export class RhythmEngine {
  constructor(rhythmId, seed = 12345) {
    this.rnd = mulberry32(seed);
    this.beatPhase = 0;
    this.respPhase = this.rnd();
    this.flutterCounter = 0;
    this.torsadesEnv = 0;
    this._lastNoise = 0;
    this._nextBeatJitter = 0;
    this.setRhythm(rhythmId);
  }

  setRhythm(id) {
    this.def = RHYTHMS[id] || RHYTHMS.sinus_normal;
    this.beatPhase = 0;
  }

  _noise() {
    // ruido blanco suavizado (media móvil de 2 muestras) para que el
    // artefacto se vea como temblor muscular, no como estática pura.
    const n = this.rnd() * 2 - 1;
    this._lastNoise = this._lastNoise * 0.55 + n * 0.45;
    return this._lastNoise;
  }

  /**
   * Avanza el motor un intervalo `dt` (segundos) — SIEMPRE el mismo dt que
   * gobierna el avance del puntero de barrido en pantalla. Devuelve la
   * muestra instantánea normalizada de ecg/pleth/resp.
   */
  advance(dt, hr, respRate, noiseLevel) {
    const def = this.def;
    const noiseAmt = Math.max(0, Math.min(1, noiseLevel / 100));

    this.respPhase = (this.respPhase + dt * (Math.max(respRate, 1) / 60)) % 1;
    const respRaw = Math.sin(2 * Math.PI * this.respPhase);
    let resp = Math.sign(respRaw) * Math.pow(Math.abs(respRaw), 0.75);

    let ecg = 0;
    let pleth = 0;
    let beatTrigger = false;

    switch (def.wave) {
      case 'sinus':
      case 'narrow':
      case 'afib':
      case 'aflutter':
      case 'block3':
      case 'wide':
      case 'torsades': {
        const effectiveHR = Math.max(hr, 1);
        const period = 60 / effectiveHR;
        this.beatPhase += dt / period;
        if (this.beatPhase >= 1) {
          this.beatPhase -= 1;
          this.flutterCounter += 1;
          beatTrigger = true;
        }

        if (def.wave === 'sinus') {
          ecg = sinusBeatShape(this.beatPhase);
        } else if (def.wave === 'narrow') {
          ecg = narrowNoPShape(this.beatPhase);
        } else if (def.wave === 'block3') {
          // QRS de escape (estrecho-moderado) + ondas P disociadas a un
          // ritmo auricular propio, más rápido e independiente del QRS.
          ecg = narrowNoPShape(this.beatPhase);
          const pAtrialPhase = (this.beatPhase * 2.7 + 0.15) % 1;
          ecg += 0.15 * gauss(pAtrialPhase, 0.15, 0.02);
        } else if (def.wave === 'afib') {
          ecg = narrowNoPShape(this.beatPhase);
        } else if (def.wave === 'aflutter') {
          ecg = flutterBeatShape(this.beatPhase);
        } else if (def.wave === 'wide') {
          ecg = wideBeatShape(this.beatPhase);
        } else if (def.wave === 'torsades') {
          this.torsadesEnv = (this.torsadesEnv + dt * 0.6) % 1;
          const envelope = 0.35 + 0.65 * Math.abs(Math.sin(2 * Math.PI * this.torsadesEnv));
          ecg = wideBeatShape(this.beatPhase) * envelope;
        }

        const plethPhase = (this.beatPhase + 0.88) % 1;
        pleth = def.hasPulse ? plethShape(plethPhase) : 0;
        break;
      }

      case 'chaotic-coarse':
      case 'chaotic-fine': {
        this.beatPhase = (this.beatPhase + dt * 5.2) % 1000;
        const t = this.beatPhase;
        const amp = def.wave === 'chaotic-coarse' ? 1.0 : 0.32;
        ecg =
          amp *
          (0.55 * Math.sin(2 * Math.PI * 4.1 * t + Math.sin(t * 3.3) * 2) +
            0.35 * Math.sin(2 * Math.PI * 7.3 * t + Math.cos(t * 2.1) * 3) +
            0.3 * this._noise());
        pleth = 0;
        break;
      }

      case 'flat':
      default: {
        ecg = 0;
        pleth = 0;
        break;
      }
    }

    // Línea de base fibrilatoria/flutter entre latidos (aparte de los QRS).
    if (def.wave === 'afib') {
      ecg += 0.09 * (0.6 * Math.sin(2 * Math.PI * 7.2 * (this.beatPhase + this.flutterCounter)) + 0.4 * this._noise());
    }
    if (def.wave === 'aflutter') {
      ecg += 0.14 * Math.sign(Math.sin(2 * Math.PI * 4 * this.beatPhase + 1)) * 0.5;
    }

    // Artefacto / ruido muscular (afecta también a asistolia: una asistolia
    // "perfecta" sin ningún ruido resulta poco realista y poco didáctica).
    ecg += this._noise() * (0.035 + noiseAmt * 0.4);
    pleth += this._noise() * noiseAmt * 0.05 * (def.hasPulse ? 1 : 2.5);
    resp *= 0.9 + noiseAmt * 0.1;
    resp += this._noise() * noiseAmt * 0.04;

    return { ecg, pleth, resp, beatTrigger };
  }
}
