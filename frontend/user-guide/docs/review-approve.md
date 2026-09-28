# Relire, publier ou abandonner un brouillon

Toute modification du programme — une leçon, un document, une section, une image rattachée, le guide de la matière — s'accumule dans un **brouillon**. Tant qu'il n'est pas publié, rien de ce qu'il contient n'atteint la production de documents. Le **curateur** prépare et signale que c'est prêt ; l'**approbateur** relit et **publie**.

!!! info "Un brouillon par matière"
    Il n'y a qu'**un** brouillon ouvert par matière, partagé par tous ceux qui y travaillent. S'il existe déjà quand vous arrivez, c'est sans doute le travail d'un collègue : parlez-lui avant de le publier ou de l'abandonner.

## 1. Voir ce qui a changé

> « Montre-moi les modifications en attente. »

Claude liste tout ce qui deviendra officiel à la publication : éléments ajoutés, modifiés, supprimés, et un changement du guide de la matière s'il y en a un. Pour le voir dans l'arborescence, ouvrez la vue **Brouillon** de l'[explorateur](explorer.md#voir-le-brouillon).

## 2. Faire les vérifications

> « Vérifie le brouillon avant publication. »

Trois vérifications, qui répondent à trois questions différentes :

| Vérification | La question | Exemple de constat |
|---|---|---|
| **Le branchement** | Quelque chose n'est-il relié à rien ? | Un document qui ne couvre rien (il serait produit vide), une section hors de tout document, une routine que personne n'utilise |
| **La couverture** | Ce qui est écrit couvre-t-il ce que le programme attend ? | Un objectif qu'aucune leçon n'enseigne. Claude en juge à partir des attentes écrites dans le **guide de la matière** |
| **La cohérence** | Deux choses écrites se contredisent-elles ? | Une routine dont la durée totale n'est pas la somme de ses étapes, une grille dont les poids ne font pas 100 %, un élément cité qui n'existe pas |

Ce sont des **constats**, jamais des blocages : la décision vous revient. Mais un document « relié à rien » mérite presque toujours une correction avant publication.

Avec le module, `/evaluer` fait toutes ces vérifications en une passe (et celles d'un document, voir [Évaluer un document](evaluate.md)).

!!! tip "Faire taire une alerte voulue"
    Si une alerte est délibérée — une règle qui ne s'applique pas à un élément précis —, demandez à Claude de **la faire taire sur cet élément**. Elle ne reviendra plus là, et continuera de s'appliquer partout ailleurs.

## 3. Signaler que c'est prêt

Quand vous avez fini, dites-le, avec une note :

> « Marque le brouillon comme prêt à relire. Note : leçons 1 à 6 faites, la 7 attend encore ses images. »

La note est le message que vous auriez écrit à la main. L'approbateur la verra en demandant « où en est-on ? ».

!!! warning "Personne n'est prévenu automatiquement"
    Aucun e-mail, aucune notification. **Prévenez l'approbateur** vous-même.

Pour reprendre le travail : « Finalement j'ai encore des corrections, retire la demande de relecture. » Le brouillon n'est pas touché, seule la demande disparaît. Elle disparaît aussi d'elle-même à la publication ou à l'abandon du brouillon.

## 4. Publier

> « Publie le brouillon. »

1. Claude montre un dernier récapitulatif de ce qui va devenir officiel, avec les constats des vérifications.
2. Vous **confirmez** : tout est publié **d'un seul coup**. La production de documents utilise aussitôt la nouvelle version.

Par défaut, un approbateur peut publier un brouillon qu'il a lui-même modifié ; l'historique le signale alors comme tel. Le serveur peut aussi être réglé pour l'interdire, auquel cas un second approbateur doit publier.

!!! warning "Publier rend les changements officiels"
    Une fois publié, le programme mis à jour alimente toutes les productions. Les fichiers déjà produits à partir de l'ancienne version apparaîtront comme **périmés** (voir [Produire un document](create-materials.md#ne-refaire-que-ce-qui-a-change)).

## Revenir sur la dernière modification

> « Annule la dernière modification. »

Claude dit d'abord **laquelle** il va annuler (quoi, quand, par qui). Vous confirmez, et seule celle-là disparaît du brouillon ; les autres restent. Redemandez, et c'est la précédente qui part.

Deux limites, voulues :

- on ne remonte que dans le **brouillon en cours** : ce qui est publié se corrige par une nouvelle modification ;
- si une modification plus récente a touché **le même élément**, Claude refuse et vous dit lequel, plutôt que de mélanger les deux.

!!! danger "Le catalogue ne passe pas par le brouillon"
    Une écriture dans le **catalogue** (routines, mises en forme, grilles de la bibliothèque) se publie aussitôt, sans brouillon, et ne s'annule pas ainsi. La suppression d'une entrée du catalogue est définitive ; elle demande le rôle d'admin, et l'historique en garde une copie complète.

## Abandonner un brouillon

> « Abandonne le brouillon. »

Tout le travail en cours est jeté ; la version officielle ne change pas. Curateurs et approbateurs peuvent le faire, après confirmation.

## Modifier le guide de la matière

Le **guide de la matière** — les conventions et les attentes que Claude lit avant d'écrire — se modifie comme le reste, dans le brouillon :

> « Dans le guide de la matière, ajoute que les consignes s'écrivent toujours à l'impératif. »

La modification apparaît dans le récapitulatif du brouillon et se publie avec lui.

## Consulter l'historique

Chaque action — modification, publication, abandon, refus, attribution de rôle — est enregistrée dans un **historique** qu'on ne peut ni modifier ni effacer.

> « Qui a publié en dernier, et quand ? »
>
> « Qu'est-ce qui a changé sur cette leçon ce mois-ci ? »

L'historique est consultable par les **approbateurs**.
