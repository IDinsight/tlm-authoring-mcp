#!/usr/bin/env sh
# Fail if a pedagogical rule has leaked into a procedure file.
#
# Skills and commands carry PROCEDURE. Rules live in the graph and are fetched at
# runtime (get_graph_guide, list_catalog, the document's formatter and rubrics).
# A rule written down here is a fourth copy that goes stale silently.
#
# The tokens below mark subject content: a line length, a drawing convention, a
# printed prefix, an answer marker, a typeface. This grep cannot tell a rule from
# an example — that judgement is a human's, and the answer should be that the file
# contains neither.
#
# Usage:  ./check-no-rules.sh        (from the plugin directory)
set -eu

# One subject's rule, written into a procedure file, is invisible until someone
# points the plugin at a different subject. These are the tokens that leaked
# before: a measured line length, a page budget, a typeface, a printed prefix,
# an answer marker, a phase name, a boilerplate id, an image-name fragment, and
# the vocabulary of one document type ("fiche", "séance"). A second subject calls
# its documents something else.
TOKENS='\b(72|88|47)\b|2 pages|boucle|\[N\]|X/O|Andika|[Ww]olof|\[WO\]|séance|fiche|phase 9|PT-0|amorce|nf-|tf-'
SEARCH_IN='skills commands agents'

# Run from the wrong directory this used to find nothing and print OK — the same
# lie a regression test tells when its corpus has moved. Missing paths are fatal.
for dir in $SEARCH_IN; do
  if [ ! -d "$dir" ]; then
    echo "check-no-rules: '$dir' not found — run this from the plugin directory." >&2
    exit 2
  fi
done

hits=$(grep -rnE "$TOKENS" $SEARCH_IN 2>/dev/null || true)

if [ -z "$hits" ]; then
  echo "OK — no subject rules found in $SEARCH_IN"
  exit 0
fi

echo "Possible pedagogical rules in procedure files:"
echo
echo "$hits"
echo
echo "Each hit needs a human's judgement. A rule is a defect; so is an example that"
echo "reads as one. Fetch it at runtime instead — get_graph_guide, list_catalog, the"
echo "document's formatter, its rubrics."
exit 1
