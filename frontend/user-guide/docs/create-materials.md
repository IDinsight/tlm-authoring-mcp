# Produire un document

Produire, c'est transformer un document du graphe en **fichier Word** (ou en fichier InDesign, voir [plus bas](#produire-pour-indesign)), section par section. Tout ce qui décide du résultat est déjà dans le graphe : le programme donne les mots, la section dit comment les placer, la mise en forme dit à quoi ils ressemblent. Mieux le graphe est préparé, meilleur et plus régulier est le fichier.

!!! info "Qui peut produire"
    Produire demande d'être **curateur** (ou plus) dans l'espace de travail : on lit les images de l'espace et, le cas échéant, on traduit. Avant de produire un document pour la première fois, demandez « **Ce document est-il prêt à être produit ?** » (voir [Composer un document](compose-document.md#7-verifier-quil-est-pret)).

## Demander

> « Produis la section de la leçon 12 du cahier d'exercices. »
>
> « Produis tous les fichiers de la leçon 12. »
>
> « Produis le guide de l'enseignant, regroupement “Nombres décimaux”. »

La deuxième demande est la plus courante. Une leçon doit **un fichier par document qui la couvre**, multiplié par **les langues** que la mise en forme de chaque document déclare. Claude les fait tous, et **saute ceux qui sont déjà à jour** (voir plus bas). Avec le module, la commande `/lecon` lance cette procédure et se termine par une **note de remise** : pour chaque fichier, ses pages, la police utilisée, les chevauchements et les constats des vérifications.

## Ce qui se passe, étape par étape

1. **Claude lit la section** : ce qu'elle couvre dans le programme, la routine qui s'applique, la mise en forme et ses réglages, les images rattachées. Il lit aussi les **dimensions fixes de la page** — largeur utile, lignes par page, taille que prendra chaque image — pour composer par le calcul plutôt qu'à tâtons.
2. **La page se compose.** Si la mise en forme porte des **gabarits**, le serveur remplit directement ce qu'ils couvrent depuis le programme. Claude compose le reste, à partir de la consigne d'assemblage de la section.
3. **La page est vérifiée contre le graphe, avant tout rendu.** Par exemple :
    - une consigne imprimée qui ne reprend pas **mot pour mot** celle de l'activité ;
    - une réponse imprimée qui ne correspond pas à la réponse enregistrée sur l'activité ;
    - une ligne plus longue que ce que son style autorise ;
    - plus d'images que la mise en forme n'en permet, ou une image placée qui n'est rattachée à rien.

    Chacune de ces fautes donnerait un fichier **qui se produit sans erreur et qui est faux**. C'est pourquoi on vérifie d'abord.
4. **Le serveur fabrique le fichier et le mesure.** Il compte les pages sur le fichier réellement mis en page — jamais sur une estimation — et signale une image qui chevauche du texte. Il vérifie que le fichier emploie bien **la police que déclare la mise en forme** : avec une police de remplacement, tous les comptes seraient faux. Sur demande, il renvoie aussi **une image de chaque page**, pour juger à l'œil ce que les chiffres ne disent pas. Si la page déborde, Claude resserre et recommence les étapes 3 et 4.
5. **Une version par langue.** Si la mise en forme déclare plusieurs langues, le serveur produit la traduction en s'appuyant sur le **lexique** de l'espace de travail. Un texte déjà écrit dans la langue cible par un expert est gardé tel quel : on ne retraduit jamais ce qu'un auteur a écrit à la main.
6. **Vous validez le dépôt.** Voir ci-dessous.

!!! tip "Si Claude s'arrête"
    Une consigne manquante, une image absente, une vérification impossible : Claude **s'arrête et vous le dit**, plutôt que d'inventer. La bonne réponse est presque toujours de compléter le graphe (la consigne sur l'activité, l'image rattachée), pas de corriger la page.

## Déposer : aperçu ou livrable

Deux destinations, qui ne se mélangent jamais :

| | **Aperçu** | **Livrable** |
|---|---|---|
| Où | Un espace à part, avec un lien de courte durée | L'espace officiel des documents de l'espace de travail |
| Visible dans la liste des documents | Non | Oui, avec son historique |
| Annulable | Rien à annuler | **Non** : l'écriture est immédiate |

