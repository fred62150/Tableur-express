/* Tableur Express — pilotage par prompt.
 * Le modèle ne voit que les en-têtes et quelques lignes ; il répond par un plan JSON
 * limité à une liste fermée d'opérations, exécutées ensuite localement par Ops.
 */
const Plan = (() => {
  const OPS = {
    accents: { label: () => 'Réparer les accents cassés' },
    espaces: { label: () => 'Nettoyer les espaces parasites' },
    vides: { label: () => 'Supprimer les lignes et colonnes vides' },
    doublons: { label: (s) => 'Supprimer les doublons' + (s.ignorer_casse ? ' (sans tenir compte de la casse)' : '') },
    dates: { label: () => 'Mettre les dates au format JJ/MM/AAAA' },
    nombres: { label: () => 'Convertir les nombres écrits en texte' },
    casse: { label: (s) => ({ nom_propre: 'Nom Propre', majuscules: 'MAJUSCULES', minuscules: 'minuscules' }[s.mode]) ? 'Casse : ' + ({ nom_propre: 'Nom Propre', majuscules: 'MAJUSCULES', minuscules: 'minuscules' }[s.mode]) : 'Casse' },
    parasites: { label: (s) => 'Supprimer les lignes parasites' + (s.texte ? ` contenant « ${s.texte} »` : '') + (s.min_cellules ? ` ou ayant moins de ${s.min_cellules} cellule(s) remplie(s)` : '') },
  };

  function sample(table, n) {
    return table.rows.slice(0, n).map((r) =>
      r.map((c) => { const s = Ops.cellToText(c); return s.length > 40 ? s.slice(0, 40) + '…' : s; }));
  }

  function buildPrompt(table, request, sampleRows) {
    const lines = [
      'Tu pilotes un outil de nettoyage de tableur. Réponds UNIQUEMENT par un objet JSON, sans texte autour, de la forme :',
      '{"etapes":[{"op":"...","colonnes":["nom exact"], ...}],"remarque":"..."}',
      'Opérations autorisées (champ "op") :',
      '- "accents", "espaces", "vides", "dates", "nombres" : champ optionnel "colonnes" (liste de noms exacts ; absent ou vide = détection automatique ou toutes les colonnes)',
      '- "doublons" : "colonnes" (liste de noms ; vide = ligne entière) et "ignorer_casse" (true/false)',
      '- "casse" : "colonnes" et "mode" parmi "nom_propre", "majuscules", "minuscules"',
      '- "parasites" : "texte" (supprime les lignes qui contiennent ce texte) et/ou "min_cellules" (supprime les lignes avec moins de cellules remplies)',
      'N\'invente aucune autre opération. Si la demande dépasse cette liste (fusion, calculs, tableau croisé…), ne l\'exécute pas et explique-le dans "remarque". Utilise uniquement les noms de colonnes ci-dessous, orthographiés exactement.',
      'Colonnes : ' + JSON.stringify(table.headers),
    ];
    if (sampleRows > 0) lines.push('Exemples de lignes : ' + JSON.stringify(sample(table, sampleRows)));
    lines.push('Demande : ' + request.trim());
    return lines.join('\n');
  }

  function extractJSON(txt) {
    const s = String(txt).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  /* Valide la réponse du modèle et convertit les noms de colonnes en indices. */
  function parse(txt, table) {
    const o = extractJSON(txt);
    if (!o || !Array.isArray(o.etapes)) return { steps: [], remark: '', warnings: ['Réponse du modèle non exploitable.'] };
    const norm = (s) => String(s).trim().toLowerCase();
    const idx = {};
    table.headers.forEach((h, i) => { idx[norm(h)] = i; });
    const steps = [];
    const warnings = [];
    o.etapes.forEach((e) => {
      if (!e || !OPS[e.op]) { warnings.push(`Opération ignorée : « ${e && e.op} »`); return; }
      const cols = [];
      (Array.isArray(e.colonnes) ? e.colonnes : []).forEach((name) => {
        const i = idx[norm(name)];
        if (i === undefined) warnings.push(`Colonne introuvable, ignorée : « ${name} »`);
        else if (!cols.includes(i)) cols.push(i);
      });
      if (Array.isArray(e.colonnes) && e.colonnes.length && !cols.length) { warnings.push(`Étape « ${e.op} » ignorée : aucune colonne reconnue.`); return; }
      const step = { op: e.op, cols, ignorer_casse: !!e.ignorer_casse, mode: e.mode, texte: typeof e.texte === 'string' ? e.texte : '', min_cellules: Math.max(0, parseInt(e.min_cellules, 10) || 0) };
      if (e.op === 'casse' && !['nom_propre', 'majuscules', 'minuscules'].includes(step.mode)) { warnings.push('Étape « casse » ignorée : mode inconnu.'); return; }
      if (e.op === 'parasites' && !step.texte.trim() && !step.min_cellules) { warnings.push('Étape « parasites » ignorée : aucun critère.'); return; }
      step.label = OPS[e.op].label(step) + (cols.length ? ` — colonnes : ${cols.map((c) => table.headers[c]).join(', ')}` : '');
      steps.push(step);
    });
    return { steps, remark: typeof o.remarque === 'string' ? o.remarque : '', warnings };
  }

  function apply(table, steps) {
    let t = table;
    const logs = [];
    steps.forEach((s) => {
      let r;
      switch (s.op) {
        case 'accents': r = Ops.fixAccents(t, s.cols); break;
        case 'espaces': r = Ops.trimSpaces(t, s.cols); break;
        case 'vides': r = Ops.removeEmpty(t); break;
        case 'doublons': r = Ops.dedupe(t, s.cols, s.ignorer_casse); break;
        case 'dates': r = Ops.normalizeDates(t, s.cols); break;
        case 'nombres': r = Ops.toNumbers(t, s.cols); break;
        case 'casse': r = Ops.changeCase(t, s.cols, { nom_propre: 'title', majuscules: 'upper', minuscules: 'lower' }[s.mode]); break;
        case 'parasites': r = Ops.dropParasites(t, s.texte, s.min_cellules); break;
        default: return;
      }
      t = r.table;
      logs.push(r.log);
    });
    return { table: t, log: 'Plan IA — ' + logs.join(' · ') };
  }

  return { buildPrompt, parse, apply, sample };
})();

if (typeof module !== 'undefined') module.exports = Plan;
