# Prise en main

Quatre étapes avant de travailler : **obtenir un accès**, **brancher l'outil dans votre assistant IA**, **vous connecter**, puis **choisir où vous travaillez**. Comptez une dizaine de minutes la première fois, aucune ensuite.

## 1. Obtenir un accès

Il y a trois façons d'entrer, selon votre situation.

- **Votre organisation a ouvert l'accès à son domaine.** Si votre adresse professionnelle appartient à un domaine autorisé et que vous vous connectez **avec Google**, vous recevez votre rôle automatiquement à la première connexion. Rien à demander.
- **Vous avez été invité.** Un administrateur a inscrit votre **adresse e-mail** avec un rôle. Créez votre compte avec cette adresse exacte (ou connectez-vous avec Google si c'est une adresse Google) : l'invitation est reconnue à la première connexion.
- **Ni l'un ni l'autre.** Écrivez à l'administrateur de l'espace de travail et donnez-lui votre adresse e-mail. Il vous enverra une invitation.

!!! info "Sans rôle, vous pouvez déjà lire"
    Tout utilisateur connecté peut consulter les programmes publiés. Un rôle est nécessaire pour les **documents** de l'espace (les télécharger, les produire), la **traduction**, et toute **modification** du programme.

## 2. Brancher l'outil dans votre assistant

L'outil fonctionne avec plusieurs assistants IA. Ce que vous installez dépend de celui que vous utilisez :

| Votre assistant | Ce que vous installez | Assistants spécialisés |
|---|---|:---:|
| **Claude** — Cowork, Claude Code | Le module d'autorat | ✅ |
| **Claude** — discussion sur le web ou dans l'application de bureau | Le module d'autorat, ou l'outil seul | — |
| **Codex** | Le module d'autorat | — |
| **ChatGPT** | L'outil seul. Un administrateur de l'espace peut importer le module | — |
| **Gemini** — Antigravity, Gemini CLI, l'application Gemini | L'outil seul | — |

Deux mots de ce tableau demandent une explication.

- **Le module d'autorat** (plugin *tlm-autorat*) apporte **l'outil et les procédures** en une seule installation. L'assistant sait alors dans quel ordre travailler, quoi vérifier avant d'écrire, et quand s'arrêter pour vous demander. Avec **l'outil seul**, tout fonctionne quand même, mais l'assistant connaît moins bien les procédures : attendez-vous à le guider davantage.
- **Les assistants spécialisés** (un lecteur, un relecteur, un mesureur…) font les lectures longues à part et ne remontent que la conclusion. Là où ils ne fonctionnent pas, votre assistant fait le même travail dans la conversation principale, et vous le dit d'abord. Le résultat est le même ; c'est plus lent, et cela consomme davantage de la conversation.

!!! info "L'adresse de l'outil"
    Là où aucun module ne la porte pour vous, vous donnez cette adresse à votre assistant :

    ```text
    https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    Si votre organisation a son propre serveur, votre administrateur vous en donne une autre. Elle se termine toujours par `/mcp`.

Suivez maintenant les étapes de votre assistant. Les noms de menus sont donnés tels que l'éditeur les écrit ; ils peuvent apparaître traduits chez vous.

=== "Claude"

    **Le module (conseillé).**

    - **Dans Cowork** : *Personnaliser → Modules (Plugins)*, ajoutez le dépôt `IDinsight/tlm-authoring-mcp`, puis installez **tlm-autorat**. Sur les offres Team et Enterprise, un administrateur peut l'installer pour tout le monde.
    - **Dans Claude Code** (y compris l'onglet Code de l'application de bureau), tapez ces deux lignes l'une après l'autre :

    ```text
    /plugin marketplace add IDinsight/tlm-authoring-mcp
    ```

    ```text
    /plugin install tlm-autorat@tlm-authoring-mcp
    ```

    **Ou l'outil seul.** Ajoutez le connecteur **« Teaching & Learning Materials authoring »** dans les paramètres des connecteurs de Claude. S'il n'est pas proposé par votre organisation, ajoutez un **connecteur personnalisé** avec l'adresse ci-dessus.

=== "Codex"

    **Le module (conseillé).** Le même module s'installe dans Codex. Dans un terminal, tapez ces deux lignes l'une après l'autre :

    ```text
    codex plugin marketplace add IDinsight/tlm-authoring-mcp
    ```

    ```text
    codex plugin add tlm-autorat@tlm-authoring-mcp
    ```

    **Ou l'outil seul :**

    ```text
    codex mcp add tlm --url https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    Codex lui-même demande un compte ChatGPT ou une clé OpenAI avant de démarrer.

=== "ChatGPT"

    ChatGPT prend l'outil seul, sous la forme d'un **serveur MCP personnalisé**. Deux limites viennent de ChatGPT lui-même :

    - cela fonctionne **sur le web**, pas dans l'application mobile ;
    - il faut une offre **Business, Enterprise ou Edu**. Dans un espace Business, seul un administrateur ou un propriétaire peut le créer et le publier pour les autres. Une offre Pro ne laisse un serveur personnalisé que *lire*, ce qui ne suffit pas pour travailler ici.

    Ensuite, sur chatgpt.com :

    1. Allez dans **Plugins**.
    2. Cliquez sur le bouton plus, puis sur **Add custom MCP server**.
    3. Donnez-lui un nom, par exemple « TLM ».
    4. Sous **Connection**, saisissez l'adresse ci-dessus.
    5. Quand ChatGPT demande comment s'authentifier, choisissez **OAuth**. Il n'y a ni clé ni mot de passe à coller : vous vous connectez à l'étape 3 ci-dessous.
    6. Lisez l'avertissement, puis cochez **I understand and want to continue**.
    7. Cliquez sur **Create as a plugin**, et parcourez la liste des outils que ChatGPT a trouvés.

    Un administrateur de l'espace ChatGPT a une seconde voie, qui apporte aussi les procédures : dans l'Admin Console, **Plugins**, **Add**, puis **Import marketplace**, avec le dépôt `IDinsight/tlm-authoring-mcp` comme source.

    !!! note "Pas encore essayé par nous"
        Ces étapes sont celles d'OpenAI. Nous n'avons encore suivi aucune des deux voies de bout en bout. ChatGPT devrait vous demander de confirmer chaque action qui **modifie** quelque chose, par exemple une modification du programme ou l'envoi d'un fichier, et laisser passer une simple lecture. S'il demande confirmation à chaque action, ou si une étape se présente autrement, dites-le à votre administrateur.

=== "Gemini"

    Google propose trois endroits où brancher l'outil. Tous les trois prennent l'outil seul.

    **Antigravity** (l'application). Cliquez sur **Customizations**, puis sur **Installed**. Sous **MCP Servers**, cliquez sur **Add MCP Server (+)**, saisissez l'adresse ci-dessus, puis **Add**.

    **Gemini CLI.** Depuis juin 2026, Google le réserve à ceux qui l'utilisent avec une clé Gemini ou un projet Google Cloud ; les comptes personnels ont Antigravity à la place. Dans un terminal :

    ```text
    gemini mcp add --scope user --transport http tlm https://senegal-mohebs-tlm-148764688487.europe-west1.run.app/mcp
    ```

    **L'application Gemini** (gemini.google.com). Ouvrez **Settings**, puis **Connected Apps**. Sous **Custom apps**, choisissez **Add a custom app**, saisissez l'adresse ci-dessus, puis **Next**. Pour l'instant, Google limite cette possibilité aux comptes Google personnels, aux États-Unis, en anglais, pour les personnes de 18 ans ou plus, avec l'historique activé.

    !!! note "Pas encore essayé par nous"
        Ces étapes sont celles de Google. Nous ne les avons pas encore suivies de bout en bout. Le module a aussi été préparé pour Antigravity, mais jamais essayé sur une vraie installation. Si une étape se présente autrement, dites-le à votre administrateur.

Dans Claude et dans Codex, le module installe aussi un second outil, destiné à la **génération d'images**. Il ne sert que lorsque vous travaillez les illustrations.

!!! tip "Là où cela marche le mieux"
    **Cowork** et **Claude Code** sont les deux endroits où les assistants spécialisés fonctionnent : les travaux longs (lire un document entier, relire une leçon) y vont le plus vite. Partout ailleurs, l'outil fait les mêmes choses, plus lentement.

## 3. Se connecter

À la première utilisation, une page de connexion s'ouvre dans votre navigateur. Choisissez **Continuer avec Google**, ou saisissez l'e-mail et le mot de passe de votre compte. Vous ne le referez pas à chaque fois.

Dans certains assistants, c'est vous qui lancez la connexion :

| Assistant | Pour lancer la connexion |
|---|---|
| Claude Code | La commande `/mcp` |
| Codex | Dans un terminal : `codex mcp login tlm`. Avant de travailler les illustrations, aussi `codex mcp login nano-banana` |
| Gemini CLI | Dans une session : `/mcp auth tlm` |
| Antigravity | **Authenticate**, à côté du serveur. Collez le code qu'on vous donne dans **Enter authorization code**, puis **Submit** |

## 4. Vérifier que tout est branché

Envoyez un message simple :

> « Que puis-je faire ? »

Si l'assistant répond en s'appuyant sur l'outil (en citant vos rôles, vos espaces de travail), tout fonctionne. S'il répond « de tête », vérifiez que l'outil est **activé pour cette conversation** (dans Claude, le menu des outils sous la zone de saisie), puis demandez-le explicitement :

> « Utilise l'outil TLM pour me dire ce que je peux faire. »

La première fois que l'assistant appelle un outil, il vous demande la permission. Acceptez : c'est normal.

## 5. Choisir où vous travaillez

Le travail est toujours cadré par trois choses :

- un **espace de travail** — le programme d'une organisation ou d'un pays. C'est lui qui détermine votre rôle ;
- une **classe** et une **matière** à l'intérieur de cet espace. On travaille sur une seule à la fois.

> « Quels espaces de travail et quelles matières sont disponibles ? »

Puis dites à l'assistant où aller, en nommant l'espace, la classe et la matière telles qu'il vous les a listées :

> « Travaillons sur les mathématiques de première année. »

À partir de là, tout ce que vous demandez s'applique à ce périmètre. Pour changer, dites-le simplement : l'assistant repart proprement sur le nouveau périmètre, sans mélanger les deux.

## 6. Demander où vous en êtes

C'est la question à poser à chaque reprise de travail :

> « Où en suis-je ? »

L'assistant répond par un point de situation : où vous êtes, ce que votre rôle permet, s'il existe un **brouillon** ouvert, ce qui attend une relecture, ce qui est **inachevé** (un document qui ne couvre rien, une section orpheline, une routine que personne n'utilise), et deux ou trois choses à faire maintenant.

!!! warning "Un brouillon ouvert est souvent le travail de quelqu'un d'autre"
    Si l'assistant signale un brouillon en cours que vous n'avez pas ouvert, c'est probablement un collègue qui y travaille. Ne le publiez pas et ne l'abandonnez pas sans lui en parler.

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

Deux anciennes commandes restent disponibles par habitude : `/nouveau-cours` (construire un cours de zéro, qui enchaîne `/construire` puis `/composer`) et `/relire` (relire le brouillon avant de l'envoyer à un approbateur, comme `/evaluer`).

**Dans Codex**, seules les commandes qui ne prennent rien après leur nom sont proposées : `/ou-en-suis-je`, `/relire`, `/publier` et `/decisions`. Pour les autres, demandez en écrivant : les procédures qu'elles ouvrent sont installées quand même.

Sans le module, certains assistants proposent quelques **démarrages tout prêts** qui viennent de l'outil lui-même (*Créer un nouveau document*, *Appliquer un style*, *Créer une routine*, *Préparer une relecture*) et qui ouvrent la conversation avec les bonnes questions.

## Et ensuite ?

- Construire ou corriger le programme → [Comprendre le graphe](create-graph.md).
- Créer ou produire un document → [Composer un document](compose-document.md).
- Regarder le programme → [Explorer le graphe](explorer.md).
