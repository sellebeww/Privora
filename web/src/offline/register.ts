// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Registers the service worker and offers updates. The page reloads only after the user asks for it:
// a reload erases the session, which lives in memory only.
interface WorkerLike extends EventTarget {
  state: string;
  postMessage(message: unknown): void;
}
export interface RegistrationLike extends EventTarget {
  installing: WorkerLike | null;
  waiting: WorkerLike | null;
}
export interface ContainerLike extends EventTarget {
  controller: unknown;
}

export function watchUpdates(
  reg: RegistrationLike,
  container: ContainerLike,
  reload: () => void,
  offer: (apply: () => void) => void,
): void {
  let accepted = false;
  let reloaded = false;
  const once = () => {
    if (!reloaded) reload();
    reloaded = true;
  };
  container.addEventListener("controllerchange", () => {
    if (accepted) once();
  });
  const announce = (worker: WorkerLike) => {
    // No controller means this is the first install, not an update.
    if (!container.controller) return;
    offer(() => {
      // Another tab may have activated it already: then only this page is behind.
      if (worker.state === "activating" || worker.state === "activated") return once();
      accepted = true;
      worker.postMessage({ type: "SKIP_WAITING" });
    });
  };
  const watch = (worker: WorkerLike | null) => {
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") announce(worker);
    });
  };
  if (reg.waiting) announce(reg.waiting);
  watch(reg.installing);
  reg.addEventListener("updatefound", () => watch(reg.installing));
}

let pending: (() => void) | null = null;
const listeners = new Set<() => void>();
const set = (next: (() => void) | null) => {
  pending = next;
  for (const l of listeners) l();
};
export const updateStore = {
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
  get: () => pending,
  dismiss: () => set(null),
};

/** Production only: the dev server has no sw.js. Failure is not an error, the app still works online. */
export function registerOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const container = navigator.serviceWorker;
  container
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then((reg) => watchUpdates(reg, container, () => location.reload(), set))
    .catch(() => undefined);
}
