// ============================================================
// TUI — Config (pure, no pi imports).
//
// Global:  ~/.pi/agent/muselinn-tui.json
// Project: .pi/muselinn-tui.json (overrides matching global fields)
// Writes always go to the global file (same convention as
// permission/config.ts writing to ~/.pi/agent).
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import { EDITOR_STYLES, type EditorStyle } from "./box.ts";

export interface TuiConfig {
  style: EditorStyle;
  /** Show the model name on the editor's top border. Default off — pi's
   *  built-in status line already shows it (opt-in to avoid duplication). */
  modelInBorder: boolean;
}

export const DEFAULT_TUI_CONFIG: TuiConfig = { style: "boxed", modelInBorder: false };

const CONFIG_FILENAME = "muselinn-tui.json";

export function globalTuiConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(home, ".pi", "agent", CONFIG_FILENAME);
}

export function projectTuiConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", CONFIG_FILENAME);
}

function sanitize(raw: any): Partial<TuiConfig> {
  const out: Partial<TuiConfig> = {};
  if (raw && typeof raw === "object") {
    if (typeof raw.style === "string" && (EDITOR_STYLES as readonly string[]).includes(raw.style)) {
      out.style = raw.style as EditorStyle;
    }
    if (typeof raw.modelInBorder === "boolean") out.modelInBorder = raw.modelInBorder;
  }
  return out;
}

function readConfigFile(p: string): Partial<TuiConfig> {
  try {
    return sanitize(JSON.parse(fs.readFileSync(p, "utf-8")));
  } catch {
    return {};
  }
}

/** Merge global config with the project override; invalid/missing fields fall back to defaults. */
export function loadTuiConfig(cwd: string): TuiConfig {
  return {
    ...DEFAULT_TUI_CONFIG,
    ...readConfigFile(globalTuiConfigPath()),
    ...readConfigFile(projectTuiConfigPath(cwd)),
  };
}

/** Persist to the global config file. Returns true on success. */
export function saveTuiConfig(config: TuiConfig): boolean {
  try {
    const p = globalTuiConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
