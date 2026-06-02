// Kleiner Telegram-Helfer: sendet eine Nachricht in die Mahona-Gruppe (gleicher Kanal wie der
// Monats-Snapshot). Keys aus ~/.pierre-keys.env (TELEGRAM_MAHONA_BOT_TOKEN / TELEGRAM_MAHONA_GROUP_ID).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function loadEnv() {
  const f = path.join(os.homedir(), ".pierre-keys.env");
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    if (!process.env[t.slice(0, i).trim()]) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

export async function sendTelegram(text) {
  loadEnv();
  const token = process.env.TELEGRAM_MAHONA_BOT_TOKEN;
  const chat = process.env.TELEGRAM_MAHONA_GROUP_ID;
  if (!token || !chat) throw new Error("Telegram-Keys fehlen (TELEGRAM_MAHONA_BOT_TOKEN / TELEGRAM_MAHONA_GROUP_ID).");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return true;
}
