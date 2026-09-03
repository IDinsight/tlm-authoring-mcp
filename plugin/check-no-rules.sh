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

TOKENS='72|boucle|\[N\]|X/O|Andika'
SEARCH_IN='skills commands agents'

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
