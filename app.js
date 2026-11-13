/* Tableur Express — interface. Toute la logique de traitement est dans ops.js. */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    fileName: '', workbook: null, raw: null, headerRow: 0,
    base: null, table: null, history: [], log: [], selected: new Set(),
  };
  const PREVIEW_ROWS = 100;

  const say = (text, err) => { const m = $('msg'); m.textContent = text || ''; m.className = 'msg' + (err ? ' err' : ''); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Import ---------- */
  async function loadFile(file) {
    if (!file) return;
    say('Lecture du fichier…');
    try {
      const buf = await file.arrayBuffer();
      const isText = /\.(csv|txt)$/i.test(file.name);
      state.fileName = file.name;
      state.workbook = null;
      if (isText) {
        state.raw = Ops.parseCSV(Ops.decodeBuffer(buf));
        fillSheets(null);
      } else {
        if (typeof XLSX === 'undefined') throw new Error('La bibliothèque de lecture Excel n\'a pas pu se charger (connexion ?). Les fichiers .csv restent utilisables.');
        state.workbook = XLSX.read(buf, { type: 'array', cellDates: true });
        fillSheets(state.workbook.SheetNames);
        readSheet(state.workbook.SheetNames[0]);
      }
      if (!state.raw.length) throw new Error('Le fichier semble vide.');
      $('fileName').textContent = file.name;
      $('outName').value = file.name.replace(/\.[^.]+$/, '') + '_propre';
      $('fileInfo').classList.remove('hidden');
      $('work').classList.remove('hidden');
      resetFromRaw(true);
      say('');
    } catch (e) {
      say('Impossible de lire ce fichier : ' + e.message, true);
    }
  }

  function fillSheets(names) {
    const sel = $('sheetSel');
    sel.innerHTML = (names || ['(fichier texte)']).map((n) => `<option>${esc(n)}</option>`).join('');
    sel.disabled = !names || names.length < 2;
  }

  function readSheet(name) {
    const ws = state.workbook.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
    state.raw = aoa.map((r) => r.map((c) => (c instanceof Date ? Ops.cleanExcelDate(c) : c)));
  }

  function resetFromRaw(guess) {
    if (guess) {
      state.headerRow = Ops.guessHeaderRow(state.raw);
      $('headerRow').value = state.headerRow + 1;
    }
    state.base = Ops.buildTable(state.raw, state.headerRow);
    state.table = state.base;
    state.history = [];
    state.log = [];
    state.selected = new Set();
    render();
  }

  /* ---------- Rendu ---------- */
  function render() {
    const t = state.table;
    $('stats').innerHTML = [
      [t.rows.length.toLocaleString('fr-FR'), 'lignes'],
      [t.headers.length, 'colonnes'],
      [Ops.emptyCells(t).toLocaleString('fr-FR'), 'cellules vides'],
      [Ops.countDuplicates(t, cols(), $('dupCase').checked).toLocaleString('fr-FR'), 'doublons détectés'],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');

    $('chips').innerHTML = t.headers
      .map((h, i) => `<button class="chip${state.selected.has(i) ? ' on' : ''}" data-col="${i}">${esc(h)}</button>`).join('');

    const head = '<tr>' + t.headers.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>';
    const body = t.rows.slice(0, PREVIEW_ROWS).map((r) =>
      '<tr>' + r.map((c) => {
        const empty = Ops.isEmpty(c);
        return `<td class="${empty ? 'empty ' : ''}${typeof c === 'number' ? 'num-c' : ''}">${esc(Ops.cellToText(c))}</td>`;
      }).join('') + '</tr>').join('');
    $('preview').innerHTML = head + body;
    $('previewNote').textContent = t.rows.length > PREVIEW_ROWS
      ? `Aperçu des ${PREVIEW_ROWS} premières lignes sur ${t.rows.length.toLocaleString('fr-FR')}. Les opérations s'appliquent à toutes les lignes.`
      : '';

    $('log').innerHTML = state.log.map((l) => `<li>${esc(l)}</li>`).join('');
    $('undo').disabled = !state.history.length;
    $('reset').disabled = !state.history.length;
    $('dupInfo').textContent = 'Garde la première ligne de chaque groupe.';
  }

  const cols = () => [...state.selected].sort((a, b) => a - b);

  /* ---------- Opérations ---------- */
  function run(fn) {
    const res = fn();
    state.history.push({ table: state.table, log: state.log });
    state.table = res.table;
    state.log = [...state.log, res.log];
    render();
  }

  const OPS = {
    accents: () => Ops.fixAccents(state.table, cols()),
    trim: () => Ops.trimSpaces(state.table, cols()),
    empty: () => Ops.removeEmpty(state.table),
    dedupe: () => Ops.dedupe(state.table, cols(), $('dupCase').checked),
    dates: () => Ops.normalizeDates(state.table, cols()),
    numbers: () => Ops.toNumbers(state.table, cols()),
    case: () => Ops.changeCase(state.table, cols(), $('caseMode').value),
    parasites: () => {
      const txt = $('pText').value;
      const min = +$('pMin').value || 0;
      if (!txt.trim() && !min) { say('Indiquez un texte à chercher ou un nombre de cellules minimum.', true); return null; }
      say('');
      return Ops.dropParasites(state.table, txt, min);
    },
  };

  /* ---------- Export ---------- */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const outBase = () => ($('outName').value.trim() || 'resultat').replace(/[\\/:*?"<>|]/g, '_');

  function exportXlsx() {
    if (typeof XLSX === 'undefined') { say('Export .xlsx indisponible : bibliothèque non chargée. Utilisez le .csv.', true); return; }
    const t = state.table;
    const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.rows], { cellDates: true });
    Object.keys(ws).forEach((k) => {
      if (k[0] !== '!' && ws[k].t === 'd') {
        const d = ws[k].v;
        ws[k].z = d.getHours() || d.getMinutes() ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
      }
    });
    ws['!cols'] = t.headers.map((h, i) => {
      const longest = Math.max(h.length, ...t.rows.slice(0, 200).map((r) => Ops.cellToText(r[i]).length));
      return { wch: Math.min(60, Math.max(8, longest + 2)) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Données');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), outBase() + '.xlsx');
  }

  function exportCsv() {
    download(new Blob([Ops.toCSV(state.table)], { type: 'text/csv;charset=utf-8' }), outBase() + '.csv');
  }

  /* ---------- Événements ---------- */
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));

  $('sheetSel').addEventListener('change', (e) => { readSheet(e.target.value); resetFromRaw(true); });
  $('headerRow').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(state.raw.length, +e.target.value || 1));
    e.target.value = n;
    state.headerRow = n - 1;
    resetFromRaw(false);
  });
  $('dupCase').addEventListener('change', render);

  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-col]');
    if (!b) return;
    const i = +b.dataset.col;
    state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i);
    render();
  });

  document.querySelector('.ops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const fn = OPS[b.dataset.op];
    const res = fn();
    if (!res) return;
    state.history.push({ table: state.table, log: state.log });
    state.table = res.table;
    state.log = [...state.log, res.log];
    render();
  });

  $('quick').addEventListener('click', () => {
    const steps = [Ops.fixAccents, Ops.trimSpaces, (t) => Ops.removeEmpty(t), (t) => Ops.dedupe(t, [], $('dupCase').checked)];
    run(() => {
      let t = state.table;
      const logs = [];
      steps.forEach((s) => { const r = s(t, []); t = r.table; logs.push(r.log); });
      return { table: t, log: 'Nettoyage rapide — ' + logs.join(' · ') };
    });
  });

  $('undo').addEventListener('click', () => {
    const h = state.history.pop();
    if (!h) return;
    state.table = h.table;
    state.log = h.log;
    render();
  });
  $('reset').addEventListener('click', () => resetFromRaw(false));
  $('expXlsx').addEventListener('click', exportXlsx);
  $('expCsv').addEventListener('click', exportCsv);
})();
