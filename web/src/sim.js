const MODE_STIFF = "stiff";
const MODE_IMPEDANCE = "impedance";

const CONTACT_DEFAULTS = Object.freeze({
  holeRadiusM: 0.0105,
  pegRadiusM: 0.0090,
  plateZM: 0.0,
  holeDepthM: 0.03,
  radialStiffnessNpm: 6000.0,
  radialDampingNspm: 35.0,
  centeringStiffnessNpmm: 350000.0,
  verticalStiffnessNpm: 2200.0,
  verticalDampingNspm: 20.0,
  bottomStiffnessNpm: 30000.0,
  bottomDampingNspm: 80.0,
});

const CONTROLLER_PRESETS = Object.freeze({
  [MODE_STIFF]: Object.freeze({
    mass: [0.4, 0.4, 0.5],
    stiffness: [6200.0, 6200.0, 18000.0],
    damping: [14.0, 14.0, 26.0],
  }),
  [MODE_IMPEDANCE]: Object.freeze({
    mass: [0.4, 0.4, 0.5],
    stiffness: [90.0, 90.0, 3200.0],
    damping: [70.0, 70.0, 120.0],
  }),
});

const DEFAULT_RUNTIME_PARAMS = Object.freeze({
  durationS: 2.0,
  dtS: 0.001,
  seed: 7,
  noiseStdN: 0.1,
  initialPositionM: [0.0032, -0.0024, 0.02],
  initialVelocityMps: [0.0, 0.0, 0.0],
  targetXYM: [0.0032, -0.0024],
  targetZM: -0.028,
  insertionSpeedMps: 0.06,
  successRadialFactor: 1.05,
  successDepthM: 0.015,
  stiffnessScale: 1.0,
  dampingScale: 1.0,
  contact: CONTACT_DEFAULTS,
});

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSampler(seed) {
  const random = mulberry32(seed);
  let spare = null;
  return function sample() {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0.0;
    let v = 0.0;
    while (u <= Number.EPSILON) {
      u = random();
    }
    while (v <= Number.EPSILON) {
      v = random();
    }
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    const z1 = mag * Math.sin(2.0 * Math.PI * v);
    spare = z1;
    return z0;
  };
}

function clearanceM(contact) {
  return contact.holeRadiusM - contact.pegRadiusM;
}

function bottomZM(contact) {
  return contact.plateZM - contact.holeDepthM;
}

function isSuccessful(position, params, contact) {
  const radial = Math.hypot(position[0], position[1]);
  return (
    radial <= params.successRadialFactor * clearanceM(contact) &&
    position[2] <= contact.plateZM - params.successDepthM
  );
}

function computeContact(position, velocity, contact) {
  const force = [0.0, 0.0, 0.0];
  let inContact = 0;
  let penetration = 0.0;

  const radialNorm = Math.hypot(position[0], position[1]);
  const radialPen = Math.max(0.0, radialNorm - clearanceM(contact));
  const zPen = Math.max(0.0, contact.plateZM - position[2]);

  if (radialPen > 0.0 && zPen > 0.0) {
    inContact = 1;
    penetration = Math.max(penetration, radialPen, zPen);
    let dirX = 0.0;
    let dirY = 0.0;
    let radialVel = 0.0;
    if (radialNorm > 1e-12) {
      dirX = position[0] / radialNorm;
      dirY = position[1] / radialNorm;
      radialVel = velocity[0] * dirX + velocity[1] * dirY;
    }
    const inwardMag =
      contact.radialStiffnessNpm * radialPen +
      contact.radialDampingNspm * Math.max(0.0, radialVel) +
      contact.centeringStiffnessNpmm * radialPen * zPen;
    force[0] = -inwardMag * dirX;
    force[1] = -inwardMag * dirY;
    force[2] +=
      contact.verticalStiffnessNpm * zPen +
      contact.verticalDampingNspm * Math.max(0.0, -velocity[2]);
  }

  const bottomPen = Math.max(0.0, bottomZM(contact) - position[2]);
  if (bottomPen > 0.0) {
    inContact = 1;
    penetration = Math.max(penetration, bottomPen);
    force[2] +=
      contact.bottomStiffnessNpm * bottomPen +
      contact.bottomDampingNspm * Math.max(0.0, -velocity[2]);
  }

  return {
    force,
    inContact,
    penetration,
  };
}

function newTraceStorage(steps) {
  return {
    tS: new Float64Array(steps),
    xM: new Float64Array(steps),
    yM: new Float64Array(steps),
    zM: new Float64Array(steps),
    xRefM: new Float64Array(steps),
    yRefM: new Float64Array(steps),
    zRefM: new Float64Array(steps),
    centerErrorM: new Float64Array(steps),
    lateralErrorM: new Float64Array(steps),
    contactFxN: new Float64Array(steps),
    contactFyN: new Float64Array(steps),
    contactFzN: new Float64Array(steps),
    contactForceN: new Float64Array(steps),
    controlFxN: new Float64Array(steps),
    controlFyN: new Float64Array(steps),
    controlFzN: new Float64Array(steps),
    inContact: new Uint8Array(steps),
    success: new Uint8Array(steps),
  };
}

