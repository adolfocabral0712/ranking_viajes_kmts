function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Método no permitido", {
        status: 405,
        headers: {
          Allow: "GET, HEAD"
        }
      });
    }

    if (url.pathname === "/api/ranking") {
      if (!env.RANKING_JSON_URL) {
        return json(
          {
            error: "Falta configurar el Secret RANKING_JSON_URL."
          },
          503
        );
      }

      let source;

      try {
        source = new URL(env.RANKING_JSON_URL.trim());

        const allowedHosts = [
          "dl.dropbox.com",
          "www.dropbox.com",
          "dropbox.com",
          "dl.dropboxusercontent.com"
        ];

        if (
          source.protocol !== "https:" ||
          !allowedHosts.includes(source.hostname) ||
          source.username ||
          source.password
        ) {
          throw new Error();
        }

        if (
          source.hostname === "www.dropbox.com" ||
          source.hostname === "dropbox.com"
        ) {
          source.hostname = "dl.dropbox.com";
        }

        source.searchParams.set("dl", "1");
      } catch {
        return json(
          {
            error:
              "El Secret debe contener un enlace HTTPS válido de Dropbox."
          },
          503
        );
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90000);

      try {
        const upstream = await fetch(source.toString(), {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache"
          },
          redirect: "follow",
          signal: controller.signal,
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        });

        if (!upstream.ok) {
          return json(
            {
              error: "No se pudo obtener el JSON de origen."
            },
            502
          );
        }

        let data;

        try {
          data = await upstream.json();
        } catch {
          return json(
            {
              error: "El origen no devolvió un JSON válido."
            },
            502
          );
        }

        if (
          data?.version_esquema !== 1 ||
          !Array.isArray(data.datos)
        ) {
          return json(
            {
              error:
                "El JSON no tiene el formato esperado para el ranking."
            },
            502
          );
        }

        const response = json(data);

        if (request.method === "HEAD") {
          return new Response(null, {
            headers: response.headers
          });
        }

        return response;
      } catch {
        const timeout = controller.signal.aborted;

        return json(
          {
            error: timeout
              ? "Se agotó el tiempo de espera al consultar los datos."
              : "No se pudo consultar el origen. Intentá actualizar nuevamente."
          },
          timeout ? 504 : 502
        );
      } finally {
        clearTimeout(timer);
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        {
          error: "Ruta no encontrada."
        },
        404
      );
    }

    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);

    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");

    if (
      (response.headers.get("Content-Type") || "").includes("text/html")
    ) {
      response.headers.set("Cache-Control", "no-store");
    }

    return response;
  }
};
