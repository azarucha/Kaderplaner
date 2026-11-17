// Kaderplaner - Kickbase-Proxy als Cloudflare Worker.
// Kickbase erlaubt Browser-Anfragen (CORS) seit November 2026 nur noch von
// play.kickbase.com. Die Web-App auf GitHub Pages schickt ihre Aufrufe deshalb
// hierher, der Worker reicht sie ohne Origin an api.kickbase.com weiter.
//
// Regeln: nur Aufrufe von ALLOWED_ORIGINS, nur /v4/..., nur GET und der
// Login-POST. Es wird nichts gespeichert oder geloggt.
//
// Einrichten: siehe proxy/README.md

const UPSTREAM = "https://api.kickbase.com";
const ALLOWED_ORIGINS = ["https://azarucha.github.io"];
const FORWARD_HEADERS = ["authorization", "content-type", "accept"];

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response("forbidden", { status: 403 });
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    const isLogin = request.method === "POST" && url.pathname === "/v4/user/login";
    if (!url.pathname.startsWith("/v4/") || !(request.method === "GET" || isLogin)) {
      return new Response("not allowed", { status: 405, headers: cors });
    }

    const headers = new Headers();
    for (const h of FORWARD_HEADERS) {
      const v = request.headers.get(h);
      if (v) headers.set(h, v);
    }
    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers,
        body: isLogin ? await request.text() : undefined,
      });
    } catch (e) {
      return new Response("upstream error", { status: 502, headers: cors });
    }
    const out = new Headers(cors);
    out.set("Content-Type", upstream.headers.get("Content-Type") || "application/json");
    out.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
