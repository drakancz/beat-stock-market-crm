# Obraz pro automatickou zálohu databáze (4. 10. 2026, do vlastní složky
# 5. 11. 2026).
#
# Na Railway z něj běží samostatná plánovaná služba, s aplikací nesdílí nic.
# Je ve vlastní složce stejně jako plánovač: služba má Root Directory
# `/zaloha` a najde tu jediný Dockerfile (Config as Code pro nové služby
# Railway zrušil — docs/funkce/zalohy.md). Proto se kopíruje jen to, co je
# v téhle složce.
#
# Verze Postgresu musí sedět s databází — pg_dump neumí zálohovat
# z novějšího serveru (docs/funkce/zalohy.md).
FROM postgres:18.6-trixie

# aws = nahrávání do úložiště S3 / Cloudflare R2, GnuPG už v obrazu je.
RUN apt-get update \
  && apt-get install -y --no-install-recommends awscli ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY zaloha-automaticka.sh /skripty/

# Ne pod rootem (security_warnings.md, pravidlo 10).
USER postgres
WORKDIR /tmp

CMD ["sh", "/skripty/zaloha-automaticka.sh"]
