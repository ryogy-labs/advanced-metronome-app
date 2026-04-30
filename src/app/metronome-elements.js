// @ts-check

/**
 * @template {HTMLElement} T
 * @param {Document} doc
 * @param {string} id
 * @returns {T}
 */
function byId(doc, id) {
  return /** @type {T} */ (doc.getElementById(id));
}

/** @param {Document} [doc] */
export function getMetronomeElements(doc = document) {
  return {
    bpm: {
      display: byId(doc, 'bpmDisplay'),
      slider: /** @type {HTMLInputElement} */ (byId(doc, 'bpmSlider')),
      buttons: {
        minus10: byId(doc, 'bpmMinus10'),
        minus5: byId(doc, 'bpmMinus5'),
        minus1: byId(doc, 'bpmMinus1'),
        plus1: byId(doc, 'bpmPlus1'),
        plus5: byId(doc, 'bpmPlus5'),
        plus10: byId(doc, 'bpmPlus10'),
      },
    },
    beatRowEls: [byId(doc, 'beatRow'), byId(doc, 'beatRowSetlist'), byId(doc, 'beatRowLibrary')].filter(Boolean),
    muteBtnEls: [byId(doc, 'muteBtnMetro'), byId(doc, 'muteBtnSetlist'), byId(doc, 'muteBtnLibrary')].filter(Boolean),
    playBtn: byId(doc, 'playBtn'),
    tapBtn: byId(doc, 'tapBtn'),
    tsNumValEl: byId(doc, 'tsNumVal'),
    tsDenValEl: byId(doc, 'tsDenVal'),
    pageDotEls: doc.querySelectorAll('.page-dot'),
    timeSigButtons: {
      numUp: byId(doc, 'tsNumUp'),
      numDown: byId(doc, 'tsNumDn'),
      denUp: byId(doc, 'tsDenUp'),
      denDown: byId(doc, 'tsDenDn'),
    },
    volume: {
      masterSlider: /** @type {HTMLInputElement} */ (byId(doc, 'volMaster')),
      masterNum: /** @type {HTMLInputElement} */ (byId(doc, 'volMasterNum')),
      beat1Slider: /** @type {HTMLInputElement} */ (byId(doc, 'volBeat1')),
      beat1Num: /** @type {HTMLInputElement} */ (byId(doc, 'volBeat1Num')),
      quarterSlider: /** @type {HTMLInputElement} */ (byId(doc, 'volQuarter')),
      quarterNum: /** @type {HTMLInputElement} */ (byId(doc, 'volQuarterNum')),
      eighthSlider: /** @type {HTMLInputElement} */ (byId(doc, 'volEighth')),
      eighthNum: /** @type {HTMLInputElement} */ (byId(doc, 'volEighthNum')),
      sixteenthSlider: /** @type {HTMLInputElement} */ (byId(doc, 'volSixteenth')),
      sixteenthNum: /** @type {HTMLInputElement} */ (byId(doc, 'volSixteenthNum')),
    },
    swing: {
      amountSlider: /** @type {HTMLInputElement} */ (byId(doc, 'swingAmount')),
      amountNum: /** @type {HTMLInputElement} */ (byId(doc, 'swingAmountNum')),
      modeBtns: /** @type {HTMLElement[]} */ (Array.from(doc.querySelectorAll('[data-swing-mode]'))),
      presetBtns: /** @type {HTMLButtonElement[]} */ (Array.from(doc.querySelectorAll('[data-swing-preset]'))),
    },
    settings: {
      overlay: byId(doc, 'settingsOverlay'),
      openBtns: doc.querySelectorAll('.settings-btn'),
      closeBtn: byId(doc, 'settingsClose'),
      langJaBtn: byId(doc, 'langJa'),
      langEnBtn: byId(doc, 'langEn'),
      wakelockOnBtn: byId(doc, 'wakelockOnBtn'),
      wakelockOffBtn: byId(doc, 'wakelockOffBtn'),
      visualDelaySlider: /** @type {HTMLInputElement} */ (byId(doc, 'visualDelaySlider')),
      visualDelayNum: /** @type {HTMLInputElement} */ (byId(doc, 'visualDelayNum')),
      visualDelayCalibrateBtn: byId(doc, 'visualDelayCalibrateBtn'),
      visualDelayCalibrateStatus: byId(doc, 'visualDelayCalibrateStatus'),
      modeVerticalBtn: byId(doc, 'modeVertical'),
      modeHorizontalBtn: byId(doc, 'modeHorizontal'),
      squashOnBtn: byId(doc, 'squashOnBtn'),
      squashOffBtn: byId(doc, 'squashOffBtn'),
    },
  };
}
