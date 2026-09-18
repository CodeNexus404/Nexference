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

export function modelIsFree(m) {
  const p = m?.pricing;
  const isZero = (v) => v !== null && v !== undefined && v !== '' && Number(v) === 0;
  if (isZero(p?.input) || isZero(p?.output)) return true;
  if (m?.accessType === 'free') return true;
  return freeNameMarker(m);
}

export { FREE_NAME_RE };