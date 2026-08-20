// Shared URL normaliser — keeps gateway base URLs consistently trailing-slash
// terminated so downstream endpoint assembly is unambiguous.
export const norm = (u) => (u && u.endsWith('/') ? u : (u || '') + '/');
