const UI_RENDER_INTERVAL_MS = 1000 / 20;
const FPS_RATE_WINDOW_MS = 5000;
const MAX_PACE_WINDOW_MS = 10000;
const ANIMATION_FALLBACK_DELAY_MS = 50;
const MAX_LOGGED_PRIMES = 5000;
const WORKER_REPORT_INTERVAL_VISIBLE_MS = 1000 / 20;
const WORKER_REPORT_INTERVAL_HIDDEN_MS = 1000;
const MIN_MATH_BUDGET_MS = 0.0001;
const DEFAULT_MATH_BUDGET_MS = 50;
const SAVE_FILE_FORMAT = "PrimeCalcSave";
const SAVE_FILE_VERSION = 1;
const EXPORT_REQUEST_TIMEOUT_MS = 15000;
const SPIN_CAT_PLAY_DURATION_MS = 3090;
const LIZARD_PLAY_DURATION_MS = 1680;
const CAT_SPAWN_MIN_INTERVAL_MS = 3000;
const CAT_SPAWN_MAX_INTERVAL_MS = 6000;
const CAT_MIN_SIZE_PX = 28;
const CAT_MAX_SIZE_PX = 90;
const CAT_MIN_SPEED_PX_PER_S = 24;
const CAT_MAX_SPEED_PX_PER_S = 132;
const CAT_SOURCES = [
  { src: "spincat.gif", durationMs: SPIN_CAT_PLAY_DURATION_MS },
  { src: "lizard.gif", durationMs: LIZARD_PLAY_DURATION_MS },
];

const integerFormatter = new Intl.NumberFormat("en-US");
const rateFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const budgetFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const MATH_TYPING_BASE_DELAY_MS = 52;
const MATH_TYPING_DELAY_JITTER_MS = 22;
const MATH_TYPING_MIN_DELAY_MS = 14;
const MATH_TYPING_WORD_BURST_MIN = 2;
const MATH_TYPING_WORD_BURST_MAX = 6;
const MATH_TYPING_BURST_MIN_MULTIPLIER = 0.78;
const MATH_TYPING_BURST_MAX_MULTIPLIER = 1.35;
const MATH_TYPING_SPACE_MULTIPLIER = 0.55;
const MATH_TYPING_NUMBER_MULTIPLIER = 0.95;
const MATH_TYPING_SYMBOL_MULTIPLIER = 1.12;
const MATH_TYPING_PUNCTUATION_PAUSE_MS = 120;
const MATH_TYPING_LINE_BREAK_PAUSE_MS = 260;
const MATH_TYPING_CURSOR_BLINK_MS = 280;

const elements = {
  speedButtons: Array.from(document.querySelectorAll(".speed-option")),
  overclockValue: document.querySelector("#overclock-value"),
  welcomeScreen: document.querySelector("#welcome-screen"),
  welcomeStartButton: document.querySelector("#welcome-start-button"),
  welcomeLoadButton: document.querySelector("#welcome-load-button"),
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
  "primecalc> waiting for the next solved prime proof",
  "primecalc> this window locks onto the most recently discovered prime",
  "primecalc> then replays every divisor check used to prove it",
].join("\n");

const state = {
  running: false,
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
  mathProofPrime: 0,
  pendingMathProof: null,
  mathTypingStartedAt: 0,
  mathTypingTimeline: [],
  lastDashboardRenderTime: 0,
};

let pendingAnimationFrameId = 0;
let pendingAnimationFallbackId = 0;
let pendingCatSpawnId = 0;
let nextFloatingCatId = 0;
let lastFloatingCatSourceIndex = -1;
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
const RECENT_PRIME_WINDOW = 100;
const MAX_ITERATIONS_PER_CYCLE = 20000;
const ACTIVE_TICK_DELAY_MS = 0;
const PAUSED_TICK_DELAY_MS = 50;
const INITIAL_PROOF_TEXT = ${JSON.stringify(INITIAL_MATH_TEXT)};

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

