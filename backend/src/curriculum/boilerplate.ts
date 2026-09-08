/*
 * The repeated sentences a document writes once and calls by reference.
 *
 * WHY THIS EXISTS. On the live ci/maths guide, one sentence about putting a
 * finger on the right image existed in EIGHT different wordings across nine
 * sheets — one of them broken mid-sentence. They were not deliberate variants;
 * they were copies that drifted. The fix was to write each sentence once and
 * have the guides call it, so correcting it in one place corrects every document
 * that calls it. This module is what resolves those calls.
 *
 * WHAT IS GENERIC HERE, AND WHAT DELIBERATELY IS NOT.
 *
 * A reference is `{key:ID}` — a brace, a namespace, an id. That is a SYNTAX, and
 * syntax is fair to encode. Everything else about these tables is one subject's
 * convention and is read from the data instead:
 *
 *   • The NAMESPACE is not enumerated. ci/maths uses `pt` for its sentences and
 *     `img` for its pictures; another document uses neither. Whatever keys the
 *     prose actually references are the keys this returns.
 *
 *   • The ID SHAPE is DERIVED from the references in use, not declared. Seeing
 *     `{pt:PT-01}` teaches it that this document's sentence ids read `PT-` then
 *     digits, which is what lets it find definitions nobody referenced. Encoding
 *     /^PT-\d+/ would have been one subject's rule in a generic module.
 *
 *   • The FIELDS of a definition are NOT parsed apart. ci/maths writes
 *     "PT-01 · phase 2 · « … » · — · imprimée." and the brief asked for
 *     `applies-to` and `default-state` as named fields — but their order and
 *     their separator are that document's format, stated in that document's own
 *     prose. Naming them here would encode it. The whole definition line comes
 *     back verbatim instead, and the model reading it reads French.
 *
 * The one thing worth encoding beyond the reference syntax is QUOTATION MARKS,
 * because a definition's payload is the wording it quotes and every convention
 * for that is a quotation mark of some kind.
 *
 * TWO SHAPES THAT ARE NOT CALLS, both of which the live prose writes:
 *
 *   • A TEMPLATE. Prose explaining the convention writes `{pt:<numéro>}` or
 *     `{img:…}`. Read naively these are calls to sentences named "<numéro>" and
 *     "…", and reporting them as undefined is crying wolf on the very paragraph
 *     that documents the feature. An id that is ITSELF a placeholder is a
 *     template — a generic test, since a real id never is one.
 *
 *   • A CALL WITH AN ARGUMENT. `{pt:PT-04 ▲}` and `{pt:PT-04 ⟨repère⟩}` both call
 *     PT-04, whose wording leaves `⟨repère⟩` to be filled; the rest of the token
 *     is what fills it. The id is the FIRST word and the remainder is the
 *     argument — which is also how a definition line names itself, so the two
 *     halves agree by construction rather than by coincidence.
 */

/** One repeated sentence: what was written once, and everywhere it is called. */
export type Boilerplate = {
  /** The id as the prose writes it, e.g. "PT-01". */
  id: string;
  /** The reference namespace it was called through, e.g. "pt". */
  key: string;
  /** The wording, taken from the quotation marks on its definition line. */
  text: string | null;
  /**
   * The whole definition line, verbatim.
   *
   * A caller needs the fields this module refuses to parse apart — which phases
   * it applies to, whether it prints by default — and they are all on this line.
   */
  definition: string;
  /** Tokens inside `text` a caller must substitute before printing. */
  placeholders: string[];
  /**
   * The distinct arguments call sites supplied, e.g. "▲" for `{pt:PT-04 ▲}`.
   *
   * Empty when every call is bare. A sentence with a placeholder and no argument
   * anywhere is a page waiting to print `⟨repère⟩` in clear.
   */
  arguments: string[];
  /** The node whose prose defines it. */
  definedIn: string;
  /** Every node whose prose calls it, in the order found. */
  referencedBy: string[];
};

/**
 * A reference with no definition, or a definition nobody calls.
 *
 * Both are errors and both are silent in production: an unresolved reference
 * prints as `{pt:PT-07}` in clear on a teacher's page, and an orphaned
 * definition is a sentence someone maintains that no document uses.
 */
export type BoilerplateProblem = {
  kind: "undefined-reference" | "unused-definition";
  id: string;
  key: string;
  /** For an undefined reference, who calls it; for an unused one, who defines it. */
  where: string[];
  message: string;
};

export type BoilerplateTable = {
  entries: Boilerplate[];
  problems: BoilerplateProblem[];
  /** The namespaces actually in use, derived from the prose. */
  keys: string[];
  /**
   * References skipped as syntax documentation rather than calls.
   *
   * Reported rather than dropped: if a real call ever lands here, the way to
   * notice is that it is listed, not that a page came out wrong.
   */
  templates: string[];
};

/** A chunk of authored prose, and the node it came from. */
export type ProseSource = { nodeId: string; text: string };

// `{key:ID}`. The id runs to the closing brace, so a placeholder written inside
// a referenced sentence (`{img:⟨repère⟩}`) is matched as its own reference and
// reported honestly rather than silently swallowed.
const REFERENCE = /\{([a-zA-Z][\w-]*):([^{}]{1,80})\}/g;

// « » first, because a French document nests " " inside it. Longest match wins,
// which is why these are tried in order rather than combined.
const QUOTED = [/«\s*([^»]{1,2000})\s*»/g, /“([^”]{1,2000})”/g, /"([^"]{1,2000})"/g];

