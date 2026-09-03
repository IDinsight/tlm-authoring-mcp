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
# It is OPT-IN because it is not free: LibreOffice and the fonts add roughly
# half a gigabyte to the image and several seconds to a cold start, and every
# other tool works without them. Build with --build-arg WITH_LAYOUT_ENGINE=1 to
# enable `render_document`'s `measure:true`; without it that call reports
# `available:false` and the render itself is unaffected.
#
# ANDIKA IS PART OF THE MEASUREMENT, not a nicety. It is a literacy face with an
# unusually generous natural leading, and substituting another changes glyph
# advances, which changes line counts, which changes the page count this exists
# to report. fonts-sil-andika ships it; pin the image if the version matters.
ARG WITH_LAYOUT_ENGINE=0
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
# Static per-subject assets (the terminology glossary fallback). The KG itself
# lives only in Firestore now; test fixtures are not shipped in the image.
COPY assets ./assets
EXPOSE 8080
CMD ["node", "dist/http.js"]
