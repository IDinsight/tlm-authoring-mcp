FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:22-slim

# Page counting needs a LAYOUT ENGINE, because a page count is measured on the
# render and never estimated from the source — an estimate once put a document
# at 2.5 pages that rendered at eleven.
#
# It is NOT free: MEASURED at 149 MB (108 -> 257 MB) plus several seconds of
# cold start, and every other tool works without it. It was opt-in (default 0)
# for as long as it bought nothing — no formatter carried a `render` bag, so
# `render_document` could not lay a page out at all, let alone count one.
#
# DEFAULT IS NOW 1, because that changed: the CI-maths teacher-sheet formatter
# carries the gabarit's geometry, so the measurement path is reachable and
# `budget.maxPages: 2` can finally produce a verdict instead of a shrug. The ARG
# stays the switch — build with --build-arg WITH_LAYOUT_ENGINE=0 for a lean
# image, and `measure:true` then reports `available:false` rather than guessing
# (the render itself is unaffected either way).
#
# NOTE ON THE DEPLOY PATH: .github/workflows/deploy.yml deploys with
# `gcloud run deploy --source backend`, which builds through Cloud Build and has
# nowhere to pass --build-arg. So for the deployed service this DEFAULT is the
# only switch there is; changing it here is what turns measuring on in production.
#
# VERIFIED 2026-09-03 on this recipe: the CI-maths teacher sheets came out at
# their documented page count on A4. That run reported nineteen pages over ten
# lessons; the corpus now on disk is lessons 11-20 and every one of its ten
# French sheets is two pages (twenty total, counted from the PDFs on
# 2026-09-07), so that run measured a set that is no longer present. Treat the
# recipe as verified and the page figures as describing the older corpus.
#
# ANDIKA IS PART OF THE MEASUREMENT, not a nicety. It is a literacy face with an
# unusually generous natural leading, and substituting another changes glyph
# advances, which changes line counts, which changes the page count this exists
# to report. fonts-sil-andika ships it; pin the image if the version matters.
ARG WITH_LAYOUT_ENGINE=1
RUN if [ "$WITH_LAYOUT_ENGINE" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-writer poppler-utils fonts-sil-andika \
      && rm -rf /var/lib/apt/lists/*; \
    fi

WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# NOTE: assets/ is deliberately NOT copied. Everything under it is SEED data —
# the GRAPH_GUIDE.md a namespace is created from — and nothing reads it at
# runtime: the server takes the guide from the store's config cell, the graph
# from the store, and the glossary from the workspace's `_glossary` namespace.
# Shipping it would put a stale second copy of the guide next to the running
# server, which is exactly how one gets mistaken for the source of truth.
EXPOSE 8080
CMD ["node", "dist/http.js"]