function cloneParams(base, overrides = {}) {
  const merged = {
    ...base,
    ...overrides,
  };
  merged.initialPositionM = [...(overrides.initialPositionM ?? base.initialPositionM)];
  merged.initialVelocityMps = [...(overrides.initialVelocityMps ?? base.initialVelocityMps)];
  merged.targetXYM = [...(overrides.targetXYM ?? base.targetXYM)];
  merged.contact = { ...(overrides.contact ?? base.contact) };
  return merged;
}

export function createRuntimeParams(overrides = {}) {
  return cloneParams(DEFAULT_RUNTIME_PARAMS, overrides);
}

export function modeNames() {
  return [MODE_STIFF, MODE_IMPEDANCE];
}

export function getDefaultRuntimeParams() {
  return createRuntimeParams();
}

export function simulateMode(mode, runtimeParams) {
  const params = createRuntimeParams(runtimeParams);
  const preset = CONTROLLER_PRESETS[mode];
  if (!preset) {
    throw new Error(`Unsupported mode '${mode}'`);
  }
  const steps = Math.max(1, Math.round(params.durationS / params.dtS));
  const data = newTraceStorage(steps);

  const mass = [
    preset.mass[0],
    preset.mass[1],
    preset.mass[2],
  ];
  const invMass = [1.0 / mass[0], 1.0 / mass[1], 1.0 / mass[2]];
  const stiffness = [
    preset.stiffness[0] * params.stiffnessScale,
    preset.stiffness[1] * params.stiffnessScale,
    preset.stiffness[2] * params.stiffnessScale,
  ];
  const damping = [
    preset.damping[0] * params.dampingScale,
    preset.damping[1] * params.dampingScale,
    preset.damping[2] * params.dampingScale,
  ];

  const position = [...params.initialPositionM];
  const velocity = [...params.initialVelocityMps];
  const sampleNormal = normalSampler(params.seed);

  let t = 0.0;
  let successIndex = -1;
  let peakContact = 0.0;
  let maxCenterError = 0.0;

  for (let i = 0; i < steps; i += 1) {
    const xRef = params.targetXYM[0];
    const yRef = params.targetXYM[1];
    const zRef = Math.max(params.targetZM, params.initialPositionM[2] - params.insertionSpeedMps * t);

    const errX = position[0] - xRef;
    const errY = position[1] - yRef;
    const errZ = position[2] - zRef;

    const controlX = -stiffness[0] * errX - damping[0] * velocity[0];
    const controlY = -stiffness[1] * errY - damping[1] * velocity[1];
    const controlZ = -stiffness[2] * errZ - damping[2] * velocity[2];

    const contact = computeContact(position, velocity, params.contact);
    const noiseX = params.noiseStdN > 0.0 ? params.noiseStdN * sampleNormal() : 0.0;
    const noiseY = params.noiseStdN > 0.0 ? params.noiseStdN * sampleNormal() : 0.0;
    const noiseZ = params.noiseStdN > 0.0 ? params.noiseStdN * sampleNormal() : 0.0;

    const totalX = controlX + contact.force[0] + noiseX;
    const totalY = controlY + contact.force[1] + noiseY;
    const totalZ = controlZ + contact.force[2] + noiseZ;

    const accX = totalX * invMass[0];
    const accY = totalY * invMass[1];
    const accZ = totalZ * invMass[2];

    velocity[0] += params.dtS * accX;
    velocity[1] += params.dtS * accY;
    velocity[2] += params.dtS * accZ;
    position[0] += params.dtS * velocity[0];
    position[1] += params.dtS * velocity[1];
    position[2] += params.dtS * velocity[2];
    t += params.dtS;

    const contactMag = Math.hypot(contact.force[0], contact.force[1], contact.force[2]);
    const centerError = Math.hypot(position[0], position[1]);
    const lateralError = Math.hypot(position[0] - xRef, position[1] - yRef);
    const success = isSuccessful(position, params, params.contact);

    if (success && successIndex < 0) {
      successIndex = i;
    }
    peakContact = Math.max(peakContact, contactMag);
    maxCenterError = Math.max(maxCenterError, centerError);

    data.tS[i] = t;
    data.xM[i] = position[0];
    data.yM[i] = position[1];
    data.zM[i] = position[2];
    data.xRefM[i] = xRef;
    data.yRefM[i] = yRef;
    data.zRefM[i] = zRef;
    data.centerErrorM[i] = centerError;
    data.lateralErrorM[i] = lateralError;
    data.contactFxN[i] = contact.force[0];
    data.contactFyN[i] = contact.force[1];
    data.contactFzN[i] = contact.force[2];
    data.contactForceN[i] = contactMag;
    data.controlFxN[i] = controlX;
    data.controlFyN[i] = controlY;
    data.controlFzN[i] = controlZ;
    data.inContact[i] = contact.inContact;
    data.success[i] = success ? 1 : 0;
  }

  return {
    mode,
    dtS: params.dtS,
    durationS: params.durationS,
    steps,
    ...data,
    summary: {
      success: successIndex >= 0,
      insertionTimeS: successIndex >= 0 ? data.tS[successIndex] : Number.NaN,
      peakContactForceN: peakContact,
      maxCenterErrorM: maxCenterError,
    },
  };
}

