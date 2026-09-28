# Comprendre le graphe

Le **graphe de connaissances** est le programme mis en forme de réseau : ce que les élèves doivent apprendre, ce qui l'enseigne, et les liens entre les deux. Tout ce que l'outil produit en sort. Cette page explique de quoi il est fait et comment il voit le jour ; les pages suivantes montrent comment le remplir.

## Deux couches, cousues ensemble

- **Les standards** disent *ce que l'élève doit maîtriser*. C'est l'ossature : de grands ensembles, puis des objectifs précis à l'intérieur, puis des **composantes d'apprentissage** qui détaillent chaque objectif. Cette couche change rarement.
- **Le contenu** dit *ce qui enseigne ces standards* : un cours, ses regroupements (chapitres, unités, semaines…), ses leçons, et les activités de chaque leçon. C'est la couche que vous écrivez et faites évoluer.

Chaque leçon est **alignée** sur le standard qu'elle enseigne. C'est ce fil qui permet de répondre à « quel objectif cette leçon enseigne-t-elle ? » et à « quels objectifs ne sont enseignés nulle part ? ».

!!! example "Un exemple"
    Un standard dit : « L'élève sait comparer deux nombres jusqu'à 20. »
    Une leçon intitulée *« Plus grand, plus petit »* est alignée sur ce standard : c'est elle qui l'enseigne. Ses activités sont les exercices que l'élève fera.

## Une troisième couche : les documents

Le programme n'est pas un livre. Un **document** — un livre de l'élève, un guide de l'enseignant, une fiche — est un élément à part du graphe, qui **couvre** une partie du programme et dit **comment la présenter**. Un même programme peut alimenter plusieurs documents : le livre de l'élève et le guide de l'enseignant couvrent les mêmes leçons, chacun à sa manière.

La règle qui tient l'ensemble : **le programme porte les mots, le document porte la page.** Le texte d'un exercice vit sur l'activité, dans le programme. Le document dit seulement où et comment cet exercice se place. Corriger une consigne se fait donc une seule fois, dans le programme, et tous les documents qui la couvrent en profitent.

Les documents sont décrits dans [Composer un document](compose-document.md).

## Les mots de votre programme

L'outil ne fixe aucun vocabulaire. Un programme appelle ses regroupements « chapitres », un autre « unités » ou « semaines » ; l'un nomme ses standards « domaine » et « objectif spécifique », l'autre « thème » et « compétence ». Ces noms sont écrits **dans les éléments du graphe**, et c'est eux que Claude reprend quand il vous parle.

Le **guide de la matière** complète le tableau : il décrit, en prose, les conventions de la matière et ce que le programme doit couvrir. Il est rédigé par les experts et se modifie comme le reste (voir [Relire et publier](review-approve.md)).

> « Lis-moi le guide de cette matière. »

## Comment un graphe voit le jour

**Au départ, un import.** Quand une nouvelle matière arrive, son ossature de départ — au minimum le cadre des standards — est **importée** d'un fichier par un développeur. Cette étape ne se fait pas par la discussion ; elle est décrite dans [Administration](admin-developer.md).

**Ensuite, tout se construit en discutant.** Standards, composantes, cours, regroupements, leçons, activités : vous les créez et les corrigez avec Claude. Un **nouveau cours** peut même partir de zéro par la discussion ; seule la racine des standards dépend de l'import.

Vous pouvez aussi partir **d'un document existant** — une planification, un ancien guide, le programme d'un autre pays. Claude le lit et vous propose une structure à créer, que vous validez avant toute écriture.

> « Voici notre planification annuelle en PDF : propose-moi les leçons à créer. »

## Se repérer avant de construire

> « Fais-moi un état des lieux de cette matière. »

Claude donne un panorama : combien de standards, de cours, de leçons, de documents, et si un brouillon est ouvert.

> « Montre-moi la structure du cours, sans le détail des textes. »

Claude parcourt le graphe depuis ce point et vous en liste le squelette. Pour une vue d'ensemble visuelle, ouvrez l'[explorateur](explorer.md).

!!! note "Rien n'est officiel tant que ce n'est pas publié"
    Tout ce que vous créez part d'abord dans un **brouillon**, invisible pour la production de documents jusqu'à ce qu'un approbateur le publie. Vous construisez donc sans risque. Voir [Relire, publier ou abandonner un brouillon](review-approve.md).
