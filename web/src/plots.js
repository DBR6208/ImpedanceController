function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssW, height: cssH };
}

function drawCardBackground(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#061019";
  ctx.fillRect(0, 0, width, height);
}

function drawAxes(ctx, rect, xTicks, yTicks) {
  ctx.strokeStyle = "rgba(170,196,206,0.35)";
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  ctx.moveTo(rect.x, rect.y);
  ctx.lineTo(rect.x, rect.y + rect.h);
  ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
  ctx.stroke();

  ctx.strokeStyle = "rgba(170,196,206,0.16)";
  for (let i = 1; i < xTicks; i += 1) {
    const x = rect.x + (i / xTicks) * rect.w;
    ctx.beginPath();
    ctx.moveTo(x, rect.y);
    ctx.lineTo(x, rect.y + rect.h);
    ctx.stroke();
  }
  for (let i = 1; i < yTicks; i += 1) {
    const y = rect.y + (i / yTicks) * rect.h;
    ctx.beginPath();
    ctx.moveTo(rect.x, y);
    ctx.lineTo(rect.x + rect.w, y);
    ctx.stroke();
  }
}

function drawLabel(ctx, text, x, y, color = "#aac4ce", size = 11) {
  ctx.fillStyle = color;
  ctx.font = `${size}px sans-serif`;
  ctx.fillText(text, x, y);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function colorScale(value) {
  const t = clamp01(value);
  const a = [12, 31, 45];
  const b = [61, 131, 152];
  const c = [240, 179, 94];
  let r = 0;
  let g = 0;
  let bch = 0;
  if (t < 0.5) {
    const u = t / 0.5;
    r = Math.round(a[0] + (b[0] - a[0]) * u);
    g = Math.round(a[1] + (b[1] - a[1]) * u);
    bch = Math.round(a[2] + (b[2] - a[2]) * u);
  } else {
    const u = (t - 0.5) / 0.5;
    r = Math.round(b[0] + (c[0] - b[0]) * u);
    g = Math.round(b[1] + (c[1] - b[1]) * u);
    bch = Math.round(b[2] + (c[2] - b[2]) * u);
  }
  return `rgb(${r}, ${g}, ${bch})`;
}

function seriesForMode(rows, mode, xKey, yKey, scale = 1.0) {
  return rows
    .filter((row) => String(row.mode) === mode)
    .map((row) => ({
      x: Number.parseFloat(row[xKey]),
      y: Number.parseFloat(row[yKey]) * scale,
    }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => a.x - b.x);
}

function drawLineSeries(ctx, rect, series, xDomain, yDomain, color) {
  if (!series.length || xDomain.max - xDomain.min <= 1e-9 || yDomain.max - yDomain.min <= 1e-9) {
    return;
  }
  const xScale = (value) => rect.x + ((value - xDomain.min) / (xDomain.max - xDomain.min)) * rect.w;
  const yScale = (value) =>
    rect.y + rect.h - ((value - yDomain.min) / (yDomain.max - yDomain.min)) * rect.h;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  series.forEach((point, idx) => {
    const x = xScale(point.x);
    const y = yScale(point.y);
    if (idx === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  ctx.fillStyle = color;
  for (const point of series) {
    const x = xScale(point.x);
    const y = yScale(point.y);
    ctx.beginPath();
    ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function maxFinite(values, fallback) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length > 0 ? Math.max(...finite) : fallback;
}

export function createPlots(elements) {
  const state = {
    stiffTrace: null,
    impTrace: null,
    cursorTimeS: 0.0,
    stiffnessRows: [],
    dampingRows: [],
    heatmapRows: [],
  };

  function drawForcePlot() {
    const { ctx, width, height } = setupCanvas(elements.forceCanvas);
    drawCardBackground(ctx, width, height);
    const rect = { x: 48, y: 18, w: width - 62, h: height - 44 };
    drawAxes(ctx, rect, 8, 5);

    const stiff = state.stiffTrace;
    const imp = state.impTrace;
    if (!stiff || !imp) {
      drawLabel(ctx, "force trace unavailable", 14, 18);
      return;
    }

    const yMax = maxFinite(
      [...stiff.contactForceN, ...imp.contactForceN],
      1,
    );
    const xMax = Math.max(stiff.durationS, imp.durationS);
    const xScale = (x) => rect.x + (x / xMax) * rect.w;
    const yScale = (y) => rect.y + rect.h - (y / yMax) * rect.h;

    const drawTrace = (trace, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < trace.steps; i += 1) {
        const x = xScale(trace.tS[i]);
        const y = yScale(trace.contactForceN[i]);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };
    drawTrace(stiff, "#ff7f79");
    drawTrace(imp, "#56e39f");

    const cursor = Math.max(0, Math.min(state.cursorTimeS, xMax));
    const cursorX = xScale(cursor);
    ctx.strokeStyle = "rgba(240,179,94,0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cursorX, rect.y);
    ctx.lineTo(cursorX, rect.y + rect.h);
    ctx.stroke();

    drawLabel(ctx, `0`, rect.x - 12, rect.y + rect.h + 14);
    drawLabel(ctx, `${xMax.toFixed(2)}s`, rect.x + rect.w - 30, rect.y + rect.h + 14);
    drawLabel(ctx, `${yMax.toFixed(1)}N`, 6, rect.y + 8);
    drawLabel(ctx, "Stiff", rect.x + 6, rect.y + 14, "#ff7f79");
    drawLabel(ctx, "Impedance", rect.x + 54, rect.y + 14, "#56e39f");
  }

  function drawErrorPlot() {
    const { ctx, width, height } = setupCanvas(elements.errorCanvas);
    drawCardBackground(ctx, width, height);
    const rect = { x: 48, y: 18, w: width - 62, h: height - 44 };
    drawAxes(ctx, rect, 8, 5);

    const stiff = state.stiffTrace;
    const imp = state.impTrace;
    if (!stiff || !imp) {
      drawLabel(ctx, "error trace unavailable", 14, 18);
      return;
    }

    const yMaxM = maxFinite(
      [...stiff.centerErrorM, ...imp.centerErrorM],
      0.001,
    );
    const yMaxMm = yMaxM * 1000.0;
    const xMax = Math.max(stiff.durationS, imp.durationS);
    const xScale = (x) => rect.x + (x / xMax) * rect.w;
    const yScale = (yMm) => rect.y + rect.h - (yMm / yMaxMm) * rect.h;

    const drawTrace = (trace, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < trace.steps; i += 1) {
        const x = xScale(trace.tS[i]);
        const y = yScale(trace.centerErrorM[i] * 1000.0);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };
    drawTrace(stiff, "#ffb3a8");
    drawTrace(imp, "#8df2cb");

    const cursor = Math.max(0, Math.min(state.cursorTimeS, xMax));
    const cursorX = xScale(cursor);
    ctx.strokeStyle = "rgba(240,179,94,0.9)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cursorX, rect.y);
    ctx.lineTo(cursorX, rect.y + rect.h);
    ctx.stroke();

    drawLabel(ctx, `0`, rect.x - 12, rect.y + rect.h + 14);
    drawLabel(ctx, `${xMax.toFixed(2)}s`, rect.x + rect.w - 30, rect.y + rect.h + 14);
    drawLabel(ctx, `${yMaxMm.toFixed(2)}mm`, 6, rect.y + 8);
    drawLabel(ctx, "Stiff", rect.x + 6, rect.y + 14, "#ffb3a8");
    drawLabel(ctx, "Impedance", rect.x + 54, rect.y + 14, "#8df2cb");
  }

  function drawStiffnessPlot() {
    const { ctx, width, height } = setupCanvas(elements.stiffnessCanvas);
    drawCardBackground(ctx, width, height);
    if (!state.stiffnessRows.length) {
      drawLabel(ctx, "stiffness sweep unavailable", 14, 18);
      return;
    }

    const pads = { left: 48, right: 14, top: 14, bottom: 18 };
    const paneGap = 8;
    const paneH = (height - pads.top - pads.bottom - 2 * paneGap) / 3;
    const panes = [
      { y: pads.top, key: "peak_contact_force_mean_n", label: "Peak Force [N]", scale: 1.0 },
      { y: pads.top + paneH + paneGap, key: "success_rate", label: "Success Rate", scale: 1.0, clampMax: 1.0 },
      { y: pads.top + 2 * (paneH + paneGap), key: "settling_time_mean_s", label: "Settling [s]", scale: 1.0 },
    ];

    const xValues = state.stiffnessRows
      .map((row) => Number.parseFloat(row.stiffness_scale))
      .filter((value) => Number.isFinite(value));
    const xDomain = { min: Math.min(...xValues), max: Math.max(...xValues) };

    for (const pane of panes) {
      const rect = { x: pads.left, y: pane.y, w: width - pads.left - pads.right, h: paneH };
      drawAxes(ctx, rect, 6, 4);

      const stiffSeries = seriesForMode(state.stiffnessRows, "stiff", "stiffness_scale", pane.key, pane.scale);
      const impSeries = seriesForMode(state.stiffnessRows, "impedance", "stiffness_scale", pane.key, pane.scale);
      const yValues = [...stiffSeries, ...impSeries].map((point) => point.y);
      const yMax = pane.clampMax ?? maxFinite(yValues, 1.0);
      const yMin = 0.0;
      const yDomain = { min: yMin, max: yMax <= yMin ? yMin + 1.0 : yMax };

      drawLineSeries(ctx, rect, stiffSeries, xDomain, yDomain, "#ff7f79");
      drawLineSeries(ctx, rect, impSeries, xDomain, yDomain, "#56e39f");
      drawLabel(ctx, pane.label, rect.x + 4, rect.y + 13, "#aac4ce", 10);
    }
    drawLabel(ctx, "Stiff", width - 120, 16, "#ff7f79");
    drawLabel(ctx, "Impedance", width - 72, 16, "#56e39f");
  }

  function drawDampingPlot() {
    const { ctx, width, height } = setupCanvas(elements.dampingCanvas);
    drawCardBackground(ctx, width, height);
    if (!state.dampingRows.length) {
      drawLabel(ctx, "damping sweep unavailable", 14, 18);
      return;
    }

    const pads = { left: 48, right: 14, top: 18, bottom: 18 };
    const paneGap = 10;
    const paneH = (height - pads.top - pads.bottom - paneGap) / 2;
    const panes = [
      { y: pads.top, key: "oscillation_mean_m", label: "Oscillation [mm]", scale: 1000.0 },
      { y: pads.top + paneH + paneGap, key: "insertion_time_mean_s", label: "Insertion [s]", scale: 1.0 },
    ];

    const xValues = state.dampingRows
      .map((row) => Number.parseFloat(row.damping_scale))
      .filter((value) => Number.isFinite(value));
    const xDomain = { min: Math.min(...xValues), max: Math.max(...xValues) };

    for (const pane of panes) {
      const rect = { x: pads.left, y: pane.y, w: width - pads.left - pads.right, h: paneH };
      drawAxes(ctx, rect, 6, 4);

      const stiffSeries = seriesForMode(state.dampingRows, "stiff", "damping_scale", pane.key, pane.scale);
      const impSeries = seriesForMode(state.dampingRows, "impedance", "damping_scale", pane.key, pane.scale);
      const yValues = [...stiffSeries, ...impSeries].map((point) => point.y);
      const yMax = maxFinite(yValues, 1.0);
      const yDomain = { min: 0.0, max: yMax > 0 ? yMax : 1.0 };

      drawLineSeries(ctx, rect, stiffSeries, xDomain, yDomain, "#ff7f79");
      drawLineSeries(ctx, rect, impSeries, xDomain, yDomain, "#56e39f");
      drawLabel(ctx, pane.label, rect.x + 4, rect.y + 13, "#aac4ce", 10);
    }
    drawLabel(ctx, "Stiff", width - 120, 16, "#ff7f79");
    drawLabel(ctx, "Impedance", width - 72, 16, "#56e39f");
  }

  function drawHeatmapPlot() {
    const { ctx, width, height } = setupCanvas(elements.heatmapCanvas);
    drawCardBackground(ctx, width, height);
    if (!state.heatmapRows.length) {
      drawLabel(ctx, "heatmap data unavailable", 14, 18);
      return;
    }

    const modes = ["stiff", "impedance"];
    const stiffnessValues = [...new Set(
      state.heatmapRows
        .map((row) => Number.parseFloat(row.stiffness_scale))
        .filter((value) => Number.isFinite(value)),
    )].sort((a, b) => a - b);
    const offsetValues = [...new Set(
      state.heatmapRows
        .map((row) => Number.parseFloat(row.offset_m))
        .filter((value) => Number.isFinite(value)),
    )].sort((a, b) => a - b);

    const paneGap = 22;
    const paneW = (width - 40 - paneGap) * 0.5;
    const paneH = height - 70;
    const startX = 18;
    const startY = 24;

    for (let pane = 0; pane < modes.length; pane += 1) {
      const mode = modes[pane];
      const x0 = startX + pane * (paneW + paneGap);
      const y0 = startY;
      ctx.strokeStyle = "rgba(170,196,206,0.36)";
      ctx.strokeRect(x0, y0, paneW, paneH);
      drawLabel(ctx, mode === "stiff" ? "Stiff Control" : "Impedance Control", x0 + 4, y0 - 6);

      const cellW = paneW / Math.max(1, stiffnessValues.length);
      const cellH = paneH / Math.max(1, offsetValues.length);
      for (let iy = 0; iy < offsetValues.length; iy += 1) {
        const offset = offsetValues[iy];
        for (let ix = 0; ix < stiffnessValues.length; ix += 1) {
          const stiffness = stiffnessValues[ix];
          const row = state.heatmapRows.find(
            (item) =>
              String(item.mode) === mode &&
              Number.parseFloat(item.offset_m) === offset &&
              Number.parseFloat(item.stiffness_scale) === stiffness,
          );
          const value = row ? Number.parseFloat(row.success_rate) : Number.NaN;
          ctx.fillStyle = Number.isFinite(value) ? colorScale(value) : "rgba(60,75,82,0.75)";
          ctx.fillRect(
            x0 + ix * cellW + 0.5,
            y0 + paneH - (iy + 1) * cellH + 0.5,
            cellW - 1,
            cellH - 1,
          );
        }
      }

      drawLabel(ctx, "stiffness", x0 + paneW - 50, y0 + paneH + 14, "#aac4ce", 10);
      ctx.save();
      ctx.translate(x0 - 10, y0 + paneH * 0.5);
      ctx.rotate(-Math.PI * 0.5);
      drawLabel(ctx, "offset [mm]", 0, 0, "#aac4ce", 10);
      ctx.restore();
    }
  }

  function redrawAll() {
    drawForcePlot();
    drawErrorPlot();
    drawStiffnessPlot();
    drawDampingPlot();
    drawHeatmapPlot();
  }

  return {
    setPlaybackTraces(stiffTrace, impTrace) {
      state.stiffTrace = stiffTrace;
      state.impTrace = impTrace;
      redrawAll();
    },
    setSweepData({ stiffnessRows, dampingRows, heatmapRows }) {
      state.stiffnessRows = stiffnessRows ?? [];
      state.dampingRows = dampingRows ?? [];
      state.heatmapRows = heatmapRows ?? [];
      redrawAll();
    },
    setCursorTime(timeS) {
      state.cursorTimeS = Number.isFinite(timeS) ? timeS : 0.0;
      drawForcePlot();
      drawErrorPlot();
    },
    redrawAll,
  };
}