!!! warning "Un livrable s'écrit tout de suite"
    Déposer un livrable n'a **pas de brouillon et pas d'annulation**. La demande de confirmation dit exactement quel fichier va être écrit, et **dans quel espace de travail**. Lisez-la avant d'accepter. Plusieurs fichiers se confirment en une seule fois.

Pour tester l'effet d'un brouillon non publié, demandez un **aperçu** : il est produit à partir du brouillon et n'atteint jamais l'espace officiel.

## Produire pour InDesign

Quand le document porte une mise en forme pour InDesign (voir [Mises en forme](formatters.md#produire-aussi-pour-indesign)), il suffit de le demander :

> « Produis la leçon 12 du livre de l'élève pour InDesign. »

La page se compose comme pour Word, à partir des mêmes gabarits, en tenant compte de la mise en forme réservée à InDesign. Ce qui revient diffère sur trois points.

- **Un paquet par langue**, avec un lien de courte durée : le fichier InDesign, ses images dans un dossier à côté (reliées, pas incorporées) et les polices. On le décompresse et on l'ouvre dans InDesign, où qu'il soit.
- **Pas de compte de pages.** Seul InDesign met en page un fichier InDesign. Ouvrez-le et cherchez le petit **+ rouge** qu'InDesign affiche quand un texte déborde de son cadre.
- **Les corrections faites dans InDesign ne se reprennent pas encore.** La reprise des corrections d'un expert (plus bas) ne lit que les fichiers Word. Corrigez les mots dans le programme, puis reproduisez la page.

Le paquet est un **aperçu**, déposé à part comme décrit plus haut. C'est le maquettiste qui en tire le fichier d'impression.

## Ne refaire que ce qui a changé

Chaque fichier produit par l'outil garde la trace des textes du programme qu'il contient. L'outil peut donc dire, pour chaque fichier, s'il est **à jour**, **périmé** (le programme a changé depuis) ou **inconnu** (produit autrement, il ne garde pas cette trace).

> « Quels fichiers de la leçon 12 sont périmés ? »

Une leçon se reproduit alors en ne refaisant que les fichiers périmés ou inconnus. Vous pouvez toujours demander de tout refaire.

## Retrouver un document produit

> « Liste les documents produits pour ce cours. »
>
> « Donne-moi le lien de téléchargement de la fiche de la leçon 12. »

Un fichier Word déposé dans l'espace de documents **autrement que par l'outil** — à la main, par un ancien procédé — n'est rattaché à rien. Claude peut lister ces fichiers **non suivis**, en lire le texte et les rattacher à l'élément du programme qu'ils couvrent. Ce rattachement s'écrit aussitôt, comme un livrable.

> « Quels fichiers de l'espace de documents ne sont rattachés à rien ? »

## Mesurer un fichier produit ailleurs

Un fichier produit par l'outil porte déjà sa mesure. Pour un fichier Word venu d'ailleurs — corrigé à la main, produit par un autre outil :

> « Combien de pages fait ce fichier, et est-ce qu'il déborde ? »

Avec le module, c'est la commande `/mesurer`.

## Reprendre les corrections d'un expert

Un expert a ouvert un fichier, corrigé des formulations et vous l'a renvoyé. Ces corrections doivent aller **dans le programme**, sinon la prochaine production les effacera.

> « Voici la fiche corrigée par l'inspectrice : reporte ses corrections dans le programme. »

Claude compare le fichier au graphe et vous **propose** les modifications ; il n'écrit rien lui-même. Trois cas :

- **une formulation modifiée** — la correction est claire, elle peut s'appliquer ;
- **un passage disparu** — il est signalé, **pas supprimé** : dans un fichier Word, une coupe volontaire et une erreur de manipulation se ressemblent ;
- **un passage ajouté** — il est signalé sans être rangé nulle part : deviner sa place à partir de sa position est la meilleure façon de mettre une phrase sous la mauvaise leçon.

Vous validez les propositions ; elles partent dans le brouillon comme toute modification. Avec le module : `/reprendre-corrections`. La comparaison fonctionne au mieux sur un fichier produit par l'outil ; un fichier produit autrement est lu, mais sans correspondance précise avec le graphe.
