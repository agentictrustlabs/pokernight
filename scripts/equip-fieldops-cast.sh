#!/usr/bin/env bash
# EQUIP THE CHARTERED CAST — after `charter-cast.mts --cast demo/fieldops-cast.json` has written
# ~/agenticprimitives/demo/fieldops-cast.faithnet.json, give every persona what a part needs:
#   1. the skills on its card (fieldops.act, fieldops.consult)   — add-mystery-skills.mts --game fieldops
#   2. a vault                                                   — activate-cast-vaults.mts
#   3. its archetype (north-<part>, context field-operations)    — assign-org-archetype.mts
# and print the FIELDOPS_CAST line for apps/tables/wrangler.toml. Idempotent: every estate script skips what stands.
#   bash scripts/equip-fieldops-cast.sh [--only <role>]
set -u
AP="$HOME/agenticprimitives"
NOTE="$AP/demo/fieldops-cast.faithnet.json"
ONLY="${2:-}"
[ -f "$NOTE" ] || { echo "no $NOTE — charter the cast first"; exit 1; }
cd "$AP"
# THE VAULTS, ONCE FOR THE WHOLE NOTE: the script's one-persona form leaves the address empty and fails.
NOTE="$NOTE" npx tsx scripts/activate-cast-vaults.mts 2>&1 | tail -2
LINE=""
while IFS=$'\t' read -r role name sa custodian; do
  [ -n "$ONLY" ] && [ "$ONLY" != "$role" ] && continue
  echo "── $role · $name ($sa) custodied by $custodian ──"
  npx tsx scripts/add-mystery-skills.mts --as "$name" --by "$custodian" --game fieldops 2>&1 | tail -2
  CONTEXT=field-operations ARCHETYPE="north-$role" npx tsx scripts/assign-org-archetype.mts "$custodian" "$sa" 2>&1 | tail -2
  LINE="${LINE:+$LINE,}$role=$name@$custodian"
done < <(node -e "const n=require('$NOTE'); for (const c of n.cast ?? []) console.log([c.role,c.name,c.sa,c.custodian].join('\t'))")
echo
echo "FIELDOPS_CAST = \"$LINE\""
