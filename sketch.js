let dragging = false;
let startX = 0, startY = 0;
let endX = 0, endY = 0;
let currentTile = 30; // default tile size (can be changed by UI)

let displayText = 'Drag!';
let textInput;
let sizeSlider;
let rotationSlider;
let colorPicker;
let tilePresetWrap;
let dividerLineDotted;
let lineMode = 'line';
let textOutlineEnabled = true;
let fontMode = 'garamond';
let selectedFont = 'Garamond';
let patternMode = 'checker';
let currentPatternRotationDeg = 0;
let currentPatternColor = '#000000';

// Left UI (control bar) occupies part of the canvas visually.
// We shift the text center by half of that width to keep the composition balanced.
let leftUiInsetPx = 0;
let uiPanel;
const UI_DESIGN_HEIGHT = 950;

function updateUiScale() {
  if (!uiPanel) return;
  const s = Math.min(1, windowHeight / UI_DESIGN_HEIGHT);
  uiPanel.style('transform', 'scale(' + s + ')');
}

function updateLeftUiInset() {
  // UI design: divider line starts at x=22, width=233px → right edge at 255px
  // Multiply by the current scale so it always matches the visual position.
  const UI_DESIGN_INSET = 22 + 233; // 255px in design space
  const s = Math.min(1, windowHeight / UI_DESIGN_HEIGHT);
  leftUiInsetPx = UI_DESIGN_INSET * s;
}

function getBalancedCenterX(canvasW) {
  const w = typeof canvasW === 'number' ? canvasW : width;
  const inset = Number(leftUiInsetPx) || 0;
  // Center exactly between the UI right edge and the canvas right edge
  return inset + (w - inset) / 2;
}

let targetDensity = 1;

// performance caches
let patternLayer;
let patternLayerBack;
let maskPixels = null;
let maskW = 0;
let maskH = 0;
let maskD = 1;
let maskWPx = 0;
let maskHPx = 0;
let rerenderTimer = null;
let rerenderToken = 0;

const PRESET_SIZES = [50, 40, 30, 20, 10, 5];
const presetButtons = new Map();

function setActivePresetButton(size) {
  for (const [s, btn] of presetButtons.entries()) {
    if (s === size) {
      btn.style('background', '#000');
      btn.style('color', '#fff');
    } else {
      btn.style('background', '#fff');
      btn.style('color', '#000');
    }
  }
}

function createPatternLayer() {
  patternLayer = createGraphics(windowWidth, windowHeight);
  patternLayer.pixelDensity(targetDensity);
  patternLayer.clear();

  patternLayerBack = createGraphics(windowWidth, windowHeight);
  patternLayerBack.pixelDensity(targetDensity);
  patternLayerBack.clear();
}

function updateMaskPixels() {
  if (!maskG) return;
  maskG.loadPixels();
  maskPixels = maskG.pixels;
  maskW = maskG.width;
  maskH = maskG.height;
  maskD = maskG.pixelDensity();
  maskWPx = Math.floor(maskW * maskD);
  maskHPx = Math.floor(maskH * maskD);
}

function insideMask(x, y) {
  if (!maskPixels) return false;
  const sx = Math.round(Number(x) * maskD);
  const sy = Math.round(Number(y) * maskD);
  if (sx < 0 || sy < 0 || sx >= maskWPx || sy >= maskHPx) return false;
  const idx = 4 * (sy * maskWPx + sx);
  return maskPixels[idx] > 127;
}

function scheduleRerenderAllRects(delayMs = 80) {
  if (rerenderTimer) clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    rerenderAllRects();
  }, delayMs);
}

function renderRectToLayer(r) {
  if (!patternLayer || !r) return;
  drawPattern(
    patternLayer,
    r.x,
    r.y,
    r.w,
    r.h,
    r.tile || currentTile,
    r.rotDeg || 0,
    r.patternMode || 'checker',
    r.fg || '#000000'
  );
}

