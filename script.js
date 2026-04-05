const UI_RENDER_INTERVAL_MS = 1000 / 16;
const FPS_RATE_WINDOW_MS = 5000;
const MAX_PACE_WINDOW_MS = 10000;
const ANIMATION_FALLBACK_DELAY_MS = 50;
const MAX_LOGGED_PRIMES = 5000;
const WORKER_REPORT_INTERVAL_VISIBLE_MS = 1000 / 16;
const WORKER_REPORT_INTERVAL_HIDDEN_MS = 1000;
const MIN_MATH_BUDGET_MS = 0.0001;
const DEFAULT_MATH_BUDGET_MS = 1;
const SAVE_FILE_FORMAT = "PrimeCalcSave";
const SAVE_FILE_VERSION = 1;
const EXPORT_REQUEST_TIMEOUT_MS = 15000;
const SPIN_CAT_PLAY_DURATION_MS = 3090;
const CAT_SPAWN_INTERVAL_MS = 3000;
const CAT_MIN_SIZE_PX = 28;
const CAT_MAX_SIZE_PX = 90;
const CAT_SOURCE = "spincat.gif";

const integerFormatter = new Intl.NumberFormat("en-US");
const rateFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const budgetFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const elements = {
  speedButtons: Array.from(document.querySelectorAll(".speed-option")),
  overclockValue: document.querySelector("#overclock-value"),
  pauseToggle: document.querySelector("#pause-toggle"),
  saveButton: document.querySelector("#save-button"),
  loadButton: document.querySelector("#load-button"),
  loadInput: document.querySelector("#load-input"),
  resetButton: document.querySelector("#reset-button"),
  systemStatus: document.querySelector("#system-status"),
  latestPrime: document.querySelector("#latest-prime"),
  calcSpeed: document.querySelector("#calc-speed"),
  fpsCounter: document.querySelector("#fps-counter"),
  primeCount: document.querySelector("#prime-count"),
  primeSpeed: document.querySelector("#prime-speed"),
  currentCandidate: document.querySelector("#current-candidate"),
  testedCount: document.querySelector("#tested-count"),
  primeGapAverage: document.querySelector("#prime-gap-average"),
  uptime: document.querySelector("#uptime"),
  mathVerdict: document.querySelector("#math-verdict"),
  mathLog: document.querySelector("#math-log"),
  primeLog: document.querySelector("#prime-log"),
  catOverlay: document.querySelector("#cat-overlay"),
};

const INITIAL_MATH_TEXT = [
  "Testing 3",
  "rule: test odd candidates with stored prime divisors up to sqrt(candidate)",
  "parity: odd candidate, so even divisors are skipped",
  "",
  "sqrt limit: 1.73 (trial divisors <= 1)",
  "stored primes available: 1",
  "divisor checks run: 0",
  "sample modulo checks:",
  "none needed",
  "highest divisor tested: none needed",
  "stop reason: sqrt(3) = 1.73, so the scanner can already mark 3 as prime.",
  "",
  "result: PRIME",
].join("\n");

const state = {
  running: true,
  workerError: false,
  mathBudgetMs: DEFAULT_MATH_BUDGET_MS,
  actualMathBudgetMs: 0,
  manualBudgetMs: DEFAULT_MATH_BUDGET_MS,
  overclockMode: "manual",
  lastPrime: 2,
  candidate: 3,
  testedCount: 1,
  totalPrimeCount: 1,
  runtimeMs: 0,
  calcSpeed: 0,
  primeSpeed: 0,
  averagePrimeGap: 0,
  fps: 0,
  frameTimestamps: [],
  displayedPrimeLog: ["2"],
  primeLogText: "2",
  primeLogColumns: 1,
  primeLogDirty: true,
  mathVerdict: "PRIME",
  mathText: INITIAL_MATH_TEXT,
  lastUiRenderTime: 0,
};

let pendingAnimationFrameId = 0;
let pendingAnimationFallbackId = 0;
let pendingCatSpawnId = 0;
let nextFloatingCatId = 0;
let pendingExportRequest = null;
const activeCatCleanupIds = new Set();

