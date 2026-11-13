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
    changeCase, dropParasites, emptyCells, toCSV, cellToText,
  };
})();

if (typeof module !== 'undefined') module.exports = Ops;
