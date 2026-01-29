let activeGuard = null;

export function registerDirtyGuard(guard) {
  activeGuard = guard;
}

export function clearDirtyGuard(guard) {
  if (!guard || guard === activeGuard) {
    activeGuard = null;
  }
}

export function confirmNavigation() {
  if (typeof activeGuard === "function") {
    return activeGuard();
  }
  return true;
}

export function useDirtyGuard(isDirty, message) {
  const confirmLeave = (options = {}) => {
    const dirty = typeof isDirty === "function" ? isDirty() : Boolean(isDirty);
    if (!dirty) return true;
    if (typeof options.confirmWithModal === "function") {
      options.confirmWithModal({
        onConfirm: options.onConfirm,
        onCancel: options.onCancel,
      });
      return false;
    }
    return window.confirm(message || "Ungespeicherte Änderungen verwerfen?");
  };

  const beforeUnloadHandler = (event) => {
    const dirty = typeof isDirty === "function" ? isDirty() : Boolean(isDirty);
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };

  confirmLeave.attachBeforeUnload = () => {
    window.addEventListener("beforeunload", beforeUnloadHandler);
  };

  confirmLeave.detachBeforeUnload = () => {
    window.removeEventListener("beforeunload", beforeUnloadHandler);
  };

  confirmLeave.register = () => {
    registerDirtyGuard(confirmLeave);
  };

  confirmLeave.unregister = () => {
    clearDirtyGuard(confirmLeave);
  };

  return confirmLeave;
}
