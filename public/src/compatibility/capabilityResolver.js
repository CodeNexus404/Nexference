// Capability resolver — the single orchestration point that answers:
//
//   "Can this client actually use this provider/runtime, and if yes, how should
//    Nexference configure it?"
//
// Given a selection it returns one structured compatibility result (never a bare
// boolean), combining the client's support level with the provider/runtime
// compatibility. This is what the workflow review step and the Workspace "next
// recommended action" both consult.
import { checkClientProvider } from './clientProviderCompatibility.js';
import { checkClientRuntime } from './clientRuntimeCompatibility.js';
import { unsupported } from './result.js';

export function resolveSelection(sel = {}) {
  const { clientId, connectionType, providerId, runtimeId, modelId } = sel;
  if (!clientId) return unsupported('No client selected');

  const comp = connectionType === 'local'
    ? checkClientRuntime(clientId, runtimeId)
    : checkClientProvider(clientId, providerId);

  if (modelId && comp.compatible && comp.notes) {
    comp.notes = [...comp.notes, `Selected model: ${modelId}`];
  }
  return comp;
}

// Convenience: just the level id for a selection, for badge colouring.
export function resolveLevel(sel = {}) {
  return resolveSelection(sel).level;
}
