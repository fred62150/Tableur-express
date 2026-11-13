// Lancer avec : node tests/ops.test.js
const assert = require('node:assert');
const Ops = require('../ops.js');

// Accents cassés
assert.strictEqual(Ops.fixMojibake('FranÃ§ois'), 'François');
assert.strictEqual(Ops.fixMojibake('RenÃ©e dâ€™Ã‰tienne'), 'Renée d’Étienne');
assert.strictEqual(Ops.fixMojibake('Âge'), 'Âge'); // texte correct : inchangé
assert.strictEqual(Ops.fixMojibake('Éric'), 'Éric');

// CSV : séparateur ; guillemets, retours ligne
const csv = 'Nom;Date;Montant\r\n"Dupont; Jean";03/02/24;"1 250,50"\r\nMartin;2024-03-05;12\r\n';
const raw = Ops.parseCSV(csv);
assert.deepStrictEqual(raw[1], ['Dupont; Jean', '03/02/24', '1 250,50']);
assert.strictEqual(raw.length, 3);

// En-tête devinée après des lignes parasites
const withTitle = [['Rapport mensuel', '', ''], ['', '', ''], ['Nom', 'Date', 'Montant'], ['A', '1', '2']];
assert.strictEqual(Ops.guessHeaderRow(withTitle), 2);
const t0 = Ops.buildTable(withTitle, 2);
assert.deepStrictEqual(t0.headers, ['Nom', 'Date', 'Montant']);
assert.strictEqual(t0.rows.length, 1);

// En-têtes vides ou dupliqués
const t1 = Ops.buildTable([['a', '', 'a'], [1, 2, 3]], 0);
assert.deepStrictEqual(t1.headers, ['a', 'Colonne 2', 'a (2)']);

// Dates
const t = Ops.buildTable(raw, 0);
const d = Ops.normalizeDates(t, [1]).table;
assert.strictEqual(Ops.fmtDate(d.rows[0][1]), '03/02/2024');
assert.strictEqual(Ops.fmtDate(d.rows[1][1]), '05/03/2024');
assert.strictEqual(Ops.parseDate('31/02/2024'), null);
assert.strictEqual(Ops.fmtDate(Ops.parseDate('5.3.99')), '05/03/1999');

// Détection auto : la colonne Nom n'est pas touchée, les dates écrites autrement sont vues comme doublons
const auto = Ops.normalizeDates(t, []);
assert.ok(!/non reconnue/.test(auto.log));
assert.strictEqual(auto.table.rows[0][0], 'Dupont; Jean');
const dd = Ops.dedupe({ headers: ['n', 'd'], rows: [['a', '3/2/24'], ['a', '03/02/2024']] }, [], true).table;
assert.strictEqual(dd.rows.length, 1);

// Nombres
const n = Ops.toNumbers(t, []).table;
assert.strictEqual(n.rows[0][0], 'Dupont; Jean');
assert.strictEqual(n.rows[0][2], 1250.5);
assert.strictEqual(Ops.toNumbers({ headers: ['x'], rows: [['01234'], ['0,5']] }, [0]).table.rows[0][0], '01234');

// Doublons et espaces
const dup = { headers: ['mail', 'nom'], rows: [['a@x.fr ', 'Paul'], ['A@X.FR', 'Paul'], ['b@x.fr', 'Léa']] };
assert.strictEqual(Ops.dedupe(dup, [0], false).table.rows.length, 3);
assert.strictEqual(Ops.dedupe(dup, [0], true).table.rows.length, 2);
assert.strictEqual(Ops.trimSpaces(dup).table.rows[0][0], 'a@x.fr');

// Lignes et colonnes vides, parasites
const e = Ops.removeEmpty({ headers: ['a', 'Colonne 2'], rows: [['x', ''], ['', ''], ['y', '']] }).table;
assert.strictEqual(e.rows.length, 2);
assert.deepStrictEqual(e.headers, ['a']);
const p = Ops.dropParasites({ headers: ['a', 'b'], rows: [['x', 'y'], ['Total', ''], ['z', '']] }, 'total', 2).table;
assert.deepStrictEqual(p.rows, [['x', 'y']]);

// Casse
assert.strictEqual(Ops.changeCase({ headers: ['n'], rows: [['jean-PAUL dupont']] }, [0], 'title').table.rows[0][0], 'Jean-Paul Dupont');

// Export CSV
const out = Ops.toCSV({ headers: ['n', 'v'], rows: [['a;b', 1.5], [Ops.parseDate('01/02/2024'), '']] });
assert.ok(out.startsWith('﻿n;v\r\n"a;b";1,5\r\n01/02/2024;'));

// Immutabilité
assert.strictEqual(dup.rows[0][0], 'a@x.fr ');

console.log('Tous les tests passent');