const workerSource = `
const PRIME_RATE_WINDOW_MS = 5000;
const MAX_PACE_WINDOW_MS = ${MAX_PACE_WINDOW_MS};
const MAX_PACE_BUCKET_MS = 250;
const CALC_SAMPLE_INTERVAL_MS = 250;
const DEFAULT_BUDGET_MS = ${DEFAULT_MATH_BUDGET_MS};
const DEFAULT_REPORT_INTERVAL_MS = 1000 / 16;
const MIN_BUDGET_MS = ${MIN_MATH_BUDGET_MS};
const MAX_PENDING_PRIMES = 5000;
const MAX_TRACE_SAMPLES = 6;
const RECENT_PRIME_WINDOW = 100;
const MAX_ITERATIONS_PER_CYCLE = 20000;
const ACTIVE_TICK_DELAY_MS = 0;
const PAUSED_TICK_DELAY_MS = 50;

const integerFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

let state = null;
let tickTimerId = 0;

function formatInteger(value) {
  return integerFormatter.format(Math.round(Math.max(0, value)));
}

function formatDecimal(value) {
  return decimalFormatter.format(Number.isFinite(value) ? value : 0);
}

function clampBudget(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BUDGET_MS;
  }

  return Math.max(MIN_BUDGET_MS, value);
}

function clampReportInterval(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_REPORT_INTERVAL_MS;
  }

  return Math.max(100, value);
}

function buildMathText(details) {
  const lines = [
    "Testing " + formatInteger(details.candidate),
    "rule: test odd candidates with stored prime divisors up to sqrt(candidate)",
    "parity: odd candidate, so even divisors are skipped",
    "",
    "sqrt limit: " + formatDecimal(details.limit) + " (trial divisors <= " + formatInteger(Math.floor(details.limit)) + ")",
    "stored primes available: " + formatInteger(details.availablePrimeCount),
    "divisor checks run: " + formatInteger(details.checks),
    "sample modulo checks:",
  ];

  if (details.sampleChecks.length === 0) {
    lines.push("none needed");
  } else {
    for (const sample of details.sampleChecks) {
      lines.push(sample);
    }
  }

  lines.push("highest divisor tested: " + (details.highestDivisorTested === null ? "none needed" : formatInteger(details.highestDivisorTested)));

  if (details.divisor !== null) {
    lines.push("factor found: " + formatInteger(details.divisor));
  }

  lines.push("stop reason: " + details.stopReason);
  lines.push("");
  lines.push("result: " + details.verdict);

  return lines.join("\\n");
}

function calculateAveragePrimeGap(primeWindow) {
  if (!Array.isArray(primeWindow) || primeWindow.length < 2) {
    return 0;
  }

  let gapTotal = 0;

  for (let index = 1; index < primeWindow.length; index += 1) {
    gapTotal += primeWindow[index] - primeWindow[index - 1];
  }

  return gapTotal / (primeWindow.length - 1);
}

function createState() {
  const now = performance.now();

  return {
    running: true,
    mathBudgetMs: DEFAULT_BUDGET_MS,
    maxMode: false,
    reportIntervalMs: DEFAULT_REPORT_INTERVAL_MS,
    lastTickTime: now,
    lastCalcSampleTime: now,
    lastCalcSampleTestedCount: 1,
    lastReportTime: 0,
    runtimeMs: 0,
    calcSpeed: 0,
    primeSpeed: 0,
    averagePrimeGap: 0,
    actualMathBudgetMs: 0,
    mathPaceBuckets: [],
    primeRateBuckets: [],
    primes: [2],
    recentPrimeWindow: [2],
    lastPrime: 2,
    candidate: 3,
    testedCount: 1,
    totalPrimeCount: 1,
    pendingPrimeLabels: [],
    resetPrimeLog: true,
    mathVerdict: "PRIME",
    mathText: buildMathText({
      candidate: 3,
      limit: Math.sqrt(3),
      availablePrimeCount: 1,
      checks: 0,
      sampleChecks: [],
      highestDivisorTested: null,
      divisor: null,
      stopReason: "sqrt(3) = 1.73, so the scanner can already mark 3 as prime.",
      verdict: "PRIME",
    }),
  };
}

function buildSaveData() {
  const now = performance.now();
  prunePrimeRateBuckets(now);

  return {
    format: "${SAVE_FILE_FORMAT}",
    version: ${SAVE_FILE_VERSION},
    savedAt: new Date().toISOString(),
    running: state.running,
    mathBudgetMs: state.mathBudgetMs,
    maxMode: state.maxMode,
    runtimeMs: state.runtimeMs,
    testedCount: state.testedCount,
    totalPrimeCount: state.totalPrimeCount,
    lastPrime: state.lastPrime,
    candidate: state.candidate,
    mathVerdict: state.mathVerdict,
    mathText: state.mathText,
    averagePrimeGap: state.averagePrimeGap,
    primes: state.primes.slice(),
    recentPrimeWindow: state.recentPrimeWindow.slice(),
    primeFeedNumbers: state.primes.slice(-MAX_PENDING_PRIMES),
    primeRateBuckets: state.primeRateBuckets.map((bucket) => ({
      ageMs: Math.max(0, now - bucket.time),
      count: bucket.count,
    })),
  };
}

function importState(data, reportIntervalMs) {
  const now = performance.now();
  const primes = Array.isArray(data.primes) ? data.primes.slice() : [];

  if (primes.length === 0 || primes[0] !== 2) {
    throw new Error("Invalid prime cache in save file.");
  }

  const recentPrimeWindow = Array.isArray(data.recentPrimeWindow) && data.recentPrimeWindow.length > 0
    ? data.recentPrimeWindow.slice(-RECENT_PRIME_WINDOW)
    : primes.slice(-RECENT_PRIME_WINDOW);
  const lastPrime = primes[primes.length - 1];
  const rawCandidate = Math.round(Number(data.candidate));
  const fallbackCandidate = lastPrime === 2 ? 3 : lastPrime + 2;
  let candidate = Number.isFinite(rawCandidate) ? rawCandidate : fallbackCandidate;

  if (candidate <= lastPrime) {
    candidate = fallbackCandidate;
  }

  if (candidate % 2 === 0) {
    candidate += 1;
  }

  state = createState();
  state.running = Boolean(data.running);
  state.mathBudgetMs = clampBudget(data.mathBudgetMs);
  state.maxMode = Boolean(data.maxMode);
  state.reportIntervalMs = clampReportInterval(reportIntervalMs);
  state.lastTickTime = now;
  state.lastCalcSampleTime = now;
  state.lastCalcSampleTestedCount = Math.max(1, Math.round(Number(data.testedCount) || 1));
  state.lastReportTime = 0;
  state.runtimeMs = Math.max(0, Number(data.runtimeMs) || 0);
  state.primes = primes;
  state.recentPrimeWindow = recentPrimeWindow;
  state.lastPrime = lastPrime;
  state.candidate = candidate;
  state.testedCount = Math.max(1, Math.round(Number(data.testedCount) || 1));
  state.totalPrimeCount = Math.max(primes.length, Math.round(Number(data.totalPrimeCount) || primes.length));
  state.averagePrimeGap = calculateAveragePrimeGap(state.recentPrimeWindow);
  state.primeRateBuckets = Array.isArray(data.primeRateBuckets)
    ? data.primeRateBuckets
      .map((bucket) => ({
        time: now - Math.max(0, Number(bucket.ageMs) || 0),
        count: Math.max(0, Math.round(Number(bucket.count) || 0)),
      }))
      .filter((bucket) => bucket.count > 0 && now - bucket.time <= PRIME_RATE_WINDOW_MS)
    : [];
  state.pendingPrimeLabels = [];
  state.resetPrimeLog = true;
  state.mathVerdict = typeof data.mathVerdict === "string" ? data.mathVerdict : "PRIME";
  state.mathText = typeof data.mathText === "string" && data.mathText.trim()
    ? data.mathText
    : buildMathText({
      candidate: candidate,
      limit: Math.sqrt(candidate),
      availablePrimeCount: primes.length,
      checks: 0,
      sampleChecks: [],
      highestDivisorTested: null,
      divisor: null,
      stopReason: "Save loaded. Prime scan resumed.",
      verdict: state.mathVerdict,
    });
  ensureLoop();
  postSnapshot(now);
}

function prunePrimeRateBuckets(now) {
  while (state.primeRateBuckets.length > 0 && now - state.primeRateBuckets[0].time > PRIME_RATE_WINDOW_MS) {
    state.primeRateBuckets.shift();
  }
}

function pruneMathPaceBuckets(now) {
  while (state.mathPaceBuckets.length > 0 && now - state.mathPaceBuckets[0].time > MAX_PACE_WINDOW_MS) {
    state.mathPaceBuckets.shift();
  }
}

function recordMathPace(now, spentMs) {
  if (!(spentMs > 0)) {
    return;
  }

  const lastBucket = state.mathPaceBuckets[state.mathPaceBuckets.length - 1];

  if (lastBucket && now - lastBucket.time < MAX_PACE_BUCKET_MS) {
    lastBucket.time = now;
    lastBucket.spentMs += spentMs;
    lastBucket.cycles += 1;
  } else {
    state.mathPaceBuckets.push({
      time: now,
      spentMs: spentMs,
      cycles: 1,
    });
  }

  pruneMathPaceBuckets(now);
}

function updateActualMathBudget(now) {
  pruneMathPaceBuckets(now);

  if (state.mathPaceBuckets.length === 0) {
    state.actualMathBudgetMs = 0;
    return;
  }

  let spentTotal = 0;
  let cycleTotal = 0;

  for (const bucket of state.mathPaceBuckets) {
    spentTotal += bucket.spentMs;
    cycleTotal += bucket.cycles;
  }

  state.actualMathBudgetMs = cycleTotal > 0 ? spentTotal / cycleTotal : 0;
}

function updatePrimeSpeed(now) {
  prunePrimeRateBuckets(now);

  if (state.primeRateBuckets.length === 0) {
    state.primeSpeed = 0;
    return;
  }

  let primeCount = 0;

  for (const bucket of state.primeRateBuckets) {
    primeCount += bucket.count;
  }

  const firstRelevantTime = Math.max(now - PRIME_RATE_WINDOW_MS, state.primeRateBuckets[0].time);
  const windowMs = Math.max(1, now - firstRelevantTime);
  state.primeSpeed = (primeCount / windowMs) * 1000;
}

function updateCalcSpeed(now) {
  const elapsed = now - state.lastCalcSampleTime;

  if (elapsed < CALC_SAMPLE_INTERVAL_MS) {
    return;
  }

  const testedDelta = state.testedCount - state.lastCalcSampleTestedCount;
  state.calcSpeed = elapsed > 0 ? (testedDelta / elapsed) * 1000 : 0;
  state.lastCalcSampleTime = now;
  state.lastCalcSampleTestedCount = state.testedCount;
}

function analyzeCandidate(candidate) {
  const limit = Math.sqrt(candidate);
  const sampleChecks = [];
  let checks = 0;
  let highestDivisorTested = null;
  let divisor = null;
  let stopReason = "";

  for (let index = 1; index < state.primes.length; index += 1) {
    const prime = state.primes[index];

    if (prime > limit) {
      stopReason = "The next stored prime, " + formatInteger(prime) + ", is above sqrt(" + formatInteger(candidate) + "), so no divisor can still fit.";
      break;
    }

    const remainder = candidate % prime;
    checks += 1;
    highestDivisorTested = prime;

    if (sampleChecks.length < MAX_TRACE_SAMPLES || remainder === 0) {
      sampleChecks.push("  " + formatInteger(prime) + " -> " + formatInteger(candidate) + " mod " + formatInteger(prime) + " = " + formatInteger(remainder));
    }

    if (remainder === 0) {
      divisor = prime;
      stopReason = formatInteger(prime) + " divides " + formatInteger(candidate) + " evenly, so the candidate is composite.";
      break;
    }
  }

  if (!stopReason) {
    if (checks === 0) {
      stopReason = "sqrt(" + formatInteger(candidate) + ") = " + formatDecimal(limit) + ", so the scanner can already mark " + formatInteger(candidate) + " as prime.";
    } else {
      stopReason = "No stored prime divisor up to sqrt(" + formatInteger(candidate) + ") worked, so the candidate is prime.";
    }
  }

  const verdict = divisor === null ? "PRIME" : "COMPOSITE";

  return {
    isPrime: divisor === null,
    verdict: verdict,
    text: buildMathText({
      candidate: candidate,
      limit: limit,
      availablePrimeCount: state.primes.length,
      checks: checks,
      sampleChecks: sampleChecks,
      highestDivisorTested: highestDivisorTested,
      divisor: divisor,
      stopReason: stopReason,
      verdict: verdict,
    }),
  };
}

function processWorkCycle() {
  let primesFound = 0;
  let iterations = 0;
  const cycleStarted = performance.now();
  let cycleEnded = cycleStarted;
  let spentTotal = 0;

  do {
    const candidate = state.candidate;
    const analysis = analyzeCandidate(candidate);

    state.testedCount += 1;
    state.mathVerdict = analysis.verdict;
    state.mathText = analysis.text;

    if (analysis.isPrime) {
      state.primes.push(candidate);
      state.recentPrimeWindow.push(candidate);

      if (state.recentPrimeWindow.length > RECENT_PRIME_WINDOW) {
        state.recentPrimeWindow.shift();
      }

      state.lastPrime = candidate;
      state.totalPrimeCount += 1;
      state.averagePrimeGap = calculateAveragePrimeGap(state.recentPrimeWindow);
      state.pendingPrimeLabels.push(formatInteger(candidate));

      if (state.pendingPrimeLabels.length > MAX_PENDING_PRIMES) {
        state.pendingPrimeLabels = state.pendingPrimeLabels.slice(-MAX_PENDING_PRIMES);
      }

      primesFound += 1;
    }

    state.candidate += 2;

    iterations += 1;
    cycleEnded = performance.now();

    if (iterations >= MAX_ITERATIONS_PER_CYCLE) {
      break;
    }
  } while (state.maxMode || cycleEnded - cycleStarted < state.mathBudgetMs);

  if (primesFound > 0) {
    state.primeRateBuckets.push({
      time: cycleEnded,
      count: primesFound,
    });
  }

  spentTotal = Math.max(cycleEnded - cycleStarted, 0.01);
  return spentTotal;
}

function postSnapshot(now) {
  state.lastReportTime = now;
  updateActualMathBudget(now);

  self.postMessage({
    type: "snapshot",
    running: state.running,
    lastPrime: state.lastPrime,
    candidate: state.candidate,
    testedCount: state.testedCount,
    totalPrimeCount: state.totalPrimeCount,
    runtimeMs: state.runtimeMs,
    calcSpeed: state.calcSpeed,
    primeSpeed: state.primeSpeed,
    averagePrimeGap: state.averagePrimeGap,
    actualMathBudgetMs: state.actualMathBudgetMs,
    mathVerdict: state.mathVerdict,
    mathText: state.mathText,
    primeFeedLabels: state.resetPrimeLog
      ? state.primes.slice(-MAX_PENDING_PRIMES).map((prime) => formatInteger(prime))
      : null,
    newPrimeLabels: state.pendingPrimeLabels.slice(),
    resetPrimeLog: state.resetPrimeLog,
  });

  state.pendingPrimeLabels = [];
  state.resetPrimeLog = false;
}

function scheduleTick(delay) {
  tickTimerId = setTimeout(tick, delay);
}

function ensureLoop() {
  if (!tickTimerId) {
    scheduleTick(0);
  }
}

function tick() {
  tickTimerId = 0;

  if (!state) {
    return;
  }

  const tickStarted = performance.now();
  const elapsed = Math.max(0, tickStarted - state.lastTickTime);
  let loopNow = tickStarted;

  if (state.running) {
    const spentThisCycle = processWorkCycle();
    loopNow = performance.now();
    recordMathPace(loopNow, spentThisCycle);
    state.runtimeMs += elapsed + Math.max(0, loopNow - tickStarted);
    state.lastTickTime = loopNow;
  } else {
    state.lastTickTime = tickStarted;
  }

  updateCalcSpeed(loopNow);
  updatePrimeSpeed(loopNow);
  updateActualMathBudget(loopNow);

  if (loopNow - state.lastReportTime >= state.reportIntervalMs) {
    postSnapshot(loopNow);
  }

  scheduleTick(state.running ? ACTIVE_TICK_DELAY_MS : PAUSED_TICK_DELAY_MS);
}

function initialize(message) {
  state = createState();
  state.mathBudgetMs = clampBudget(message.mathBudgetMs);
  state.maxMode = Boolean(message.maxMode);
  state.reportIntervalMs = clampReportInterval(message.reportIntervalMs);
  state.lastTickTime = performance.now();
  state.lastCalcSampleTime = state.lastTickTime;
  state.lastReportTime = 0;
  ensureLoop();
  postSnapshot(state.lastTickTime);
}

function resetState() {
  const budget = state ? state.mathBudgetMs : DEFAULT_BUDGET_MS;
  const maxMode = state ? state.maxMode : false;
  const reportInterval = state ? state.reportIntervalMs : DEFAULT_REPORT_INTERVAL_MS;
  state = createState();
  state.mathBudgetMs = budget;
  state.maxMode = maxMode;
  state.reportIntervalMs = reportInterval;
  state.lastTickTime = performance.now();
  state.lastCalcSampleTime = state.lastTickTime;
  state.lastReportTime = 0;
  ensureLoop();
  postSnapshot(state.lastTickTime);
}

self.addEventListener("message", (event) => {
  const message = event.data || {};

  switch (message.type) {
    case "init":
      initialize(message);
      break;

    case "set-budget":
      if (!state) {
        break;
      }

      state.mathBudgetMs = clampBudget(message.mathBudgetMs);
      state.maxMode = Boolean(message.maxMode);
      break;

    case "set-running":
      if (!state) {
        break;
      }

      state.running = Boolean(message.running);
      state.lastTickTime = performance.now();
      postSnapshot(state.lastTickTime);
      break;

    case "reset":
      resetState();
      break;

    case "export-state":
      if (!state) {
        break;
      }

      self.postMessage({
        type: "export-state",
        data: buildSaveData(),
      });
      break;

    case "import-state":
      importState(message.data, message.reportIntervalMs);
      break;

    case "set-report-interval":
      if (!state) {
        break;
      }

      state.reportIntervalMs = clampReportInterval(message.reportIntervalMs);
      break;

    default:
      break;
  }
});
`;

