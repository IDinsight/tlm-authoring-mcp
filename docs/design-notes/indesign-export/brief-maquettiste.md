# Brief maquettiste — transformer le pilote en gabarit

**Pour :** la personne qui met en page le livre de l'élève dans InDesign.
**À partir de :** `Pilote Maths OE 3 1 à 10.indd`.
**À rendre :** un gabarit, `gabarit-eleve`, et la leçon 1 refaite dessus (détail en fin de brief).

## Pourquoi

Aujourd'hui, chaque consigne et chaque image du livre est saisie ou placée à la main, à partir de ce
que les experts ont écrit ailleurs. Nous voulons que le serveur produise directement un fichier
InDesign, avec les bons textes et les bonnes images déjà en place, dans **votre** mise en page. Vous
n'auriez plus qu'à finir la page et exporter le PDF d'impression.

Pour cela, le programme doit savoir **comment s'appelle chaque élément** de votre page. Aujourd'hui,
presque tout est mis en forme à la main : le fichier ne contient qu'un seul style de paragraphe
(`puces`). Le programme ne peut pas deviner qu'un texte en Andika corps 14 blanc sur fond orange est
le titre de la leçon. Il faut que ce soit écrit dans un style qui porte ce nom.

Rien ne change dans le dessin de la page. On donne des noms à ce qui existe déjà.

## Ce qu'il faut faire

### 1. Les styles de paragraphe

Créez un style de paragraphe pour chaque sorte de texte, **avec exactement ces noms**, en minuscules
et avec les tirets :

| Nom du style | Ce que c'est | Exemple dans le pilote (leçon 1) |
|---|---|---|
| `numero-lecon` | Le numéro dans l'onglet | « Lesoŋ 1 » |
| `titre-lecon` | Le titre dans le bandeau | « MA DEFAR TE JËMMAL AY MBOOLE » |
| `question-orale` | Les questions du début, à côté de la grande image | « Lan ngeen gis ci pañe bu mag bi ? » |
| `directive` | La consigne d'un exercice, à côté de ★ ▲ ■ ● ♥ ☾ | « Ban ci nataal yi mooy wone mboolem orãas yi ? » |
| `evaluation` | La consigne dans l'encadré rouge du bas | « Xoolal bu baax mboole meññeef yi… » |
| `etiquette` | Les petits mots sous les images | « Bari », « Tuuti », « Dara » |
| `pied-de-page` | Le texte en bas de page | « Pilote Approche Enseignement explicite… » |

S'il existe une autre sorte de texte que nous n'avons pas vue, créez-lui un style et notez-le (voir
« Questions » plus bas).

**Un groupe de styles par domaine.** Dans InDesign, un style a une couleur fixe : il ne peut pas
prendre celle de la page. Les styles qui changent de couleur selon le domaine se rangent donc dans un
**groupe de styles par domaine**, avec les mêmes noms dans chaque groupe : `AN/titre-lecon`,
`GEO/titre-lecon`, `MESURE/titre-lecon`, `RP/titre-lecon`. Le programme choisit le groupe d'après le
domaine de la leçon. Un style qui reste identique partout (une consigne en noir, par exemple) se crée
une seule fois, hors de tout groupe.

Puis **appliquez ces styles aux pages du pilote** et retirez les mises en forme locales. Dans le
panneau Styles de paragraphe, aucun nom ne doit garder le petit « + » qui signale une retouche à la
main.

### 2. Les styles d'objet pour les images

Une image est dimensionnée et habillée par son style d'objet. Créez :

| Nom du style d'objet | Ce que c'est |
|---|---|
| `amorce` | La grande image du début de leçon |
| `bande` | Une rangée d'images d'un exercice. Elle arrive **en une seule image**, cases et signes ☒ ◯ ⊖ compris |
| `je-retiens` | L'image de l'encadré rose « je retiens » |
| `picto-section` | Les pictogrammes de la marge gauche (tableau, lecture, crayon, ampoule, évaluation) |
| `repere` | Les formes devant les consignes : ★ ▲ ■ ● ♥ ☾ |

