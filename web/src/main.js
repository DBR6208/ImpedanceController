import "./styles.css";

import { createSplitScene, SCENE_CONSTANTS } from "./scene.js";
import { createUI } from "./ui.js";
import { createPlots } from "./plots.js";
import {
  MODE_IMPEDANCE,
  MODE_STIFF,
  createRuntimeParams,
  getDefaultRuntimeParams,
  loadTraceFromCsvUrl,
  parseCsv,
  simulateComparison,
  simulateMode,
} from "./sim.js";

function toIndex(trace, timeS) {
  if (!trace || trace.steps <= 0) {
    return 0;
  }
  const index = Math.round(timeS / trace.dtS);
  return Math.max(0, Math.min(index, trace.steps - 1));
}

async function loadCsvRows(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return parseCsv(await response.text());
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return response.json();
}

function asFiniteNumber(value, fallback) {
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asVector3(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) {
    return [...fallback];
  }
  return [
    asFiniteNumber(value[0], fallback[0]),
    asFiniteNumber(value[1], fallback[1]),
    asFiniteNumber(value[2], fallback[2]),
  ];
}

function asVector2(value, fallback) {
  if (!Array.isArray(value) || value.length < 2) {
    return [...fallback];
  }
  return [
    asFiniteNumber(value[0], fallback[0]),
    asFiniteNumber(value[1], fallback[1]),
  ];
}

function runtimeParamsFromLoggedMeta(meta, fallbackParams) {
  const config = meta && typeof meta === "object" ? meta.config : null;
  if (!config || typeof config !== "object") {
    return createRuntimeParams(fallbackParams);
  }
  return createRuntimeParams({
    ...fallbackParams,
    durationS: asFiniteNumber(config.duration_s, fallbackParams.durationS),
    dtS: asFiniteNumber(config.dt_s, fallbackParams.dtS),
    seed: Math.round(asFiniteNumber(config.seed, fallbackParams.seed)),
    noiseStdN: asFiniteNumber(config.noise_std_n, fallbackParams.noiseStdN),
    initialPositionM: asVector3(config.initial_position_m, fallbackParams.initialPositionM),
    initialVelocityMps: asVector3(config.initial_velocity_mps, fallbackParams.initialVelocityMps),
    targetXYM: asVector2(config.target_xy_m, fallbackParams.targetXYM),
    targetZM: asFiniteNumber(config.target_z_m, fallbackParams.targetZM),
    insertionSpeedMps: asFiniteNumber(config.insertion_speed_mps, fallbackParams.insertionSpeedMps),
    successRadialFactor: asFiniteNumber(
      config.success_radial_factor,
      fallbackParams.successRadialFactor,
    ),
    successDepthM: asFiniteNumber(config.success_depth_m, fallbackParams.successDepthM),
    stiffnessScale: asFiniteNumber(config.stiffness_scale, fallbackParams.stiffnessScale),
    dampingScale: asFiniteNumber(config.damping_scale, fallbackParams.dampingScale),
  });
}

function mean(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return Number.NaN;
  }
  return finite.reduce((acc, value) => acc + value, 0) / finite.length;
}

function computeSettlingTime(trace, toleranceM) {
  for (let i = 0; i < trace.steps; i += 1) {
    let allInside = true;
    for (let j = i; j < trace.steps; j += 1) {
      if (trace.centerErrorM[j] > toleranceM) {
        allInside = false;
        break;
      }
    }
    if (allInside) {
      return trace.tS[i];
    }
  }
  return Number.NaN;
}

function computeOscillation(trace) {
  const start = Math.floor(trace.steps * 0.45);
  const values = [];
  for (let i = start; i < trace.steps; i += 1) {
    values.push(trace.centerErrorM[i]);
  }
  const m = mean(values);
  if (!Number.isFinite(m)) {
    return Number.NaN;
  }
  const variance = mean(values.map((value) => (value - m) ** 2));
  return Math.sqrt(Math.max(0, variance));
}

function aggregateMetrics(traces, stiffnessScale, dampingScale, extra = {}) {
  return {
    ...extra,
    trial_count: traces.length,
    stiffness_scale: stiffnessScale,
    damping_scale: dampingScale,
    success_rate: mean(traces.map((trace) => (trace.summary.success ? 1 : 0))),
    peak_contact_force_mean_n: mean(traces.map((trace) => trace.summary.peakContactForceN)),
    insertion_time_mean_s: mean(traces.map((trace) => trace.summary.insertionTimeS)),
    settling_time_mean_s: mean(
      traces.map((trace) =>
        computeSettlingTime(
          trace,
          getDefaultRuntimeParams().successRadialFactor *
            (SCENE_CONSTANTS.holeRadiusM - SCENE_CONSTANTS.pegRadiusM),
        ),
      ),
    ),
    oscillation_mean_m: mean(traces.map((trace) => computeOscillation(trace))),
  };
}

