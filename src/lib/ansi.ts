/**
 * ANSI escape code to HTML converter for terminal output rendering.
 * Handles common SGR (Select Graphic Rendition) codes for colors and text styles.
 */

interface AnsiState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const ANSI_COLORS: Record<number, string> = {
  30: "#1e1e1e", 31: "#f87171", 32: "#4ade80", 33: "#fbbf24",
  34: "#60a5fa", 35: "#c084fc", 36: "#22d3ee", 37: "#e5e5e5",
  90: "#6b7280", 91: "#fca5a5", 92: "#86efac", 93: "#fde68a",
  94: "#93c5fd", 95: "#d8b4fe", 96: "#67e8f9", 97: "#fafafa",
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#1e1e1e", 41: "#f87171", 42: "#4ade80", 43: "#fbbf24",
  44: "#60a5fa", 45: "#c084fc", 46: "#22d3ee", 47: "#e5e5e5",
  100: "#6b7280", 101: "#fca5a5", 102: "#86efac", 103: "#fde68a",
  104: "#93c5fd", 105: "#d8b4fe", 106: "#67e8f9", 107: "#fafafa",
};

const RESET_STATE: AnsiState = {
  fg: null, bg: null, bold: false, dim: false, italic: false, underline: false,
};

function stateToStyle(state: AnsiState): string {
  const styles: string[] = [];
  if (state.fg) styles.push(`color:${state.fg}`);
  if (state.bg) styles.push(`background-color:${state.bg}`);
  if (state.bold) styles.push("font-weight:bold");
  if (state.dim) styles.push("opacity:0.6");
  if (state.italic) styles.push("font-style:italic");
  if (state.underline) styles.push("text-decoration:underline");
  return styles.join(";");
}

/**
 * Convert ANSI-escaped text to HTML spans with inline styles.
 */
export function ansiToHtml(text: string): string {
  if (!text) return "";

  // Escape HTML entities in the raw text first
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const ansiRegex = /\x1b\[([\d;]*)m/g;

  let result = "";
  let lastIndex = 0;
  let state: AnsiState = { ...RESET_STATE };
  let spanOpen = false;

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(escaped)) !== null) {
    // Add text before this escape code
    if (match.index > lastIndex) {
      result += escaped.slice(lastIndex, match.index);
    }

    // Process SGR codes
    const codes = match[1] ? match[1].split(";").map(Number) : [0];
    let stateChanged = false;

    for (const code of codes) {
      if (code === 0) {
        if (spanOpen) { result += "</span>"; spanOpen = false; }
        state = { ...RESET_STATE };
        stateChanged = false;
      } else if (code === 1) { state.bold = true; stateChanged = true; }
      else if (code === 2) { state.dim = true; stateChanged = true; }
      else if (code === 3) { state.italic = true; stateChanged = true; }
      else if (code === 4) { state.underline = true; stateChanged = true; }
      else if (code >= 30 && code <= 37) { state.fg = ANSI_COLORS[code]; stateChanged = true; }
      else if (code >= 90 && code <= 97) { state.fg = ANSI_COLORS[code]; stateChanged = true; }
      else if (code >= 40 && code <= 47) { state.bg = ANSI_BG_COLORS[code]; stateChanged = true; }
      else if (code >= 100 && code <= 107) { state.bg = ANSI_BG_COLORS[code]; stateChanged = true; }
      // 22: normal intensity, 23: not italic, 24: not underline
      else if (code === 22) { state.bold = false; state.dim = false; stateChanged = true; }
      else if (code === 23) { state.italic = false; stateChanged = true; }
      else if (code === 24) { state.underline = false; stateChanged = true; }
      // 39: default fg, 49: default bg
      else if (code === 39) { state.fg = null; stateChanged = true; }
      else if (code === 49) { state.bg = null; stateChanged = true; }
    }

    if (stateChanged) {
      if (spanOpen) { result += "</span>"; spanOpen = false; }
      const style = stateToStyle(state);
      if (style) {
        result += `<span style="${style}">`;
        spanOpen = true;
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < escaped.length) {
    result += escaped.slice(lastIndex);
  }

  if (spanOpen) {
    result += "</span>";
  }

  return result;
}

/**
 * Check if a string contains ANSI escape codes.
 */
export function hasAnsi(text: string): boolean {
  return /\x1b\[[\d;]*m/.test(text);
}
