import {figureDiagnosticText} from './figure-diagnostics.js';
// Lossless delimited-table reading. Chart roles belong to consumers, not the parser.
export const TABLE_DELIMITERS = [['auto', 'Detect automatically'], [',', 'Comma'], ['\t', 'Tab'], [';', 'Semicolon'], ['|', 'Pipe']];
export const MAX_TABLE_TEXT = 16 * 1024 * 1024;

function readRows(source, delimiter, limit = Infinity, preserveEmptyRows = false, fm = figureDiagnosticText()) {
  const rows = [];
  let cells = [], value = '', quoted = false, closed = false, line = 1, start = 1;
  function cell() { cells.push(value); value = ''; closed = false; }
  function row() {
    cell();
    if (preserveEmptyRows || cells.some(v => v.trim())) rows.push({line: start, cells});
    cells = []; start = line + 1;
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { value += c; if (c === '\n' || c === '\r' && source[i + 1] !== '\n') line++; }
    } else if (c === delimiter) cell();
    else if (c === '\n' || c === '\r') {
      row();
      if (c === '\r' && source[i + 1] === '\n') i++;
      line++;
      if (rows.length >= limit) return rows;
    } else if (c === '"' && !value && !closed) quoted = true;
    else if (closed && /[ \t]/.test(c)) continue;
    else if (closed || c === '"') throw new Error(fm('quotedAdjacent',{line}));
    else value += c;
  }
  if (quoted) throw new Error(fm('quotedUnclosed',{line:start}));
  if (!preserveEmptyRows || value || cells.length || closed) row();
  return rows;
}

function detectDelimiter(source) {
  const candidates = [',', '\t', ';', '|'].map(delimiter => {
    try {
      const rows = readRows(source, delimiter, 25), width = rows[0]?.cells.length ?? 0;
      const consistent = rows.filter(row => row.cells.length === width).length;
      return {delimiter, score: width > 1 ? consistent / rows.length * 100 + Math.min(width, 30) : 0};
    } catch { return {delimiter, score: -1}; }
  });
  return candidates.sort((a, b) => b.score - a.score)[0].delimiter;
}

export function readDelimitedTable(source, {delimiter = 'auto', header = true, preserveEmptyRows = false, minColumns = 2, translate} = {}) {
  const fm=figureDiagnosticText(translate);
  if (typeof source !== 'string' || !source.trim()) throw new Error(fm('tableRequired'));
  if (source.length > MAX_TABLE_TEXT) throw new Error(fm('tableLimit'));
  source = source.replace(/^\uFEFF/, '');
  if (delimiter === 'auto') delimiter = detectDelimiter(source);
  if (!TABLE_DELIMITERS.some(([value]) => value === delimiter && value !== 'auto')) throw new Error(fm('tableSeparator'));
  const parsed = readRows(source, delimiter, Infinity, preserveEmptyRows, fm), width = (preserveEmptyRows ? parsed.find(row => row.cells.some(v => v.trim()) || row.cells.length > 1)?.cells.length : parsed[0]?.cells.length) ?? 0;
  if (preserveEmptyRows) for (const row of parsed) if (row.cells.length === 1 && row.cells[0] === '') row.cells = Array(width).fill('');
  if (![1, 2].includes(minColumns)) throw new Error(fm('tableMinimum'));
  if (width < minColumns) throw new Error(fm('tableColumns'));
  for (const row of parsed) if (row.cells.length !== width) {
    throw new Error(fm('tableWidth',{line:row.line,found:row.cells.length,expected:width}));
  }
  const headings = header ? parsed.shift().cells : Array.from({length: width}, (_, i) => 'Column ' + (i + 1));
  if (!parsed.length) throw new Error(fm('tableRows'));
  const used = new Set();
  const columns = headings.map((heading, index) => {
    const base = heading.trim() || 'Column ' + (index + 1);
    let label = base, suffix = 2;
    while (used.has(label)) label = base + ' (' + suffix++ + ')';
    used.add(label);
    return {index, label, heading};
  });
  return {columns, rows: parsed, delimiter, header};
}

// Deliberately reject formulas, hexadecimal, Infinity and ambiguous grouping.
// Decimal convention is explicit; blank values remain missing, never zero.
export function tableNumber(value, decimal = '.') {
  const source = String(value ?? '').trim();
  if (!source) return null;
  const normalized = decimal === ',' ? source.replace(',', '.') : source;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return NaN;
  const result = Number(normalized);
  return Number.isFinite(result) && Math.abs(result) <= 1e100 ? result : NaN;
}
