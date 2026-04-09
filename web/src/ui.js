function format3(value) {
  return value.toFixed(3);
}

function format2(value) {
  return value.toFixed(2);
}

function setCanvasPixelRatio(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const displayWidth = canvas.clientWidth || canvas.width;
  const displayHeight = canvas.clientHeight || canvas.height;
  const targetWidth = Math.round(displayWidth * dpr);
  const targetHeight = Math.round(displayHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: displayWidth, height: displayHeight };
}

function drawArrow(ctx, fromX, fromY, toX, toY, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const head = 7;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - head * Math.cos(angle - 0.38), toY - head * Math.sin(angle - 0.38));
  ctx.lineTo(toX - head * Math.cos(angle + 0.38), toY - head * Math.sin(angle + 0.38));
  ctx.closePath();
  ctx.fill();
}

function drawTopDownInset(canvas, trace, frameIndex, theme, geometry) {
  const { ctx, width, height } = setCanvasPixelRatio(canvas);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#07131f";
  ctx.fillRect(0, 0, width, height);

  if (!trace || trace.steps <= 0) {
    ctx.fillStyle = "#aac4ce";
    ctx.font = "12px sans-serif";
    ctx.fillText("No trace loaded", 10, 20);
    return;
  }

  const i = Math.max(0, Math.min(frameIndex, trace.steps - 1));
  const cx = width * 0.5;
  const cy = height * 0.5;

  const holeRadiusM = geometry.holeRadiusM;
  const pegRadiusM = geometry.pegRadiusM;
  const maxOffsetM = Math.max(
    0.012,
    holeRadiusM * 1.35,
    trace.summary?.maxCenterErrorM ?? 0.012,
  );
  const usable = Math.min(width, height) * 0.4;
  const scale = usable / maxOffsetM;
  const toPx = (meters) => meters * scale;

  const x = trace.xM[i];
  const y = trace.yM[i];
  const px = cx + toPx(x);
  const py = cy - toPx(y);

  ctx.strokeStyle = "rgba(143,214,232,0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, toPx(holeRadiusM), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(143,214,232,0.25)";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.arc(cx, cy, toPx(geometry.clearanceM), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = theme.pathColor;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let k = 0; k <= i; k += 1) {
    const tx = cx + toPx(trace.xM[k]);
    const ty = cy - toPx(trace.yM[k]);
    if (k === 0) {
      ctx.moveTo(tx, ty);
    } else {
      ctx.lineTo(tx, ty);
    }
  }
  ctx.stroke();

  ctx.fillStyle = theme.pegFill;
  ctx.strokeStyle = theme.pegStroke;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py, toPx(pegRadiusM), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawArrow(ctx, px, py, cx, cy, theme.errorColor);

  if (trace.inContact[i] > 0) {
    const radial = Math.hypot(x, y);
    if (radial > 1e-9) {
      const nx = -x / radial;
      const ny = -y / radial;
      const startX = px + toPx(pegRadiusM * nx);
      const startY = py - toPx(pegRadiusM * ny);
      const endX = startX + toPx(0.0022 * nx);
      const endY = startY - toPx(0.0022 * ny);
      drawArrow(ctx, startX, startY, endX, endY, theme.normalColor);
    }
  }

  ctx.fillStyle = "#aac4ce";
  ctx.font = "11px sans-serif";
  const errMm = trace.centerErrorM[i] * 1000.0;
  ctx.fillText(`err: ${errMm.toFixed(2)} mm`, 8, height - 8);
}

