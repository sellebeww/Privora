// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Update flow: the new version waits for the user; no reload without consent.
import { describe, expect, it } from "vitest";
import { watchUpdates } from "./register.ts";

class FakeWorker extends EventTarget {
  sent: unknown[] = [];
  state: string;
  constructor(state = "installing") {
    super();
    this.state = state;
  }
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  to(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
class FakeReg extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
}
class FakeContainer extends EventTarget {
  controller: object | null;
  constructor(controller: object | null) {
    super();
    this.controller = controller;
  }
}

function setup(controller: object | null, reg = new FakeReg()) {
  const offers: (() => void)[] = [];
  let reloads = 0;
  const container = new FakeContainer(controller);
  watchUpdates(reg, container, () => (reloads += 1), (apply) => offers.push(apply));
  const change = () => container.dispatchEvent(new Event("controllerchange"));
  return { reg, offers, change, reloads: () => reloads };
}
function found(reg: FakeReg) {
  const w = new FakeWorker();
  reg.installing = w;
  reg.dispatchEvent(new Event("updatefound"));
  return w;
}

describe("service worker updates", () => {
  it("first install: no banner and no reload when the worker takes control", () => {
    const t = setup(null);
    found(t.reg).to("installed");
    t.change();
    expect(t.offers).toHaveLength(0);
    expect(t.reloads()).toBe(0);
  });
  it("an update is offered once installed, and nothing happens until the user accepts", () => {
    const t = setup({});
    const w = found(t.reg);
    expect(t.offers).toHaveLength(0);
    w.to("installed");
    expect(t.offers).toHaveLength(1);
    expect(w.sent).toEqual([]);
    expect(t.reloads()).toBe(0);
  });
  it("accepting asks the worker to activate, then reloads once on control change", () => {
    const t = setup({});
    const w = found(t.reg);
    w.to("installed");
    t.offers[0]!();
    expect(w.sent).toEqual([{ type: "SKIP_WAITING" }]);
    expect(t.reloads()).toBe(0);
    t.change();
    t.change();
    expect(t.reloads()).toBe(1);
  });
  it("another tab accepting never reloads this one; accepting here afterwards reloads directly", () => {
    const t = setup({});
    const w = found(t.reg);
    w.to("installed");
    w.to("activated");
    t.change();
    expect(t.reloads()).toBe(0);
    t.offers[0]!();
    expect(t.reloads()).toBe(1);
  });
  it("offers a worker that was already waiting or already installing", () => {
    const waiting = new FakeReg();
    waiting.waiting = new FakeWorker("installed");
    expect(setup({}, waiting).offers).toHaveLength(1);
    const installing = new FakeReg();
    installing.installing = new FakeWorker();
    const t = setup({}, installing);
    installing.installing.to("installed");
    expect(t.offers).toHaveLength(1);
  });
  it("a worker that fails to install is not offered", () => {
    const t = setup({});
    found(t.reg).to("redundant");
    expect(t.offers).toHaveLength(0);
  });
});
