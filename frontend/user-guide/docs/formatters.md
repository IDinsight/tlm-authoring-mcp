# Mises en forme (formatters)

Une **mise en forme** — un *formatter* dans le vocabulaire de l'outil — décide de **l'apparence** d'un document : format de page, marges, polices, couleurs, style des images, langues de sortie. On l'écrit une fois et on l'applique à autant de documents qu'on veut, pour qu'ils se ressemblent.

## Qui décide quoi sur une page

La production d'une page se partage en deux, et la mise en forme n'en fait qu'une moitié.

| Qui | Décide | Exemple |
|---|---|---|
| **Claude**, à partir du programme et de la consigne de la section | **Ce qui est sur la page**, et dans quel ordre | « d'abord le titre de la leçon, puis la bande d'images, puis les trois exercices » |
| **La mise en forme** | **À quoi cela ressemble** | « un titre est en 16 pt gras, une bande d'images occupe toute la largeur » |

Le serveur assemble les deux et fabrique le fichier Word. Claude ne choisit donc jamais une couleur ou une taille : il nomme un **style** (« titre de leçon », « consigne »), et c'est la mise en forme qui dit ce que ce style veut dire.

## Les trois parties d'une mise en forme

1. **Des consignes écrites.** Du texte que Claude lit avant de composer : le ton, ce qu'on imprime pour l'élève et pour l'enseignant, le style des illustrations, ce qu'il faut éviter.
2. **Des réglages de page.** Des valeurs précises que le serveur applique lui-même : taille de page et marges, styles de texte et nombre de caractères par ligne, taille maximale des images, nombre de pages visé, **langues** à produire. Sans ces réglages, un document **ne peut pas être produit** — l'outil refuse plutôt que de sortir un fichier sans style.
3. **Des gabarits de page** (facultatifs). Quand toutes les pages d'un document suivent la même structure, on peut l'écrire une fois sous forme de gabarit : « en tête, le numéro et le titre de la leçon ; puis l'image de l'activité 1 ; puis sa consigne… ». Le serveur remplit alors chaque page **directement depuis le programme**, à l'identique à chaque fois, sans que Claude ait à recomposer. Ce qu'aucun gabarit ne couvre revient à Claude, qui le compose à la main.

!!! example "Pourquoi les gabarits comptent"
    Sans gabarit, Claude recompose chaque page à partir des consignes. Deux productions de la même leçon peuvent alors différer légèrement. Avec un gabarit, une consigne ou une image ne peut pas être mal recopiée : elle est **copiée** du programme, pas réécrite.

## Les mises en forme se superposent

Un document peut porter plusieurs mises en forme. Une mise en forme générale donne le ton commun (la charte de la maison) ; une plus spécifique ajoute les règles propres à ce document ; une section peut encore en porter une à elle. Quand deux disent des choses différentes, c'est **la plus proche** de la page qui l'emporte.

> « Quelles mises en forme s'appliquent à cette section, et laquelle fixe la taille des titres ? »

## Parcourir le catalogue

Les mises en forme vivent dans le même [catalogue](routines.md#le-catalogue) que les routines et les grilles.

> « Quelles mises en forme propose le catalogue ? »
>
> « Montre-moi le détail de la mise en forme “Charte maison”. »

## Appliquer une mise en forme à un document

Une mise en forme s'applique **à un document**, pas au programme : l'apparence est une propriété de ce qu'on imprime, pas de ce qu'on enseigne.

> « Applique la mise en forme “Charte maison” à ce document. »

Comme pour une routine, cela pose une **copie indépendante** sous le document. Modifier cette copie ne change que ce document ; une modification ultérieure de l'entrée du catalogue ne l'atteint pas.

## Créer ou modifier une mise en forme

**Partir d'une mise en forme existante** est presque toujours le plus simple :

> « Duplique la mise en forme “Charte maison” sous le nom “Charte des fiches de révision”. »
>
> « Dans ma copie, passe le corps de texte à 12 pt. »

**Corriger la mise en forme d'un seul document** : modifiez sa copie, en brouillon.

> « Dans la mise en forme de ce document, réduis les marges à 1,5 cm. »

**Corriger pour tout le monde** : écrivez dans le catalogue. Cette écriture **se publie aussitôt**, sans brouillon ni annulation, parce qu'une bibliothèque sert à d'autres. Relisez l'aperçu avant de confirmer.

!!! tip "Les consignes et les réglages doivent dire la même chose"
    Si la prose dit « texte en 12 pt » et que les réglages disent 11, l'outil le signale à la relecture. Gardez les deux d'accord : la prose explique, les réglages s'appliquent.

!!! info "Qui peut modifier quoi"
    - **Appliquer** une mise en forme, ou **modifier la copie** d'un document : un **curateur** (brouillon).
    - **Créer, dupliquer ou modifier** une entrée du catalogue de l'espace : un **approbateur** (publié aussitôt).
    - Une entrée **partagée** : le **super-administrateur** seulement. Pour l'adapter, dupliquez-la.
