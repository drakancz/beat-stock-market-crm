# Denní plánovač (krok 3A, 4. 10. 2026) — malá služba na Railway, která
# jednou denně zavolá POST /api/planovac.
#
# Je ve vlastní složce, protože služba na Railway má Root Directory
# `/planovac` a najde tu jediný Dockerfile (CLAUDE.md, oddíl Denní
# plánovač). Z repozitáře nic nekopíruje.
#
# Klíč PLANOVAC_KEY a adresa aplikace PLANOVAC_URL jsou proměnné služby
# na Railway; do obrazu se nic tajného nedostane. Obraz běží pod
# neprivilegovaným uživatelem `curl_user`.
FROM curlimages/curl:8.22.0

# --fail: chyba aplikace (401, 500) = neúspěšný běh, Railway ho ukáže.
# --retry: aplikace se na Railway uspává, první probuzení může vrátit 502.
CMD ["sh", "-c", "curl --fail --silent --show-error --max-time 120 --retry 5 --retry-all-errors --retry-delay 15 -X POST -H \"Authorization: Bearer ${PLANOVAC_KEY}\" \"${PLANOVAC_URL%/}/api/planovac\""]