export function createUI({ geometry, onPlayPause, onReset, onScrub, onControlsChange, onViewMode }) {
  const elements = {
    playPause: document.querySelector("#btn-play-pause"),
    reset: document.querySelector("#btn-reset"),
    stiffness: document.querySelector("#stiffness-scale"),
    damping: document.querySelector("#damping-scale"),
    noise: document.querySelector("#noise-std"),
    stiffnessValue: document.querySelector("#stiffness-scale-value"),
    dampingValue: document.querySelector("#damping-scale-value"),
    noiseValue: document.querySelector("#noise-std-value"),
    timeline: document.querySelector("#timeline"),
    timeLabel: document.querySelector("#time-label"),
    viewMode: document.querySelector("#view-mode"),
    insetLeft: document.querySelector("#topdown-left"),
    insetRight: document.querySelector("#topdown-right"),
    statusLeft: document.querySelector("#status-left"),
    statusRight: document.querySelector("#status-right"),
    stage: document.querySelector("#stage"),
    panelTagLeft: document.querySelector(".panel-tag-left"),
    panelTagRight: document.querySelector(".panel-tag-right"),
    divider: document.querySelector(".split-divider"),
    insetRightWrap: document.querySelector(".inset-right"),
  };

  let isScrubbing = false;
  let currentViewMode = "split";
  let lastStatusLeft = null;
  let lastStatusRight = null;

  function controlSnapshot() {
    return {
      stiffnessScale: Number.parseFloat(elements.stiffness.value),
      dampingScale: Number.parseFloat(elements.damping.value),
      noiseStdN: Number.parseFloat(elements.noise.value),
      viewMode: elements.viewMode.value,
    };
  }

  function refreshValueLabels() {
    const controls = controlSnapshot();
    elements.stiffnessValue.textContent = format2(controls.stiffnessScale);
    elements.dampingValue.textContent = format2(controls.dampingScale);
    elements.noiseValue.textContent = format2(controls.noiseStdN);
  }

  function setControls({ stiffnessScale, dampingScale, noiseStdN }) {
    if (Number.isFinite(stiffnessScale)) {
      elements.stiffness.value = String(stiffnessScale);
    }
    if (Number.isFinite(dampingScale)) {
      elements.damping.value = String(dampingScale);
    }
    if (Number.isFinite(noiseStdN)) {
      elements.noise.value = String(noiseStdN);
    }
    refreshValueLabels();
  }

  elements.playPause.addEventListener("click", () => {
    onPlayPause();
  });
  elements.reset.addEventListener("click", () => {
    onReset();
  });

  elements.timeline.addEventListener("pointerdown", () => {
    isScrubbing = true;
  });
  elements.timeline.addEventListener("pointerup", () => {
    isScrubbing = false;
  });
  elements.timeline.addEventListener("input", () => {
    const value = Number.parseFloat(elements.timeline.value);
    onScrub(value);
  });

  const controlInputs = [elements.stiffness, elements.damping, elements.noise];
  for (const input of controlInputs) {
    input.addEventListener("input", () => {
      refreshValueLabels();
      onControlsChange(controlSnapshot());
    });
  }

  elements.viewMode.addEventListener("change", () => {
    const mode = elements.viewMode.value;
    setViewMode(mode);
    onViewMode(mode);
  });

  refreshValueLabels();

  function setViewMode(mode) {
    currentViewMode = mode;
    if (mode === "split") {
      elements.divider.style.display = "";
      elements.panelTagRight.style.display = "";
      elements.insetRightWrap.style.display = "";
      elements.statusRight.style.display = "";
      elements.panelTagLeft.textContent = "Stiff";
      elements.panelTagLeft.style.background = "rgba(255, 127, 121, 0.2)";
      elements.panelTagLeft.style.borderColor = "rgba(255, 127, 121, 0.55)";
      return;
    }
    elements.divider.style.display = "none";
    elements.panelTagRight.style.display = "none";
    elements.insetRightWrap.style.display = "none";
    elements.statusRight.style.display = "none";
    if (mode === "impedance") {
      elements.panelTagLeft.textContent = "Impedance";
      elements.panelTagLeft.style.background = "rgba(86, 227, 159, 0.2)";
      elements.panelTagLeft.style.borderColor = "rgba(86, 227, 159, 0.55)";
    } else {
      elements.panelTagLeft.textContent = "Stiff";
      elements.panelTagLeft.style.background = "rgba(255, 127, 121, 0.2)";
      elements.panelTagLeft.style.borderColor = "rgba(255, 127, 121, 0.55)";
    }
    if (lastStatusLeft && lastStatusRight) {
      setStatus(lastStatusLeft, lastStatusRight);
    }
  }

  function setPlaying(playing) {
    elements.playPause.textContent = playing ? "Pause" : "Play";
  }

  function setDuration(durationS) {
    elements.timeline.max = String(durationS);
  }

  function setTime(timeS) {
    if (!isScrubbing) {
      elements.timeline.value = String(timeS);
    }
    elements.timeLabel.textContent = `${format3(timeS)} s`;
  }

  function setStatus(left, right) {
    lastStatusLeft = left;
    lastStatusRight = right;
    const stiffText =
      `Stiff | success=${left.success ? "yes" : "no"} | ` +
      `peak=${left.peakContactForceN.toFixed(2)}N | ` +
      `insert=${Number.isFinite(left.insertionTimeS) ? `${left.insertionTimeS.toFixed(3)}s` : "--"}`;
    const impText =
      `Impedance | success=${right.success ? "yes" : "no"} | ` +
      `peak=${right.peakContactForceN.toFixed(2)}N | ` +
      `insert=${Number.isFinite(right.insertionTimeS) ? `${right.insertionTimeS.toFixed(3)}s` : "--"}`;

    if (currentViewMode === "impedance") {
      elements.statusLeft.textContent = impText;
    } else {
      elements.statusLeft.textContent = stiffText;
    }
    elements.statusRight.textContent = impText;
  }

  function updateTopDown(stiffTrace, impTrace, frameStiff, frameImp) {
    const stiffTheme = {
      pegFill: "rgba(255,127,121,0.28)",
      pegStroke: "#ff7f79",
      pathColor: "rgba(255,179,168,0.9)",
      errorColor: "#ffb3a8",
      normalColor: "#f0b35e",
    };
    const impTheme = {
      pegFill: "rgba(86,227,159,0.25)",
      pegStroke: "#56e39f",
      pathColor: "rgba(141,242,203,0.9)",
      errorColor: "#8fd6e8",
      normalColor: "#56e39f",
    };

    if (currentViewMode === "impedance") {
      drawTopDownInset(elements.insetLeft, impTrace, frameImp, impTheme, geometry);
      return;
    }
    drawTopDownInset(elements.insetLeft, stiffTrace, frameStiff, stiffTheme, geometry);
    if (currentViewMode === "split") {
      drawTopDownInset(elements.insetRight, impTrace, frameImp, impTheme, geometry);
    }
  }

  return {
    controls: controlSnapshot,
    setControls,
    setPlaying,
    setDuration,
    setTime,
    setStatus,
    setViewMode,
    updateTopDown,
  };
}