function buildPrimeProofText(details) {
  const prompt = "primecalc> ";
  const lines = [
    prompt + "latest solved prime locked: " + formatInteger(details.candidate),
  ];

  if (details.candidate === 2) {
    lines.push(prompt + "candidate 2 is the only even prime");
    lines.push(prompt + "total divisor checks: 0");
    lines.push(prompt + "verdict: PRIME");
    lines.push(prompt + "2 enters the prime feed");
    return lines.join("\\n");
  }

  lines.push(prompt + "rule: test stored prime divisors up to sqrt(candidate)");
  lines.push(prompt + "candidate parity: odd -> divisor 2 skipped");
  lines.push(prompt + "sqrt(" + formatInteger(details.candidate) + ") = " + formatDecimal(details.limit));
  lines.push(prompt + "trial divisors allowed through " + formatInteger(Math.floor(details.limit)));
  lines.push(prompt + "stored primes available: " + formatInteger(details.availablePrimeCount));
  lines.push(prompt + "terminal replay of divisor checks:");

  if (details.checkLines.length === 0) {
    lines.push(prompt + "no odd stored prime divisor is <= sqrt(candidate)");
  } else {
    for (const line of details.checkLines) {
      lines.push(prompt + line);
    }
  }

  if (details.nextPrimeAboveLimit !== null) {
    lines.push(
      prompt
        + "next stored prime "
        + formatInteger(details.nextPrimeAboveLimit)
        + " is above sqrt(candidate), so the scan stops",
    );
  } else if (details.checks === 0) {
    lines.push(prompt + "sqrt(candidate) is below 3, so the scan stops immediately");
  }

  lines.push(
    prompt
      + "highest divisor tested: "
      + (details.highestDivisorTested === null ? "none" : formatInteger(details.highestDivisorTested)),
  );
  lines.push(prompt + "total divisor checks: " + formatInteger(details.checks));
  lines.push(prompt + "verdict: PRIME");
  lines.push(prompt + formatInteger(details.candidate) + " enters the prime feed");

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

function rebuildPrimeCache(limit) {
  const upperLimit = Math.max(2, Math.round(Number(limit) || 2));

  if (upperLimit === 2) {
    return [2];
  }

  const oddCount = Math.floor((upperLimit - 1) / 2);
  const composite = new Uint8Array(oddCount);
  const maxFactorIndex = Math.floor((Math.sqrt(upperLimit) - 3) / 2);

  for (let index = 0; index <= maxFactorIndex; index += 1) {
    if (composite[index]) {
      continue;
    }

    const prime = index * 2 + 3;
    let compositeIndex = Math.floor((prime * prime - 3) / 2);

    while (compositeIndex < oddCount) {
      composite[compositeIndex] = 1;
      compositeIndex += prime;
    }
  }

  const primes = [2];

  for (let index = 0; index < oddCount; index += 1) {
    if (!composite[index]) {
      primes.push(index * 2 + 3);
    }
  }

  return primes;
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
    mathPrime: 0,
    mathVerdict: "PRIME",
    mathText: INITIAL_PROOF_TEXT,
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
    mathPrime: state.mathPrime,
    mathVerdict: state.mathVerdict,
    mathText: state.mathText,
    averagePrimeGap: state.averagePrimeGap,
    primeFeedNumbers: state.primes.slice(-MAX_PENDING_PRIMES),
    primeRateBuckets: state.primeRateBuckets.map((bucket) => ({
      ageMs: Math.max(0, now - bucket.time),
      count: bucket.count,
    })),
  };
}

