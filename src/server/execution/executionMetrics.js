// ═══════════════════════════════════════════════════════════════
//  Execution Metrics (v0.9.0)
//
//  Captures only metrics that can be measured honestly. If exact token
//  counts are unavailable from the source, the field is reported as null
//  rather than fabricated. Tokens/sec is only computed when BOTH the
//  output token count and a generation duration are known.
// ═══════════════════════════════════════════════════════════════

// Compute derived metrics from measured timing + (optional) token counts.
// All inputs are optional; any value we cannot honestly produce is null.
export function computeMetrics({
  startTime,
  firstTokenAt,
  endTime,
  inputTokens = null,
  outputTokens = null,
  providerReportedLatencyMs = null,
}) {
  const totalDurationMs = (startTime && endTime) ? Math.max(0, endTime - startTime) : null;
  const ttftMs = (startTime && firstTokenAt) ? Math.max(0, firstTokenAt - startTime) : null;

  // Generation duration: from first token to completion (streaming), or the
  // full duration when streaming was not used (single response).
  const genDurationMs = (firstTokenAt && endTime) ? Math.max(0, endTime - firstTokenAt)
    : (totalDurationMs != null ? totalDurationMs : null);

  let tokensPerSecond = null;
  if (outputTokens != null && genDurationMs != null && genDurationMs > 0) {
    tokensPerSecond = +(outputTokens / (genDurationMs / 1000)).toFixed(2);
  }

  return {
    totalDurationMs: totalDurationMs != null ? Math.round(totalDurationMs) : null,
    ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
    inputTokens: inputTokens != null ? outputTokensNormalize(inputTokens) : null,
    outputTokens: outputTokens != null ? outputTokensNormalize(outputTokens) : null,
    tokensPerSecond,
    providerReportedLatencyMs: providerReportedLatencyMs != null ? Math.round(providerReportedLatencyMs) : null,
  };
}

function outputTokensNormalize(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
