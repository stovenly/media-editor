// Finds the concurrency limit where throughput stops improving. Fed one sample
// per window, taken only while the queue kept every slot busy.
export type Calibration = {
  limit: number;
  min: number;
  max: number;
  best: number;
  bestThroughput: number;
  probing: boolean;
  settled: boolean;
};

const GAIN = 1.05;

export function startCalibration(initial: number, max: number): Calibration {
  return {
    limit: initial,
    min: 1,
    max,
    best: initial,
    bestThroughput: 0,
    probing: false,
    settled: false,
  };
}

// throughput: work units finished per second during the window.
export function calibrate(state: Calibration, throughput: number): Calibration {
  if (state.settled) return state;
  if (!state.probing) {
    const bestThroughput = Math.max(state.bestThroughput, throughput);
    if (state.limit >= state.max) return { ...state, bestThroughput, settled: true };
    return { ...state, best: state.limit, bestThroughput, limit: state.limit + 1, probing: true };
  }
  if (throughput >= state.bestThroughput * GAIN) {
    if (state.limit >= state.max) {
      return {
        ...state,
        best: state.limit,
        bestThroughput: throughput,
        probing: false,
        settled: true,
      };
    }
    return { ...state, best: state.limit, bestThroughput: throughput, limit: state.limit + 1 };
  }
  return { ...state, limit: state.best, probing: false, settled: true };
}

export function underPressure(
  state: Calibration,
  level: 'nominal' | 'fair' | 'serious' | 'critical',
): Calibration {
  if (level === 'critical')
    return { ...state, limit: Math.max(state.min, Math.floor(state.limit / 2)) };
  if (level === 'serious')
    return { ...state, limit: Math.max(state.min, Math.floor(state.limit * 0.75)) };
  return { ...state, limit: Math.max(state.limit, state.best) };
}