function importState(data, reportIntervalMs) {
  const now = performance.now();
  const savedPrimeFeed = Array.isArray(data.primeFeedNumbers) && data.primeFeedNumbers.length > 0
    ? data.primeFeedNumbers.slice(-MAX_PENDING_PRIMES)
    : Array.isArray(data.primes)
      ? data.primes.slice(-MAX_PENDING_PRIMES)
      : [];

  if (savedPrimeFeed.length === 0) {
    throw new Error("Invalid saved prime feed in save file.");
  }

  const lastSavedPrime = savedPrimeFeed[savedPrimeFeed.length - 1];
  const parsedLastPrime = Math.round(Number(data.lastPrime));
  const lastPrime = Number.isFinite(parsedLastPrime) ? parsedLastPrime : lastSavedPrime;

  if (lastPrime !== lastSavedPrime) {
    throw new Error("Saved latest prime does not match the saved prime feed.");
  }

  const primes = rebuildPrimeCache(lastPrime);
  const recentPrimeWindow = Array.isArray(data.recentPrimeWindow) && data.recentPrimeWindow.length > 0
    ? data.recentPrimeWindow.slice(-RECENT_PRIME_WINDOW)
    : savedPrimeFeed.slice(-RECENT_PRIME_WINDOW);
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
  state.mathPrime = Math.max(
    0,
    Math.round(
      Number(data.mathPrime)
      || (typeof data.mathText === "string" && data.mathText.trim() && data.mathText !== INITIAL_PROOF_TEXT ? lastPrime : 0),
    ),
  );
  state.mathVerdict = typeof data.mathVerdict === "string" ? data.mathVerdict : "PRIME";
  state.mathText = typeof data.mathText === "string" && data.mathText.trim()
    ? data.mathText
    : candidate > 2
      ? analyzeCandidate(lastPrime).text
      : INITIAL_PROOF_TEXT;
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
  const checkLines = [];
  let checks = 0;
  let highestDivisorTested = null;
  let divisor = null;
  let nextPrimeAboveLimit = null;

  for (let index = 1; index < state.primes.length; index += 1) {
    const prime = state.primes[index];

    if (prime > limit) {
      nextPrimeAboveLimit = prime;
      break;
    }

    const remainder = candidate % prime;
    checks += 1;
    highestDivisorTested = prime;
    checkLines.push(
      "check "
        + String(checks).padStart(3, "0")
        + " | "
        + formatInteger(candidate)
        + " mod "
        + formatInteger(prime)
        + " = "
        + formatInteger(remainder),
    );

    if (remainder === 0) {
      divisor = prime;
      break;
    }
  }

  const verdict = divisor === null ? "PRIME" : "COMPOSITE";

  return {
    isPrime: divisor === null,
    verdict: verdict,
    text: divisor === null
      ? buildPrimeProofText({
        candidate: candidate,
        limit: limit,
        availablePrimeCount: state.primes.length,
        checks: checks,
        checkLines: checkLines,
        highestDivisorTested: highestDivisorTested,
        nextPrimeAboveLimit: nextPrimeAboveLimit,
      })
      : "",
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

      state.mathPrime = candidate;
      state.mathVerdict = analysis.verdict;
      state.mathText = analysis.text;
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
    mathPrime: state.mathPrime,
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
  state.running = Boolean(message.running);
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

function getMathTypingTimeline(text) {
  const timeline = [];
  let elapsed = 0;
  let burstRemaining = 0;
  let burstMultiplier = 1;

  for (const character of text) {
    if (burstRemaining <= 0) {
      burstRemaining = Math.round(randomBetween(MATH_TYPING_WORD_BURST_MIN, MATH_TYPING_WORD_BURST_MAX));
      burstMultiplier = randomBetween(MATH_TYPING_BURST_MIN_MULTIPLIER, MATH_TYPING_BURST_MAX_MULTIPLIER);
    }

    let delay = MATH_TYPING_BASE_DELAY_MS * burstMultiplier
      + randomBetween(-MATH_TYPING_DELAY_JITTER_MS, MATH_TYPING_DELAY_JITTER_MS);

    if (character === " ") {
      delay *= MATH_TYPING_SPACE_MULTIPLIER;
    } else if (/\d/.test(character)) {
      delay *= MATH_TYPING_NUMBER_MULTIPLIER;
    } else if (/[^A-Za-z0-9\s]/.test(character)) {
      delay *= MATH_TYPING_SYMBOL_MULTIPLIER;
    }

    if (character === "\n") {
      delay += MATH_TYPING_LINE_BREAK_PAUSE_MS * randomBetween(0.8, 1.2);
      burstRemaining = 0;
    } else if (/[.,:;=|>)]/.test(character)) {
      delay += MATH_TYPING_PUNCTUATION_PAUSE_MS * randomBetween(0.75, 1.35);
    }

    delay = Math.max(MATH_TYPING_MIN_DELAY_MS, delay);
    elapsed += delay;
    timeline.push(elapsed);
    burstRemaining -= 1;
  }

  return timeline;
}

function getTypedCharacterCount(timeline, elapsed) {
  let low = 0;
  let high = timeline.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (timeline[middle] <= elapsed) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function setMathTextInstant(text, proofPrime = 0, verdict = "PRIME") {
  state.mathText = text;
  state.mathProofPrime = Math.max(0, Math.round(Number(proofPrime) || 0));
  state.mathVerdict = verdict;
  state.pendingMathProof = null;
  state.mathTypingStartedAt = 0;
  state.mathTypingTimeline = [];
}

function startMathProofTyping(proof, now = performance.now()) {
  state.mathProofPrime = proof.prime;
  state.mathVerdict = proof.verdict;
  state.mathText = proof.text;
  state.mathTypingStartedAt = now;
  state.mathTypingTimeline = getMathTypingTimeline(proof.text);
}

function queueMathProof(proofPrime, text, verdict = "PRIME", now = performance.now()) {
  if (typeof text !== "string" || !text.trim()) {
    return;
  }

  const normalizedPrime = Math.max(0, Math.round(Number(proofPrime) || 0));

  if (normalizedPrime <= 0) {
    return;
  }

  if (normalizedPrime === state.mathProofPrime && text === state.mathText) {
    return;
  }

  const proof = {
    prime: normalizedPrime,
    text: text,
    verdict: verdict,
  };

  if (!state.mathTypingStartedAt && normalizedPrime !== state.mathProofPrime) {
    startMathProofTyping(proof, now);
    return;
  }

  if (!state.pendingMathProof || normalizedPrime >= state.pendingMathProof.prime) {
    state.pendingMathProof = proof;
  }
}

function renderMathLog(now) {
  if (!elements.mathLog) {
    return;
  }

  if (!state.mathTypingStartedAt && state.pendingMathProof && state.pendingMathProof.prime !== state.mathProofPrime) {
    const nextProof = state.pendingMathProof;
    state.pendingMathProof = null;
    startMathProofTyping(nextProof, now);
  }

  if (!state.mathTypingStartedAt) {
    setText(elements.mathLog, state.mathText);
    elements.mathLog.scrollTop = elements.mathLog.scrollHeight;
    return;
  }

  const elapsed = Math.max(0, now - state.mathTypingStartedAt);
  const visibleCharacters = Math.min(state.mathText.length, getTypedCharacterCount(state.mathTypingTimeline, elapsed));
  const typingComplete = visibleCharacters >= state.mathText.length;
  const showCursor = !typingComplete && Math.floor(now / MATH_TYPING_CURSOR_BLINK_MS) % 2 === 0;
  const displayText = typingComplete
    ? state.mathText
    : state.mathText.slice(0, visibleCharacters) + (showCursor ? "_" : "");

  if (typingComplete) {
    state.mathTypingStartedAt = 0;
    state.mathTypingTimeline = [];
  }

  setText(elements.mathLog, displayText);
  elements.mathLog.scrollTop = elements.mathLog.scrollHeight;
}

function showWelcomeScreen() {
  if (elements.welcomeScreen) {
    elements.welcomeScreen.hidden = false;
  }
}

function hideWelcomeScreen() {
  if (elements.welcomeScreen) {
    elements.welcomeScreen.hidden = true;
  }
}

function openLoadDialog() {
  if (!elements.loadInput) {
    return;
  }

  elements.loadInput.value = "";
  elements.loadInput.click();
}

function startNewSession() {
  cleanupPendingExportRequest("Save canceled while starting a new session.");
  hideWelcomeScreen();
  resetDisplayState();
  render(performance.now(), true);
  primeWorker.postMessage({ type: "reset" });
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

function isStrictlyIncreasingIntegerArray(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return false;
  }

  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) {
      return false;
    }
  }

  return true;
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

  const primeFeedNumbers = parsePositiveIntegerArray(rawData.primeFeedNumbers);
  const legacyPrimeCache = parsePositiveIntegerArray(rawData.primes);
  const savedPrimeFeed = (primeFeedNumbers.length > 0 ? primeFeedNumbers : legacyPrimeCache).slice(-MAX_LOGGED_PRIMES);

  if (savedPrimeFeed.length === 0 || !isStrictlyIncreasingIntegerArray(savedPrimeFeed)) {
    throw new Error("The save file is missing its saved primes.");
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
  const totalPrimeCount = Math.max(savedPrimeFeed.length, Math.round(Number(rawData.totalPrimeCount) || savedPrimeFeed.length));
  const savedLastPrime = savedPrimeFeed[savedPrimeFeed.length - 1];
  const parsedLastPrime = Math.round(Number(rawData.lastPrime));
  const lastPrime = Number.isFinite(parsedLastPrime) ? parsedLastPrime : savedLastPrime;

  if (lastPrime !== savedLastPrime) {
    throw new Error("The save file latest prime does not match its saved prime list.");
  }

  if (totalPrimeCount <= MAX_LOGGED_PRIMES && savedPrimeFeed[0] !== 2) {
    throw new Error("The save file is missing earlier primes for this prime count.");
  }

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
    mathPrime: Math.max(
      0,
      Math.round(
        Number(rawData.mathPrime)
        || (typeof rawData.mathText === "string" && rawData.mathText.trim() && rawData.mathText !== INITIAL_MATH_TEXT ? lastPrime : 0),
      ),
    ),
    mathVerdict: typeof rawData.mathVerdict === "string" ? rawData.mathVerdict : "PRIME",
    mathText: typeof rawData.mathText === "string" ? rawData.mathText : INITIAL_MATH_TEXT,
    averagePrimeGap: Number.isFinite(Number(rawData.averagePrimeGap)) ? Number(rawData.averagePrimeGap) : 0,
    recentPrimeWindow: recentPrimeWindow.length > 0 ? recentPrimeWindow : savedPrimeFeed.slice(-100),
    primeFeedNumbers: savedPrimeFeed,
    primeRateBuckets: primeRateBuckets,
  };
}

