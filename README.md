# Tableur Express

Application web pour nettoyer des fichiers tableur (.xlsx, .xls, .csv) directement dans le navigateur.
L'original n'est jamais modifié et les données ne quittent pas l'ordinateur.

## Version 1.5

- Tableau croisé dynamique guidé (listes de champs, somme/moyenne/nombre/min/max, totaux), sans IA
- Aides à la saisie du prompt : colonnes cliquables, idées de demandes générées depuis le fichier
- L'IA pose une question de précision quand la demande est incomplète

## Version 1.4

- Lecture des réponses de l'IA plus tolérante (bloc de code ou JSON), consigne dédiée aux tableaux croisés, réponse brute visible en cas d'échec

## Version 1.3

- Pilotage par prompt réécrit : l'IA écrit une vraie transformation (tri, filtres, colonnes calculées, regroupements, tableaux croisés…)
- Exécution isolée : Worker dans une iframe sandbox sans accès réseau (CSP), arrêt au bout de 8 s
- Aperçu du résultat avant application, correction automatique si le code échoue, bouton « Réessayer » avec précisions
- Seuls les noms de colonnes, leur type et 3 exemples (désactivable) sont envoyés au modèle

## Version 1.2

- Réglages de l'IA complets comme dans Prise rapide : fournisseurs (ajout par préréglage, modification, défaut, test, suppression), relais Supabase

## Version 1.1

- Thème « verre poli » identique à Prise rapide (clair et sombre)
- Zone de prompt : l'IA (Albert, Mistral…) propose un plan d'étapes parmi une liste fermée, affiché avant exécution, annulable
- Réglages IA repris de Prise rapide (même navigateur) ; seuls les noms de colonnes et 3 lignes d'exemple (désactivable) sont envoyés

## Version 1

- Import .xlsx / .xls / .csv (encodage et séparateur détectés), choix de la feuille et de la ligne d'en-tête
- Nettoyage : accents cassés, espaces parasites, lignes/colonnes vides, doublons, dates en JJ/MM/AAAA,
  nombres écrits en texte, casse, lignes parasites
- Aperçu, journal des actions, annulation, retour au fichier d'origine
- Export en .xlsx ou .csv (UTF-8, séparateur « ; »)

## À venir

Fusion et comparaison de fichiers, formules et totaux, tableaux croisés, graphiques,
procédures enregistrées.

## Publication (GitHub Pages)

Settings > Pages > Source « Deploy from a branch » > branche `main`, dossier `/ (root)`.

## Développement

Pas de build. La logique de traitement est dans `ops.js` (testée avec `node tests/ops.test.js`),
l'interface dans `index.html`, `style.css` et `app.js`. La lecture/écriture Excel utilise SheetJS (CDN).
Aucune clé ni donnée ne doit être placée dans ce dépôt public.
