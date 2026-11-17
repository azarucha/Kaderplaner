# Kickbase-Proxy für die Web-App

Seit November 2026 beantwortet `api.kickbase.com` Browser-Anfragen nur noch, wenn sie
von `https://play.kickbase.com` kommen (CORS). Die Web-App auf GitHub Pages kommt
deshalb nicht mehr direkt an die Daten. Die iPhone-App (Scriptable) ist nicht
betroffen, sie lädt die Daten nativ.

Der Worker in `worker.js` reicht die Aufrufe der Web-App an Kickbase weiter: nur von
`https://azarucha.github.io`, nur `/v4/...`, nur GET und den Login. Er speichert und
loggt nichts. Login-Daten und Token laufen dabei durch den Worker, also durch das
eigene Cloudflare-Konto.

## Einrichten

1. Kostenloses Konto bei Cloudflare, dann im Projektordner:

   ```bash
   npx wrangler login
   npx wrangler deploy --config proxy/wrangler.toml
   ```

   Wrangler gibt die Adresse aus, z. B. `https://kaderplaner-proxy.<konto>.workers.dev`.

2. Im GitHub-Repo unter Settings → Secrets and variables → Actions → Variables eine
   Variable `KP_API_BASE` mit dem Wert `https://kaderplaner-proxy.<konto>.workers.dev/v4`
   anlegen.

3. Den Pages-Workflow neu starten (Actions → „Web-App auf GitHub Pages“ → Run workflow).
   `build.mjs` schreibt die Adresse dann in die Web-App.

Lokal braucht es keinen Worker: `npm run demo` startet `tools/devserver.mjs`, der unter
`http://localhost:8787/kb/v4/...` dasselbe macht.