function loadSaveData(saveData) {
  cleanupPendingExportRequest("Save canceled while loading a save file.");
  hideWelcomeScreen();
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
  setMathTextInstant(saveData.mathText, saveData.mathPrime, saveData.mathVerdict);
  state.displayedPrimeLog = saveData.primeFeedNumbers.map((prime) => formatInteger(prime));
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

function getRandomCatMotion(size, durationMs) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - size - margin);
  const maxTop = Math.max(margin, window.innerHeight - size - margin);
  const horizontalTravelLimit = Math.max(0, maxLeft - margin);
  const verticalTravelLimit = Math.max(0, maxTop - margin);
  const durationSeconds = Math.max(durationMs, 1) / 1000;
  const speed = randomBetween(CAT_MIN_SPEED_PX_PER_S, CAT_MAX_SPEED_PX_PER_S);
  const angle = randomBetween(0, Math.PI * 2);
  let driftX = Math.cos(angle) * speed * durationSeconds;
  let driftY = Math.sin(angle) * speed * durationSeconds;
  const horizontalScale = Math.abs(driftX) > 0.01 ? horizontalTravelLimit / Math.abs(driftX) : 1;
  const verticalScale = Math.abs(driftY) > 0.01 ? verticalTravelLimit / Math.abs(driftY) : 1;
  const motionScale = Math.min(1, horizontalScale, verticalScale);

  driftX *= motionScale;
  driftY *= motionScale;

  const minLeft = margin + Math.max(0, -driftX);
  const maxStartLeft = maxLeft - Math.max(0, driftX);
  const minTop = margin + Math.max(0, -driftY);
  const maxStartTop = maxTop - Math.max(0, driftY);

  return {
    left: Math.round(randomBetween(minLeft, Math.max(minLeft, maxStartLeft))),
    top: Math.round(randomBetween(minTop, Math.max(minTop, maxStartTop))),
    driftX: driftX.toFixed(1),
    driftY: driftY.toFixed(1),
  };
}

