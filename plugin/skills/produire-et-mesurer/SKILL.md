---
name: produire-et-mesurer
description: Produire un document et vérifier qu'il tient — rendre, compter les pages, resserrer, et ne jamais trancher sur une estimation. À utiliser quand on demande de générer, produire, prévisualiser ou mesurer un document, ou quand on dit « produire le document », « est-ce que ça tient », « combien de pages », « ça déborde ».
---

# Produce, then measure

The rule this whole skill exists to enforce: **render it and count.** Not estimate, not reason about
whether it will fit — produce the artifact and measure the artifact.

## Get the generation inputs

- **`walk_document_section`** for one slot of a document. This is the unit a sheet is produced from,
  and it is the one to prefer. It hands you the section's own text, the curriculum it covers, the
  routine that applies, and every formatter on its path.
- **Read the shared parts once.** The formatters, the document's assembly guide and the routine are
  identical for every section of a document, and together they are about fifteen times the section's
  own text. Read the **first** section of a document in full (follow `nextCursor` until the formatter
  stack is complete); read **every later** section with `include:[]`, adding `'curriculum'` only when
  it covers something you have not read yet. A ten-section lesson read the default way is roughly
  400k tokens of input; read this way it is roughly 40k, with nothing lost — and the formatter rules
  you read first are still in memory when you compose the tenth section.
- **`walk_graph`** when what the section covers is a grouping rather than a single lesson: the
  section names the curriculum it covers, not everything underneath it. Read that subtree with ONE
  walk from its id — `session-autorat` carries the depth discipline — never by descending into it
  call by call.
- **`walk_document`** for a whole document's `sections` spine — but a large document will not fit
  in one response: it sheds the formatters too, tells you so, and points you back at the per-section
  read. Believe it; do not retry, and do not count on it for the formatters.
- **`preview_generation`** when the material should reflect an unpublished draft. Preview the
  **smallest piece you changed** — after editing one section, preview that section, not its document.

Everything about how the sheet must look comes from the **formatters** in that payload, and
everything about what it must contain from the section's own assembly guidance and the routine.
Read them. Do not lay out a document from memory or from another subject's habits.

## Rendre avec `render_document`

Vous composez la page — quel bandeau, dans quel ordre, où elle tourne — et vous l'envoyez comme
**arbre de blocs**. Le serveur la met en page. La géométrie ne vous appartient pas : un bloc nomme
un `style`, une image nomme un `role`, et c'est le formatter qui dit à quoi cela ressemble. L'arbre
ne porte donc **aucune couleur, aucun corps, aucun centimètre** — si vous cherchez où mettre une
couleur, c'est que vous vous trompez de moitié.

Sa forme est dans `get_capabilities section:'document'`. Lisez-la avant de composer : une clé
inventée est REFUSÉE, et rien n'est rendu tant que l'arbre n'est pas valide.

Deux options qui comptent :

- **`translateInto`** — le serveur dérive la langue cible de celle que porte l'arbre, adossé au
  glossaire de l'espace de travail, et sort un fichier par langue. **Quelle langue produire est
  déclaré par la mise en forme du document** (`language.variants`) : lisez-la, ne la devinez pas et
  ne l'écrivez jamais en dur — un autre document en livre une autre. Un arbre qui porte déjà la
  langue cible est laissé tel quel : on ne retraduit jamais ce qu'un auteur a écrit à la main.
- **`measure:true`** — il met la page en page et **compte les pages**. Le compte se fait sur le
  RENDU, jamais sur la lecture du guide : une estimation a déjà donné 2,5 pages pour un document
  qui en faisait onze. Là où le déploiement n'a pas de moteur de mise en page, il répond
  `available:false` — il ne devine pas.

**Ce que cette route ne peut pas faire.** `render_document` veut chaque image **en clair dans
l'appel**, encodée en base64 ; une référence à un fichier déjà déposé est REFUSÉE
(« document.media.0: Unrecognized key(s) »). Un document qui porte de vraies illustrations — quelques
mégaoctets — ne passe donc pas par là : il est composé par le producteur local, puis déposé avec
**`create_upload_url`**. `render_document` sert les pages dont les images sont légères ou absentes.
Dans les deux cas, le compte de pages se mesure sur le RENDU, jamais sur une lecture du guide.

