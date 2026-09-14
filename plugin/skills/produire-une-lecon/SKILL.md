---
name: produire-une-lecon
description: Produire tous les fichiers qu'une leçon doit — un par document qui la couvre, multiplié par les langues que la mise en forme de ce document déclare — en ne refaisant que ce qui est périmé, avec la vérification de page avant tout rendu, la mesure sur le rendu, une seule relecture et une note de remise. À utiliser quand on dit « produis la leçon 23 », « génère la leçon », « refais les fichiers de la leçon », « la leçon est-elle à jour », « livre la leçon ».
---

# Produire une leçon

Une leçon doit plusieurs fichiers : un par document qui la couvre, multiplié par les langues que
la mise en forme de ce document déclare. Cette compétence les produit tous, dans un ordre fixe, et
s'arrête sur ce qu'elle ne peut pas vérifier. Elle ne compose qu'avec ce que le graphe contient :
un contenu ou une image qui manque est un **arrêt**, jamais une invention.

Ce qu'une leçon doit, à quoi ressemble une page, combien de langues, quelles limites — rien de
cela n'est écrit ici. Tout se lit dans le graphe à chaque exécution : les sections qui couvrent la
leçon, la pile de mises en forme de chaque document, ses grilles. La séquence, elle, ne change pas.

## La séquence

1. **Résoudre la leçon** — `find_node` sur le nom que l'expert donne. Une ambiguïté se demande en
   citant les chemins ; on ne choisit jamais à sa place.
2. **Inventorier ce qu'elle doit** — `walk_graph` depuis la leçon, `direction:'in'`, pour les
   sections qui la couvrent ; puis chaque section remonte à son document. Le résultat est une liste
   « document → sections », et **rien d'autre n'est dû**. Un document sans section pour cette leçon
   n'est pas complété ici : c'est `composer-un-document`, et on le dit.
3. **Ne refaire que le périmé** — `walk_document` sur chaque document de la liste, avec la
   fraîcheur des fichiers : un fichier `current` est **sauté et déclaré sauté** ; `stale` ou
   `unknown` se produit. L'expert peut demander de tout refaire ; sinon, ce filtre est ce qui rend
   une leçon rapide et une reprise sûre.
4. **Lire une fois** — par document, la première section en entier (`walk_document_section`,
   `nextCursor` jusqu'à ce que la pile de mises en forme soit complète), les suivantes avec
   `include:[]`, plus `'curriculum'` quand une section couvre autre chose. Noter au passage : les
   valeurs du `render` que la mesure demandera, et les langues que `language.variants` déclare —
   ce sont les fichiers dus par section.
5. **Composer, vérifier, rendre — page par page** — pour chaque section à produire, d'abord
   `compose_section` : le serveur remplit depuis le graphe les gabarits que la mise en forme
   déclare, et renvoie l'arbre prêt, la liste `unfilled` de ce qu'aucun gabarit ne couvre (à
   composer vous-même, à sa place, depuis son guide) et `problems` (une image ou un contenu que le
   graphe n'a pas : on corrige le graphe, jamais la page). Puis la séquence de `produire-et-mesurer`
   sur le résultat : `page_geometry` une fois par document, avec les images qu'on va placer, pour
   composer par le calcul (`linesBeside`, un `clear` après chaque bloc d'ancrage plus court que sa
   bande) ; compléter l'arbre dans la forme de `get_capabilities section:'document'` (son
   `example` est un arbre à copier) ; `lint_content` avec `document` et `nodeId` **avant tout
   rendu**, un refus étant un arrêt ; `render_document` avec `measure:true` et `translateInto`
   dérivé des variantes de la mise en forme — **une seule composition**, les autres langues en sont
   dérivées, jamais composées une seconde fois ; lire `overlaps` et `reserveKept` sur chaque
   fichier ; en cas de débordement ou de chevauchement, corriger, puis vérifier et mesurer à
   nouveau.
6. **Relire une fois, en parallèle** — tous les fichiers rendus : `mesureur` sur chacun avec le
   budget lu au point 4, `relecteur` contre les grilles qu'`evaluate_document` remonte pour le
   document, `terminologue` sur les fichiers dérivés dans une autre langue. Trois sous-agents en
   même temps, sur des fichiers, jamais sur le graphe. Le fil principal ne compte pas de pages.
7. **Déposer et consigner** — `create_upload_url` puis `log_generation` par fichier livrable ; la
   voie aperçu (`create_preview_upload_url`) seulement si l'expert a demandé un aperçu, et jamais les
   deux pour un même fichier. Puis `append_journal` sur chaque section produite : la date, ce qui
   a été resserré, ce que la relecture laisse ouvert.
8. **La note de remise** — par fichier : pages, marge en pied, police présente, constats ; par
   leçon : ce qui a été sauté comme à jour, ce qui a été refusé et pourquoi. Rends compte de ce que
   tu as mesuré, et de comment tu l'as mesuré.

## Ce qui arrête la production, et vers qui renvoyer

| constat | ce qu'on fait |
|---|---|
| aucune mise en forme de la pile ne porte de `render` | arrêt — `composer-un-document` |
| `lint_content` refuse, ou `rulesPending` n'est pas vide après l'envoi de la page | arrêt — corriger l'arbre ou le graphe, jamais rendre quand même |
| une section nomme une image qu'aucun `pictures` ne porte, ou dont le fichier manque | arrêt — `illustrations` |
| une activité couverte n'a pas de contenu | arrêt — `construire-le-programme` |
| un débordement que l'ordre de resserrage ne résout pas sans toucher au contenu | arrêt — la décision est à l'expert |

On ne livre jamais en contournant un manque : un fichier produit malgré un arrêt a l'air fini et
ne l'est pas.

## Ordre et reprise

Les documents dans l'ordre que le graphe donne ; dans un document, les sections par position.
Une production interrompue reprend au point 3 : le filtre de fraîcheur retrouve seul ce qui reste
à faire, et ce qui a été livré n'est pas refait. C'est ce qui rend la compétence sûre à relancer.

## Ce qu'elle ne fait pas

Elle n'écrit pas le programme, ne dessine pas d'images, ne crée pas de section : elle produit ce
qui existe. Elle ne publie rien dans le graphe non plus — ses écritures de journal sont des
brouillons comme les autres, et `publier` reste une décision à part.
