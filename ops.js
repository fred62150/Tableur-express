/* Tableur Express — opérations de nettoyage (fonctions pures, sans interface).
 * Modèle de table : { headers: string[], rows: any[][] }
 * Une cellule est une chaîne, un nombre, un booléen ou un objet Date.
 */
const Ops = (() => {
  const isEmpty = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const clone = (t) => ({ headers: [...t.headers], rows: t.rows.map((r) => [...r]) });
  const allCols = (t) => t.headers.map((_, i) => i);
  const pick = (t, cols) => (cols && cols.length ? cols : allCols(t));

  /* ---------- Lecture CSV ---------- */
  function decodeBuffer(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 5).join('\n');
    const count = { ';': 0, ',': 0, '\t': 0, '|': 0 };
    let inQ = false;
    for (const ch of sample) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in count) count[ch]++;
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  }

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const d = detectDelimiter(text);
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === d) { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ---------- En-têtes ---------- */
  function guessHeaderRow(raw) {
    const head = raw.slice(0, 20);
    const filled = head.map((r) => r.filter((c) => !isEmpty(c)).length);
    const max = Math.max(0, ...filled);
    if (max === 0) return 0;
    const idx = filled.findIndex((n) => n >= Math.ceil(max * 0.6));
    return idx < 0 ? 0 : idx;
  }

  function buildTable(raw, headerRow) {
    const width = Math.max(0, ...raw.map((r) => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => (i < r.length ? r[i] : ''));
    const src = raw.map(pad);
    const hdr = (src[headerRow] || []).map((h, i) => {
      const s = h instanceof Date ? fmtDate(h) : String(h ?? '').trim();
      return s || `Colonne ${i + 1}`;
    });
    const seen = {};
    const headers = hdr.map((h) => {
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? `${h} (${seen[h]})` : h;
    });
    return { headers, rows: src.slice(headerRow + 1) };
  }

  /* ---------- Dates ---------- */
  const p2 = (n) => String(n).padStart(2, '0');
  function fmtDate(d) {
    const base = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
    return d.getHours() || d.getMinutes() ? `${base} ${p2(d.getHours())}:${p2(d.getMinutes())}` : base;
  }
  function mkDate(y, m, d, h = 0, mi = 0) {
    const dt = new Date(y, m - 1, d, h, mi);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }
  function parseDate(s) {
    s = s.trim();
    let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[ T]+(\d{1,2})[:h](\d{2}))?$/);
    if (m) {
      let y = +m[3];
      if (m[3].length === 2) y += y <= 69 ? 2000 : 1900;
      return mkDate(y, +m[2], +m[1], +(m[4] || 0), +(m[5] || 0));
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
    if (m) return mkDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0));
    return null;
  }
  /* Date lue par SheetJS : on arrondit à la minute pour absorber ses décalages. */
  function cleanExcelDate(d) {
    return new Date(Math.round(d.getTime() / 60000) * 60000);
  }

  /* ---------- Accents cassés (mojibake) ---------- */
  const CP1252 = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91,
    0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98,
    0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
  };
  function fixMojibake(s) {
    if (typeof s !== 'string' || !/[ÃÂâ]/.test(s)) return s;
    const bytes = [];
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 256) bytes.push(c);
      else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
      else return s;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch (e) {
      return s;
    }
  }

  /* ---------- Outils de transformation ---------- */
  function mapCells(t, cols, fn) {
    let changed = 0;
    t.rows.forEach((r) => {
      cols.forEach((c) => {
        const nv = fn(r[c]);
        if (nv !== r[c] && !(nv instanceof Date && r[c] instanceof Date && +nv === +r[c])) {
          r[c] = nv;
          changed++;
        }
      });
    });
    return changed;
  }

  /* ---------- Opérations ---------- */
  function fixAccents(t, cols) {
    const out = clone(t);
    const n = mapCells(out, pick(t, cols), fixMojibake);
    return { table: out, log: `Accents réparés : ${n} cellule(s)` };
  }

  function trimSpaces(t, cols) {
    const out = clone(t);
    const n = mapCells(out, pick(t, cols), (v) =>
      typeof v === 'string' ? v.replace(/[   \t]+/g, ' ').replace(/ {2,}/g, ' ').trim() : v);
    return { table: out, log: `Espaces nettoyés : ${n} cellule(s)` };
  }

  function removeEmpty(t) {
    const out = clone(t);
    const r0 = out.rows.length;
    out.rows = out.rows.filter((r) => r.some((c) => !isEmpty(c)));
    const keep = out.headers.map((h, i) => !/^Colonne \d+$/.test(h) || out.rows.some((r) => !isEmpty(r[i])));
    const c0 = out.headers.length;
    out.headers = out.headers.filter((_, i) => keep[i]);
    out.rows = out.rows.map((r) => r.filter((_, i) => keep[i]));
    return {
      table: out,
      log: `Lignes vides supprimées : ${r0 - out.rows.length} · colonnes vides supprimées : ${c0 - out.headers.length}`,
    };
  }

  function dedupe(t, cols, ignoreCase) {
    const out = clone(t);
    const use = pick(t, cols);
    const norm = (v) => {
      if (v instanceof Date) return `d${+v}`;
      let s = String(v ?? '').trim();
      const pd = s && typeof v === 'string' ? parseDate(s) : null;
      if (pd) return `d${+pd}`;
      if (ignoreCase) s = s.toLowerCase().replace(/\s+/g, ' ');
      return s;
    };
    const seen = new Set();
    const r0 = out.rows.length;
    out.rows = out.rows.filter((r) => {
      const k = use.map((c) => norm(r[c])).join('\u0001');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { table: out, log: `Doublons supprimés : ${r0 - out.rows.length} ligne(s)` };
  }

  function countDuplicates(t, cols, ignoreCase) {
    return t.rows.length - dedupe(t, cols, ignoreCase).table.rows.length;
  }

  const filled = (t, c) => t.rows.map((r) => r[c]).filter((v) => !isEmpty(v));
  const isDateLike = (v) => v instanceof Date || (typeof v === 'string' && !!parseDate(v));
  function autoCols(t, cols, test, share) {
    if (cols && cols.length) return cols;
    return allCols(t).filter((c) => {
      const f = filled(t, c);
      return f.length > 0 && f.filter(test).length / f.length >= share;
    });
  }

  function normalizeDates(t, cols) {
    const out = clone(t);
    const target = autoCols(t, cols, isDateLike, 0.5);
    let failed = 0;
    const n = mapCells(out, target, (v) => {
      if (v instanceof Date) return v;
      if (typeof v !== 'string' || isEmpty(v)) return v;
      const d = parseDate(v);
      if (!d) { failed++; return v; }
      return d;
    });
    const where = cols && cols.length ? '' : ` (colonnes détectées : ${target.map((c) => t.headers[c]).join(', ') || 'aucune'})`;
    return {
      table: out,
      log: `Dates converties : ${n} cellule(s)${where}` + (failed ? ` · ${failed} valeur(s) non reconnue(s), laissées telles quelles` : ''),
    };
  }

  const NUM_RE = /^-?(?:\d{1,3}(?:[  ]\d{3})+|\d+)(?:[.,]\d+)?$/;
  function toNumbers(t, cols) {
    const out = clone(t);
    const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && NUM_RE.test(v.trim()));
    const target = autoCols(t, cols, isNum, 0.8);
    const n = mapCells(out, target, (v) => {
      if (typeof v !== 'string') return v;
      const s = v.trim();
      if (!NUM_RE.test(s) || /^-?0\d/.test(s)) return v; // garde les codes comme 01234
      return parseFloat(s.replace(/[  ]/g, '').replace(',', '.'));
    });
    const where = cols && cols.length ? '' : ` (colonnes détectées : ${target.map((c) => t.headers[c]).join(', ') || 'aucune'})`;
    return { table: out, log: `Nombres convertis : ${n} cellule(s)${where}` };
  }

  function changeCase(t, cols, mode) {
    const out = clone(t);
    const title = (s) => s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    const n = mapCells(out, pick(t, cols), (v) => {
      if (typeof v !== 'string') return v;
      if (mode === 'upper') return v.toUpperCase();
      if (mode === 'lower') return v.toLowerCase();
      return title(v);
    });
    return { table: out, log: `Casse modifiée : ${n} cellule(s)` };
  }

  function dropParasites(t, text, minFilled) {
    const out = clone(t);
    const r0 = out.rows.length;
    const needle = (text || '').trim().toLowerCase();
    out.rows = out.rows.filter((r) => {
      if (needle && r.some((c) => String(c ?? '').toLowerCase().includes(needle))) return false;
      if (minFilled > 0 && r.filter((c) => !isEmpty(c)).length < minFilled) return false;
      return true;
    });
    return { table: out, log: `Lignes parasites supprimées : ${r0 - out.rows.length}` };
  }

  function emptyCells(t) {
    let n = 0;
    t.rows.forEach((r) => r.forEach((c) => { if (isEmpty(c)) n++; }));
    return n;
  }


  /* ---------- Tableau croisé ---------- */
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v !== 'string') return NaN;
    const s = v.trim();
    return NUM_RE.test(s) ? parseFloat(s.replace(/[  ]/g, '').replace(',', '.')) : NaN;
  }
  const AGG_LABEL = { sum: 'Somme', avg: 'Moyenne', count: 'Nombre', min: 'Minimum', max: 'Maximum' };

  /* opt : { rows:[indices], col:indice|null, val:indice|null, agg, totals, sortRows:'az'|'appearance' } */
  function pivot(t, opt) {
    const agg = opt.agg || 'sum';
    const rowIdx = opt.rows;
    const colIdx = opt.col === undefined || opt.col === null ? null : opt.col;
    const valIdx = opt.val === undefined || opt.val === null ? null : opt.val;
    const disp = (v) => (isEmpty(v) ? '(vide)' : v instanceof Date ? fmtDate(v) : String(v).trim());
    const cmp = (a, b) => {
      if (typeof a.raw === 'number' && typeof b.raw === 'number') return a.raw - b.raw;
      if (a.raw instanceof Date && b.raw instanceof Date) return a.raw - b.raw;
      return a.text.localeCompare(b.text, 'fr', { numeric: true, sensitivity: 'base' });
    };
    const acc = () => ({ sum: 0, n: 0, rows: 0, min: Infinity, max: -Infinity });
    const add = (a, x) => {
      a.rows++;
      if (!Number.isNaN(x)) { a.sum += x; a.n++; if (x < a.min) a.min = x; if (x > a.max) a.max = x; }
    };
    const rnd = (x) => Math.round(x * 1e8) / 1e8;
    const fin = (a) => {
      if (!a) return agg === 'sum' || agg === 'count' ? 0 : '';
      if (agg === 'count') return a.rows;
      if (agg === 'sum') return rnd(a.sum);
      if (!a.n) return '';
      if (agg === 'avg') return rnd(a.sum / a.n);
      return agg === 'min' ? a.min : a.max;
    };

    const rowMap = new Map();
    const colMap = new Map();
    const cells = new Map();
    const rowTot = new Map();
    const colTot = new Map();
    const grand = acc();
    t.rows.forEach((r) => {
      const rk = rowIdx.map((i) => disp(r[i])).join('\u0001');
      if (!rowMap.has(rk)) rowMap.set(rk, rowIdx.map((i) => ({ raw: r[i], text: disp(r[i]) })));
      const ck = colIdx === null ? '' : disp(r[colIdx]);
      if (colIdx !== null && !colMap.has(ck)) colMap.set(ck, { raw: r[colIdx], text: ck });
      const x = valIdx === null ? NaN : toNum(r[valIdx]);
      const key = rk + '\u0002' + ck;
      if (!cells.has(key)) cells.set(key, acc());
      add(cells.get(key), x);
      if (!rowTot.has(rk)) rowTot.set(rk, acc());
      add(rowTot.get(rk), x);
      if (!colTot.has(ck)) colTot.set(ck, acc());
      add(colTot.get(ck), x);
      add(grand, x);
    });

    let rowKeys = [...rowMap.keys()];
    if (opt.sortRows !== 'appearance') {
      rowKeys.sort((a, b) => {
        const A = rowMap.get(a);
        const B = rowMap.get(b);
        for (let i = 0; i < A.length; i++) { const c = cmp(A[i], B[i]); if (c) return c; }
        return 0;
      });
    }
    let colKeys = [...colMap.keys()];
    const sortable = colKeys.length && colKeys.every((k) => typeof colMap.get(k).raw === 'number' || colMap.get(k).raw instanceof Date);
    if (sortable) colKeys.sort((a, b) => cmp(colMap.get(a), colMap.get(b)));

    const valName = valIdx === null ? '' : t.headers[valIdx];
    const aggName = agg === 'count' ? 'Nombre de lignes' : `${AGG_LABEL[agg]} de ${valName}`;
    const headers = [...rowIdx.map((i) => t.headers[i])];
    if (colIdx === null) headers.push(aggName);
    else { colKeys.forEach((k) => headers.push(k)); if (opt.totals) headers.push('Total'); }

    const rows = rowKeys.map((rk) => {
      const line = rowMap.get(rk).map((c) => c.raw instanceof Date || typeof c.raw === 'number' ? c.raw : c.text);
      if (colIdx === null) line.push(fin(rowTot.get(rk)));
      else { colKeys.forEach((ck) => line.push(fin(cells.get(rk + '\u0002' + ck)))); if (opt.totals) line.push(fin(rowTot.get(rk))); }
      return line;
    });
    if (opt.totals) {
      const line = rowIdx.map((_, i) => (i === 0 ? 'Total' : ''));
      if (colIdx === null) line.push(fin(grand));
      else { colKeys.forEach((ck) => line.push(fin(colTot.get(ck)))); line.push(fin(grand)); }
      rows.push(line);
    }
    return { table: { headers, rows }, log: `Tableau croisé : ${aggName}${colIdx === null ? '' : ' par ' + t.headers[colIdx]} — ${rows.length} ligne(s)` };
  }

  /* ---------- Export ---------- */
  function cellToText(v) {
    if (v instanceof Date) return fmtDate(v);
    if (typeof v === 'number') return String(v).replace('.', ',');
    return v === null || v === undefined ? '' : String(v);
  }
  function toCSV(t) {
    const q = (s) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [t.headers, ...t.rows].map((r) => r.map((c) => q(cellToText(c))).join(';'));
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return {
    isEmpty, clone, decodeBuffer, parseCSV, guessHeaderRow, buildTable, fmtDate, parseDate, cleanExcelDate,
    fixMojibake, fixAccents, trimSpaces, removeEmpty, dedupe, countDuplicates, normalizeDates, toNumbers,
    changeCase, dropParasites, emptyCells, toCSV, cellToText, pivot, toNum,
  };
})();

if (typeof module !== 'undefined') module.exports = Ops;
