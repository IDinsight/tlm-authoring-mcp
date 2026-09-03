# The formatter's declarative half — `properties.render`

**Status:** Live (schema + authoring-time validation). The renderer that consumes it does not exist
yet — see "What this does not do" below.

## The problem

A `FormatterSpec`'s `content` is prose: *« En-tête, bandeaux et couleurs »*, *« Une séance par
page »*. That prose is load-bearing — it is what the authoring model reads, and it says things only
a sentence can say (*« un bandeau ne se sépare pas de ce qu'il annonce »*). But no program can read
it and produce a page.

So a formatter gets a second, **declarative** half beside the prose, in the same `properties` bag
every other raw LC property uses. `content` is unchanged.

## The line: geometry, not structure

This is the decision that matters, and it corrects the roadmap that proposed this work.

**`render` carries geometry and style** — page size, margins, type, the fill of a banner, how wide a
bullet may run, where a page break is carried, which line prefixes print, how the languages are laid
out, what yields when a page overflows. These are constant across every sheet a formatter governs,
and a renderer needs them as *values*.

**`render` does not carry structure** — which blocks appear, in what order, and where a particular
lesson breaks its page. On the live CI-maths graph that is **2–8 KB of authored French per lesson**,
on each `DocumentSection`'s own `metadata.assemblyGuide`: *« la rupture de page tombe après JE
RETIENS »* is a per-lesson instruction, not a formatter knob. There are hundreds of them.

The roadmap assumed a declarative bag would be enough to drive a renderer. It is not, and building
on that assumption would have been discovered at golden-file time. What `render` does is supply the
geometry a model cannot invent (A4, 12 pt, 0.68 cm per line, 72 characters) while the section's prose
supplies the structure a schema cannot hold.

## Shape

Nine optional groups: `page`, `type`, `budget`, `blocks`, `images`, `pagination`, `visibility`,
`language`, `overflow`. Schema and validation in
[`kg-recipes/render-spec.ts`](../../backend/src/kg-recipes/render-spec.ts).

Two properties of the schema are deliberate and in tension, so both are worth stating:

- **Everything is optional.** Silence means "this formatter does not govern that", never zero. It is
  also what lets a caller amend one knob — `{"render.budget.maxCharsPerLine": 68}` — without
  restating the whole formatter, since the bag merges nested.
- **Unknown keys are refused.** A typo in a declarative bag is invisible at authoring time and
  silently ignored at render time; the page then comes out wrong with nothing to point at. Refusing
  it at `edit_nodes` / `add_nodes` time is the whole reason to validate at all.

Because everything is optional, the few genuine "if you say A you must say B" rules cannot be
expressed as types. They are checked separately, and only for a whole-object write: an `inline`
language layout needs a `separator`, a `per-file` one needs every variant routable, an `overflow`
block needs a `policy`.

## Two knobs that are not in the roadmap's list, and why

- **`budget`** — the measured page economy: lines per page, line height, maximum characters per
  bullet. These are *measured on a render*, never computed: the CI-maths figures were recalculated
  from PDFs after a computed budget proved a third too optimistic. A renderer that derives them from
  `type` will repeat that error, so they are declared.
- **`overflow`** — what gives when a page will not hold its content. This is a knob rather than a
  constant precisely because the two live formatters answer it **differently**: CI maths tightens the
  text until the sheet fits (*« c'est le texte qui cède »*), CE1 reading lets it run on rather than
  compress (*« la lisibilité prime sur l'économie de pages »*). Both refuse to move the geometry,
  which `neverAdjust` states as a value.

## One knob reshaped

The roadmap modelled language as `L1 { colour, lang }`, `L2 { colour, lang }` and a separator. That
fits CE1 reading and **cannot express CI maths**, which produces *two separate files* from one
source: black lines print in both, red French only in the French file, blue Wolof only in the Wolof
file. So the schema carries a `strategy` (`inline` | `per-file` | `monolingual`) and an open list of
variants, which holds both shapes and a third besides.

## Acceptance

The roadmap's test — both live formatters expressible, no key private to one of them, no free-text
escape hatch — is a test, not a claim:
[`render-spec.test.ts`](../../backend/src/kg-recipes/__tests__/render-spec.test.ts) transcribes the
CI-maths teacher sheet and the CE1 bilingual session sheet from their own prose and asserts both
validate, that six groups are common ground, and that the values which differ are exactly the ones
that make these knobs rather than constants.

## What this does not do

It does not render anything. `generate_document` and `measure_document` do not exist, and building
them needs a decision that has not been made: port the existing Python to Node, or ship Python
alongside the server. Nothing here depends on that choice — the schema was written from the two
formatters' prose, not from any renderer's API.

It also does not check `content` prose against `render` values. Where both are machine-readable —
leading, page size, character limits — they can contradict each other silently. That check belongs
to `lint_content` (WP5).
