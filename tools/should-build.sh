#!/bin/bash
# Vercel "Ignored Build Step" — decides whether THIS client's site needs
# rebuilding for the commit that was just pushed.
#
#   Settings → Git → Ignored Build Step:   bash tools/should-build.sh
#
#   exit 1 → build        exit 0 → skip
#   (Vercel's convention, and yes, it reads backwards.)
#
# Without this, every project watching this repo rebuilds on every push: fix one
# client's typo and you redeploy all of them, which is most of the reason we gave
# each client their own project in the first place.
#
# It is deliberately fail-safe. Anything it cannot work out with certainty —
# no CLIENT, unreadable history, a shallow clone that hides the base commit —
# ends in a build. Skipping a deploy that was needed is far worse than running
# one that wasn't.

set -u
build()  { echo "→ building: $1"; exit 1; }
skip()   { echo "→ skipping: $1"; exit 0; }

[ -n "${CLIENT:-}" ] || build "no CLIENT set, so nothing to narrow by"

CLIENT_DIR="clients/$CLIENT"
[ -d "$CLIENT_DIR" ] || build "clients/$CLIENT not found — let the build fail loudly"

# Which theme this client uses, so a change to it triggers a rebuild here.
THEME=$(sed -n 's/.*"theme"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CLIENT_DIR/client.json" | head -1)
[ -n "$THEME" ] || build "could not read the theme out of $CLIENT_DIR/client.json"

# What this site is actually made of. Everything else in the repo is irrelevant
# to it — other clients, other themes, docs, source clips.
WATCH=(
  "$CLIENT_DIR"
  "themes/$THEME"
  "engine"
  "tools"
  "vercel.json"
  "package.json"
)

# Base commit to compare against. VERCEL_GIT_PREVIOUS_SHA is the last commit
# Vercel built for this project, which is exactly right across a multi-commit
# push; HEAD^ is the fallback for a single commit.
BASE="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$BASE" ] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  git cat-file -e "HEAD^{commit}" 2>/dev/null || build "no history to compare (shallow clone)"
  BASE="HEAD^"
fi

CHANGED=$(git diff --name-only "$BASE" HEAD -- "${WATCH[@]}" 2>/dev/null) \
  || build "git diff failed — not going to guess"

if [ -n "$CHANGED" ]; then
  echo "changed:"; echo "$CHANGED" | sed 's/^/  /'
  build "$CLIENT depends on the above"
fi

skip "nothing $CLIENT depends on changed since $BASE"