function quickFallbackTables(baseParams) {
  const seeds = [1, 2, 3];
  const stiffnessScales = [0.7, 1.0, 1.3, 1.6];
  const dampingScales = [0.7, 1.0, 1.4, 1.8];
  const offsetScales = [0.0012, 0.0016, 0.0020, 0.0024, 0.0028];

  const stiffnessRows = [];
  const dampingRows = [];
  const heatmapRows = [];

  for (const mode of [MODE_STIFF, MODE_IMPEDANCE]) {
    for (const scale of stiffnessScales) {
      const traces = seeds.map((seed) =>
        simulateMode(
          mode,
          createRuntimeParams({
            ...baseParams,
            seed,
            stiffnessScale: scale,
            dampingScale: 1.0,
          }),
        ),
      );
      stiffnessRows.push(
        aggregateMetrics(traces, scale, 1.0, {
          mode,
        }),
      );
    }
    for (const scale of dampingScales) {
      const traces = seeds.map((seed) =>
        simulateMode(
          mode,
          createRuntimeParams({
            ...baseParams,
            seed,
            stiffnessScale: 1.0,
            dampingScale: scale,
          }),
        ),
      );
      dampingRows.push(
        aggregateMetrics(traces, 1.0, scale, {
          mode,
        }),
      );
    }
    for (const stiffnessScale of stiffnessScales) {
      for (const offset of offsetScales) {
        const angle = Math.atan2(
          baseParams.initialPositionM[1],
          baseParams.initialPositionM[0],
        );
        const x = Math.cos(angle) * offset;
        const y = Math.sin(angle) * offset;
        const traces = seeds.map((seed) =>
          simulateMode(
            mode,
            createRuntimeParams({
              ...baseParams,
              seed,
              stiffnessScale,
              dampingScale: 1.0,
              initialPositionM: [x, y, baseParams.initialPositionM[2]],
              targetXYM: [x, y],
            }),
          ),
        );
        heatmapRows.push(
          aggregateMetrics(traces, stiffnessScale, 1.0, {
            mode,
            offset_m: offset,
          }),
        );
      }
    }
  }

  return {
    stiffnessRows,
    dampingRows,
    heatmapRows,
  };
}

async function loadSweepTables(baseParams) {
  try {
    const [stiffnessRows, dampingRows, heatmapRows] = await Promise.all([
      loadCsvRows("/data/stiffness_sweep.csv"),
      loadCsvRows("/data/damping_sweep.csv"),
      loadCsvRows("/data/success_heatmap.csv"),
    ]);
    return { stiffnessRows, dampingRows, heatmapRows };
  } catch (_error) {
    return quickFallbackTables(baseParams);
  }
}

async function loadInitialComparison(params) {
  try {
    const [stiff, impedance, stiffMeta, impMeta] = await Promise.all([
      loadTraceFromCsvUrl("/data/run_stiff.csv", MODE_STIFF),
      loadTraceFromCsvUrl("/data/run_impedance.csv", MODE_IMPEDANCE),
      loadJson("/data/run_stiff_meta.json"),
      loadJson("/data/run_impedance_meta.json"),
    ]);
    const canonicalParams = runtimeParamsFromLoggedMeta(impMeta ?? stiffMeta, params);
    return {
      stiff,
      impedance,
      durationS: Math.max(stiff.durationS, impedance.durationS),
      dtS: Math.min(stiff.dtS, impedance.dtS),
      params: canonicalParams,
      source: "logged",
    };
  } catch (_error) {
    const comparison = simulateComparison(params);
    return {
      ...comparison,
      source: "simulated",
    };
  }
}