function rerenderAllRects() {
  if (!patternLayer) return;

  const token = ++rerenderToken;
  const nextLayer = patternLayerBack;
  if (!nextLayer) return;
  nextLayer.clear();

  // Chunk rendering so UI doesn't freeze with many stacked rectangles.
  let idx = 0;
  const step = () => {
    if (token !== rerenderToken) return; // cancelled by a newer rerender request

    const start = performance.now();
    while (idx < rects.length && (performance.now() - start) < 8) {
      const r = rects[idx++];
      drawPattern(
        nextLayer,
        r.x,
        r.y,
        r.w,
        r.h,
        r.tile || currentTile,
        r.rotDeg || 0,
        r.patternMode || 'checker',
        r.fg || '#000000'
      );
    }

    if (idx < rects.length) {
      requestAnimationFrame(step);
    } else {
      if (token !== rerenderToken) return;
      // swap front/back buffers
      patternLayerBack = patternLayer;
      patternLayer = nextLayer;
      if (!isLooping()) redraw();
    }
  };

  requestAnimationFrame(step);
}

function tPush(g) { if (g) g.push(); else push(); }
function tPop(g) { if (g) g.pop(); else pop(); }
function tNoFill(g) { if (g) g.noFill(); else noFill(); }
function tFill(g, v) { if (g) g.fill(v); else fill(v); }
function tStroke(g, v) { if (g) g.stroke(v); else stroke(v); }
function tNoStroke(g) { if (g) g.noStroke(); else noStroke(); }
function tStrokeWeight(g, v) { if (g) g.strokeWeight(v); else strokeWeight(v); }
function tRect(g, x, y, w, h) { if (g) g.rect(x, y, w, h); else rect(x, y, w, h); }
function tLine(g, x1, y1, x2, y2) { if (g) g.line(x1, y1, x2, y2); else line(x1, y1, x2, y2); }

function drawPattern(
  g,
  x,
  y,
  w,
  h,
  tile,
  rotationDeg = currentPatternRotationDeg,
  mode = patternMode,
  fg = currentPatternColor
) {
  tile = tile || currentTile;
  x = Math.floor(x);
  y = Math.floor(y);
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));

  // clamp work to canvas bounds (saves a lot when dragging outside)
  const maxW = g ? g.width : width;
  const maxH = g ? g.height : height;
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(maxW, x + w);
  const y1 = Math.min(maxH, y + h);
  if (x1 <= x0 || y1 <= y0) return;

  const isGrid = mode === 'grid';
  const isLine = mode === 'line';
  const angle = (rotationDeg || 0) * Math.PI / 180;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cxRect = x + w / 2;
  const cyRect = y + h / 2;

  // Clip to the dragged rectangle so rotated tiles don't spill out.
  const ctx = g ? g.drawingContext : drawingContext;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();

  tPush(g);
  if (angle !== 0) {
    if (g) {
      g.translate(cxRect, cyRect);
      g.rotate(angle);
      g.translate(-cxRect, -cyRect);
    } else {
      translate(cxRect, cyRect);
      rotate(angle);
      translate(-cxRect, -cyRect);
    }
  }

  let loopX0 = x0;
  let loopY0 = y0;
  let loopX1 = x1;
  let loopY1 = y1;
  if (angle !== 0) {
    const radius = Math.sqrt(w * w + h * h) / 2;
    loopX0 = Math.max(0, Math.floor(cxRect - radius));
    loopY0 = Math.max(0, Math.floor(cyRect - radius));
    loopX1 = Math.min(maxW, Math.ceil(cxRect + radius));
    loopY1 = Math.min(maxH, Math.ceil(cyRect + radius));
  }

  if (isGrid || isLine) {
    // Both modes should cover underlying patterns with white.
    // Grid: white fill + black stroke rect.
    // Line: white fill per tile + black horizontal line only.

    // pass 1: fill white tiles
    tNoStroke(g);
    tFill(g, 255);
    for (let ix = loopX0; ix < loopX1; ix += tile) {
      for (let iy = loopY0; iy < loopY1; iy += tile) {
        const px = ix + tile / 2;
        const py = iy + tile / 2;
        let mx = px;
        let my = py;
        if (angle !== 0) {
          const dx = px - cxRect;
          const dy = py - cyRect;
          mx = cxRect + dx * cosA - dy * sinA;
          my = cyRect + dx * sinA + dy * cosA;
        }
        if (insideMask(mx, my)) {
          tRect(g, ix, iy, tile, tile);
        }
      }
    }

    // pass 2: strokes
    tNoFill(g);
    tStroke(g, fg);
    tStrokeWeight(g, 1);
    for (let ix = loopX0; ix < loopX1; ix += tile) {
      for (let iy = loopY0; iy < loopY1; iy += tile) {
        const px = ix + tile / 2;
        const py = iy + tile / 2;
        let mx = px;
        let my = py;
        if (angle !== 0) {
          const dx = px - cxRect;
          const dy = py - cyRect;
          mx = cxRect + dx * cosA - dy * sinA;
          my = cyRect + dx * sinA + dy * cosA;
        }

        if (!insideMask(mx, my)) continue;
        if (isGrid) {
          tRect(g, ix, iy, tile, tile);
        } else {
          // horizontal-only line at the top edge of each tile
          tLine(g, ix, iy, ix + tile, iy);
        }
      }
    }

    tPop(g);
    ctx.restore();
    return;
  }

  // checker: draw BOTH white + black tiles so gaps don't show through
  tNoStroke(g);
  // pass 1: white tiles
  tFill(g, 255);
  for (let ix = loopX0; ix < loopX1; ix += tile) {
    for (let iy = loopY0; iy < loopY1; iy += tile) {
      const i = ((ix - x) / tile) | 0;
      const j = ((iy - y) / tile) | 0;
      if (((i + j) & 1) === 1) {
        const px = ix + tile / 2;
        const py = iy + tile / 2;
        let mx = px;
        let my = py;
        if (angle !== 0) {
          const dx = px - cxRect;
          const dy = py - cyRect;
          mx = cxRect + dx * cosA - dy * sinA;
          my = cyRect + dx * sinA + dy * cosA;
        }
        if (insideMask(mx, my)) {
          tRect(g, ix, iy, tile, tile);
        }
      }
    }
  }

  // pass 2: black tiles
  tFill(g, fg);
  for (let ix = loopX0; ix < loopX1; ix += tile) {
    for (let iy = loopY0; iy < loopY1; iy += tile) {
      const i = ((ix - x) / tile) | 0;
      const j = ((iy - y) / tile) | 0;
      if (((i + j) & 1) === 0) {
        const px = ix + tile / 2;
        const py = iy + tile / 2;
        let mx = px;
        let my = py;
        if (angle !== 0) {
          const dx = px - cxRect;
          const dy = py - cyRect;
          mx = cxRect + dx * cosA - dy * sinA;
          my = cyRect + dx * sinA + dy * cosA;
        }
        if (insideMask(mx, my)) {
          tRect(g, ix, iy, tile, tile);
        }
      }
    }
  }
  tPop(g);
  ctx.restore();
}




