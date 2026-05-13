// Minimal CV file → plain text extractor that runs in Cue's main process.
// Owned by main (not renderer) because:
//   - File-system read needs Node fs APIs the renderer doesn't have.
//   - Reading binary blobs in renderer would mean shuttling the bytes
//     through IPC twice (renderer → main → renderer → main → server).
//
// Supports plain-text (.txt) and markdown (.md) trivially. For PDFs we
// take a HEURISTIC approach: extract text out of literal-string operators
// inside PDF content streams. This works for the common case (CVs
// exported from Word / Google Docs / Pages / typst), and fails
// gracefully (empty result) for scanned-image PDFs — those callers see
// an error and fall back to "paste text manually" in the wizard.
//
// Why not pdf-parse / pdfjs-dist? Both pull ~5MB native-ish deps into
// Cue. We do best-effort for the 80%-case and instruct users in the
// remaining 20% (scanned résumés, exotic encoders) to paste text. CVs
// are short — the manual fallback is acceptable.

import { promises as fs } from 'fs';
import path from 'path';

export interface ExtractResult {
  text: string;
  filename: string;
  /** True when the extractor produced usable text. False otherwise so
   *  the wizard can surface "couldn't read this file, paste text". */
  ok: boolean;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB hard cap — refuse anything bigger

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read the file at `filePath` and return its plain-text contents.
 *
 * The extractor dispatches on the file extension:
 *   - .txt / .markdown / .md / .* (anything non-binary)  → utf-8 decode.
 *   - .pdf                                                → heuristic PDF
 *                                                           text-stream scrape.
 *
 * Returns `ok=false` when the file is missing, oversized, or the
 * extractor couldn't produce >50 chars of text (typical scanned-PDF
 * case). Caller should show a "paste manually" affordance on `!ok`.
 */
