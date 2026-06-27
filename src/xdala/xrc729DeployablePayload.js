function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function readRequiredString(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function readOptionalString(value) {
  return String(value ?? '').trim();
}

function normalizeSpawns(value, label) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label}.spawns must be a string array.`);
  }
  const spawns = value.map((item, index) => readRequiredString(item, `${label}.spawns[${index}]`));
  return spawns.length ? spawns : undefined;
}

function normalizeJoinMode(value, label) {
  if (value == null || value === '' || value === 'any') return undefined;
  if (value === 'all') return 'all';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const kofn = Number(value.kofn);
    if (Number.isInteger(kofn) && kofn >= 1) return { kofn };
  }
  throw new Error(`${label}.mode is invalid.`);
}

function normalizeJoinFrom(value, label) {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${label}.from must be an array.`);
  }

  const from = value.map((item, index) => {
    const source = assertObject(item, `${label}.from[${index}]`);
    const node = readRequiredString(source.node, `${label}.from[${index}].node`);
    const when = readOptionalString(source.when).toLowerCase();

    if (!when) return { node };
    if (when === 'valid' || when === 'invalid') return { node, when };
    throw new Error(`${label}.from[${index}].when must be valid or invalid.`);
  });

  return from.length ? from : undefined;
}

function normalizeJoin(value, label) {
  if (value == null) return undefined;
  const source = assertObject(value, `${label}.join`);
  const joinid = readRequiredString(source.joinid, `${label}.join.joinid`);

  const join = { joinid };
  const mode = normalizeJoinMode(source.mode, `${label}.join`);
  const from = normalizeJoinFrom(source.from, `${label}.join`);

  if (mode) join.mode = mode;
  if (source.waitonjoin === 'kill') join.waitonjoin = 'kill';
  if (from) join.from = from;

  return join;
}

function normalizeTransitionSide(value, label) {
  if (value == null) return undefined;
  const source = assertObject(value, label);

  const side = {};
  const spawns = normalizeSpawns(source.spawns, label);
  const join = normalizeJoin(source.join, label);

  if (spawns) side.spawns = spawns;
  if (join) side.join = join;

  return Object.keys(side).length ? side : undefined;
}

export function buildDeployableXrc729Payload(value) {
  const source = assertObject(value, 'XRC-729 JSON');
  const id = readRequiredString(source.id, 'XRC-729 id');
  const structure = assertObject(source.structure, 'XRC-729 structure');
  const entries = Object.entries(structure);

  if (!entries.length) {
    throw new Error('XRC-729 structure must contain at least one step.');
  }

  const deployableStructure = {};

  for (const [rawStepId, rawStep] of entries) {
    const stepId = readRequiredString(rawStepId, 'XRC-729 step id');
    const step = assertObject(rawStep, `XRC-729 step ${stepId}`);
    const rule = readRequiredString(step.rule, `XRC-729 step ${stepId} rule`);

    const deployableStep = { rule };
    const onValid = normalizeTransitionSide(step.onValid, `XRC-729 step ${stepId}.onValid`);
    const onInvalid = normalizeTransitionSide(step.onInvalid, `XRC-729 step ${stepId}.onInvalid`);

    if (onValid) deployableStep.onValid = onValid;
    if (onInvalid) deployableStep.onInvalid = onInvalid;

    deployableStructure[stepId] = deployableStep;
  }

  return {
    id,
    structure: deployableStructure,
  };
}
