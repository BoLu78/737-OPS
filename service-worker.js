const APP_VERSION = "3.4";
// Keep this equal to the production PWA's original computed app ID.
const PWA_ID = "/737-OPS/?v=3.4";
const CACHE_PREFIX = "737-ops-v";
// Increment this revision whenever this worker or its shell changes without an app version bump.
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-r1`;
const STAGING_CACHE_NAME = `${CACHE_NAME}-staging`;
const APP_SHELL_URL = `./?v=${APP_VERSION}`;
const APP_SCRIPT_URL = `./app.js?v=${APP_VERSION}`;
const APP_MANIFEST_URL = `./manifest.json?v=${APP_VERSION}`;
const PRECACHE_URLS = [
  APP_SHELL_URL,
  APP_SCRIPT_URL,
  APP_MANIFEST_URL,
  "./assets/tripinfo-logo-neos.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
let cacheRepairPromise = null;

async function validatePrecache(cache) {
  const [shellResponse, scriptResponse, manifestResponse] = await Promise.all([
    cache.match(APP_SHELL_URL),
    cache.match(APP_SCRIPT_URL),
    cache.match(APP_MANIFEST_URL),
  ]);

  if (!shellResponse || !scriptResponse || !manifestResponse) {
    throw new Error("Required app shell files are missing from the staged cache.");
  }

  const [shellText, scriptText, manifest] = await Promise.all([
    shellResponse.text(),
    scriptResponse.text(),
    manifestResponse.json(),
  ]);

  const shellVersionMatches =
    shellText.includes(`<meta name="app-version" content="${APP_VERSION}">`)
    && shellText.includes(`src="app.js?v=${APP_VERSION}"`);
  const scriptVersionMatches =
    scriptText.includes(`const APP_VERSION = "${APP_VERSION}";`);
  const manifestVersionMatches =
    manifest.version === APP_VERSION
    && manifest.start_url === `./?v=${APP_VERSION}`
    && manifest.id === PWA_ID
    && manifest.scope === "./";

  if (!shellVersionMatches || !scriptVersionMatches || !manifestVersionMatches) {
    throw new Error("App shell version validation failed.");
  }
}

async function copyStagedCache(stagingCache) {
  const releaseCache = await caches.open(CACHE_NAME);

  for (const url of PRECACHE_URLS) {
    const response = await stagingCache.match(url);

    if (!response) {
      throw new Error(`Staged response is missing for ${url}`);
    }

    await releaseCache.put(url, response);
  }
}

async function precacheAppShell() {
  try {
    await caches.delete(STAGING_CACHE_NAME);
  } catch (error) {
    console.warn("737 OPS stale staging cache cleanup failed:", error);
  }

  const stagingCache = await caches.open(STAGING_CACHE_NAME);
  const requests = PRECACHE_URLS.map(
    (url) => new Request(url, { cache: "reload" })
  );

  try {
    await stagingCache.addAll(requests);
    await validatePrecache(stagingCache);
    await copyStagedCache(stagingCache);
  } finally {
    try {
      await caches.delete(STAGING_CACHE_NAME);
    } catch (error) {
      console.warn("737 OPS staging cache cleanup failed:", error);
    }
  }
}

async function matchReleaseCache(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(request);
  } catch (error) {
    console.error("737 OPS cache read failed:", error);
    return null;
  }
}

async function inspectReleaseCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const responses = await Promise.all(
      PRECACHE_URLS.map((url) => cache.match(url))
    );
    const shellResponse = responses[PRECACHE_URLS.indexOf(APP_SHELL_URL)];
    const scriptResponse = responses[PRECACHE_URLS.indexOf(APP_SCRIPT_URL)];

    return {
      shell: shellResponse && scriptResponse ? shellResponse : null,
      complete: responses.every(Boolean),
    };
  } catch (error) {
    console.error("737 OPS release cache validation failed:", error);
    return {
      shell: null,
      complete: false,
    };
  }
}

function repairReleaseCache() {
  if (!cacheRepairPromise) {
    cacheRepairPromise = precacheAppShell().finally(() => {
      cacheRepairPromise = null;
    });
  }

  return cacheRepairPromise;
}

function createRecoveryResponse(error) {
  console.error("737 OPS offline shell unavailable:", error);

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#f3efe4">
    <title>737 OPS</title>
    <style>
      body { margin: 0; padding: 24px; background: #f3efe4; color: #101827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 520px; margin: 0 auto; }
      button { min-height: 48px; border: 0; border-radius: 12px; padding: 12px 18px; background: #163b57; color: #fff; font: inherit; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>737 OPS</h1>
      <p>The application could not start. Check the connection and try again.</p>
      <button type="button" onclick="window.location.reload()">Reload Application</button>
    </main>
  </body>
</html>`,
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

async function respondToNavigation(request, cachedShellPromise) {
  const cachedShell = await cachedShellPromise;

  if (cachedShell) {
    return cachedShell;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      return networkResponse;
    }

    return createRecoveryResponse(
      new Error(
        `Navigation failed with status ${
          networkResponse ? networkResponse.status : "unknown"
        }.`
      )
    );
  } catch (error) {
    return createRecoveryResponse(error);
  }
}

async function respondToAsset(request) {
  const cachedResponse = await matchReleaseCache(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheAppShell();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (cacheName) =>
              cacheName.startsWith(CACHE_PREFIX)
              && cacheName !== CACHE_NAME
          )
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }

  const requestUrl = new URL(request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    const cacheStatePromise = inspectReleaseCache();
    event.respondWith(
      respondToNavigation(
        request,
        cacheStatePromise.then((cacheState) => cacheState.shell)
      )
    );
    event.waitUntil(
      cacheStatePromise.then((cacheState) => {
        if (cacheState.complete) {
          return;
        }

        return repairReleaseCache().catch((error) => {
          console.error("737 OPS background cache repair failed:", error);
        });
      })
    );
    return;
  }

  event.respondWith(respondToAsset(request));
});