export function simulateComparison(runtimeParams) {
  const params = createRuntimeParams(runtimeParams);
  const stiff = simulateMode(MODE_STIFF, params);
  const impedance = simulateMode(MODE_IMPEDANCE, params);
  return {
    stiff,
    impedance,
    durationS: params.durationS,
    dtS: params.dtS,
    params,
  };
}

export function frameAt(trace, index) {
  const i = Math.max(0, Math.min(index, trace.steps - 1));
  return {
    index: i,
    tS: trace.tS[i],
    xM: trace.xM[i],
    yM: trace.yM[i],
    zM: trace.zM[i],
    xRefM: trace.xRefM[i],
    yRefM: trace.yRefM[i],
    zRefM: trace.zRefM[i],
    centerErrorM: trace.centerErrorM[i],
    lateralErrorM: trace.lateralErrorM[i],
    contactFxN: trace.contactFxN[i],
    contactFyN: trace.contactFyN[i],
    contactFzN: trace.contactFzN[i],
    contactForceN: trace.contactForceN[i],
    controlFxN: trace.controlFxN[i],
    controlFyN: trace.controlFyN[i],
    controlFzN: trace.controlFzN[i],
    inContact: trace.inContact[i],
    success: trace.success[i],
  };
}

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) {
    return [];
  }
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    const values = line.split(",");
    const row = {};
    for (let c = 0; c < header.length; c += 1) {
      row[header[c]] = values[c];
    }
    rows.push(row);
  }
  return rows;
}

function numeric(row, key, fallback = 0.0) {
  const value = Number.parseFloat(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function traceFromLoggedRows(rows, modeLabel = MODE_STIFF) {
  const steps = rows.length;
  if (steps === 0) {
    return null;
  }
  const data = newTraceStorage(steps);
  let peak = 0.0;
  let maxCenter = 0.0;
  let successIndex = -1;

  for (let i = 0; i < steps; i += 1) {
    const row = rows[i];
    const x = numeric(row, "x_m");
    const y = numeric(row, "y_m");
    const z = numeric(row, "z_m");
    const centerError = Math.hypot(x, y);
    const contactForce = numeric(row, "contact_force_n");
    const success = Math.round(numeric(row, "success"));

    peak = Math.max(peak, contactForce);
    maxCenter = Math.max(maxCenter, centerError);
    if (success && successIndex < 0) {
      successIndex = i;
    }

    data.tS[i] = numeric(row, "t_s");
    data.xM[i] = x;
    data.yM[i] = y;
    data.zM[i] = z;
    data.xRefM[i] = numeric(row, "x_ref_m");
    data.yRefM[i] = numeric(row, "y_ref_m");
    data.zRefM[i] = numeric(row, "z_ref_m");
    data.centerErrorM[i] = centerError;
    data.lateralErrorM[i] = numeric(row, "lateral_error_m");
    data.contactFxN[i] = numeric(row, "contact_fx_n");
    data.contactFyN[i] = numeric(row, "contact_fy_n");
    data.contactFzN[i] = numeric(row, "contact_fz_n");
    data.contactForceN[i] = contactForce;
    data.controlFxN[i] = numeric(row, "control_fx_n");
    data.controlFyN[i] = numeric(row, "control_fy_n");
    data.controlFzN[i] = numeric(row, "control_fz_n");
    data.inContact[i] = Math.round(numeric(row, "in_contact"));
    data.success[i] = success ? 1 : 0;
  }

  const durationS = data.tS[steps - 1] || 0.0;
  const dtS = steps > 1 ? data.tS[1] - data.tS[0] : 0.001;
  return {
    mode: modeLabel,
    dtS,
    durationS,
    steps,
    ...data,
    summary: {
      success: successIndex >= 0,
      insertionTimeS: successIndex >= 0 ? data.tS[successIndex] : Number.NaN,
      peakContactForceN: peak,
      maxCenterErrorM: maxCenter,
    },
  };
}

export async function loadTraceFromCsvUrl(url, modeLabel) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}`);
  }
  const text = await response.text();
  const rows = parseCsv(text);
  const trace = traceFromLoggedRows(rows, modeLabel);
  if (!trace) {
    throw new Error(`No rows found in ${url}`);
  }
  return trace;
}

export { MODE_STIFF, MODE_IMPEDANCE, CONTACT_DEFAULTS, CONTROLLER_PRESETS };