// A placeholder is a token left inside a quoted sentence for the caller to fill:
// `{img:…}` (a picture to place) or `⟨…⟩` (a value that varies by lesson).
const PLACEHOLDER = /\{[^{}]{1,80}\}|⟨[^⟩]{1,80}⟩/g;

/**
 * Turn an observed id into a pattern matching its siblings.
 *
 * "PT-01" becomes /^PT-\d+/ — every digit run generalised, everything else kept
 * literal and escaped. This is how a definition NOBODY references is found: the
 * shape comes from the ids that are referenced, so it is the document's own
 * convention rather than one written into this file.
 */
function idPattern(id: string): RegExp {
  const source = id
    .split(/(\d+)/)
    .map((part, index) => (index % 2 === 1 ? "\\d+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${source}\\b`);
}

/** The longest quoted span on a line, under whichever quotation marks it uses. */
function quotedText(line: string): string | null {
  let longest: string | null = null;
  for (const pattern of QUOTED) {
    for (const match of line.matchAll(pattern)) {
      const value = match[1].trim();
      if (value && (longest === null || value.length > longest.length)) {
        longest = value;
      }
    }
  }
  return longest;
}

/** A token that is wholly a placeholder is a slot to fill, never a name. */
const isPlaceholder = (token: string) =>
  /^(?:\{.*\}|⟨.*⟩|<.*>|…|\.\.\.)$/.test(token);

type Reference = { key: string; nodes: string[]; args: string[] };

/**
 * Every `{key:ID}` call in a body of prose, plus the templates that are not
 * calls.
 *
 * The id is the first word of the payload and anything after it is the argument
 * that call site supplies, so `{pt:PT-04 ▲}` and a bare `{pt:PT-04}` are read as
 * the same sentence — which they are.
 */
function referencesIn(sources: ProseSource[]): {
  calls: Map<string, Reference>;
  templates: string[];
} {
  const calls = new Map<string, Reference>();
  const templates = new Set<string>();

  for (const source of sources) {
    for (const match of source.text.matchAll(REFERENCE)) {
      const [whole, key, payload] = match;
      const trimmed = payload.trim();
      // Test the WHOLE payload first: a placeholder may be several words
      // ("⟨pictogramme de la section⟩"), and splitting before recognising it
      // leaves "⟨pictogramme" looking like an id nobody defined.
      if (!trimmed || isPlaceholder(trimmed)) {
        templates.add(whole);
        continue;
      }
      const [id, ...rest] = trimmed.split(/\s+/);
      const existing = calls.get(id) ?? { key, nodes: [], args: [] };
      if (!existing.nodes.includes(source.nodeId)) existing.nodes.push(source.nodeId);
      const argument = rest.join(" ").trim();
      if (argument && !existing.args.includes(argument)) existing.args.push(argument);
      calls.set(id, existing);
    }
  }
  return { calls, templates: [...templates].sort() };
}

/**
 * Resolve a document's repeated sentences.
 *
 * `referenceSources` is the prose that CALLS them — a document's sections and
 * their assembly guidance. `definitionSources` is the prose that WRITES them,
 * which is the document's formatter stack. They overlap in practice (a formatter
 * both defines sentences and references pictures) and passing the same prose as
 * both is fine.
 *
 * A document with no references at all gets an empty table and no problems. That
 * is the common case — only one of the two live Senegal subjects uses this at
 * all — so it must be silence, not a complaint.
 */
export function resolveBoilerplate(
  referenceSources: ProseSource[],
  definitionSources: ProseSource[],
): BoilerplateTable {
  const { calls: references, templates } = referencesIn(referenceSources);
  const entries: Boilerplate[] = [];
  const problems: BoilerplateProblem[] = [];

  // Definition lines, by the id they open with. A line "PT-01 · phase 2 · « … »"
  // defines PT-01; the id must OPEN the line, or a sentence merely mentioning
  // PT-01 in passing would be read as defining it.
  const definitionLines: Array<{ nodeId: string; id: string; line: string }> = [];
  const patterns = [...new Set([...references.keys()].map((id) => idPattern(id).source))]
    .map((source) => new RegExp(source));

  for (const source of definitionSources) {
    for (const rawLine of source.text.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/^[•\-*]\s*/, "");
      if (!patterns.some((pattern) => pattern.test(line))) continue;
      const id = line.split(/[\s·]/)[0].trim();
      definitionLines.push({ nodeId: source.nodeId, id, line });
    }
  }

  const defined = new Map(definitionLines.map((entry) => [entry.id, entry]));

  for (const [id, { key, nodes, args }] of references) {
    const definition = defined.get(id);
    if (!definition) {
      // A placeholder inside a referenced sentence is a reference by syntax but
      // never a defined one; saying so is the point, since it is exactly what
      // would print in clear on the page.
      problems.push({
        kind: "undefined-reference", id, key, where: nodes,
        message: `'{${key}:${id}}' is called but never written down. It will print in clear unless it is defined in this document's formatter stack, or the call is removed.`,
      });
      continue;
    }
    const text = quotedText(definition.line);
    entries.push({
      id, key, text,
      definition: definition.line,
      placeholders: text ? [...new Set(text.match(PLACEHOLDER) ?? [])] : [],
      arguments: args,
      definedIn: definition.nodeId,
      referencedBy: nodes,
    });
  }

  for (const { id, nodeId } of definitionLines) {
    if (references.has(id)) continue;
    problems.push({
      kind: "unused-definition", id, key: "",
      where: [nodeId],
      message: `'${id}' is written down but nothing calls it. Either a document should reference it, or it is dead wording that will drift out of step with what is printed.`,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return {
    entries, problems, templates,
    keys: [...new Set([...references.values()].map((reference) => reference.key))].sort(),
  };
}
