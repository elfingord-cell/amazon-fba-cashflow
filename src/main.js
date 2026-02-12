import { createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "../styles.css";
import "./react/app-shell.css";
import { AppShell } from "./react/AppShell.jsx";
import { StandaloneV2App } from "./v2/app/StandaloneV2App";

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
  const [mode, setMode] = useState(() => (isV2Hash(normalizeV2Hash(window.location.hash)) ? "v2" : "legacy"));

  useEffect(() => {
    const syncMode = () => {
      const currentHash = window.location.hash || "";
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

createRoot(rootNode).render(createElement(AppEntry));
