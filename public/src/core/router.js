import { Storage } from './storage.js';

// Router — a small client-side router for the multi-page Nexference shell.
// v0.2.0 adds the real navigation (Workspace / Providers / Configuration /
// Local AI / Clients / Settings). The router persists the active page and
// notifies listeners so the shell can show the right view and render its
// content. No framework, no history hacking — just a single mutable route.
const PAGES = ['workspace', 'cloud-providers', 'localai', 'models', 'clients', 'configuration', 'playground', 'settings', 'intelligence', 'ecosystem'];

export class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = Storage.getPage() || 'workspace';
    this._listeners = new Set();
  }

  register(name, render) {
    this.routes.set(name, render);
    return this;
  }

  onRouteChange(fn) {
    this._listeners.add(fn);
  }

  navigate(name) {
    if (!PAGES.includes(name)) name = 'workspace';
    this.currentRoute = name;
    Storage.setPage(name);
    const render = this.routes.get(name);
    if (render) render();
    this._listeners.forEach((fn) => fn(name));
    return this;
  }

  current() {
    return this.currentRoute;
  }
}

export const router = new Router();