// store persisted checkerboard rectangles
const rects = [];
let maskG;

function setup() {
  createCanvas(windowWidth, windowHeight);
  targetDensity = displayDensity();
  pixelDensity(targetDensity);
  smooth();
  noStroke();
  // create mask graphics and draw the text shape into it
  maskG = createGraphics(windowWidth, windowHeight);
  maskG.pixelDensity(targetDensity);

  // offscreen layer that holds ALL persisted rectangles
  createPatternLayer();

  // Create a wrapper for all UI elements so the layout scales on small screens
  uiPanel = createDiv('');
  uiPanel.id('uiPanel');
  uiPanel.style('position', 'fixed');
  uiPanel.style('top', '0');
  uiPanel.style('left', '0');
  uiPanel.style('transform-origin', 'top left');
  uiPanel.style('z-index', '1000');
  uiPanel.style('pointer-events', 'none');

  // 설명글 추가
  let descriptionText = createP('This work approaches letterforms through the logic of the grid, observing how they shift when gaps appear or individual parts take on different shapes. It experiments with recombining these fragments to question where a letter ends and a graphic begins.');
  descriptionText.position(25, 655);
  descriptionText.style('width', '233px');
  descriptionText.style('margin', '0');
  descriptionText.style('font-family', "'Courier New', Courier, monospace");
  descriptionText.style('font-size', '13.5px');
  descriptionText.style('font-weight', '400');
  descriptionText.style('color', '#000');
  descriptionText.style('line-height', '1.4');

  // 점선
  dividerLineDotted = createDiv('');
  dividerLineDotted.position(22, 630);
  dividerLineDotted.style('width', '233px');
  dividerLineDotted.style('border-top', '2px dotted #000');
  dividerLineDotted.style('z-index', '1000');

    dividerLineDotted = createDiv('');
  dividerLineDotted.position(22, 860);
  dividerLineDotted.style('width', '233px');
  dividerLineDotted.style('border-top', '2px dotted #000');
  dividerLineDotted.style('z-index', '1000');

  // Save 버튼 (Reset 버튼과 동일한 외형)
  const saveButton = createDiv('Save');
  saveButton.position(20, 890);
  saveButton.style('width', '233px');
  saveButton.style('height', '28px');
  saveButton.style('display', 'flex');
  saveButton.style('align-items', 'center');
  saveButton.style('justify-content', 'center');
  saveButton.style('border', '2px solid #000');
  saveButton.style('border-radius', '20px');
  saveButton.style('font-family', "'Courier New', Courier, monospace");
  saveButton.style('font-size', '14px');
  saveButton.style('font-weight', '400');
  saveButton.style('transition', 'all 0.3s');
  saveButton.style('background-color', '#000000');
  saveButton.style('color', '#ffffff');
  saveButton.style('cursor', 'pointer');
  saveButton.style('z-index', '1000');
  saveButton.mousePressed(() => {
    const filename = 'grid_' + Date.now();
    saveCanvas(filename, 'png');
  });

  // 텍스트 입력 박스 (점선 가로크기와 동일)
  textInput = createElement('textarea', displayText);
  textInput.position(20, 20);
  textInput.style('width', '233px');
  textInput.style('height', '85px');
  textInput.style('box-sizing', 'border-box');
  textInput.style('margin', '0');
  textInput.style('font-family', "'Courier New', Courier, monospace");
  textInput.style('font-size', '15.5px');
  textInput.style('font-weight', '400');
  textInput.style('color', '#000');
  textInput.style('border', '1px solid #000');
  textInput.style('outline', 'none');
  textInput.style('resize', 'none');
  textInput.style('z-index', '1000');
  textInput.input(() => {
    const v = (textInput.value() || '').trim();
    displayText = v.length ? v : 'T';
    createMask();
  });

  // After UI is mounted, measure its inset so we can balance the center.
  updateLeftUiInset();

  // 슬라이더 라벨들 추가
  let sizeLabel = createP('Font Size');
  sizeLabel.position(20, 135);
  sizeLabel.style('margin', '0');
  sizeLabel.style('font-family', "'Courier New', Courier, monospace");
  sizeLabel.style('font-size', '16px');
  sizeLabel.style('font-weight', '400');
  sizeLabel.style('color', '#000');

  // 텍스트 크기 슬라이더 생성
  sizeSlider = createSlider(10, 1500, 400, 10);
  sizeSlider.elt.id = 'sizeSlider';
  sizeSlider.position(20, 160);
  sizeSlider.size(230);
  sizeSlider.style('width', '230px');
  sizeSlider.input(() => {
    createMask();
  });

  // Pattern Rotation label + slider
  const rotationLabel = createP('Pattern Rotation');
  rotationLabel.position(20, 180);
  rotationLabel.style('margin', '0');
  rotationLabel.style('font-family', "'Courier New', Courier, monospace");
  rotationLabel.style('font-size', '16px');
  rotationLabel.style('font-weight', '400');
  rotationLabel.style('color', '#000');

  rotationSlider = createSlider(-180, 180, 0, 1);
  rotationSlider.elt.id = 'rotationSlider';
  rotationSlider.position(20, 205);
  rotationSlider.size(230);
  rotationSlider.style('width', '230px');
  rotationSlider.input(() => {
    currentPatternRotationDeg = Number(rotationSlider.value()) || 0;
    // Only affects new / preview patterns; existing baked layer stays as-is.
    if (!isLooping()) redraw();
  });

  let graphicLabel = createP('Pattern Scale');
  graphicLabel.position(20, 232);
  graphicLabel.style('margin', '0');
  graphicLabel.style('font-family', "'Courier New', Courier, monospace");
  graphicLabel.style('font-size', '16px');
  graphicLabel.style('font-weight', '400');
  graphicLabel.style('color', '#000');

  // 타일 크기 프리셋 버튼 (3개씩 2줄)
  tilePresetWrap = createDiv('');
  tilePresetWrap.position(20, 258);
  tilePresetWrap.style('width', '237px');
  tilePresetWrap.style('display', 'grid');
  tilePresetWrap.style('grid-template-columns', 'repeat(3, 1fr)');
  tilePresetWrap.style('gap', '5px');
  tilePresetWrap.style('z-index', '1000');

  presetButtons.clear();
  for (const s of PRESET_SIZES) {
    const b = createButton(`${s} px`);
    b.parent(tilePresetWrap);
    b.style('width', '100%');
    b.style('height', '26px');
    b.style('padding', '0');
    b.style('margin', '0');
    b.style('border', '2px solid #000');
    b.style('border-radius', '13px');
    b.style('background', '#fff');
    b.style('color', '#000');
    b.style('font-family', "'Courier New', Courier, monospace");
    b.style('font-size', '13px');
    b.style('cursor', 'pointer');
    b.mousePressed(() => {
      currentTile = s;
      setActivePresetButton(s);
    });

    presetButtons.set(s, b);
  }

  // initial preset state
  setActivePresetButton(currentTile);

  // Pattern 라벨 + 버튼 (3개)
  let patternLabel = createP('Pattern');
  patternLabel.position(20, 327);
  patternLabel.style('margin', '0');
  patternLabel.style('font-family', "'Courier New', Courier, monospace");
  patternLabel.style('font-size', '16px');
  patternLabel.style('font-weight', '400');
  patternLabel.style('color', '#000');

  const patternToggleContainer = createDiv('');
  patternToggleContainer.position(20, 352);
  patternToggleContainer.style('width', '233px');
  patternToggleContainer.style('height', '28px');
  patternToggleContainer.style('display', 'flex');
  patternToggleContainer.style('border', '2px solid #000');
  patternToggleContainer.style('border-radius', '20px');
  patternToggleContainer.style('overflow', 'hidden');
  patternToggleContainer.style('z-index', '1000');

  const checkerButton = createDiv('Checker');
  checkerButton.parent(patternToggleContainer);
  checkerButton.style('flex', '1');
  checkerButton.style('display', 'flex');
  checkerButton.style('align-items', 'center');
  checkerButton.style('justify-content', 'center');
  checkerButton.style('font-family', "'Courier New', Courier, monospace");
  checkerButton.style('font-size', '14px');
  checkerButton.style('font-weight', '400');
  checkerButton.style('transition', 'all 0.3s');
  checkerButton.style('cursor', 'pointer');
  checkerButton.style('border-right', '2px solid #000');

  const gridButton = createDiv('Grid');
  gridButton.parent(patternToggleContainer);
  gridButton.style('flex', '1');
  gridButton.style('display', 'flex');
  gridButton.style('align-items', 'center');
  gridButton.style('justify-content', 'center');
  gridButton.style('font-family', "'Courier New', Courier, monospace");
  gridButton.style('font-size', '14px');
  gridButton.style('font-weight', '400');
  gridButton.style('transition', 'all 0.3s');
  gridButton.style('cursor', 'pointer');
  gridButton.style('border-right', '2px solid #000');

  const linePatternButton = createDiv('Line');
  linePatternButton.parent(patternToggleContainer);
  linePatternButton.style('flex', '1');
  linePatternButton.style('display', 'flex');
  linePatternButton.style('align-items', 'center');
  linePatternButton.style('justify-content', 'center');
  linePatternButton.style('font-family', "'Courier New', Courier, monospace");
  linePatternButton.style('font-size', '14px');
  linePatternButton.style('font-weight', '400');
  linePatternButton.style('transition', 'all 0.3s');
  linePatternButton.style('cursor', 'pointer');

  function setPatternToggle(mode) {
    patternMode = mode;
    const activeBg = '#000000';
    const activeFg = '#ffffff';
    const idleBg = '#ffffff';
    const idleFg = '#000000';

    checkerButton.style('background-color', mode === 'checker' ? activeBg : idleBg);
    checkerButton.style('color', mode === 'checker' ? activeFg : idleFg);

    gridButton.style('background-color', mode === 'grid' ? activeBg : idleBg);
    gridButton.style('color', mode === 'grid' ? activeFg : idleFg);

    linePatternButton.style('background-color', mode === 'line' ? activeBg : idleBg);
    linePatternButton.style('color', mode === 'line' ? activeFg : idleFg);

    // Apply from newly-added patterns only (no rerender of existing baked layer)
    if (!isLooping()) redraw();
  }

  checkerButton.mousePressed(() => setPatternToggle('checker'));
  gridButton.mousePressed(() => setPatternToggle('grid'));
  linePatternButton.mousePressed(() => setPatternToggle('line'));
  setPatternToggle(patternMode);

  // Color label + picker
  const colorLabel = createP('Color');
  colorLabel.position(20, 395);
  colorLabel.style('margin', '0');
  colorLabel.style('font-family', "'Courier New', Courier, monospace");
  colorLabel.style('font-size', '16px');
  colorLabel.style('font-weight', '400');
  colorLabel.style('color', '#000');

  const colorWrap = createDiv('');
  colorWrap.position(20, 419);
  colorWrap.style('width', '233px');
  colorWrap.style('height', '28px');
  colorWrap.style('display', 'flex');
  colorWrap.style('align-items', 'center');
  colorWrap.style('border', '2px solid #000');
  colorWrap.style('border-radius', '20px');
  colorWrap.style('overflow', 'hidden');
  colorWrap.style('background', '#fff');
  colorWrap.style('z-index', '1000');

  colorPicker = createColorPicker(currentPatternColor);
  colorPicker.elt.id = 'patternColorPicker';
  colorPicker.parent(colorWrap);
  colorPicker.style('width', '100%');
  colorPicker.style('height', '28px');
  colorPicker.style('border', 'none');
  colorPicker.style('padding', '0');
  colorPicker.style('margin', '0');
  colorPicker.style('background', 'transparent');
  colorPicker.style('border-radius', '20px');
  colorPicker.style('cursor', 'pointer');
  colorPicker.input(() => {
    currentPatternColor = colorPicker.value();
    // Apply from newly-added patterns only
    if (!isLooping()) redraw();
  });

  // Other label
  const otherLabel = createP('Other');
  otherLabel.position(20, 460);
  otherLabel.style('margin', '0');
  otherLabel.style('font-family', "'Courier New', Courier, monospace");
  otherLabel.style('font-size', '16px');
  otherLabel.style('font-weight', '400');
  otherLabel.style('color', '#000');

  // Appearance 토글 버튼
  const toggleContainer = createDiv('');
  toggleContainer.position(20, 484);
  toggleContainer.style('width', '233px');
  toggleContainer.style('height', '28px');
  toggleContainer.style('display', 'flex');
  toggleContainer.style('border', '2px solid #000');
  toggleContainer.style('border-radius', '20px');
  toggleContainer.style('overflow', 'hidden');
  toggleContainer.style('z-index', '1000');

  const lineButton = createDiv('Outline');
  lineButton.parent(toggleContainer);
  lineButton.style('flex', '1');
  lineButton.style('display', 'flex');
  lineButton.style('align-items', 'center');
  lineButton.style('justify-content', 'center');
  lineButton.style('font-family', "'Courier New', Courier, monospace");
  lineButton.style('font-size', '14px');
  lineButton.style('font-weight', '400');
  lineButton.style('transition', 'all 0.3s');
  lineButton.style('cursor', 'pointer');

  const line2Button = createDiv('No Outline');
  line2Button.parent(toggleContainer);
  line2Button.style('flex', '1');
  line2Button.style('display', 'flex');
  line2Button.style('align-items', 'center');
  line2Button.style('justify-content', 'center');
  line2Button.style('font-family', "'Courier New', Courier, monospace");
  line2Button.style('font-size', '14px');
  line2Button.style('font-weight', '400');
  line2Button.style('transition', 'all 0.3s');
  line2Button.style('cursor', 'pointer');

  function setLineToggle(mode) {
    lineMode = mode;
    if (mode === 'line') {
      textOutlineEnabled = true;
      lineButton.style('background-color', '#000000');
      lineButton.style('color', '#ffffff');
      line2Button.style('background-color', '#ffffff');
      line2Button.style('color', '#000000');
    } else {
      textOutlineEnabled = false;
      lineButton.style('background-color', '#ffffff');
      lineButton.style('color', '#000000');
      line2Button.style('background-color', '#000000');
      line2Button.style('color', '#ffffff');
    }

    // outline only affects the center text
    if (!isLooping()) redraw();
  }

  lineButton.mousePressed(() => setLineToggle('line'));
  line2Button.mousePressed(() => setLineToggle('line2'));
  setLineToggle(lineMode);

  // Font 토글 버튼
  const fontToggleContainer = createDiv('');
  fontToggleContainer.position(20, 523);
  fontToggleContainer.style('width', '233px');
  fontToggleContainer.style('height', '28px');
  fontToggleContainer.style('display', 'flex');
  fontToggleContainer.style('border', '2px solid #000');
  fontToggleContainer.style('border-radius', '20px');
  fontToggleContainer.style('overflow', 'hidden');
  fontToggleContainer.style('z-index', '1000');

  const garamondButton = createDiv('Garamond');
  garamondButton.parent(fontToggleContainer);
  garamondButton.style('flex', '1');
  garamondButton.style('display', 'flex');
  garamondButton.style('align-items', 'center');
  garamondButton.style('justify-content', 'center');
  garamondButton.style('font-family', "'Courier New', Courier, monospace");
  garamondButton.style('font-size', '14px');
  garamondButton.style('font-weight', '400');
  garamondButton.style('transition', 'all 0.3s');
  garamondButton.style('cursor', 'pointer');

  const helveticaButton = createDiv('Helvetica');
  helveticaButton.parent(fontToggleContainer);
  helveticaButton.style('flex', '1');
  helveticaButton.style('display', 'flex');
  helveticaButton.style('align-items', 'center');
  helveticaButton.style('justify-content', 'center');
  helveticaButton.style('font-family', "'Courier New', Courier, monospace");
  helveticaButton.style('font-size', '14px');
  helveticaButton.style('font-weight', '400');
  helveticaButton.style('transition', 'all 0.3s');
  helveticaButton.style('cursor', 'pointer');

  function setFontToggle(mode) {
    fontMode = mode;
    if (mode === 'helvetica') {
      selectedFont = 'Helvetica';
      helveticaButton.style('background-color', '#000000');
      helveticaButton.style('color', '#ffffff');
      garamondButton.style('background-color', '#ffffff');
      garamondButton.style('color', '#000000');
    } else {
      selectedFont = 'Garamond';
      helveticaButton.style('background-color', '#ffffff');
      helveticaButton.style('color', '#000000');
      garamondButton.style('background-color', '#000000');
      garamondButton.style('color', '#ffffff');
    }
    createMask();
  }

  helveticaButton.mousePressed(() => setFontToggle('helvetica'));
  garamondButton.mousePressed(() => setFontToggle('garamond'));
  setFontToggle(fontMode);

  // Reset 버튼 (Font 토글과 같은 가로길이/형태)
  const resetButton = createDiv('Reset');
  resetButton.position(20, 572);
  resetButton.style('width', '233px');
  resetButton.style('height', '28px');
  resetButton.style('display', 'flex');
  resetButton.style('align-items', 'center');
  resetButton.style('justify-content', 'center');
  resetButton.style('border', '2px solid #000');
  resetButton.style('border-radius', '20px');
  resetButton.style('font-family', "'Courier New', Courier, monospace");
  resetButton.style('font-size', '14px');
  resetButton.style('font-weight', '400');
  resetButton.style('transition', 'all 0.3s');
  resetButton.style('background-color', '#000000');
  resetButton.style('color', '#ffffff');
  resetButton.style('cursor', 'pointer');
  resetButton.style('z-index', '1000');
  resetButton.mousePressed(() => {
    rects.length = 0;

    if (patternLayer) patternLayer.clear();
    if (patternLayerBack) patternLayerBack.clear();

    currentTile = 30;
    setActivePresetButton(currentTile);

    if (sizeSlider) sizeSlider.value(400);

    currentPatternRotationDeg = 0;
    if (rotationSlider) rotationSlider.value(0);

    currentPatternColor = '#000000';
    if (colorPicker) colorPicker.value(currentPatternColor);

    displayText = 'Drag!';
    if (textInput) textInput.value(displayText);

    setPatternToggle('checker');
    setLineToggle('line');
    setFontToggle('garamond');
    createMask(true);
  });

  // 슬라이더 커스텀 스타일 추가
  const style = document.createElement('style');
  style.textContent = `
    /* 슬라이더 트랙 - 검은색 / 둥글고 굵게 */
    #sizeSlider, #rotationSlider {
      -webkit-appearance: none;
      appearance: none;
      background: #000000;
      outline: none;
      height: 6px;
      border-radius: 3px;
    }

    /* WebKit (Chrome/Safari) thumb */
    #sizeSlider::-webkit-slider-thumb, #rotationSlider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13.5px;
      height: 13.5px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid #000000;
      cursor: pointer;
    }

    /* Firefox thumb */
    #sizeSlider::-moz-range-thumb, #rotationSlider::-moz-range-thumb {
      width: 13.5px;
      height: 13.5px;
      border-radius: 50%;
      background: #ffffff;
      border: 2px solid #000000;
      cursor: pointer;
    }

    /* Firefox track */
    #sizeSlider::-moz-range-track, #rotationSlider::-moz-range-track {
      background: #000000;
      height: 6px;
      border-radius: 3px;
    }

    /* Color picker rounding */
    #patternColorPicker {
      -webkit-appearance: none;
      appearance: none;
      border: none;
      padding: 0;
      background: transparent;
      border-radius: 20px;
      overflow: hidden;
    }

    #patternColorPicker::-webkit-color-swatch-wrapper {
      padding: 0;
    }

    #patternColorPicker::-webkit-color-swatch {
      border: none;
      border-radius: 20px;
    }

    #patternColorPicker::-moz-color-swatch {
      border: none;
      border-radius: 20px;
    }

    /* Allow clicks through the panel wrapper but keep children interactive */
    #uiPanel * { pointer-events: auto; }
  `;
  document.head.appendChild(style);

  // Move all non-canvas UI elements into the scaled panel wrapper
  const bodyChildren = [...document.body.children];
  for (const child of bodyChildren) {
    if (child.tagName === 'CANVAS' || child.tagName === 'SCRIPT' || child === uiPanel.elt) continue;
    uiPanel.elt.appendChild(child);
  }
  updateUiScale();
  updateLeftUiInset();

  // initial mask after UI is ready
  createMask(true);

  // draw only when something changes (massive perf win)
  noLoop();
  redraw();
}

