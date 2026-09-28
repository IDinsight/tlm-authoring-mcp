# Prise en main

Quatre étapes avant de travailler : **obtenir un accès**, **brancher l'outil dans Claude**, **vous connecter**, puis **choisir où vous travaillez**. Comptez une dizaine de minutes la première fois, aucune ensuite.

## 1. Obtenir un accès

Il y a trois façons d'entrer, selon votre situation.

- **Votre organisation a ouvert l'accès à son domaine.** Si votre adresse professionnelle appartient à un domaine autorisé et que vous vous connectez **avec Google**, vous recevez votre rôle automatiquement à la première connexion. Rien à demander.
- **Vous avez été invité.** Un administrateur a inscrit votre **adresse e-mail** avec un rôle. Créez votre compte avec cette adresse exacte (ou connectez-vous avec Google si c'est une adresse Google) : l'invitation est reconnue à la première connexion.
- **Ni l'un ni l'autre.** Écrivez à l'administrateur de l'espace de travail et donnez-lui votre adresse e-mail. Il vous enverra une invitation.

!!! info "Sans rôle, vous pouvez déjà lire"
    Tout utilisateur connecté peut consulter les programmes publiés. Un rôle est nécessaire pour les **documents** de l'espace (les télécharger, les produire), la **traduction**, et toute **modification** du programme.

## 2. Brancher l'outil dans Claude

Deux possibilités. La première est conseillée.

### Installer le module d'autorat (conseillé)

Le module *tlm-autorat* apporte **le connecteur et les procédures** en une seule installation : Claude sait alors dans quel ordre travailler, quoi vérifier avant d'écrire, et quand s'arrêter pour vous demander.

- **Dans Cowork** : *Personnaliser → Modules (Plugins)*, ajoutez le dépôt `IDinsight/tlm-authoring-mcp`, puis installez **tlm-autorat**. Sur les offres Team et Enterprise, un administrateur peut l'installer pour tout le monde.
- **Dans Claude Code** (y compris l'onglet Code de l'application de bureau), tapez ces deux lignes l'une après l'autre :

```text
/plugin marketplace add IDinsight/tlm-authoring-mcp
```

```text
/plugin install tlm-autorat@tlm-authoring-mcp
```

Le module installe aussi un second connecteur, destiné à la **génération d'images**, utilisé seulement quand vous travaillez les illustrations.

!!! tip "Cowork, c'est mieux"
    Le module s'appuie sur des assistants spécialisés (un lecteur, un relecteur, un mesureur…) qui font les lectures longues à part et ne remontent que la conclusion. Ils fonctionnent dans **Cowork** et **Claude Code**, pas dans la discussion simple sur le web. Le module y marche quand même, mais plus lentement.

### Ou : le connecteur seul

Si vous n'installez pas le module, ajoutez le connecteur **« Teaching & Learning Materials authoring »** dans les paramètres des connecteurs de Claude. S'il n'est pas proposé par votre organisation, ajoutez un **connecteur personnalisé** avec l'adresse que vous donne votre administrateur (elle se termine par `/mcp`). Tout fonctionne, mais Claude connaîtra moins bien les procédures.

## 3. Se connecter

À la première utilisation, une page de connexion s'ouvre. Choisissez **Continuer avec Google**, ou saisissez l'e-mail et le mot de passe de votre compte. Vous ne le referez pas à chaque fois.

Dans Claude Code, la connexion se lance avec la commande `/mcp`.

## 4. Vérifier que tout est branché

Envoyez un message simple :

> « Que puis-je faire ? »

Si Claude répond en s'appuyant sur l'outil (en citant vos rôles, vos espaces de travail), tout fonctionne. S'il répond « de tête », vérifiez que le connecteur est **activé pour cette conversation** (menu des outils sous la zone de saisie), puis demandez-le explicitement :

> « Utilise l'outil TLM pour me dire ce que je peux faire. »

La première fois que Claude appelle un outil, il vous demande la permission. Acceptez : c'est normal.

## 5. Choisir où vous travaillez

Le travail est toujours cadré par trois choses :

- un **espace de travail** — le programme d'une organisation ou d'un pays. C'est lui qui détermine votre rôle ;
- une **classe** et une **matière** à l'intérieur de cet espace. On travaille sur une seule à la fois.

> « Quels espaces de travail et quelles matières sont disponibles ? »

Puis dites à Claude où aller, en nommant l'espace, la classe et la matière telles qu'il vous les a listées :

> « Travaillons sur les mathématiques de première année. »

À partir de là, tout ce que vous demandez s'applique à ce périmètre. Pour changer, dites-le simplement : Claude repart proprement sur le nouveau périmètre, sans mélanger les deux.

## 6. Demander où vous en êtes

C'est la question à poser à chaque reprise de travail :

> « Où en suis-je ? »

Claude répond par un point de situation : où vous êtes, ce que votre rôle permet, s'il existe un **brouillon** ouvert, ce qui attend une relecture, ce qui est **inachevé** (un document qui ne couvre rien, une section orpheline, une routine que personne n'utilise), et deux ou trois choses à faire maintenant.

!!! warning "Un brouillon ouvert est souvent le travail de quelqu'un d'autre"
    Si Claude signale un brouillon en cours que vous n'avez pas ouvert, c'est probablement un collègue qui y travaille. Ne le publiez pas et ne l'abandonnez pas sans lui en parler.

## Les commandes du module

Avec le module installé, quelques raccourcis ouvrent directement la bonne procédure. Ils sont facultatifs : tout ce qu'ils font, vous pouvez le demander en écrivant.

| Commande | Pour… |
|---|---|
| `/ou-en-suis-je` | Faire le point : où vous êtes, ce que vous pouvez faire, ce qui reste ouvert |
| `/construire` | Construire ou faire évoluer le programme (standards, cours, leçons, regroupements) |
| `/composer` | Créer ou faire évoluer un document (ce qu'il couvre, sa mise en forme, ses sections) |
| `/produire` | Produire un document, puis vérifier qu'il tient |
| `/lecon` | Produire tous les fichiers d'une leçon, en ne refaisant que ce qui est périmé |
| `/mesurer` | Mesurer un document déjà produit (pages, débordement) |
| `/evaluer` | Relire un document ou le brouillon en une seule passe |
| `/reprendre-corrections` | Reporter dans le programme les corrections d'un expert sur un fichier Word |
| `/publier` | Publier le brouillon, vérifications d'abord |
| `/decisions` | Lister ce qui attend une décision humaine |

Sans le module, le connecteur propose parfois quelques **démarrages tout prêts** (*Créer un nouveau document*, *Appliquer un style*, *Créer une routine*, *Préparer une relecture*) qui ouvrent la conversation avec les bonnes questions.

## Et ensuite ?

- Construire ou corriger le programme → [Comprendre le graphe](create-graph.md).
- Créer ou produire un document → [Composer un document](compose-document.md).
- Regarder le programme → [Explorer le graphe](explorer.md).
