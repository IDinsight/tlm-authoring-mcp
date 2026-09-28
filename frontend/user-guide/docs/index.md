# Guide utilisateur TLM

Cet outil sert à deux choses : **entretenir un programme d'enseignement** (le « graphe de connaissances ») et **produire les documents qui l'enseignent** — livres de l'élève, guides de l'enseignant, fiches, cahiers — en fichiers Word prêts à imprimer.

Il fonctionne de la même façon pour toutes les matières, toutes les classes et tous les pays. Ce qui fait la différence entre deux programmes n'est pas dans l'outil : c'est dans leur graphe.

## Ce qui est propre à votre programme vit dans le graphe

L'outil ne connaît d'avance ni vos matières, ni vos documents, ni vos habitudes. Tout ce qui est propre à un programme est **écrit dans son graphe**, par ses experts, et peut donc être relu et corrigé par la discussion :

| Ce qui change d'un programme à l'autre | Où c'est écrit |
|---|---|
| Le nom des niveaux (domaine, thème, objectif spécifique…) et des regroupements (chapitre, unité, semaine…) | Dans les éléments du graphe eux-mêmes |
| Les documents que l'on produit, et ce que chacun couvre | Dans les **documents** du graphe |
| Le déroulé d'une séance | Dans les **routines pédagogiques** |
| L'apparence d'une page, les langues de sortie | Dans les **mises en forme** (formatters) |
| Ce qui fait qu'un document est bon | Dans les **grilles d'évaluation** |
| Les conventions de la matière, ce que le programme doit couvrir | Dans le **guide de la matière** |
| La traduction attendue des termes | Dans le **lexique** de l'espace de travail |

Les exemples de ce guide sont donc des **exemples** : votre programme dira peut-être « unité » là où ce guide dit « chapitre ». Pour connaître les conventions de la matière sur laquelle vous travaillez, demandez à Claude :

> « Lis-moi le guide de cette matière. »

## Vos outils de travail

- **La discussion avec Claude.** Tout se fait là, en langage courant. Vous dites ce que vous voulez — « ajoute une leçon », « produis la leçon 12 », « est-ce que ce document est prêt ? » — et Claude appelle les bons outils. Aucune commande à apprendre.
- **Le module d'autorat** (plugin *tlm-autorat*). Il apprend à Claude les bonnes procédures : dans quel ordre créer un document, comment vérifier une page avant de la rendre, quand s'arrêter pour vous demander. Il est facultatif mais fortement conseillé. Voir [Prise en main](getting-started.md).
- **L'explorateur.** Une page web en **lecture seule** qui montre le programme publié, son brouillon en cours et le catalogue. On y regarde, on n'y modifie rien. Voir [Explorer le graphe](explorer.md).

## Qui fait quoi

Ce que vous pouvez faire dépend de votre **rôle dans l'espace de travail**.

| Vous êtes… | Vous voulez… | Rôle |
|---|---|---|
| **Lecteur** | Consulter un programme | aucun rôle nécessaire |
| **Expert programme** | Écrire les standards, les leçons, les activités | curateur |
| **Concepteur de documents** | Créer les documents, leurs sections, leur mise en forme, et les produire | curateur |
| **Approbateur** | Relire et **publier** le travail des curateurs | approbateur |
| **Administrateur** | Gérer les membres d'un espace de travail | admin |

Vous ne savez pas quel est votre rôle ? Demandez : « **Que puis-je faire ?** »

## Par où commencer

1. [**Prise en main**](getting-started.md) — obtenir un accès, installer le module, choisir où vous travaillez.
2. **Construire le programme** — [comprendre le graphe](create-graph.md), [les standards](build-standards.md), [les cours et les leçons](courses-lessons.md), [les routines](routines.md).
3. **Composer et produire** — [composer un document](compose-document.md), [sa mise en forme](formatters.md), [le produire](create-materials.md).
4. **Évaluer et publier** — [évaluer un document](evaluate.md), [relire et publier le brouillon](review-approve.md).
5. [**Explorer le graphe**](explorer.md) et la [**Référence**](reference.md) pour le vocabulaire.

!!! note "Trois règles de sécurité"
    **Rien ne s'écrit sans votre accord.** Avant toute modification, Claude vous montre ce qui va changer et attend votre « oui ».

    **Le programme passe par un brouillon.** Vos modifications s'accumulent à part. Elles n'atteignent la production de documents qu'une fois **publiées** par un approbateur.

    **Vous donnez des noms, jamais des identifiants.** « La leçon 12 », « le guide de l'enseignant » : Claude retrouve l'élément. S'il y en a plusieurs du même nom, il vous demande lequel.
