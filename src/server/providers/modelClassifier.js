// ═══════════════════════════════════════════════════════════════
//  Model Classifier (shared)
//
//  Single free/paid classifier for stored model lists across the
//  server (intelligence snapshots, cached-models, unified lists).
//  Classification is conservative: only explicit signals classify:
//    1. zero pricing (numeric OR numeric string "0" — discovery APIs
//       return strings) on input/output,
//    2. accessType === 'free',
//    3. a free-tier marker in the id/name — matches "free" as a whole
//       token at a delimiter: free/claude-opus-4.6 (gateways like
//       APInex / Inference Dahl), free:gpt-4o, free-gpt4, gpt-4o:free,
//       "Free GPT-4". Unknown prices never count as free or paid.
// ═══════════════════════════════════════════════════════════════

const FREE_NAME_RE = /(^|[:._\-\s/])free(?=$|[:._\-\s/])/i;

function freeNameMarker(m) {
  return (typeof m?.id === 'string' && FREE_NAME_RE.test(m.id)) ||
    (typeof m?.name === 'string' && FREE_NAME_RE.test(m.name));
}

// Some gateways (e.g. Requesty's /v1/models) return pricing as an ARRAY of
// volume-tier objects ({ prompt_tokens_threshold, input_price, output_price, … })
// instead of one flat per-token price. Free/paid must not depend on the shape:
// a model is free only when no published tier carries a paid price.
function pricingArrayIsFree(p) {
  if (!Array.isArray(p)) return false;
  const tiers = p.filter((t) => t && typeof t === 'object');
  if (!tiers.length) return false;
  const tierPaid = (t) => {
    const i = Number(t.input_price ?? t.input ?? t.prompt) || 0;
    const o = Number(t.output_price ?? t.output ?? t.completion) || 0;
    return i > 0 || o > 0;
  };
  return !tiers.some(tierPaid);
}

export function modelIsFree(m) {
  const p = m?.pricing;
  const isZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  if (pricingArrayIsFree(p)) return true;
  if (isZero(p?.input) || isZero(p?.output)) return true;
  if (m?.accessType === 'free') return true;
  return freeNameMarker(m);
}

// Flatten gateway pricing into the shared { input, output } convention so every
// consumer (badges, picker, intelligence) classifies identically regardless of
// the source shape:
//   - array-of-tiers (Requesty /v1/models) → free when ALL tiers are $0, paid
//     otherwise, flattened from the primary (threshold 0) tier.
//   - flat object → passed through untouched.
//   - anything else → null.
export function normalizePricing(p) {
  if (p == null) return null;
  if (Array.isArray(p)) {
    const tiers = p.filter((t) => t && typeof t === 'object');
    if (!tiers.length) return null;
    const tierIn = (t) => Number(t.input_price ?? t.input ?? t.prompt);
    const tierOut = (t) => Number(t.output_price ?? t.output ?? t.completion);
    const anyPaid = tiers.some((t) => (tierIn(t) || 0) > 0 || (tierOut(t) || 0) > 0);
    if (!anyPaid) return { input: 0, output: 0 };
    const t0 = tiers[0];
    const input = Number.isFinite(tierIn(t0)) ? tierIn(t0) : 0;
    const output = Number.isFinite(tierOut(t0)) ? tierOut(t0) : input;
    return { input, output };
  }
  if (p && typeof p === 'object') return p;
  return null;
}

export { FREE_NAME_RE };