export async function extractCVText(filePath: string): Promise<ExtractResult> {
  const filename = path.basename(filePath);
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      return { text: '', filename, ok: false };
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') {
      const buf = await fs.readFile(filePath);
      const text = extractPDFText(buf);
      // Less than 50 usable chars = probably a scanned image PDF.
      // The LLM parser doesn't add value on garbage input; better to
      // tell the user up-front to paste their CV directly.
      if (text.trim().length < 50) {
        return { text: '', filename, ok: false };
      }
      return { text, filename, ok: true };
    }
    // Default path: read as utf-8 text. Works for .txt, .md, .markdown,
    // .rtf (the unstyled parts), and any other text-ish file.
    const text = await fs.readFile(filePath, 'utf8');
    if (text.trim().length < 5) {
      return { text: '', filename, ok: false };
    }
    return { text, filename, ok: true };
  } catch {
    return { text: '', filename, ok: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// PDF heuristic extractor
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract literal text strings from a PDF's content streams without a
 * full PDF parser.
 *
 * Strategy: most CV-style PDFs (Word/Docs/Pages export) wrap visible
 * text in `(string) Tj` or `[(s1)(s2)] TJ` operators inside `BT…ET`
 * blocks. We grep across the whole binary for these literal strings,
 * decode common PDF escape sequences, and join with spaces.
 *
 * Limitations:
 *   - Scanned PDFs (image-only) → empty result.
 *   - Custom encoding maps (CID-keyed fonts) → garbled. We accept this
 *     — uncommon in CVs, and the wizard can fall back to paste.
 *   - Word-order may scramble multi-column layouts. The LLM parser is
 *     surprisingly tolerant.
 */
function extractPDFText(buf: Buffer): string {
  // Decoding the entire PDF as latin-1 (binary-safe) lets us regex
  // across compressed streams that we can't decode in JS without a
  // zlib pass. We DO attempt zlib decompression of FlateDecode'd
  // streams (the common case) below.
  const out: string[] = [];

  // Step 1: decode FlateDecode streams. We look for the
  // /Filter /FlateDecode marker followed by `stream\n...\nendstream`
  // and inflate the inner bytes. This catches the majority of PDF
  // text content (PDFs from Word / Docs / Pages all compress).
  const decompressed = decompressFlateStreams(buf);

  // Step 2: regex for `(literal) Tj` and `[(a)(b)(c)] TJ` operators.
  // We scan the whole decompressed string. The parentheses-balanced
  // regex is approximate — embedded `\)` escapes work; nested parens
  // do not (PDFs rarely have them in text strings).
  const literalRE = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|TJ|')/g;
  let m: RegExpExecArray | null;
  while ((m = literalRE.exec(decompressed)) !== null) {
    const decoded = decodePDFLiteral(m[1]);
    if (decoded.trim().length > 0) {
      out.push(decoded);
    }
  }
  // Also catch the `[...]TJ` array form where each element is a literal
  // separated by kerning numbers.
  const arrayRE = /\[((?:\([^)]*\)|-?\d+|\s)+)\]\s*TJ/g;
  while ((m = arrayRE.exec(decompressed)) !== null) {
    const inner = m[1];
    const litRE = /\(((?:\\.|[^\\()])*)\)/g;
    let lm: RegExpExecArray | null;
    const piece: string[] = [];
    while ((lm = litRE.exec(inner)) !== null) {
      piece.push(decodePDFLiteral(lm[1]));
    }
    if (piece.length > 0) {
      out.push(piece.join(''));
    }
  }

  // Insert a space between operator results so words from adjacent Tj
  // operators don't run together.
  return collapseWhitespace(out.join(' '));
}

/**
 * Walk the PDF bytes, find every `/Filter /FlateDecode … stream\n…\nendstream`
 * block, inflate the body, and concatenate the inflated output with the
 * non-stream portions of the PDF. Returns a "binary-as-latin1" string we
 * can then regex over.
 *
 * Falls back to the raw latin-1 decode of `buf` if zlib inflate fails.
 */
function decompressFlateStreams(buf: Buffer): string {
  let result = '';
  // We treat the buffer as latin-1 (each byte = one codepoint). That's
  // safe because regex / indexOf work in byte units, and we re-emit
  // bytes for the non-stream sections. Final emit uses latin1 again so
  // the text-literal regex over the concatenated string is identical.
  const raw = buf.toString('latin1');
  let cursor = 0;

  // Tokens we look for. The PDF spec allows whitespace before/after `/FlateDecode`
  // and the literal `stream\n` / `stream\r\n` delimiter.
  const streamMarker = /stream[\r\n]+/g;
  const endMarker = '\nendstream';

  while (cursor < raw.length) {
    const streamMatch = streamMarker.exec(raw);
    if (!streamMatch || streamMatch.index < cursor) {
      result += raw.slice(cursor);
      break;
    }
    // Capture the dictionary preceding `stream`. We need its bytes to
    // re-emit if FlateDecode isn't in the filter list; we'll also skip
    // streams that don't declare Flate.
    const dictStart = raw.lastIndexOf('<<', streamMatch.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, streamMatch.index) : '';
    const isFlate = /\/FlateDecode/.test(dict) || /\/Fl\b/.test(dict);

    // Emit everything up to and including the marker as-is.
    result += raw.slice(cursor, streamMatch.index + streamMatch[0].length);
    const bodyStart = streamMatch.index + streamMatch[0].length;
    const bodyEnd = raw.indexOf(endMarker, bodyStart);
    if (bodyEnd < 0) {
      result += raw.slice(bodyStart);
      break;
    }
    const bodyBytes = buf.subarray(bodyStart, bodyEnd);

    if (isFlate) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const zlib = require('zlib') as typeof import('zlib');
        const inflated = zlib.inflateSync(bodyBytes);
        result += inflated.toString('latin1');
      } catch {
        // Inflate failure → fall back to raw bytes; we may still find
        // unencrypted text fragments in there.
        result += bodyBytes.toString('latin1');
      }
    } else {
      result += bodyBytes.toString('latin1');
    }
    result += endMarker;
    cursor = bodyEnd + endMarker.length;
    streamMarker.lastIndex = cursor;
  }
  return result;
}

/**
 * Decode a literal-string body that was extracted from a `(…)` PDF
 * operand. Handles common escapes: `\(`, `\)`, `\\`, `\n`, `\r`, `\t`,
 * octal `\ddd`. Other escapes pass through stripped of their backslash.
 *
 * We DELIBERATELY do not attempt CID / glyph-map conversion — that
 * requires a full font dictionary read which a heuristic extractor
 * skips. Real-world CVs use standard encodings and survive this.
 */
function decodePDFLiteral(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = s[i + 1];
    if (next === undefined) {
      break;
    }
    // Octal escapes \ddd — up to 3 digits.
    if (next >= '0' && next <= '7') {
      let oct = next;
      let j = i + 2;
      while (j < s.length && j - i - 1 < 3 && s[j] >= '0' && s[j] <= '7') {
        oct += s[j];
        j++;
      }
      out += String.fromCharCode(parseInt(oct, 8));
      i = j - 1;
      continue;
    }
    switch (next) {
      case 'n': out += '\n'; break;
      case 'r': out += '\r'; break;
      case 't': out += '\t'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case '\\':
      case '(':
      case ')': out += next; break;
      default: out += next;
    }
    i++;
  }
  return out;
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