const workerUrl = URL.createObjectURL(
  new Blob([workerSource], { type: "text/javascript" }),
);
const primeWorker = new Worker(workerUrl);
URL.revokeObjectURL(workerUrl);

function formatInteger(value) {
  return integerFormatter.format(Math.round(Math.max(0, value)));
}

function formatRate(value) {
  return rateFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatBudget(value) {
  return budgetFormatter.format(Number.isFinite(value) ? value : 0);
}

function formatUptime(value) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours + ":" + minutes + ":" + seconds;
}

function clampMathBudget(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MATH_BUDGET_MS;
  }

  return Math.max(MIN_MATH_BUDGET_MS, value);
}

function buildPrimeFeedText(labels, columns) {
  if (!Array.isArray(labels) || labels.length === 0) {
    return "";
  }

  let longestLabelLength = 1;

  for (const label of labels) {
    if (label.length > longestLabelLength) {
      longestLabelLength = label.length;
    }
  }

  const cellWidth = longestLabelLength + 4;
  const rows = [];

  for (let index = 0; index < labels.length; index += columns) {
    const row = labels
      .slice(index, index + columns)
      .map((label, labelIndex, rowLabels) => (
        labelIndex === rowLabels.length - 1 ? label : label.padEnd(cellWidth, " ")
      ))
      .join("");

    rows.push(row);
  }

  return rows.join("\n");
}

