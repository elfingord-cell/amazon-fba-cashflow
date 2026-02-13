"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDirtyGuard = registerDirtyGuard;
exports.clearDirtyGuard = clearDirtyGuard;
exports.confirmNavigation = confirmNavigation;
exports.useDirtyGuard = useDirtyGuard;
let activeGuard = null;
function registerDirtyGuard(guard) {
    activeGuard = guard;
}
function clearDirtyGuard(guard) {
    if (!guard || guard === activeGuard) {
        activeGuard = null;
    }
}
function confirmNavigation() {
    if (typeof activeGuard === "function") {
        return activeGuard();
    }
    return true;
}
function useDirtyGuard(isDirty, message) {
    const confirmCooldownMs = 500;
    let lastPromptAt = 0;
    let lastPromptResult = true;
    const confirmLeave = (options = {}) => {
        const dirty = typeof isDirty === "function" ? isDirty() : Boolean(isDirty);
        if (!dirty) {
            lastPromptAt = 0;
            return true;
        }
        const now = Date.now();
        if (now - lastPromptAt < confirmCooldownMs) {
            return lastPromptResult;
        }
        if (typeof options.confirmWithModal === "function") {
            lastPromptAt = now;
            lastPromptResult = false;
            options.confirmWithModal({
                onConfirm: options.onConfirm,
                onCancel: options.onCancel,
            });
            return false;
        }
        lastPromptResult = window.confirm(message || "Ungespeicherte Änderungen verwerfen?");
        lastPromptAt = Date.now();
        return lastPromptResult;
    };
    const beforeUnloadHandler = (event) => {
        const dirty = typeof isDirty === "function" ? isDirty() : Boolean(isDirty);
        if (!dirty)
            return;
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