function drawChecker(x, y, w, h, tile) {
  // kept for compatibility with existing calls
  drawPattern(null, x, y, w, h, tile);
}

function mousePressed() {
  dragging = true;
  startX = mouseX;
  startY = mouseY;
  endX = mouseX;
  endY = mouseY;

  // enable continuous draw only while dragging
  loop();
}

function mouseDragged() {
  if (dragging) {
    endX = mouseX;
    endY = mouseY;
  }
}

function mouseReleased() {
  if (dragging) {
    const rx = Math.min(startX, endX);
    const ry = Math.min(startY, endY);
    const rw = Math.abs(endX - startX);
    const rh = Math.abs(endY - startY);

    // store the rectangle so it persists
    const r = {
      x: rx,
      y: ry,
      w: rw,
      h: rh,
      tile: currentTile,
      rotDeg: currentPatternRotationDeg,
      patternMode,
      fg: currentPatternColor,
    };
    rects.push(r);
    // render once onto offscreen layer (no per-frame cost)
    renderRectToLayer(r);
  }
  dragging = false;

  // stop the draw loop when idle
  noLoop();
  redraw();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  // recreate mask on resize
  maskG = createGraphics(windowWidth, windowHeight);
  maskG.pixelDensity(targetDensity);
  createPatternLayer();
  createMask(true);
  updateUiScale();       // apply scale transform first
  updateLeftUiInset();   // then measure actual visual right edge
  redraw();
}

