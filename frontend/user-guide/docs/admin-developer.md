# Administration

Cette page couvre deux tâches, pour deux publics différents :

- **Gérer un espace de travail et ses membres** — se fait **en discutant avec Claude**, sans aucune compétence technique. Pour les administrateurs.
- **Ajouter une nouvelle matière** — demande l'accès au dépôt de code et au déploiement. Pour les développeurs.

---

## Partie 1 — Espaces de travail et membres

### Ce qu'est un espace de travail

Un **espace de travail** est le conteneur d'un programme — celui d'un pays, d'une organisation, d'un projet. Il possède les programmes de ses classes et matières, sa bibliothèque (catalogue), son lexique et ses documents produits. C'est à ce niveau que sont donnés les **rôles** : on peut être approbateur dans un espace et sans rôle dans un autre.

### Les rôles

| Rôle | Portée | Peut… |
|---|---|---|
| **super-admin** | tous les espaces | tout, y compris créer des espaces, ouvrir un espace à un domaine, écrire dans la bibliothèque partagée |
| **admin** | un espace | gérer les membres, supprimer une entrée du catalogue, plus tout ce que fait l'approbateur |
| **approbateur** | un espace | publier, écrire dans le catalogue et le lexique, consulter l'historique, plus tout ce que fait le curateur |
| **curateur** | un espace | modifier le programme et les documents en brouillon, produire des documents |
| *(aucun rôle)* | — | lire les programmes publiés |

Le rôle de **super-admin** ne s'accorde pas par la discussion : il est fixé dans la configuration du serveur, par un développeur.

### Faire entrer quelqu'un

Trois façons, de la plus simple à la plus manuelle.

**Ouvrir l'espace à un domaine** (super-admin). Toute personne qui se connecte **avec Google** avec une adresse de ce domaine reçoit le rôle choisi à sa première connexion.

> « Dans l'espace de travail de notre programme, donne le rôle de curateur à toute personne de notre-organisation.org. »

Seule la connexion Google compte : c'est Google qui garantit que l'adresse appartient bien à la personne. Quelqu'un du même domaine qui crée un compte avec un mot de passe a besoin d'une invitation.

**Inviter par e-mail** (admin). L'invitation est reconnue à la première connexion de la personne avec cette adresse.

> « Invite ana.diallo@exemple.org comme curatrice de cet espace. »

Si la personne a déjà un compte connu, le rôle lui est donné tout de suite ; sinon l'invitation attend. Une invitation se retire : « Retire l'invitation de ana.diallo@exemple.org. »

**Voir qui attend** (super-admin) : « Quels comptes n'ont encore aucun espace de travail ? » Claude liste les personnes connectées sans rôle, les invitations non réclamées et les comptes non confirmés.

### Gérer les membres

> « Liste les membres de cet espace, avec les invitations en attente. »
>
> « Passe Ana Diallo approbatrice. »
>
> « Retire Ana Diallo de cet espace. »

Quelques garde-fous :

- redonner un rôle à un membre **remplace** son rôle actuel ;
- on **ne peut pas retirer le dernier admin** d'un espace : nommez-en un autre d'abord ;
- un admin ne peut pas accorder le rôle de super-admin.

Chaque changement est **immédiat** (pas de brouillon) et **enregistré** dans l'historique de l'espace, que les approbateurs peuvent consulter.

### Créer un espace de travail

Réservé au **super-admin** :

> « Crée un espace de travail “kenya”, affiché “Kenya”. »

L'identifiant est un mot court sans espace. Créer l'espace ne crée **aucun programme** : les programmes s'importent à part (partie 2).

---

## Partie 2 — Ajouter une nouvelle matière

!!! warning "Tâche de développeur"
    Cette partie suppose l'accès au dépôt et aux identifiants du stockage. Les commandes se lancent depuis le dossier `backend/`. La procédure complète, avec ses vérifications, est dans la documentation technique du dépôt (`docs/technical-reference/`) et dans la compétence interne **rollout**.

Ajouter une matière, c'est **un petit fichier de description, puis des données**. Aucun comportement propre à la matière ne s'écrit dans le code : tout ce qui la distingue vit dans son graphe et dans son guide.

1. **Décrire la matière.** Un **profil** (un objet de configuration) dit à l'outil comment lire son graphe : d'où vient l'ordre des éléments, comment se nomment ses regroupements. Il s'ajoute sous `backend/src/adapters/profiles/`, sur le modèle d'un profil existant de même forme, puis s'enregistre dans `backend/src/adapters/index.ts`. Plusieurs matières peuvent partager un profil quand leurs graphes ont la même forme.
2. **Déployer le serveur**, pour qu'il connaisse la nouvelle matière. L'import refuse une matière sans profil.
3. **Importer le graphe de départ** — une enveloppe *Learning Commons* `{ nodes, relationships }` :

    ```bash
    npm run import:kg-store -- <espace> <classe> <matière> <graphe.json>
    ```

    Ajoutez `--dry-run` pour un essai à blanc. Sur un espace **neuf**, l'import crée le programme publié. Sur un programme **déjà en place**, il faut `--replace-published`, qui écrit directement la version publiée ; il est refusé tant qu'un brouillon est ouvert. Le guide de la matière déjà en ligne est conservé, sauf si vous en fournissez un avec `--profile`.

4. **Vérifier** : entrer dans la matière par la discussion, demander un état des lieux, relire le guide.

**Sauvegarder avant toute manipulation** :

```bash
npm run export:kg-store -- <espace> <classe> <matière> [sortie.json]
```

Le fichier produit se réimporte tel quel, pour restaurer ou cloner.

!!! tip "Faire évoluer une matière existante ne demande pas de développeur"
    Le **guide** d'une matière, ses **documents**, ses **mises en forme**, ses **routines** et ses **grilles** se modifient par la discussion, en brouillon, comme le reste du programme. Seul l'ajout d'une matière *nouvelle* passe par le code.
