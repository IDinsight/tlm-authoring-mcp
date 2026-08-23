# Explorer le graphe

L'**explorateur** est une page web qui vous permet de **visualiser** le curriculum — les domaines, chapitres, leçons et leurs liens — sans rien modifier. C'est une vue **en lecture seule** de la version **publiée** (officielle).

Ouvrez l'adresse fournie par votre administrateur, puis connectez-vous (mêmes identifiants que l'outil).

<!-- SCREENSHOT : page d'accueil de l'explorateur -->

## Choisir un graphe

En haut, un sélecteur liste les curriculums disponibles (par exemple *Mathématiques — CI*, *Lecture — CE1*). Choisissez celui que vous voulez explorer. Un curriculum apparaît automatiquement dès qu'il a été publié.

## Les deux vues

L'explorateur suit l'**ontologie Learning Commons** : il ne montre pas de vocabulaire propre à une matière, mais la structure du graphe telle qu'elle est.

| Vue | Ce qu'elle montre |
|---|---|
| **Hiérarchie (contenance)** | L'arborescence de contenance : du cadre de référence vers ses éléments, en suivant les liens de contenance |
| **Par type (LC)** | Tous les nœuds regroupés par leur type Learning Commons, chacun avec ses liens — la vue la plus complète |

Cliquez sur un nœud pour ouvrir son **panneau de détail** ; le petit triangle **déplie / replie** ses éléments.

## Couleurs et légende

Chaque nœud a une **couleur** selon son **type Learning Commons** (cadre de référence, élément du cadre, regroupement, leçon, composant, curriculum…). La **légende** rappelle le code couleur.

## Rechercher

Utilisez la barre de recherche pour retrouver un nœud par son intitulé.

## Voir son brouillon avant de publier

Quand un **brouillon** est ouvert sur un curriculum, deux boutons apparaissent au-dessus de l'arbre : **Publié** et **Brouillon**.

- **Publié** — la version officielle, celle que lit la génération. C'est la vue par défaut.
- **Brouillon** — le travail en cours, **non publié**. Chaque élément **ajouté** ou **modifié** porte une pastille dans l'arbre, et les éléments **supprimés** sont listés au-dessus (ils ne sont plus dans l'arbre : c'est le seul endroit où ils peuvent apparaître). Un compteur rappelle combien d'éléments ont été ajoutés, modifiés et supprimés.

C'est la réponse à « qu'est-ce que je m'apprête à publier, exactement ? » : on regarde son propre travail dans la même arborescence que d'habitude, au lieu de lire un résumé.

!!! info "Réservé aux curateurs"
    Voir le brouillon demande un rôle de **curateur** (ou plus) dans l'espace de travail concerné : un brouillon est un travail en cours, pas une publication. Si votre rôle ne le permet pas, l'explorateur vous le dit et reste sur la version publiée.

!!! warning "Un brouillon reste un brouillon"
    Ce que vous voyez ici n'alimente **pas** la génération de documents tant qu'il n'est pas publié (voir [Relire, publier ou abandonner un brouillon](review-approve.md)). L'explorateur reste en lecture seule : on y regarde, on n'y modifie rien — les modifications se font en discutant avec Claude.

## Le catalogue

L'onglet **Catalogue** ouvre les bibliothèques de gabarits réutilisables — celle de votre **espace de travail** et la bibliothèque **partagée** entre tous les programmes. Chaque entrée s'affiche en fiche : son titre, son type, son résumé, et de quoi elle est faite.

Trois types d'entrées, reconnaissables à leur pastille :

| Type | Ce qu'il décrit | Ce que compte la fiche |
|---|---|---|
| **Routine** | La structure pédagogique d'une séance | Ses étapes et ses matériaux |
| **Formatter** | L'apparence d'un document | Ses règles de mise en forme |
| **Grille** | Les critères d'évaluation d'un document | Son échelle (par exemple 0-4 ou Oui/Non), ses sections et ses critères |

Pour s'y retrouver quand la bibliothèque grossit :

- les **onglets** (Tout · Routines · Formatters · Grilles) ne gardent qu'un type à la fois, avec son nombre entre parenthèses ;
- la **recherche** filtre sur le titre et le résumé. Les accents sont ignorés : taper `recitation` trouve « poésie-récitation » ;
- le **sélecteur de bibliothèque** limite l'affichage à l'espace de travail ou au partagé.

Les trois se combinent, et un compteur rappelle combien d'entrées restent affichées sur le total. **Réinitialiser** les efface d'un coup.

Cliquez sur une fiche pour lire la **spécification complète** de l'entrée — le texte de consignes que la génération lit réellement.

!!! note "Ce que montre l'explorateur"
    L'explorateur affiche la **version publiée** uniquement. Un brouillon en cours d'édition n'y apparaît **pas** tant qu'il n'est pas publié — c'est voulu, pour ne montrer que l'officiel. Pour prévisualiser l'effet d'un brouillon, voir la prévisualisation côté outil.
