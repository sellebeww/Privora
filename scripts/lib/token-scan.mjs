// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Vassel Goleyu
// Finds colours, radii, shadows, spacing and arbitrary values that are not design tokens.
// Pure function over text so it can be unit tested; scripts/check-tokens.mjs walks the files.

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
const SPACING = new Set(["0", "px", "1", "2", "3", "4", "6", "8", "12", "16"]); // x4px: 0, 1, 4, 8, 12, 16, 24, 32, 48, 64
const NAMED = "white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|lime|teal|navy|silver|gold";

const RULES = [
  ["hex colour", /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g],
  ["colour function", /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g],
  ["named colour in CSS", new RegExp(`(?:color|background(?:-color)?|border(?:-[a-z]+)*-color|fill|stroke|outline-color)\\s*:\\s*(?:${NAMED})\\b`, "g")],
  ["default palette class", new RegExp(`(?<![\\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret)-(?:${PALETTE})(?:-\\d+)?(?![\\w-])`, "g")],
  ["border-radius literal", /border-radius\s*:\s*(?!var\()[^;}]+/g],
  ["shadow", /(?<![\w-])(?:drop-)?shadow(?:-[\w[\]-]+)?(?![\w-])/g],
  ["box-shadow literal", /box-shadow\s*:/g],
  ["gradient class", /(?<![\w-])bg-(?:linear|radial|conic|gradient)[\w[\]-]*/g],
];

const RADIUS_OK = /^rounded(?:-(?:t|b|l|r|s|e|tl|tr|bl|br|ss|se|es|ee))?-(?:chip|control|panel)$/;

/** Blanks comments (keeping line numbers) so prose such as "no shadows" is not flagged. */
function stripComments(t) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return t.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/(^|\s)\/\/[^\n]*/g, blank);
}

/** @returns {{rule: string, text: string, line: number}[]} */
export function scanSource(source, file = "") {
  const out = [];
  const text = stripComments(source);
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  const isTokens = /styles\/tokens\.css$/.test(file);
  const isHtml = /\.html$/.test(file);
  for (const [rule, re] of RULES) {
    if (isTokens) continue;
    for (const m of text.matchAll(re)) {
      // theme-color needs a literal. In HTML only, a hex equal to a token value is fine.
      if (isHtml && rule === "hex colour" && /^#0a0a0b$/i.test(m[0])) continue;
      // Colour rules apply to code. A hash in a URL fragment such as href="#main" is not a colour.
      if (rule === "hex colour" && /["'`]#/.test(text.slice(Math.max(0, m.index - 1), m.index + 1)) && !/^#[0-9a-fA-F]{6}$/.test(m[0]) ) continue;
      out.push({ rule, text: m[0], line: lineOf(m.index) });
    }
  }
  if (!isTokens) {
    for (const m of text.matchAll(/(?<![\w-])-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(px|\d+(?:\.\d+)?)(?![\w.-])/g)) {
      if (!SPACING.has(m[2])) out.push({ rule: "spacing off the 4px scale", text: m[0], line: lineOf(m.index) });
    }
    for (const m of text.matchAll(/(?<![\w])rounded[\w-]*/g)) {
      if (!RADIUS_OK.test(m[0])) out.push({ rule: "radius outside tokens", text: m[0], line: lineOf(m.index) });
    }
    for (const m of text.matchAll(/(?<![\w])[a-z][\w:-]*-\[([^\]\s]+)\]/g)) {
      if (/\d(?:px|rem|em|ch|vh|vw|%)|#|rgb|hsl/.test(m[1]) && !/var\(--/.test(m[1])) out.push({ rule: "arbitrary value without a token", text: m[0], line: lineOf(m.index) });
    }
    for (const m of text.matchAll(/(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)) {
      out.push({ rule: "font size off the type scale", text: m[0], line: lineOf(m.index) });
    }
  }
  return out;
}

/** SVG assets cannot use CSS variables: every colour must equal a token value. */
export function scanSvg(text, tokenHexes) {
  const out = [];
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    if (!tokenHexes.has(m[0].toLowerCase())) out.push({ rule: "svg colour is not a token value", text: m[0], line: 1 });
  }
  return out;
}