function startApp() {
  const sceneHost = document.querySelector("#scene-host");
  const scene = createSplitScene(sceneHost);
  const plots = createPlots({
    forceCanvas: document.querySelector("#plot-force"),
    errorCanvas: document.querySelector("#plot-error"),
    stiffnessCanvas: document.querySelector("#plot-stiffness"),
    dampingCanvas: document.querySelector("#plot-damping"),
    heatmapCanvas: document.querySelector("#plot-heatmap"),
  });

  const state = {
    runtimeParams: getDefaultRuntimeParams(),
    comparison: null,
    playheadS: 0.0,
    playing: true,
    viewMode: "split",
    rafId: 0,
    lastTickMs: 0.0,
    lastRenderMs: 0.0,
    debounceTimer: 0,
  };

  const ui = createUI({
    geometry: {
      holeRadiusM: SCENE_CONSTANTS.holeRadiusM,
      pegRadiusM: SCENE_CONSTANTS.pegRadiusM,
      clearanceM: SCENE_CONSTANTS.holeRadiusM - SCENE_CONSTANTS.pegRadiusM,
    },
    onPlayPause: () => {
      state.playing = !state.playing;
      ui.setPlaying(state.playing);
    },
    onReset: () => {
      state.playheadS = 0.0;
      ui.setTime(state.playheadS);
    },
    onScrub: (value) => {
      state.playheadS = value;
      state.playing = false;
      ui.setPlaying(false);
      redrawFrame();
    },
    onControlsChange: (controls) => {
      window.clearTimeout(state.debounceTimer);
      state.playing = false;
      ui.setPlaying(false);
      state.debounceTimer = window.setTimeout(() => {
        state.runtimeParams = createRuntimeParams({
          ...state.runtimeParams,
          stiffnessScale: controls.stiffnessScale,
          dampingScale: controls.dampingScale,
          noiseStdN: controls.noiseStdN,
        });
        state.comparison = simulateComparison(state.runtimeParams);
        state.playheadS = 0.0;
        applyComparison(state.comparison);
        redrawFrame();
      }, 220);
    },
    onViewMode: (mode) => {
      state.viewMode = mode;
      scene.setViewMode(mode);
      if (state.comparison) {
        ui.setStatus(state.comparison.stiff.summary, state.comparison.impedance.summary);
      }
      redrawFrame();
    },
  });

  function applyComparison(comparison) {
    state.comparison = comparison;
    scene.setTraces({
      stiff: comparison.stiff,
      impedance: comparison.impedance,
    });
    plots.setPlaybackTraces(comparison.stiff, comparison.impedance);
    ui.setDuration(comparison.durationS);
    ui.setStatus(comparison.stiff.summary, comparison.impedance.summary);
  }

  function redrawFrame() {
    if (!state.comparison) {
      return;
    }
    const stiffIndex = toIndex(state.comparison.stiff, state.playheadS);
    const impIndex = toIndex(state.comparison.impedance, state.playheadS);

    scene.render(stiffIndex, impIndex);
    plots.setCursorTime(state.playheadS);
    ui.setTime(state.playheadS);
    ui.updateTopDown(
      state.comparison.stiff,
      state.comparison.impedance,
      stiffIndex,
      impIndex,
    );
  }

  function animate(nowMs) {
    if (state.lastTickMs === 0.0) {
      state.lastTickMs = nowMs;
    }
    const dt = Math.max(0.0, (nowMs - state.lastTickMs) / 1000.0);
    state.lastTickMs = nowMs;

    if (state.playing && state.comparison) {
      state.playheadS += dt;
      if (state.playheadS >= state.comparison.durationS) {
        state.playheadS = state.comparison.durationS;
        state.playing = false;
        ui.setPlaying(false);
      }
      if (nowMs - state.lastRenderMs >= 33.0 || !state.playing) {
        redrawFrame();
        state.lastRenderMs = nowMs;
      }
    }
    state.rafId = window.requestAnimationFrame(animate);
  }

  function bindResize() {
    window.addEventListener("resize", () => {
      plots.redrawAll();
      redrawFrame();
    });
  }

  Promise.all([
    loadInitialComparison(state.runtimeParams),
    loadSweepTables(state.runtimeParams),
  ])
    .then(([comparison, tables]) => {
      state.runtimeParams = createRuntimeParams(comparison.params ?? state.runtimeParams);
      ui.setControls({
        stiffnessScale: state.runtimeParams.stiffnessScale,
        dampingScale: state.runtimeParams.dampingScale,
        noiseStdN: state.runtimeParams.noiseStdN,
      });
      applyComparison(comparison);
      plots.setSweepData(tables);
      ui.setPlaying(true);
      ui.setViewMode(state.viewMode);
      redrawFrame();
      bindResize();
      state.rafId = window.requestAnimationFrame(animate);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
    });

  window.addEventListener("beforeunload", () => {
    if (state.rafId) {
      window.cancelAnimationFrame(state.rafId);
    }
    scene.dispose();
  });
}

startApp();
