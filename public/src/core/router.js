// Router — a minimal client-side router for the single-view dashboard. v0.1.0
// has exactly one route ('dashboard'); the router exists so future milestones can
// add views (settings, provider detail, about) without restructuring the entry
// point. It performs no navigation/UI changes today (milestone constraint).
export class Router {
  constructor() {
    this.routes = new Map();
    this.currentRoute = 'dashboard';
    this._listeners = new Set();
  }

  register(name, handler) {
    this.routes.set(name, handler);
    return this;
  }

  onRouteChange(fn) {
    this._listeners.add(fn);
  }

  navigate(name) {
    if (!this.routes.has(name)) name = 'dashboard';
    this.currentRoute = name;
    const handler = this.routes.get(name);
    if (handler) handler();
    this._listeners.forEach((fn) => fn(name));
    return this;
  }

  current() {
    return this.currentRoute;
  }
}

export const router = new Router();
