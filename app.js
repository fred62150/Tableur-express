/* Tableur Express — interface. Toute la logique de traitement est dans ops.js. */
(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    fileName: '', workbook: null, raw: null, headerRow: 0,
    base: null, table: null, history: [], log: [], selected: new Set(), plan: null,
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
    clearPlan();
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
    clearPlan();
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
    run(() => res);
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
    clearPlan();
    state.table = h.table;
    state.log = h.log;
    render();
  });
  $('reset').addEventListener('click', () => resetFromRaw(false));
  $('expXlsx').addEventListener('click', exportXlsx);
  $('expCsv').addEventListener('click', exportCsv);

  /* ---------- Thème ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('te.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('te.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } },
  };
  const shared = (k) => { try { const v = localStorage.getItem('pr.' + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } };
  $('themeBtn').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store.set('theme', next);
  });

  /* ---------- Réglages IA ---------- */
  let PROV = store.get('prov', { list: [], def: '' });
  let SB = store.get('sb', { url: '', key: '', email: '', session: null });
  const curProv = () => PROV.list.find((p) => p.id === PROV.def) || PROV.list[0] || null;
  const aiMsg = (t, err) => { const m = $('aiMsg'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); };

  function renderSettings() {
    const sel = $('provSel');
    sel.innerHTML = PROV.list.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') || '<option value="">Aucun fournisseur</option>';
    const p = curProv();
    if (p) sel.value = p.id;
    $('sbEmail').value = SB.email || '';
    const needRelay = !!(p && p.relay);
    $('sbBox').classList.toggle('hidden', !needRelay && !SB.session);
    $('sbState').textContent = SB.session ? 'Relais Supabase : connecté.' : (needRelay ? 'Relais Supabase : non connecté (requis pour ' + p.name + ').' : '');
    $('aiStatus').textContent = p && p.key ? '· ' + p.name : '· non configuré';
  }

  $('importPR').addEventListener('click', () => {
    const p = shared('prov');
    const s = shared('sb');
    if (!p || !Array.isArray(p.list) || !p.list.length) {
      $('importNote').textContent = 'Aucun réglage trouvé. Ouvrez d\'abord Prise rapide dans ce même navigateur, configurez-y vos fournisseurs, puis revenez ici.';
      return;
    }
    PROV = { list: p.list, def: p.def };
    if (s) SB = { url: s.url || '', key: s.key || '', email: s.email || '', session: null };
    store.set('prov', PROV);
    store.set('sb', SB);
    $('importNote').textContent = `${PROV.list.length} fournisseur(s) repris de Prise rapide.`;
    renderSettings();
  });
  $('provSel').addEventListener('change', (e) => { PROV.def = e.target.value; store.set('prov', PROV); renderSettings(); });

  const sbBase = () => SB.url.replace(/\/+$/, '');
  async function sbToken(grant, body) {
    const r = await fetch(sbBase() + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST', headers: { apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || 'Connexion refusée.');
    return j;
  }
  $('sbLogin').addEventListener('click', async () => {
    const email = $('sbEmail').value.trim();
    const pw = $('sbPw').value;
    if (!SB.url || !SB.key) { $('sbState').textContent = 'Reprenez d\'abord les réglages de Prise rapide.'; return; }
    try {
      SB.session = await sbToken('password', { email, password: pw });
      SB.email = email;
      $('sbPw').value = '';
      store.set('sb', SB);
      renderSettings();
    } catch (e) { $('sbState').textContent = e.message; }
  });
  async function sbCall(path, body) {
    const go = () => fetch(sbBase() + path, {
      method: 'POST',
      headers: { apikey: SB.key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + ((SB.session && SB.session.access_token) || SB.key) },
      body: JSON.stringify(body),
    });
    let r = await go();
    if (r.status === 401 && SB.session) {
      SB.session = await sbToken('refresh_token', { refresh_token: SB.session.refresh_token });
      store.set('sb', SB);
      r = await go();
    }
    return r;
  }

  async function callAI(prov, model, prompt) {
    const base = prov.base.replace(/\/+$/, '');
    let url, headers, bodyObj;
    if (prov.type === 'anthropic') {
      url = base + '/messages';
      headers = { 'content-type': 'application/json', 'x-api-key': prov.key, 'anthropic-version': '2023-06-01' };
      bodyObj = { model, max_tokens: 2048, messages: [{ role: 'user', content: prompt }] };
    } else {
      url = base + '/chat/completions';
      headers = { 'content-type': 'application/json', authorization: 'Bearer ' + prov.key };
      bodyObj = { model, messages: [{ role: 'user', content: prompt }], temperature: 0.1 };
    }
    let j;
    if (prov.relay) {
      if (!SB.session) throw new Error('Connectez-vous au relais Supabase dans « Réglages de l\'IA ».');
      const r = await sbCall('/functions/v1/ia-proxy', { url, headers, body: bodyObj });
      if (!r.ok) throw new Error('Le relais Supabase a répondu une erreur (' + r.status + ').');
      const w = await r.json();
      if (!w.status) throw new Error('Le relais n\'a pas pu joindre ' + prov.name + '.');
      if (w.status < 200 || w.status >= 300) throw new Error(prov.name + ' a répondu ' + w.status + ' : ' + String(w.text || '').slice(0, 160));
      j = JSON.parse(w.text);
    } else {
      if (prov.type === 'anthropic') headers['anthropic-dangerous-direct-browser-access'] = 'true';
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyObj) });
      if (!r.ok) throw new Error(prov.name + ' a répondu ' + r.status + ' : ' + (await r.text().catch(() => '')).slice(0, 160));
      j = await r.json();
    }
    return prov.type === 'anthropic'
      ? (j.content && j.content[0] && j.content[0].text) || ''
      : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }

  /* ---------- Plan proposé par l'IA ---------- */
  function clearPlan() {
    state.plan = null;
    const box = $('planBox');
    if (box) box.classList.add('hidden');
  }

  $('aiGo').addEventListener('click', async () => {
    const request = $('aiPrompt').value.trim();
    const prov = curProv();
    if (!request) { aiMsg('Écrivez d\'abord ce que vous voulez faire.', true); return; }
    if (!prov || !prov.key) { aiMsg('Aucun fournisseur d\'IA configuré : ouvrez « Réglages de l\'IA » en haut de page.', true); return; }
    const model = $('aiFull').checked ? (prov.full || prov.light) : (prov.light || prov.full);
    const btn = $('aiGo');
    btn.disabled = true;
    aiMsg(`Demande envoyée à ${prov.name}…`);
    clearPlan();
    try {
      const txt = await callAI(prov, model, Plan.buildPrompt(state.table, request, $('aiSample').checked ? 3 : 0));
      const plan = Plan.parse(txt, state.table);
      state.plan = plan;
      $('planList').innerHTML = plan.steps.map((s) => `<li>${esc(s.label)}</li>`).join('')
        + plan.warnings.map((w) => `<li class="warn">${esc(w)}</li>`).join('');
      $('planRemark').textContent = plan.remark ? 'Remarque du modèle : ' + plan.remark : '';
      $('planApply').disabled = !plan.steps.length;
      $('planBox').classList.remove('hidden');
      aiMsg(plan.steps.length ? 'Vérifiez le plan puis appliquez-le. Vous pourrez l\'annuler.' : 'Aucune étape exploitable dans la réponse.', !plan.steps.length);
    } catch (e) {
      aiMsg(e.message || 'Erreur lors de l\'appel à l\'IA.', true);
    } finally {
      btn.disabled = false;
    }
  });

  $('planApply').addEventListener('click', () => {
    const plan = state.plan;
    if (!plan || !plan.steps.length) return;
    run(() => Plan.apply(state.table, plan.steps));
    aiMsg('Plan appliqué.');
  });
  $('planDrop').addEventListener('click', () => { clearPlan(); aiMsg(''); });

  renderSettings();
})();
