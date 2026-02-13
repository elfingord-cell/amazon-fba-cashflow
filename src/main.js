import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "../styles.css";
import "./react/app-shell.css";
import { AppShell } from "./react/AppShell.jsx";
import { StandaloneV2App } from "./v2/app/StandaloneV2App";
import { loadRuntimeConfig, getRuntimeLoadError } from "./storage/runtimeConfig.js";

const rootNode = document.getElementById("root");

if (!rootNode) {
  throw new Error("Root element #root not found");
}

function normalizeV2Hash(hash) {
  if (!hash) return hash;
  if (hash.startsWith("#/v2")) return hash;
  if (hash === "#v2") return "#/v2";
  if (hash.startsWith("#v2/")) return `#/v2/${hash.slice(4)}`;
  if (hash.startsWith("#v2?")) return `#/v2?${hash.slice(4)}`;
  return hash;
}

function isV2Hash(hash) {
  return /^#\/v2(?:\/|$|\?)/.test(hash || "");
}

function AppEntry() {
  const [mode, setMode] = useState(() => {
    const currentHash = window.location.hash || "";
    if (!currentHash) return "v2";
    return isV2Hash(normalizeV2Hash(currentHash)) ? "v2" : "legacy";
  });

  useEffect(() => {
    const syncMode = () => {
      const currentHash = window.location.hash || "";
      if (!currentHash) {
        window.location.hash = "#/v2/dashboard";
        return;
      }
      const normalized = normalizeV2Hash(currentHash);
      if (normalized !== currentHash) {
        window.location.hash = normalized;
        return;
      }
      setMode(isV2Hash(normalized) ? "v2" : "legacy");
    };

    syncMode();
    window.addEventListener("hashchange", syncMode);
    return () => {
      window.removeEventListener("hashchange", syncMode);
    };
  }, []);

  return mode === "v2"
    ? createElement(StandaloneV2App)
    : createElement(AppShell);
}

async function bootstrap() {
  try {
    await loadRuntimeConfig();
  } catch {
    // runtimeConfig stores the load error; app still renders and shows auth/config states.
  }

  const runtimeError = getRuntimeLoadError();
  if (runtimeError) {
    console.error("Runtime config load error:", runtimeError);
  }

  createRoot(rootNode).render(createElement(AppEntry));
}

void bootstrap();
