# Sourced by tools/ops/deploy-identity.sh: the two pure text checks behind
# its --remove-default-editor step (ADR
# docs/architecture/decisions/2026-11-19-functions-runtime-identity.md, I6).
# They read what a gcloud listing printed and run nothing themselves, so
# tools/verify/ops/ops-scripts.spec.mjs tests them on fixed text, with no
# --apply run.

# Prints one line, «name (account)», for each function in a listing of
# `name<TAB>account` lines (`gcloud functions list
# --format='value(name.basename(),serviceConfig.serviceAccountEmail)'`)
# that runs as an account other than $2. A function with no account counts
# as another account. Prints nothing when every function runs as $2.
functions_off_account() {
  printf '%s\n' "$1" | awk -F'\t' -v want="$2" '
    NF > 0 && $2 != want { print $1 " (" ($2 == "" ? "no account" : $2) ")" }
  '
}

# Whether a policy listing of `role<TAB>member` lines (`get-iam-policy
# --flatten='bindings[].members' --format='value(bindings.role,bindings.members)'`)
# holds the member $3 in the role $2, by an exact line match.
policy_holds() {
  printf '%s\n' "$1" | grep -Fxq -- "$2"$'\t'"$3"
}