### 3. Le style de tableau

Créez un style de tableau `encadre` pour les encadrés de couleur (le rose « je retiens », le rouge de
l'évaluation). Si les deux doivent rester différents, créez `encadre` et `encadre-evaluation`.

### 4. Les couleurs

Une seule couleur porte un nom aujourd'hui (`Activite Numerique`). Les autres sont des valeurs CMJN
brutes. Donnez un nom à la couleur de chaque domaine, par exemple :

- `Activite Numerique`
- `Geometrie`
- `Mesure`
- `Resolution de problemes`

### 5. Les gabarits (pages types)

Les 7 gabarits existants sont très bien : `A-AN`, `B-Géo`, `C-Mesure`, `D-RP`, `E-INT AN`,
`F-INT GEO`, `A-Gabarit`. Gardez ces noms.

### 6. Les blocs nommés

Sur une page modèle, nommez trois blocs dans le panneau **Calques** :

- `numero-lecon` : le bloc de l'onglet « Lesoŋ 1 » ;
- `titre-lecon` : le bloc du titre ;
- `corps` : **un seul grand bloc de texte** qui occupe la zone de la page sous le bandeau.

C'est le changement le plus important. Aujourd'hui, chaque consigne est un bloc séparé, posé à la
main. Le programme, lui, écrit tout le contenu de la leçon **à la suite**, dans `corps` : les
consignes, puis les images ancrées dans le texte, puis les encadrés sous forme de tableaux. Ainsi,
quand une consigne s'allonge, InDesign pousse le reste vers le bas tout seul, comme dans Word.

### 7. Les images : liées, pas incorporées

97 images sont incorporées dans le fichier. C'est pour cela qu'il pèse 111 Mo. Dans le panneau
**Liens**, désincorporez-les (*Désincorporer le lien*) vers le dossier `Links`. Le programme fournira
ses images de la même façon, dans un dossier `Links` à côté du fichier.

## Ce qu'on vous demande de rendre

1. **Le gabarit**, enregistré en `gabarit-eleve.indt` et exporté en `gabarit-eleve.idml`
   (*Fichier › Exporter › InDesign Markup (IDML)*). Il contient les styles, les couleurs, les
   gabarits et la page modèle avec ses trois blocs nommés.
2. **La leçon 1 refaite sur ce gabarit** : tout son contenu dans le bloc `corps`, avec les styles
   ci-dessus et sans aucune retouche locale. Il est normal que cela vous demande de revoir comment
   l'encadré rose et les rangées d'images sont construits. Si un élément refuse vraiment d'entrer
   dans le flux, laissez-le en bloc libre et signalez-le.
3. **Un dossier de livraison** (*Fichier › Assemblage*) qui contient les deux fichiers, les
   images et les polices.

Le pilote d'origine reste tel quel : travaillez sur une copie.

## Ce qui est déjà décidé

- **Une leçon tient sur une page**, comme dans votre pilote.
- **Une rangée d'images arrive en une seule image**, signes ☒ ◯ ⊖ compris. Vous la déplacez d'un
  bloc. Si vous constatez que vous retouchez souvent une case seule, dites-le : on pourra fournir les
  cases séparément plus tard.
- **Un groupe de styles par domaine** pour tout ce qui change de couleur (voir la partie 1).

## Questions pour vous

Répondez dans un court message, cela nous aide à écrire le programme :

1. **L'encadré « je retiens »** : le composez-vous toujours à la main, fruit par fruit ? Ou une seule
   image fournie vous conviendrait-elle ?
2. **Les polices** : Andika partout pour le texte de l'élève ? À quoi servent Advert-Bold et Minion
   Pro ?
3. **Une sorte de texte ou d'image que nous aurions oubliée** dans les tableaux ci-dessus ?
