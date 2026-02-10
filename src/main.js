import { createElement } from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "../styles.css";
import "./react/app-shell.css";
import { AppShell } from "./react/AppShell.jsx";

const rootNode = document.getElementById("root");

if (!rootNode) {
  throw new Error("Root element #root not found");
}

createRoot(rootNode).render(createElement(AppShell));
