# Évaluer un document

Un document produit, comment savoir s'il est **bon** ? On le confronte à une **grille d'évaluation** : une liste de critères écrite à l'avance par votre programme, rangée dans le catalogue et rattachée au document.

C'est la troisième sorte d'entrée du catalogue :

| Entrée | Ce qu'elle décrit | S'applique à |
|---|---|---|
| **Routine** | Le déroulé d'une séance | Un cours, une leçon, une activité |
| **Mise en forme** | L'apparence d'un document | Un document |
| **Grille d'évaluation** | Les critères qui jugent le résultat | Un document |

## Deux formes de grille

Une grille porte une **échelle**, et c'est elle qui décide de ce que l'évaluation produit.

| Forme | Échelle | Résultat |
|---|---|---|
| **Grille notée** | Numérique (par exemple 0 à 4) | Une **note**, moyenne pondérée de ses sections |
| **Grille d'approbation** | Oui / Non | Un **feu vert** : un seul « Non » bloque, il n'y a pas de moyenne |

L'une mesure *à quel point* le document est bon, l'autre dit s'il *peut partir à l'impression*. Un document peut avoir une excellente note et rester bloqué par un seul « Non » : c'est pourquoi on lui rattache souvent les deux.

L'échelle, les sections, les poids et les critères viennent de la grille **telle qu'elle est écrite dans le catalogue**. L'outil n'en connaît aucune d'avance.

> « Quelles grilles propose le catalogue ? »

## Rattacher une grille

> « Rattache la grille d'approbation à ce document. »

Comme une routine ou une mise en forme, la grille est **copiée** sous le document ; une modification ultérieure du catalogue ne l'atteint pas. Un document peut porter plusieurs grilles, et l'évaluation les rapporte toutes.

!!! warning "Une grille rattachée deux fois compte deux fois"
    Avant de rattacher, en cas de doute : « Quelles grilles sont rattachées à ce document ? »

## Lancer l'évaluation

> « Évalue ce document. »

L'outil rassemble les grilles du document et le fichier produit ; **c'est Claude qui lit et note**, critère par critère, avec la justification de chaque note. L'outil ne juge jamais lui-même.

Avec le module, `/evaluer` fait l'évaluation **en une seule relecture**, dans cet ordre :

1. le document est-il **prêt** (couverture, sections, mise en forme, grilles) ;
2. le **branchement** du brouillon ;
3. la **couverture** au regard du guide de la matière ;
4. la **cohérence** entre ce qui est écrit, et la **page composée contre le graphe** ;
5. les **grilles**, sur le fichier rendu ;
6. la **terminologie**, si le document est traduit : les termes employés sont-ils ceux du lexique de l'espace ?

!!! tip "Demandez où est chaque faute"
    Une note sans preuve ne sert à rien. Un bon critère d'exactitude demande de **citer chaque erreur avec l'endroit où elle se trouve**. Une note ou un « Non » qui arrive sans passage cité se redemande.

## Ce qu'une grille n'a pas à vérifier

Tout ce que l'outil **garantit déjà** n'a pas à être recoché à la main : les marges et les tailles (la mise en forme les applique), le nombre de pages (le rendu le mesure), une consigne recopiée de travers (la vérification de page la compare au programme). Claude trie la grille avant de la lire : ce qui est déjà garanti est signalé comme tel, le reste est jugé sur le document.

Une grille gagne donc à garder les critères qui **exigent de lire** le document produit.

## Ce que l'évaluation ne peut pas faire

Certains critères supposent un **test sur le terrain** : le taux de compréhension des consignes par les élèves, le temps de résolution d'un exercice. Ils ne se déduisent pas de la lecture. La règle est de **le déclarer** plutôt que d'inventer une note : une note fabriquée donne une fausse assurance, pire qu'une case vide.

D'autres critères ne s'apprécient qu'à l'échelle du **document entier** — tout ce qui parle d'équilibre ou de répartition, entre types d'exercices, contextes ou personnages. Ceux-là se jugent après lecture complète, jamais page par page.

!!! note "Pas encore d'évaluation de programme"
    Une grille se rattache à un **document**. Évaluer le programme lui-même contre une grille n'est pas prévu aujourd'hui.