function getPrimeFeedColumnCount() {
  const containerWidth = elements.primeLog.clientWidth
    || elements.primeLog.parentElement?.clientWidth
    || window.innerWidth
    || 1;
  const longestLabelLength = state.displayedPrimeLog[state.displayedPrimeLog.length - 1]?.length || 1;
  const estimatedCellWidth = Math.max(112, (longestLabelLength + 4) * 11.5);
  return Math.max(1, Math.floor(containerWidth / estimatedCellWidth));
}

function setText(element, value) {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function parsePositiveIntegerArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => Math.round(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function cleanupPendingExportRequest(reason = "Save canceled.") {
  if (!pendingExportRequest) {
    return;
  }

  const { reject, timeoutId } = pendingExportRequest;
  window.clearTimeout(timeoutId);
  pendingExportRequest = null;

  if (typeof reject === "function") {
    reject(new Error(reason));
  }
}

function requestWorkerSaveData() {
  if (pendingExportRequest) {
    return Promise.reject(new Error("A save is already in progress."));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingExportRequest = null;
      reject(new Error("Timed out while waiting for worker save data."));
    }, EXPORT_REQUEST_TIMEOUT_MS);

    pendingExportRequest = {
      resolve,
      reject,
      timeoutId,
    };

    primeWorker.postMessage({ type: "export-state" });
  });
}