function getNextFloatingCatSource() {
  if (CAT_SOURCES.length === 0) {
    return null;
  }

  let sourceIndex = Math.floor(Math.random() * CAT_SOURCES.length);

  if (CAT_SOURCES.length > 1 && sourceIndex === lastFloatingCatSourceIndex) {
    sourceIndex = (sourceIndex + 1) % CAT_SOURCES.length;
  }

  lastFloatingCatSourceIndex = sourceIndex;
  return CAT_SOURCES[sourceIndex];
}

function spawnFloatingCat() {
  if (!elements.catOverlay || document.visibilityState === "hidden") {
    return;
  }

  const cat = document.createElement("img");
  const size = getRandomCatSize();
  const catSource = getNextFloatingCatSource();

  if (!catSource) {
    return;
  }

  const motion = getRandomCatMotion(size, catSource.durationMs);

  const catUrl = new URL(catSource.src, window.location.href);

  nextFloatingCatId += 1;
  catUrl.searchParams.set("spawn", String(nextFloatingCatId));

  cat.src = catUrl.toString();
  cat.alt = "";
  cat.setAttribute("aria-hidden", "true");
  cat.className = "floating-cat";
  cat.decoding = "async";
  cat.loading = "eager";
  cat.style.width = `${size}px`;
  cat.style.left = `${motion.left}px`;
  cat.style.top = `${motion.top}px`;
  cat.style.setProperty("--cat-life", `${catSource.durationMs}ms`);
  cat.style.setProperty("--cat-drift-x", `${motion.driftX}px`);
  cat.style.setProperty("--cat-drift-y", `${motion.driftY}px`);
  elements.catOverlay.append(cat);

  const cleanupId = window.setTimeout(() => {
    activeCatCleanupIds.delete(cleanupId);
    cat.remove();
  }, catSource.durationMs + 160);

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
  }, Math.round(randomBetween(CAT_SPAWN_MIN_INTERVAL_MS, CAT_SPAWN_MAX_INTERVAL_MS)));
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
  setMathTextInstant(INITIAL_MATH_TEXT, 0, "PRIME");
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
  queueMathProof(snapshot.mathPrime, snapshot.mathText, snapshot.mathVerdict, performance.now());

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
  const shouldRenderDashboard = force || now - state.lastDashboardRenderTime >= UI_RENDER_INTERVAL_MS;

  if (shouldRenderDashboard) {
    state.lastDashboardRenderTime = now;
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
    setText(elements.pauseToggle, state.running ? "Pause" : "Start");

    if (state.primeLogDirty) {
      state.primeLogText = buildPrimeFeedText(state.displayedPrimeLog, state.primeLogColumns);
      setText(elements.primeLog, state.primeLogText);
      elements.primeLog.scrollTop = elements.primeLog.scrollHeight;
      state.primeLogDirty = false;
    }
  }

  setText(elements.mathVerdict, state.mathVerdict);
  renderMathLog(now);
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
  setMathTextInstant([
    "Background worker failed to start.",
    "Refresh the page to try again.",
  ].join("\n"), 0, "ERROR");
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

elements.loadButton.addEventListener("click", openLoadDialog);

elements.welcomeStartButton?.addEventListener("click", () => {
  startNewSession();
});

elements.welcomeLoadButton?.addEventListener("click", () => {
  openLoadDialog();
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
showWelcomeScreen();
render(performance.now(), true);
scheduleNextAnimationFrame();
scheduleNextFloatingCat();
primeWorker.postMessage({
  type: "init",
  running: state.running,
  mathBudgetMs: state.mathBudgetMs,
  maxMode: state.overclockMode === "max",
  reportIntervalMs: getWorkerReportInterval(),
});
