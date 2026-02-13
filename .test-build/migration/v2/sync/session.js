"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSyncSession = useSyncSession;
exports.useStorageAdapter = useStorageAdapter;
const react_1 = require("react");
const authSession_js_1 = require("../../storage/authSession.js");
const syncBackend_js_1 = require("../../storage/syncBackend.js");
const storageAdapters_1 = require("./storageAdapters");
function readOnline() {
    if (typeof navigator === "undefined")
        return true;
    return navigator.onLine;
}
function useSyncSession() {
    const [session, setSession] = (0, react_1.useState)({
        userId: null,
        email: null,
        workspaceId: null,
        role: null,
        online: readOnline(),
        isAuthenticated: false,
        hasWorkspaceAccess: false,
        requiresAuth: (0, syncBackend_js_1.isDbSyncEnabled)(),
    });
    (0, react_1.useEffect)(() => {
        let mounted = true;
        const refresh = async () => {
            try {
                const user = await (0, authSession_js_1.getCurrentUser)();
                const server = user ? await (0, authSession_js_1.fetchServerSession)() : null;
                if (!mounted)
                    return;
                const authenticated = Boolean(user?.id);
                const hasWorkspaceAccess = Boolean(server?.workspaceId);
                setSession({
                    userId: user?.id || null,
                    email: user?.email || null,
                    workspaceId: server?.workspaceId || null,
                    role: (server?.role || null),
                    online: readOnline(),
                    isAuthenticated: authenticated,
                    hasWorkspaceAccess,
                    requiresAuth: (0, syncBackend_js_1.isDbSyncEnabled)() && !authenticated,
                });
            }
            catch {
                if (!mounted)
                    return;
                setSession((prev) => ({
                    ...prev,
                    online: readOnline(),
                }));
            }
        };
        refresh();
        const unsub = (0, authSession_js_1.onAuthSessionChange)(() => {
            refresh();
        });
        const onOnline = () => setSession((prev) => ({ ...prev, online: true }));
        const onOffline = () => setSession((prev) => ({ ...prev, online: false }));
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            mounted = false;
            unsub();
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);
    return session;
}
function useStorageAdapter() {
    return (0, react_1.useMemo)(() => (0, storageAdapters_1.createDefaultStorageAdapter)(), []);
}