function buildSaveFileName() {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");

  return `primecalc-save-${timestamp}.json`;
}

function downloadSaveData(saveData) {
  const blob = new Blob([JSON.stringify(saveData, null, 2)], {
    type: "application/json",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = buildSaveFileName();
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}

function normalizeSaveData(rawData) {
  if (!rawData || typeof rawData !== "object") {
    throw new Error("The save file is not valid JSON data.");
  }

  if (rawData.format !== SAVE_FILE_FORMAT) {
    throw new Error("This file is not a PrimeCalc save.");
  }

  const primes = parsePositiveIntegerArray(rawData.primes);

  if (primes.length === 0 || primes[0] !== 2) {
    throw new Error("The save file is missing its prime cache.");
  }

  const recentPrimeWindow = parsePositiveIntegerArray(rawData.recentPrimeWindow).slice(-100);
  const primeRateBuckets = Array.isArray(rawData.primeRateBuckets)
    ? rawData.primeRateBuckets
      .map((bucket) => ({
        ageMs: Math.max(0, Number(bucket?.ageMs) || 0),
        count: Math.max(0, Math.round(Number(bucket?.count) || 0)),
      }))
      .filter((bucket) => bucket.count > 0)
    : [];
  const totalPrimeCount = Math.max(primes.length, Math.round(Number(rawData.totalPrimeCount) || primes.length));
  const lastPrime = primes[primes.length - 1];
  const candidateValue = Math.round(Number(rawData.candidate));
  let candidate = Number.isFinite(candidateValue) ? candidateValue : (lastPrime === 2 ? 3 : lastPrime + 2);

  if (candidate <= lastPrime) {
    candidate = lastPrime === 2 ? 3 : lastPrime + 2;
  }

  if (candidate % 2 === 0) {
    candidate += 1;
  }

  return {
    format: SAVE_FILE_FORMAT,
    version: Math.max(1, Math.round(Number(rawData.version) || SAVE_FILE_VERSION)),
    savedAt: typeof rawData.savedAt === "string" ? rawData.savedAt : new Date().toISOString(),
    running: Boolean(rawData.running),
    mathBudgetMs: clampMathBudget(rawData.mathBudgetMs),
    maxMode: Boolean(rawData.maxMode),
    runtimeMs: Math.max(0, Number(rawData.runtimeMs) || 0),
    testedCount: Math.max(1, Math.round(Number(rawData.testedCount) || 1)),
    totalPrimeCount: totalPrimeCount,
    lastPrime: lastPrime,
    candidate: candidate,
    mathVerdict: typeof rawData.mathVerdict === "string" ? rawData.mathVerdict : "PRIME",
    mathText: typeof rawData.mathText === "string" ? rawData.mathText : INITIAL_MATH_TEXT,
    averagePrimeGap: Number.isFinite(Number(rawData.averagePrimeGap)) ? Number(rawData.averagePrimeGap) : 0,
    primes: primes,
    recentPrimeWindow: recentPrimeWindow.length > 0 ? recentPrimeWindow : primes.slice(-100),
    primeFeedNumbers: parsePositiveIntegerArray(rawData.primeFeedNumbers).slice(-MAX_LOGGED_PRIMES),
    primeRateBuckets: primeRateBuckets,
  };
}

function loadSaveData(saveData) {
  cleanupPendingExportRequest("Save canceled while loading a save file.");
  clearFloatingCats();
  state.workerError = false;
  state.overclockMode = saveData.maxMode ? "max" : "manual";
  state.manualBudgetMs = saveData.mathBudgetMs;
  state.mathBudgetMs = saveData.mathBudgetMs;
  state.actualMathBudgetMs = 0;
  state.running = saveData.running;
  state.lastPrime = saveData.lastPrime;
  state.candidate = saveData.candidate;
  state.testedCount = saveData.testedCount;
  state.totalPrimeCount = saveData.totalPrimeCount;
  state.runtimeMs = saveData.runtimeMs;
  state.calcSpeed = 0;
  state.primeSpeed = 0;
  state.averagePrimeGap = saveData.averagePrimeGap;
  state.mathVerdict = saveData.mathVerdict;
  state.mathText = saveData.mathText;
  state.displayedPrimeLog = saveData.primeFeedNumbers.length > 0
    ? saveData.primeFeedNumbers.map((prime) => formatInteger(prime))
    : saveData.primes.slice(-MAX_LOGGED_PRIMES).map((prime) => formatInteger(prime));
  state.primeLogText = buildPrimeFeedText(state.displayedPrimeLog, state.primeLogColumns);
  state.primeLogDirty = true;
  updateOverclockButtons();
  render(performance.now(), true);
  primeWorker.postMessage({
    type: "import-state",
    data: saveData,
    reportIntervalMs: getWorkerReportInterval(),
  });
  scheduleNextFloatingCat();
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function clearCatSpawnTimer() {
  if (pendingCatSpawnId) {
    window.clearTimeout(pendingCatSpawnId);
    pendingCatSpawnId = 0;
  }
}

function clearFloatingCats() {
  clearCatSpawnTimer();

  for (const cleanupId of activeCatCleanupIds) {
    window.clearTimeout(cleanupId);
  }

  activeCatCleanupIds.clear();
  elements.catOverlay?.replaceChildren();
}

function getRandomCatSize() {
  const viewportMin = Math.max(
    240,
    Math.min(window.innerWidth || CAT_MAX_SIZE_PX, window.innerHeight || CAT_MAX_SIZE_PX),
  );
  const minSize = Math.max(CAT_MIN_SIZE_PX, Math.round(viewportMin * 0.09));
  const maxSize = Math.max(
    minSize + 10,
    Math.min(CAT_MAX_SIZE_PX, Math.round(viewportMin * 0.17)),
  );

  return Math.round(randomBetween(minSize, maxSize));
}

function spawnFloatingCat() {
  if (!elements.catOverlay || document.visibilityState === "hidden") {
    return;
  }

  const cat = document.createElement("img");
  const size = getRandomCatSize();
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - size - margin);
  const maxTop = Math.max(margin, window.innerHeight - size - margin);
  const catUrl = new URL(CAT_SOURCE, window.location.href);

  nextFloatingCatId += 1;
  catUrl.searchParams.set("spawn", String(nextFloatingCatId));

  cat.src = catUrl.toString();
  cat.alt = "";
  cat.setAttribute("aria-hidden", "true");
  cat.className = "floating-cat";
  cat.decoding = "async";
  cat.loading = "eager";
  cat.style.width = `${size}px`;
  cat.style.left = `${Math.round(randomBetween(margin, maxLeft))}px`;
  cat.style.top = `${Math.round(randomBetween(margin, maxTop))}px`;
  cat.style.setProperty("--cat-life", `${SPIN_CAT_PLAY_DURATION_MS}ms`);
  cat.style.setProperty("--cat-drift-x", `${randomBetween(-24, 24).toFixed(1)}px`);
  cat.style.setProperty("--cat-drift-y", `${randomBetween(-18, 18).toFixed(1)}px`);
  elements.catOverlay.append(cat);

  const cleanupId = window.setTimeout(() => {
    activeCatCleanupIds.delete(cleanupId);
    cat.remove();
  }, SPIN_CAT_PLAY_DURATION_MS + 160);

  activeCatCleanupIds.add(cleanupId);
}

function scheduleNextFloatingCat() {
  clearCatSpawnTimer();

  if (!elements.catOverlay || document.visibilityState === "hidden") {
    return;
  }

  pendingCatSpawnId = window.setTimeout(() => {
    pendingCatSpawnId = 0;
    spawnFloatingCat();
    scheduleNextFloatingCat();
  }, CAT_SPAWN_INTERVAL_MS);
}

function updateOverclockButtons() {
  for (const button of elements.speedButtons) {
    const isMaxButton = button.dataset.speedMode === "max";
    const buttonValue = Number(button.dataset.speedValue);
    const isActive = isMaxButton
      ? state.overclockMode === "max"
      : state.overclockMode === "manual" && buttonValue === state.manualBudgetMs;

    button.classList.toggle("speed-option--active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateOverclockReadout() {
  if (state.overclockMode === "max") {
    setText(
      elements.overclockValue,
      "Max pace avg (10s): "
        + formatBudget(state.actualMathBudgetMs)
        + " ms / cycle",
    );
    return;
  }

  setText(
    elements.overclockValue,
    "Manual pace: "
      + formatBudget(state.mathBudgetMs)
      + " ms / cycle | actual avg (10s) "
      + formatBudget(state.actualMathBudgetMs)
      + " ms",
  );
}

function syncMathBudgetWithWorker() {
  primeWorker.postMessage({
    type: "set-budget",
    mathBudgetMs: state.mathBudgetMs,
    maxMode: state.overclockMode === "max",
  });
}

function setManualBudget(value) {
  const clampedBudget = clampMathBudget(value);

  state.overclockMode = "manual";
  state.manualBudgetMs = clampedBudget;
  state.mathBudgetMs = clampedBudget;
  state.actualMathBudgetMs = 0;
  updateOverclockButtons();
  render(performance.now(), true);
  syncMathBudgetWithWorker();
}

function setMaxMode() {
  state.overclockMode = "max";
  state.actualMathBudgetMs = 0;
  updateOverclockButtons();
  render(performance.now(), true);
  syncMathBudgetWithWorker();
}

function getWorkerReportInterval() {
  return document.visibilityState === "hidden"
    ? WORKER_REPORT_INTERVAL_HIDDEN_MS
    : WORKER_REPORT_INTERVAL_VISIBLE_MS;
}

function resetDisplayState() {
  state.running = true;
  state.workerError = false;
  state.lastPrime = 2;
  state.candidate = 3;
  state.testedCount = 1;
  state.totalPrimeCount = 1;
  state.runtimeMs = 0;
  state.calcSpeed = 0;
  state.primeSpeed = 0;
  state.averagePrimeGap = 0;
  state.actualMathBudgetMs = 0;
  state.fps = 0;
  state.frameTimestamps = [];
  state.displayedPrimeLog = ["2"];
  state.primeLogText = buildPrimeFeedText(state.displayedPrimeLog, state.primeLogColumns);
  state.primeLogDirty = true;
  state.mathVerdict = "PRIME";
  state.mathText = INITIAL_MATH_TEXT;
}

function appendPrimeLabels(labels) {
  if (!Array.isArray(labels) || labels.length === 0) {
    return;
  }

  state.displayedPrimeLog.push(...labels);

  if (state.displayedPrimeLog.length > MAX_LOGGED_PRIMES) {
    state.displayedPrimeLog = state.displayedPrimeLog.slice(-MAX_LOGGED_PRIMES);
  }

  state.primeLogDirty = true;
}

function applyWorkerSnapshot(snapshot) {
  state.workerError = false;
  state.running = Boolean(snapshot.running);
  state.lastPrime = snapshot.lastPrime;
  state.candidate = snapshot.candidate;
  state.testedCount = snapshot.testedCount;
  state.totalPrimeCount = snapshot.totalPrimeCount;
  state.runtimeMs = snapshot.runtimeMs;
  state.calcSpeed = snapshot.calcSpeed;
  state.primeSpeed = snapshot.primeSpeed;
  state.averagePrimeGap = snapshot.averagePrimeGap;
  state.actualMathBudgetMs = snapshot.actualMathBudgetMs;
  state.mathVerdict = snapshot.mathVerdict;
  state.mathText = snapshot.mathText;

  if (snapshot.resetPrimeLog) {
    state.displayedPrimeLog = Array.isArray(snapshot.primeFeedLabels) && snapshot.primeFeedLabels.length > 0
      ? snapshot.primeFeedLabels.slice(-MAX_LOGGED_PRIMES)
      : ["2"];
    state.primeLogText = buildPrimeFeedText(state.displayedPrimeLog, state.primeLogColumns);
    state.primeLogDirty = true;
  }

  appendPrimeLabels(snapshot.newPrimeLabels);
  render(performance.now());
}

function recordFrame(now) {
  state.frameTimestamps.push(now);

  while (
    state.frameTimestamps.length > 0
    && now - state.frameTimestamps[0] > FPS_RATE_WINDOW_MS
  ) {
    state.frameTimestamps.shift();
  }

  if (state.frameTimestamps.length < 2) {
    state.fps = 0;
    return;
  }

  const windowMs = now - state.frameTimestamps[0];
  state.fps = windowMs > 0
    ? ((state.frameTimestamps.length - 1) / windowMs) * 1000
    : 0;
}

function render(now = performance.now(), force = false) {
  if (!force && now - state.lastUiRenderTime < UI_RENDER_INTERVAL_MS) {
    return;
  }

  state.lastUiRenderTime = now;
  const nextPrimeLogColumns = getPrimeFeedColumnCount();

  if (nextPrimeLogColumns !== state.primeLogColumns) {
    state.primeLogColumns = nextPrimeLogColumns;
    state.primeLogDirty = true;
  }

  updateOverclockReadout();
  setText(elements.systemStatus, state.workerError ? "WORKER ERROR" : (state.running ? "RUNNING" : "PAUSED"));
  setText(elements.latestPrime, formatInteger(state.lastPrime));
  setText(elements.calcSpeed, formatRate(state.calcSpeed));
  setText(elements.fpsCounter, formatRate(state.fps));
  setText(elements.primeCount, formatInteger(state.totalPrimeCount));
  setText(elements.primeSpeed, formatRate(state.primeSpeed));
  setText(elements.currentCandidate, formatInteger(state.candidate));
  setText(elements.testedCount, formatInteger(state.testedCount));
  setText(elements.primeGapAverage, formatRate(state.averagePrimeGap));
  setText(elements.uptime, formatUptime(state.runtimeMs));
  setText(elements.mathVerdict, state.mathVerdict);
  setText(elements.mathLog, state.mathText);
  setText(elements.pauseToggle, state.running ? "Pause" : "Start");

  if (state.primeLogDirty) {
    state.primeLogText = buildPrimeFeedText(state.displayedPrimeLog, state.primeLogColumns);
    setText(elements.primeLog, state.primeLogText);
    elements.primeLog.scrollTop = elements.primeLog.scrollHeight;
    state.primeLogDirty = false;
  }
}

function onAnimationFallback() {
  pendingAnimationFallbackId = 0;

  if (pendingAnimationFrameId) {
    window.cancelAnimationFrame(pendingAnimationFrameId);
    pendingAnimationFrameId = 0;
  }

  onAnimationFrame(performance.now());
}

function onAnimationFrame(now) {
  pendingAnimationFrameId = 0;

  if (pendingAnimationFallbackId) {
    window.clearTimeout(pendingAnimationFallbackId);
    pendingAnimationFallbackId = 0;
  }

  recordFrame(now);
  render(now);
  scheduleNextAnimationFrame();
}

function scheduleNextAnimationFrame() {
  if (pendingAnimationFrameId || pendingAnimationFallbackId) {
    return;
  }

  pendingAnimationFrameId = window.requestAnimationFrame(onAnimationFrame);
  pendingAnimationFallbackId = window.setTimeout(
    onAnimationFallback,
    ANIMATION_FALLBACK_DELAY_MS,
  );
}

primeWorker.addEventListener("message", (event) => {
  if (!event.data) {
    return;
  }

  if (event.data.type === "snapshot") {
    applyWorkerSnapshot(event.data);
    return;
  }

  if (event.data.type === "export-state" && pendingExportRequest) {
    const { resolve, timeoutId } = pendingExportRequest;
    window.clearTimeout(timeoutId);
    pendingExportRequest = null;
    resolve(event.data.data);
  }
});

primeWorker.addEventListener("error", () => {
  if (pendingExportRequest) {
    const { reject, timeoutId } = pendingExportRequest;
    window.clearTimeout(timeoutId);
    pendingExportRequest = null;
    reject(new Error("Background worker failed during save."));
  }

  state.workerError = true;
  state.running = false;
  state.mathVerdict = "ERROR";
  state.mathText = [
    "Background worker failed to start.",
    "Refresh the page to try again.",
  ].join("\n");
  render(performance.now(), true);
});

for (const button of elements.speedButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.speedMode === "max") {
      setMaxMode();
      return;
    }

    setManualBudget(Number(button.dataset.speedValue));
  });
}

elements.pauseToggle.addEventListener("click", () => {
  const nextRunning = !state.running;
  state.running = nextRunning;
  render(performance.now(), true);

  primeWorker.postMessage({
    type: "set-running",
    running: nextRunning,
  });
});

elements.saveButton.addEventListener("click", async () => {
  try {
    const saveData = await requestWorkerSaveData();
    downloadSaveData(saveData);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Save failed.");
  }
});

elements.loadButton.addEventListener("click", () => {
  if (!elements.loadInput) {
    return;
  }

  elements.loadInput.value = "";
  elements.loadInput.click();
});

elements.loadInput.addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input?.files?.[0];

  if (!file) {
    return;
  }

  try {
    const fileText = await file.text();
    const rawSaveData = JSON.parse(fileText);
    const saveData = normalizeSaveData(rawSaveData);
    loadSaveData(saveData);
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Load failed.");
  } finally {
    if (input) {
      input.value = "";
    }
  }
});

elements.resetButton.addEventListener("click", () => {
  cleanupPendingExportRequest("Save canceled while resetting the program.");
  resetDisplayState();
  render(performance.now(), true);
  primeWorker.postMessage({ type: "reset" });
});

document.addEventListener("visibilitychange", () => {
  primeWorker.postMessage({
    type: "set-report-interval",
    reportIntervalMs: getWorkerReportInterval(),
  });

  if (document.visibilityState === "visible") {
    scheduleNextFloatingCat();
    render(performance.now(), true);
    return;
  }

  clearFloatingCats();
});

window.addEventListener("resize", () => {
  state.primeLogDirty = true;
  render(performance.now(), true);
});

updateOverclockButtons();
render(performance.now(), true);
scheduleNextAnimationFrame();
scheduleNextFloatingCat();
primeWorker.postMessage({
  type: "init",
  mathBudgetMs: state.mathBudgetMs,
  maxMode: state.overclockMode === "max",
  reportIntervalMs: getWorkerReportInterval(),
});