function createMask(immediate = false) {
  if (!maskG) return;
  const textSizeValue = sizeSlider ? Number(sizeSlider.value()) : 500;
  maskG.background(0);
  maskG.noStroke();
  maskG.fill(255);
  // use serif bold for mask so shape matches the visible text
  maskG.textFont(selectedFont);
  maskG.textStyle(BOLD);
  maskG.textSize(textSizeValue);
  maskG.textAlign(CENTER, CENTER);
  maskG.text(displayText, getBalancedCenterX(maskG.width), maskG.height / 2);
  maskG.textStyle(NORMAL);

  updateMaskPixels();

  // mask changes affect ALL persisted rectangles
  if (immediate) {
    rerenderAllRects();
  } else {
    scheduleRerenderAllRects();
  }

  // even before patterns re-render, the center text should update
  if (!isLooping()) redraw();
}
function draw() {
  // full-window white background
  background(255);

  const textSizeValue = sizeSlider ? Number(sizeSlider.value()) : 500;

  // draw the big white text in the center
  push();
  if (textOutlineEnabled) {
    stroke(0);
    strokeWeight(1);
  } else {
    noStroke();
  }
  fill(255); // white
  // use serif bold for visible text so it matches mask
  textFont(selectedFont);
  textStyle(BOLD);
  textSize(textSizeValue);
  textAlign(CENTER, CENTER);
  text(displayText, getBalancedCenterX(width), height / 2);
  textStyle(NORMAL);
  pop();

  // draw persisted rectangles from offscreen layer (O(1))
  if (patternLayer) image(patternLayer, 0, 0);

  // draw preview while dragging
  if (dragging) {
    const rx = Math.min(startX, endX);
    const ry = Math.min(startY, endY);
    const rw = Math.abs(endX - startX);
    const rh = Math.abs(endY - startY);

    // preview pattern (only 1 rect => fast)
    drawPattern(null, rx, ry, rw, rh, currentTile, currentPatternRotationDeg, patternMode, currentPatternColor);



    // outline
    noFill();
    stroke(0);
    strokeWeight(1);
    rect(rx, ry, rw, rh);
    noStroke();
  }



}
