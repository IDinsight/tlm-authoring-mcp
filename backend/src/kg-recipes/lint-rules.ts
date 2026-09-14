/*
 * Layer: services · module: kg-recipes · declared lint rules
 *
 * A formatter may carry LINT RULES as data — `properties.lintRules`, a list
 * of "a line that looks like X must also look like Y" — beside its `render`
 * geometry and its `layout` templates. They exist because the same handful
 * of guide defects was re-found and re-arbitrated by hand on every fiche:
 * PT-07 called without its example, « Aujourd'hui, nous allons apprendre à… »
 * prefixed [FR] though it never prints, a RÉPONSE line that runs to a
 * justification, a question in the amorce with no answer in its parenthesis.
 * Each is a question the DATA answers, which is the test a lint rule must
 * pass; but each is also SUBJECT knowledge, which stays out of the code. So
 * the rule is authored on the formatter, one regex and one message, and a
 * curator adds or retires one without a deploy.
 *
 * What a rule reads is what the formatter governs: the assembly guides of
 * the document it is attached to and of every section under it (`guide`),
 * the `content` of the curriculum those sections cover (`content`), or the
 * lines of a composed page checked against that formatter's stack (`page`).
 */
import { z } from "zod";

const regexSource = z.string().min(1).max(300);

export const lintRuleSchema = z.object({
  /** Stable id, reported as `declared:<id>` and silenced by it (metadata.lintIgnore). */
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "lower-case letters, digits and hyphens"),
  where: z.enum(["guide", "content", "page"]),
  /** Only sections whose title matches — a phase, say. Guide and content rules only. */
  sections: regexSource.optional(),
  /** The lines the rule looks at. */
  match: regexSource,
  /** A matched line must ALSO match this, or it is a finding. */
  require: regexSource.optional(),
  /** A matched line must NOT match this, or it is a finding. */
  forbid: regexSource.optional(),
  /** A matched line longer than this is a finding. */
  maxChars: z.number().int().positive().optional(),
  /** Lines to leave alone even when they match — the named exceptions. */
  unless: regexSource.optional(),
  message: z.string().min(1).max(500),
  fix: z.string().min(1).max(500).optional(),
  severity: z.enum(["warning", "info"]).optional(),
}).strict();

export const lintRulesSchema = z.array(lintRuleSchema).min(1).max(100);

export type LintRule = z.infer<typeof lintRuleSchema>;

/** Errors for a `lintRules` value, each prefixed with the tool name. Empty when valid. */
export function validateLintRules(rules: unknown, tool: string): string[] {
  const result = lintRulesSchema.safeParse(rules);
  if (!result.success) {
    return result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? `lintRules.${issue.path.join(".")}` : "lintRules";
      return `${tool}: '${path}' — ${issue.message}`;
    });
  }
  const errors: string[] = [];
  const seen = new Set<string>();
  result.data.forEach((rule, index) => {
    if (seen.has(rule.id)) errors.push(`${tool}: 'lintRules[${index}].id' — '${rule.id}' is used twice; ids are how a finding is silenced, so each must be one rule.`);
    seen.add(rule.id);
    for (const key of ["sections", "match", "require", "forbid", "unless"] as const) {
      const source = rule[key];
      if (source === undefined) continue;
      try { new RegExp(source, "u"); } catch (e) { errors.push(`${tool}: 'lintRules[${index}].${key}' is not a valid regular expression (${(e as Error).message}).`); }
    }
    if (rule.where === "page" && rule.sections) errors.push(`${tool}: 'lintRules[${index}].sections' — a page rule reads the page it is given; it cannot pick sections.`);
  });
  return errors;
}

/**
 * The `lintRules` value in a freeform properties bag. A dotted partial
 * (`lintRules.0`) is refused: the list replaces as a whole, like `layout`.
 */
export function validateLintRulesInBag(properties: Record<string, unknown> | undefined, tool: string): string[] {
  if (!properties) return [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (key === "lintRules") errors.push(...validateLintRules(value, tool));
    else if (key.startsWith("lintRules.")) errors.push(`${tool}: '${key}' — write the whole \`lintRules\` list; it replaces as a whole.`);
  }
  return errors;
}

/** The `lintRules` list off a stored node, wherever the raw envelope keeps it, or null. */
export function lintRulesOf(node: { properties?: Record<string, unknown> }): LintRule[] | null {
  const props = node.properties ?? {};
  const raw = props.raw as Record<string, unknown> | undefined;
  const value = props.lintRules ?? raw?.lintRules;
  const parsed = lintRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * One line against one rule. Null when the line is not the rule's business;
 * a short reason when it is and it breaks the rule.
 */
export function lineBreaks(rule: LintRule, line: string): string | null {
  const flags = "u";
  if (rule.unless && new RegExp(rule.unless, flags).test(line)) return null;
  if (!new RegExp(rule.match, flags).test(line)) return null;
  if (rule.require && !new RegExp(rule.require, flags).test(line)) return `does not match the required /${rule.require}/`;
  if (rule.forbid && new RegExp(rule.forbid, flags).test(line)) return `matches the forbidden /${rule.forbid}/`;
  if (rule.maxChars !== undefined && line.length > rule.maxChars) return `${line.length} characters, over ${rule.maxChars}`;
  // A rule with only `match` says: this line should not exist as it is.
  if (rule.require === undefined && rule.forbid === undefined && rule.maxChars === undefined) return "should not be written like this";
  return null;
}
