/* Tableur Express — préparation des demandes à l'IA et lecture de ses réponses (fonctions pures). */
const AI = (() => {
  const trunc = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  function describeColumns(table, nSample) {
    return table.headers.map((h, ci) => {
      const vals = table.rows.map((r) => r[ci]).filter((v) => !Ops.isEmpty(v));
      const k = { nombre: 0, date: 0, texte: 0 };
      vals.forEach((v) => { if (typeof v === 'number') k.nombre++; else if (v instanceof Date) k.date++; else k.texte++; });
      const type = vals.length ? Object.entries(k).sort((a, b) => b[1] - a[1])[0][0] : 'vide';
      const o = { nom: h, type, vides: table.rows.length - vals.length };
      if (nSample > 0) {
        const seen = [];
        for (const v of vals) {
          const s = trunc(Ops.cellToText(v), 40);
          if (!seen.includes(s)) seen.push(s);
          if (seen.length >= nSample) break;
        }
        o.exemples = seen;
      }
      return o;
    });
  }

  const RULES = [
    'Tu transformes un tableau avec du JavaScript. Réponds en deux parties, rien d\'autre :',
    '1) une ligne « Explication : » en français (1 à 2 phrases) ;',
    '2) le code dans UN SEUL bloc ```js contenant : function transform(table){ ... return {headers:[...], rows:[[...]]}; }',
    'Règles du code : table.headers = noms des colonnes ; table.rows = lignes (tableaux de cellules, mêmes indices que headers). Une cellule est un texte, un nombre ou un objet Date.',
    'Pas de réseau, pas de DOM, pas de bibliothèque. Ne modifie pas table en place : renvoie un nouvel objet {headers, rows}. Conserve les colonnes non concernées. Toute colonne ajoutée porte un nom dans headers.',
    'Les nombres au format français peuvent être des textes ("1 250,50") : convertis-les si besoin.',
    'Tableau croisé : première colonne = champ placé en lignes, puis une colonne par valeur distincte du champ placé en colonnes (triées), puis une colonne Total ; somme (ou comptage) par case, 0 si vide. Renvoie directement ce tableau de résultats.',
    'Si la demande est impossible, n\'écris que l\'explication, sans bloc de code.',
  ].join('\n');

  const header = (table, sampleN) =>
    `Tableau : ${table.rows.length} lignes. Colonnes : ${JSON.stringify(describeColumns(table, sampleN))}`;

  function buildPrompt(table, request, sampleN) {
    return `${RULES}\n${header(table, sampleN)}\nDemande : ${request.trim()}`;
  }
  function buildFixPrompt(table, request, code, error, sampleN) {
    return `${RULES}\n${header(table, sampleN)}\nDemande : ${request.trim()}\nTon code précédent a échoué.\nCode :\n${code}\nErreur : ${error}\nCorrige-le et renvoie le JSON complet.`;
  }
  function buildRetryPrompt(table, request, code, feedback, sampleN) {
    return `${RULES}\n${header(table, sampleN)}\nDemande initiale : ${request.trim()}\nCode proposé précédemment :\n${code}\nL'utilisateur n'est pas satisfait du résultat et précise : ${feedback.trim()}\nRenvoie le JSON complet avec un code corrigé.`;
  }

  function extractJSON(txt) {
    const s = String(txt);
    const i = s.indexOf('{');
    const j = s.lastIndexOf('}');
    if (i < 0 || j <= i) return null;
    const cand = s.slice(i, j + 1);
    try { return JSON.parse(cand); } catch (e) { /* on tente une réparation */ }
    try { return JSON.parse(cand.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')); } catch (e) { return null; }
  }

  function parse(txt) {
    const s = String(txt).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = s.match(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/);
    if (fence && /transform/.test(fence[1])) {
      const expl = s.replace(fence[0], '').replace(/^\s*\**Explication\s*:?\**\s*/i, '').trim();
      return { explication: expl.slice(0, 400), code: fence[1].trim() };
    }
    const o = extractJSON(s);
    if (o && typeof o.code === 'string') return { explication: String(o.explication || ''), code: o.code.trim() };
    if (/function\s+transform\s*\(/.test(s)) {
      const k = s.indexOf('function transform');
      return { explication: s.slice(0, k).trim().slice(0, 400), code: s.slice(k).replace(/```\s*$/, '').trim() };
    }
    return { explication: s.slice(0, 400), code: '' };
  }

  /* Rend le résultat du code conforme : en-têtes uniques et non vides, lignes à la bonne largeur. */
  function normalizeResult(raw) {
    const seen = {};
    const headers = raw.headers.map((h, i) => {
      const base = String(h).trim() || `Colonne ${i + 1}`;
      seen[base] = (seen[base] || 0) + 1;
      return seen[base] > 1 ? `${base} (${seen[base]})` : base;
    });
    const rows = raw.rows.slice(0, 200000).map((r) => Array.from({ length: headers.length }, (_, i) => (i < r.length ? r[i] : '')));
    return { headers, rows };
  }

  const summarize = (a, b) => `${a.rows.length} → ${b.rows.length} lignes · ${a.headers.length} → ${b.headers.length} colonnes`;

  return { describeColumns, buildPrompt, buildFixPrompt, buildRetryPrompt, parse, normalizeResult, summarize };
})();

if (typeof module !== 'undefined') module.exports = AI;