## Mesurer, c'est déléguer

**MESURER, C'EST APPELER `mesureur`.** Le fil principal ne rend pas un PDF lui-même et ne
regarde pas une page pour compter. Les seuils ne s'écrivent pas dans l'agent : ils se lisent
dans le `render` du formatter rendu par `walk_document_section` — `budget.maxPages`,
`budget.reserveBottomCm`, `budget.linesPerPage`, `page.marginsCm`, `type` — et se passent
dans l'appel. Un agent qui connaîtrait ces valeurs les figerait ; un curateur doit pouvoir
les changer dans la mise en forme et voir la mesure suivre.

L'appel type :

    Mesure ces fichiers : <chemins>.
    Budget lu dans la mise en forme (render.budget) : maxPages=…, type.family=…,
    reserveBottomCm=…, linesPerPage=…, maxCharsPerLine=…, maxCharsBesideImage=…
    Page attendue : <format, marges, police, interligne>.
    Rends le tableau et la liste des dépassements. Aucune image.

## La police déclarée doit être présente, sinon le compte est faux

Tout le budget est exprimé dans la police que la mise en forme déclare — `type.family`,
`type.sizePt`, `type.leadingPt`, et le nombre de lignes et de caractères qui en découlent.
Si cette police est absente du poste qui rend, LibreOffice lui en substitue une autre **en
silence** ; elle n'a pas la même largeur, et le compte de pages part à la hausse. Un document
qui tenait se mesure alors une page trop long — et on le resserre pour rien. C'est le même
piège que « mesurer le rendu, pas le guide » : le nombre a l'air d'une mesure, mais il décrit
un document que personne ne recevra.

Donc `type.family` fait partie des seuils qu'on lit dans le `render` et qu'on passe à
`mesureur`, au même titre que `maxPages`. Et `mesureur` le vérifie **sur le PDF produit** —
les polices réellement intégrées au fichier, pas ce que le système croit qu'il utiliserait,
car les deux divergent — et refuse de rendre un chiffre si la police déclarée n'y est pas.
Ne pas pouvoir vérifier est aussi un refus : si l'outil qui lit les polices du PDF manque sur
le poste, on le dit et on l'installe avant de mesurer, on ne devine pas. Un compte pris sans
la bonne police n'est pas un résultat.

## When a sheet overflows

**Render it again with no images at all, and count.** The cause is usually text, and stripping the
images tells you that in one measurement instead of an afternoon of guesses.

Then tighten in this order — smallest change that could work, remeasured each time:

1. text (the usual culprit),
2. spacing and layout knobs the formatter allows,
3. images,
4. content — and only with the expert's agreement, because dropping content is a pedagogical
   decision and not yours.

**Never arbitrate on an estimate.** If you cannot measure it, say that you cannot measure it and ask
for the render, rather than reporting a judgement as a result.

## Check the artifact, not the specification

The two most expensive rendering bugs in this project were both invisible to any check of the spec —
a page size that silently defaulted to the wrong standard, and a spacing setting that cropped
full-width images to a few millimetres. Both were found by looking at a rendered page.

Regarder la page reste donc nécessaire — mais c'est un **jugement, pas une mesure** : la lisibilité
d'un bandeau, une image flottante qui rogne un titre. Cela revient à **`relecteur`**, une seule fois,
sur le rendu final. Le fil principal n'ouvre pas les images d'une page pour compter : compter, c'est
`mesureur`, et lui ne remonte que des nombres.

Rends compte de ce que tu as mesuré, et de comment tu l'as mesuré.

## Preview output is segregated — keep it that way

A preview `.docx` goes through **`create_preview_upload_url`** only. Never `create_upload_url`, and
never `log_generation`: those write to the canonical bucket and the generation history, and a
preview recorded there becomes indistinguishable from a real deliverable.
