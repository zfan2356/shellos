// Pinned terminal-browser PageInput and controller anchors for patch regression tests.
var PageInput = class {
  target;
  lastX = 0;
  lastY = 0;
  lastSentX = 0;
  lastSentY = 0;
  pressed = /* @__PURE__ */ new Set();
  click = { button: "none", at: 0, x: 0, y: 0, count: 0 };
  activeClickCount = 1;
  wheelRemainderX = 0;
  wheelRemainderY = 0;
  sentKeys = /* @__PURE__ */ new Set();
  superHeld = false;
  focusGate = null;
  constructor(target) {
    this.target = target;
  }
  syncFocus() {
    const pending = this.target.focus();
    if (!pending) return this.focusGate;
    const gate = this.focusGate ? this.focusGate.then(() => pending) : pending;
    this.focusGate = gate;
    void gate.then(() => {
      if (this.focusGate === gate) this.focusGate = null;
    });
    return gate;
  }
  send(event) {
    const contents = this.target.contents();
    if (this.focusGate) void this.focusGate.then(() => contents.sendInputEvent(event));
    else contents.sendInputEvent(event);
  }
  releaseModifiers() {
    this.superHeld = false;
  }
  rememberModifiers(event) {
    this.superHeld = event.key === "leftsuper" || event.key === "rightsuper" ? event.kind !== "release" : !!event.mods.super;
  }
  pointerModifiers(mods) {
    return this.modifiers(this.superHeld && !mods.super ? { ...mods, super: true } : mods);
  }
  pointer(event) {
    this.syncFocus();
    const scale = this.target.scale();
    const x = Math.max(0, Math.round(event.x / scale));
    const y = Math.max(0, Math.round(event.y / scale));
    this.lastX = x;
    this.lastY = y;
    const button = event.button === "none" ? void 0 : event.button;
    if (event.kind === "down" && button) {
      this.pressed.add(button);
      this.activeClickCount = this.nextClickCount(button, x, y);
    }
    if (event.kind === "up" && button) this.pressed.delete(button);
    const modifiers = this.pointerModifiers(event.mods);
    for (const pressed of this.pressed) modifiers.push(`${pressed}buttondown`);
    this.send({
      type: event.kind === "down" ? "mouseDown" : event.kind === "up" ? "mouseUp" : "mouseMove",
      x,
      y,
      movementX: x - this.lastSentX,
      movementY: y - this.lastSentY,
      button,
      clickCount: event.kind === "move" ? 0 : this.activeClickCount,
      modifiers
    });
    this.lastSentX = x;
    this.lastSentY = y;
  }
  wheel(event) {
    this.syncFocus();
    if (event.mods.ctrl && event.precise) {
      this.pinch(event);
      return;
    }
    if (!event.precise) {
      this.wheelTick(event);
      return;
    }
    const scale = this.target.scale();
    this.wheelRemainderX += -event.deltaX / scale;
    this.wheelRemainderY += -event.deltaY / scale;
    const deltaX = wholeDelta(this.wheelRemainderX);
    const deltaY = wholeDelta(this.wheelRemainderY);
    this.wheelRemainderX -= deltaX;
    this.wheelRemainderY -= deltaY;
    if (deltaX === 0 && deltaY === 0) return;
    this.send({
      type: "mouseWheel",
      x: this.lastX,
      y: this.lastY,
      deltaX,
      deltaY,
      wheelTicksX: deltaX / 40,
      wheelTicksY: deltaY / 40,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
      modifiers: this.pointerModifiers(event.mods)
    });
  }
  wheelTick(event) {
    const ticksX = -Math.sign(event.deltaX);
    const ticksY = -Math.sign(event.deltaY);
    if (ticksX === 0 && ticksY === 0) return;
    const step = WHEEL_DETENT_PX;
    this.send({
      type: "mouseWheel",
      x: this.lastX,
      y: this.lastY,
      deltaX: ticksX * step,
      deltaY: ticksY * step,
      wheelTicksX: ticksX,
      wheelTicksY: ticksY,
      hasPreciseScrollingDeltas: false,
      canScroll: true,
      modifiers: this.pointerModifiers(event.mods)
    });
  }
  pinch(event) {
    const pinchScale = 1 - event.deltaY / 100;
    if (pinchScale <= 0) return;
    this.send({
      type: "mouseWheel",
      x: this.lastX,
      y: this.lastY,
      deltaX: 0,
      deltaY: 100 * Math.log(pinchScale),
      wheelTicksX: 0,
      wheelTicksY: pinchScale > 1 ? 1 : -1,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
      modifiers: ["ctrl"]
    });
  }
  key(event) {
    this.rememberModifiers(event);
    if (event.key === "enter") {
      void this.dispatchEnter(event).catch(() => {
      });
      return;
    }
    const commands = process.platform === "darwin" ? editingCommands(event) : null;
    if (commands) {
      void this.dispatchEditing(event, commands).catch(() => {
      });
      return;
    }
    const keyCode = electronKey(event.key);
    if (event.kind === "release") {
      if (!keyCode || !this.sentKeys.delete(event.key)) return;
      const modifiers2 = this.modifiers(event.mods);
      if (event.key.startsWith("left")) modifiers2.push("left");
      if (event.key.startsWith("right")) modifiers2.push("right");
      this.send({ type: "keyUp", keyCode, modifiers: modifiers2 });
      return;
    }
    this.syncFocus();
    if (!keyCode) {
      if (event.text) {
        this.target.contents().insertText(event.text);
      }
      return;
    }
    const modifiers = this.modifiers(event.mods);
    if (event.key.startsWith("left")) modifiers.push("left");
    if (event.key.startsWith("right")) modifiers.push("right");
    if (event.kind === "repeat") modifiers.push("isautorepeat");
    this.sentKeys.add(event.key);
    this.send({ type: "rawKeyDown", keyCode, modifiers });
    const printable = !!event.text && !event.mods.ctrl && !event.mods.super && !event.mods.alt;
    if (printable) {
      this.send({ type: "char", keyCode: event.text, modifiers });
    }
  }
  paste(text2) {
    import_electron3.clipboard.writeText(text2);
    if (process.platform === "darwin") {
      void this.dispatchPaste().catch(() => {
      });
      return;
    }
    this.syncFocus();
    this.target.contents().paste();
  }
  async selectionText() {
    for (const frame of this.target.contents().mainFrame.framesInSubtree) {
      const text2 = await frame.executeJavaScript(SELECTION_SNIPPET).catch(() => "");
      if (typeof text2 === "string" && text2) return text2;
    }
    return "";
  }
  pasteImage(image) {
    this.syncFocus();
    switch (image.source) {
      case "clipboard":
        this.target.contents().paste();
        return;
      case "osc":
      case "file": {
        const staged = import_electron3.nativeImage.createFromPath(image.path);
        if (staged.isEmpty()) return;
        import_electron3.clipboard.writeImage(staged);
        this.target.contents().paste();
        return;
      }
    }
  }
  releaseKeys() {
    for (const key of this.sentKeys) {
      const keyCode = electronKey(key);
      if (!keyCode) continue;
      const modifiers = [];
      if (key.startsWith("left")) modifiers.push("left");
      if (key.startsWith("right")) modifiers.push("right");
      this.send({ type: "keyUp", keyCode, modifiers });
    }
    this.sentKeys.clear();
  }
  /**
   *
   * why are we hard coding huerestics for vscode web??
   *
   */
  async dispatchEnter(event) {
    const base2 = {
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers: cdpModifiers(event.mods)
    };
    if (event.kind === "release") {
      await this.target.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base2 });
      return;
    }
    await this.syncFocus();
    await this.target.cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...base2,
      autoRepeat: event.kind === "repeat"
    });
    if (!event.mods.ctrl && !event.mods.super && !event.mods.alt) {
      await this.target.cdp("Input.dispatchKeyEvent", { type: "char", text: "\r", ...base2 });
    }
  }
  async dispatchPaste() {
    const base2 = {
      key: "v",
      code: "KeyV",
      windowsVirtualKeyCode: 86,
      nativeVirtualKeyCode: 86,
      modifiers: 4
    };
    await this.syncFocus();
    await this.target.cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...base2,
      commands: ["Paste"]
    });
    await this.target.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base2 });
  }
  async dispatchEditing(event, commands) {
    const info = EDITING_KEY_INFO[event.key];
    if (!info) return;
    const base2 = {
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      modifiers: cdpModifiers(event.mods)
    };
    if (event.kind === "release") {
      await this.target.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base2 });
      return;
    }
    await this.syncFocus();
    await this.target.cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...base2,
      autoRepeat: event.kind === "repeat",
      commands
    });
  }
  nextClickCount(button, x, y) {
    const now = Date.now();
    const close = Math.abs(x - this.click.x) <= 4 && Math.abs(y - this.click.y) <= 4;
    const count = this.click.button === button && now - this.click.at <= 500 && close ? Math.min(this.click.count + 1, 3) : 1;
    this.click = { button, at: now, x, y, count };
    return count;
  }
  modifiers(mods) {
    const result = [];
    if (mods.shift) result.push("shift");
    if (mods.alt) result.push("alt");
    if (mods.ctrl) result.push("ctrl");
    if (mods.super) result.push("meta");
    return result;
  }
};
function cdpModifiers(mods) {
  return (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.super ? 4 : 0) | (mods.shift ? 8 : 0);
}
var PageController = class {
  async attachCdp() {
    this.window.webContents.debugger.on("message", (_event, method, params) => {
      this.cdpEventHandlers.get(method)?.(params);
    });
    await this.cdp("Runtime.addBinding", { name: "__pixelEmit" });
  }
};
