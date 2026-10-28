#!/usr/bin/env bash
# Sincroniza variáveis Firebase (e Google Drive client id) de .env.local para o projeto Vercel.
# Uso:
#   cd web && npx vercel login
#   VERCEL_PROJECT=brain2 ./scripts/sync-firebase-env-vercel.sh
# Opcional: VERCEL_ORG=team-slug se o projeto estiver num team.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.local}"
PROJECT="${VERCEL_PROJECT:-brain2}"

vercel_cli() {
  if [[ -n "${VERCEL_ORG:-}" ]]; then
    npx vercel@latest "$@" --scope "$VERCEL_ORG"
  else
    npx vercel@latest "$@"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Ficheiro não encontrado: $ENV_FILE" >&2
  exit 1
fi

if ! vercel_cli whoami >/dev/null 2>&1; then
  echo "Não autenticado no Vercel. Corra: npx vercel login" >&2
  exit 1
fi

read_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^["'\''"]//;s/["'\''"]$//'
}

KEYS=(
  NEXT_PUBLIC_FIREBASE_API_KEY
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  NEXT_PUBLIC_FIREBASE_PROJECT_ID
  NEXT_PUBLIC_FIREBASE_APP_ID
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
  NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID
)

upsert() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "— ignorado (vazio): $name"
    return 0
  fi
  for env in production preview development; do
    if vercel_cli env ls "$name" -p "$PROJECT" 2>/dev/null | grep -q "$env"; then
      vercel_cli env update "$name" --environment "$env" --value "$value" -y -p "$PROJECT"
    else
      vercel_cli env add "$name" --environment "$env" --value "$value" --force --yes -p "$PROJECT"
    fi
  done
  echo "✓ $name"
}

echo "Projeto Vercel: $PROJECT"
echo "Origem: $ENV_FILE"
echo ""

for key in "${KEYS[@]}"; do
  val="$(read_env "$key" || true)"
  upsert "$key" "$val"
done

echo ""
echo "Concluído. Faça redeploy para aplicar (Production):"
echo "  cd web && npx vercel --prod -p $PROJECT ${VERCEL_ORG:+--scope $VERCEL_ORG}"
