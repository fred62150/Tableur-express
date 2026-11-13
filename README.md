# Tableur Express

Application web pour nettoyer des fichiers tableur (.xlsx, .xls, .csv) directement dans le navigateur.
L'original n'est jamais modifié et les données ne quittent pas l'ordinateur.

## Version 1

- Import .xlsx / .xls / .csv (encodage et séparateur détectés), choix de la feuille et de la ligne d'en-tête
- Nettoyage : accents cassés, espaces parasites, lignes/colonnes vides, doublons, dates en JJ/MM/AAAA,
  nombres écrits en texte, casse, lignes parasites
- Aperçu, journal des actions, annulation, retour au fichier d'origine
- Export en .xlsx ou .csv (UTF-8, séparateur « ; »)

## À venir

Fusion et comparaison de fichiers, formules et totaux, tableaux croisés, graphiques,
procédures enregistrées, pilotage par un prompt (Albert / Mistral).

## Publication (GitHub Pages)

Settings > Pages > Source « Deploy from a branch » > branche `main`, dossier `/ (root)`.

## Développement

Pas de build. La logique de traitement est dans `ops.js` (testée avec `node tests/ops.test.js`),
l'interface dans `index.html`, `style.css` et `app.js`. La lecture/écriture Excel utilise SheetJS (CDN).
Aucune clé ni donnée ne doit être placée dans ce dépôt public.
