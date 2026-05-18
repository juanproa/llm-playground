/**
 * Close-on-Escape hook for modals/dialogs/drawers.
 *
 * Maintains a module-level stack of active handlers so that when modals are
 * nested (e.g., a Save dialog opened from inside a run-detail drawer), pressing
 * Escape closes only the topmost modal — not every open modal at once.
 *
 * Usage:
 *   useEscapeKey(onClose);             // active whenever the component is mounted
 *   useEscapeKey(onClose, isOpen);     // gated by an open flag
 */
import { useEffect } from 'react';

type Handler = () => void;

const handlerStack: Handler[] = [];

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (handlerStack.length === 0) return;
  // Don't hijack Escape while the user is composing in an IME, or inside
  // contenteditable surfaces (Monaco editor, etc.) — they have their own meaning.
  if (e.isComposing) return;
  const top = handlerStack[handlerStack.length - 1];
  e.stopPropagation();
  top();
}

let listenerAttached = false;
function ensureListener() {
  if (listenerAttached) return;
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', onKeyDown);
  listenerAttached = true;
}

export function useEscapeKey(handler: Handler, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    ensureListener();
    handlerStack.push(handler);
    return () => {
      const idx = handlerStack.lastIndexOf(handler);
      if (idx >= 0) handlerStack.splice(idx, 1);
    };
  }, [handler, enabled]);
}
