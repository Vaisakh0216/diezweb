#!/bin/zsh
# API smoke test for EDD v2
B=http://localhost:4000/api
S=$(dirname $0)/../sample_data
tok() { curl -s -XPOST $B/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).token'; }
A="Authorization: Bearer $(tok admin@edd.local admin123)"
SU="Authorization: Bearer $(tok susan@edd.local Welcome@123)"
FI="Authorization: Bearer $(tok firas@edd.local Welcome@123)"
J='Content-Type: application/json'
echo "--- preview DSO"; curl -s -XPOST $B/edd/preview -H "$A" -F file=@$S/DSO_export.xlsx | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); [r.system,r.total,r.needsBu,r.minDate,r.maxDate].join(" ")'
echo "--- upload DSO"; curl -s -XPOST $B/edd/upload -H "$A" -F file=@$S/DSO_export.xlsx -F dateFrom=2026-10-01 -F dateTo=2026-11-07 -F defaultBu=DSO; echo
echo "--- upload DAFZ"; curl -s -XPOST $B/edd/upload -H "$A" -F file=@$S/DAFZ_export.xlsx -F dateFrom=2026-09-01 -F dateTo=2026-11-07; echo
echo "--- upload DCC"; curl -s -XPOST $B/edd/upload -H "$A" -F file=@$S/DCC_export.xlsx -F dateFrom=2025-01-01 -F dateTo=2026-11-07; echo
echo "--- master"; curl -s "$B/edd/master" -H "$A" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(c=>[c.id,c.bu,c.request_no,c.created_date,c.app_type,c.assigned_name||"UNASSIGNED",c.edd_status||"Open"].join(" | ")).join("\n")'
echo "--- susan work"; curl -s "$B/edd/my-cases?tab=work" -H "$SU" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(c=>c.request_no+" "+c.app_type).join("\n")'
ID=$(curl -s "$B/edd/my-cases?tab=work" -H "$SU" | node -pe 'JSON.parse(require("fs").readFileSync(0))[0].id')
echo "--- status without risk (expect error)"; curl -s -XPATCH $B/edd/cases/$ID -H "$SU" -H "$J" -d '{"edd_status":"Requested"}'; echo
echo "--- status with risk"; curl -s -XPATCH $B/edd/cases/$ID -H "$SU" -H "$J" -d '{"risk_rating":"High","root_causes":["PEP","Entity"],"edd_status":"Requested"}' | node -pe 'const c=JSON.parse(require("fs").readFileSync(0)); c.edd_status+" "+c.risk_rating'
echo "--- counts susan"; curl -s "$B/edd/counts" -H "$SU"; echo
echo "--- re-upload DSO (expect resubmitted=1)"; curl -s -XPOST $B/edd/upload -H "$A" -F file=@$S/DSO_export.xlsx -F dateFrom=2026-10-01 -F dateTo=2026-11-07; echo
echo "--- susan work after resubmission"; curl -s "$B/edd/my-cases?tab=work" -H "$SU" | node -pe 'JSON.parse(require("fs").readFileSync(0)).map(c=>c.request_no+" resub="+c.resubmission_count+" new="+c.is_new).join("\n")'
echo "--- resubmitted case can be approved without risk check"; curl -s -XPATCH $B/edd/cases/$ID -H "$SU" -H "$J" -d '{"edd_status":"Approved"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).edd_status'
