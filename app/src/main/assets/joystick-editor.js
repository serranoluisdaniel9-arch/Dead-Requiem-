import { DEFAULT_JOYSTICK, normalizeJoystick, saveJoystick, joystickLayout } from './joystick-settings.js';

let editorSequence = 0;

/**
 * The parent owns game phase/focus restoration and calls close() from onClose.
 * onChange receives a fresh normalized object and {persisted:true|false} after
 * edits, or {persisted:null} on open/resize (no storage write was attempted).
 */
export function createJoystickEditor({ container, onChange, onClose }) {
  if (!container || typeof onChange !== 'function' || typeof onClose !== 'function') {
    throw new TypeError('El editor necesita un contenedor y sus acciones.');
  }
  const doc = container.ownerDocument || document;
  const view = doc.defaultView || globalThis;
  const prefix = `joyedit-${++editorSequence}`;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let settings = { ...DEFAULT_JOYSTICK };
  let opened = false;
  let drag = null;
  let persisted = null;

  container.classList.add('joystick-editor');
  container.classList.add('hidden');
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-labelledby', `${prefix}-title`);
  container.setAttribute('aria-hidden', 'true');

  const preview = make('div', 'joyedit-preview');
  preview.tabIndex = 0;
  preview.setAttribute('role', 'button');
  preview.setAttribute('aria-label', 'Mover joystick: arrastra o usa las flechas');
  preview.setAttribute('aria-describedby', `${prefix}-hint`);
  const ring = make('div', 'joyedit-ring');
  const stick = make('div', 'joyedit-stick');
  const marker = make('span', 'joyedit-marker', 'MOVER');
  for (const item of [ring, stick, marker]) item.setAttribute('aria-hidden', 'true');
  preview.append(ring, stick, marker);

  const panel = make('div', 'joyedit-panel');
  const title = make('h2', 'joyedit-title', 'Ajustar joystick');
  title.id = `${prefix}-title`;
  const hint = make('p', 'joyedit-hint', 'Arrastra el círculo sin tapar otros botones. Ajusta un tamaño cómodo.');
  hint.id = `${prefix}-hint`;
  const sizeRow = make('label', 'joyedit-size-label', 'Tamaño');
  sizeRow.htmlFor = `${prefix}-size`;
  const output = make('output', 'joyedit-size-value');
  output.setAttribute('for', `${prefix}-size`);
  sizeRow.append(output);
  const slider = make('input', 'joyedit-size');
  slider.id = `${prefix}-size`;
  slider.type = 'range';
  slider.min = '76';
  slider.max = '180';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Tamaño del joystick');
  const actions = make('div', 'joyedit-actions');
  const reset = make('button', 'joyedit-reset', 'Restablecer');
  reset.type = 'button';
  reset.setAttribute('aria-label', 'Restablecer tamaño y posición del joystick');
  const done = make('button', 'joyedit-done', 'Listo');
  done.type = 'button';
  done.setAttribute('aria-label', 'Terminar ajuste del joystick');
  actions.append(reset, done);
  const status = make('p', 'joyedit-status', 'Los cambios se guardan automáticamente.');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(title, hint, sizeRow, slider, actions, status);
  container.append(preview, panel);

  function geometry() {
    const rect = container.getBoundingClientRect();
    const start = joystickLayout({ ...settings, x: 0, y: 0 }, rect.width, rect.height);
    const end = joystickLayout({ ...settings, x: 1, y: 1 }, rect.width, rect.height);
    const current = joystickLayout(settings, rect.width, rect.height);
    return { rect, start, current, travelX: end.left - start.left, travelY: end.top - start.top };
  }

  function render() {
    const layout = geometry().current;
    preview.style.left = `${layout.left}px`;
    preview.style.top = `${layout.top}px`;
    preview.style.width = `${layout.size}px`;
    preview.style.height = `${layout.size}px`;
    slider.value = String(settings.size);
    slider.setAttribute('aria-valuetext', `${settings.size} píxeles`);
    output.textContent = `${settings.size} px`;
    const message = persisted === false
      ? 'No se pudo guardar: cambios solo para esta sesión.'
      : persisted === true ? 'Guardado en este dispositivo.' : 'Los cambios se guardan automáticamente.';
    if (status.textContent !== message) status.textContent = message;
  }

  function notify() {
    onChange({ ...settings }, { persisted });
  }

  function update(value) {
    if (!opened) return;
    settings = normalizeJoystick(value);
    persisted = saveJoystick(settings);
    render();
    notify();
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id;
    drag = null;
    preview.classList.remove('joyedit-dragging');
    view.removeEventListener('pointermove', moveDrag, true);
    view.removeEventListener('pointerup', endDrag, true);
    view.removeEventListener('pointercancel', endDrag, true);
    if (event) stopEvent(event);
    try {
      if (preview.hasPointerCapture(id)) preview.releasePointerCapture(id);
    } catch (_) { /* Capture may already have been released by Android. */ }
  }

  function moveDrag(event) {
    if (!opened || !drag || event.pointerId !== drag.id) return;
    stopEvent(event);
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const bounds = geometry();
    update({
      ...settings,
      x: bounds.travelX > 0
        ? (event.clientX - bounds.rect.left - drag.offsetX - bounds.start.left) / bounds.travelX
        : settings.x,
      y: bounds.travelY > 0
        ? (event.clientY - bounds.rect.top - drag.offsetY - bounds.start.top) / bounds.travelY
        : settings.y,
    });
  }

  preview.addEventListener('pointerdown', event => {
    if (!opened || drag || event.isPrimary === false ||
        (typeof event.button === 'number' && event.button !== 0) ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    stopEvent(event);
    preview.focus();
    const bounds = geometry();
    drag = {
      id: event.pointerId,
      offsetX: event.clientX - bounds.rect.left - bounds.current.left,
      offsetY: event.clientY - bounds.rect.top - bounds.current.top,
    };
    preview.classList.add('joyedit-dragging');
    // Capture-phase listeners also cover browsers where setPointerCapture fails.
    // They exist only during this editor's active drag and only handle its ID.
    view.addEventListener('pointermove', moveDrag, true);
    view.addEventListener('pointerup', endDrag, true);
    view.addEventListener('pointercancel', endDrag, true);
    try { preview.setPointerCapture(event.pointerId); } catch (_) { /* Fallback above. */ }
  });
  preview.addEventListener('lostpointercapture', endDrag);
  preview.addEventListener('keydown', event => {
    if (!opened) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = arrows[event.key];
    if (!direction) return;
    stopEvent(event);
    const bounds = geometry();
    const distance = event.shiftKey ? 1 : 10;
    update({
      ...settings,
      x: settings.x + (bounds.travelX ? direction[0] * distance / bounds.travelX : 0),
      y: settings.y + (bounds.travelY ? direction[1] * distance / bounds.travelY : 0),
    });
  });
  slider.addEventListener('input', () => update({ ...settings, size: Number(slider.value) }));
  let resetTouchTime = 0;
  const triggerReset = (e) => {
    const now = Date.now();
    if (now - resetTouchTime < 350) return;
    resetTouchTime = now;
    if (e && e.cancelable && e.preventDefault) e.preventDefault();
    if (reset.blur) reset.blur();
    endDrag();
    update(DEFAULT_JOYSTICK);
  };
  reset.addEventListener('touchend', triggerReset, { passive: false });
  reset.addEventListener('click', triggerReset);

  let doneTouchTime = 0;
  const triggerDone = (e) => {
    const now = Date.now();
    if (now - doneTouchTime < 350) return;
    doneTouchTime = now;
    if (e && e.cancelable && e.preventDefault) e.preventDefault();
    if (done.blur) done.blur();
    if (opened) onClose();
  };
  done.addEventListener('touchend', triggerDone, { passive: false });
  done.addEventListener('click', triggerDone);

  container.addEventListener('keydown', event => {
    if (!opened) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'Tab') {
      const order = [preview, slider, reset, done];
      const index = order.indexOf(doc.activeElement);
      const next = event.shiftKey ? index - 1 : index + 1;
      if (index < 0 || next < 0 || next >= order.length) {
        event.preventDefault();
        order[event.shiftKey ? order.length - 1 : 0].focus();
      }
    } else if ((event.key === ' ' || event.key === 'Spacebar') &&
        event.target !== slider && event.target !== reset && event.target !== done) {
      event.preventDefault();
    }
  });
  // Keep layout gestures inside the overlay, never reaching game controls.
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) {
    container.addEventListener(type, event => { if (opened) event.stopPropagation(); });
  }
  container.addEventListener('touchmove', event => {
    if (opened && !panel.contains(event.target)) event.preventDefault();
  }, { passive: false });
  container.addEventListener('wheel', event => {
    if (opened && !panel.contains(event.target)) event.preventDefault();
  }, { passive: false });

  function resize() {
    if (!opened) return;
    endDrag();
    render();
    onChange({ ...settings }, { persisted: null });
  }

  return {
    open(value) {
      endDrag();
      settings = normalizeJoystick(value);
      persisted = null;
      if (!opened) view.addEventListener('resize', resize);
      opened = true;
      container.classList.remove('hidden');
      container.setAttribute('aria-hidden', 'false');
      render();
      notify();
      slider.focus();
    },
    close() {
      endDrag();
      opened = false;
      view.removeEventListener('resize', resize);
      container.classList.add('hidden');
      container.setAttribute('aria-hidden', 'true');
    },
    isOpen() { return opened; },
  };
}
