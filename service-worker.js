const APP_VERSION = "4.0";
const PWA_ID = "/737-OPS/";
const CACHE_PREFIX = "737-ops-v";
// Bump this for every worker or shell change made without an APP_VERSION change.
const CACHE_REVISION = "r1";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-${CACHE_REVISION}`;
const STAGING_CACHE_NAME = `${CACHE_NAME}-staging`;
const RELEASE_MARKER_URL = "./__737_ops_release_ready__";
const FALLBACK_CACHE_PARAM = "__737_fallback";
const APP_SHELL_URL = "./";
const APP_SCRIPT_URL = "./app.js";
const APP_MANIFEST_URL = "./manifest.json";
const PRECACHE_URLS = [
  APP_SHELL_URL,
  APP_SCRIPT_URL,
  APP_MANIFEST_URL,
  "./assets/tripinfo-logo-neos.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const PNG_URLS = [
  "./assets/tripinfo-logo-neos.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let backgroundMaintenancePromise = null;
let previousReleaseCacheNamesPromise = null;
let usablePreviousReleasePromise = null;

function createReleaseMarkerResponse() {
  return new Response(CACHE_NAME, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

async function hasValidReleaseMarker(cacheName) {
  const marker = await caches.match(RELEASE_MARKER_URL, { cacheName });
  return Boolean(marker && await marker.text() === CACHE_NAME);
}

async function responseIsPng(response) {
  if (!response || !response.ok) {
    return false;
  }

  const contentType = (response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType && contentType !== "image/png") {
    return false;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());

  return (
    bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

async function validatePrecache(cache) {
  const responses = await Promise.all(
    PRECACHE_URLS.map((url) => cache.match(url))
  );

  if (responses.some((response) => !response || !response.ok)) {
    throw new Error("Required app shell files are missing from the staged cache.");
  }

  const responseByUrl = new Map(
    PRECACHE_URLS.map((url, index) => [url, responses[index]])
  );
  const [shellText, scriptText, manifest, pngChecks] = await Promise.all([
    responseByUrl.get(APP_SHELL_URL).text(),
    responseByUrl.get(APP_SCRIPT_URL).text(),
    responseByUrl.get(APP_MANIFEST_URL).json(),
    Promise.all(
      PNG_URLS.map((url) => responseIsPng(responseByUrl.get(url)))
    ),
  ]);

  const shellVersionMatches =
    shellText.includes(`<meta name="app-version" content="${APP_VERSION}">`)
    && shellText.includes('href="manifest.json"')
    && shellText.includes('src="app.js"');
  const scriptVersionMatches =
    scriptText.includes(`const APP_VERSION = "${APP_VERSION}";`);
  const manifestVersionMatches =
    manifest.version === APP_VERSION
    && manifest.start_url === "./"
    && manifest.id === PWA_ID
    && manifest.scope === "./"
    && manifest.display === "standalone";

  if (
    !shellVersionMatches
    || !scriptVersionMatches
    || !manifestVersionMatches
    || pngChecks.some((isValid) => !isValid)
  ) {
    throw new Error("App shell validation failed.");
  }
}

async function downloadReleaseToStaging() {
  await caches.delete(STAGING_CACHE_NAME);
  const stagingCache = await caches.open(STAGING_CACHE_NAME);
  const requests = PRECACHE_URLS.map(
    (url) => new Request(url, {
      cache: "reload",
      credentials: "same-origin",
    })
  );

  try {
    await stagingCache.addAll(requests);
    await validatePrecache(stagingCache);
    return stagingCache;
  } catch (error) {
    await caches.delete(STAGING_CACHE_NAME);
    throw error;
  }
}

async function copyStagedRelease(stagingCache, releaseCache) {
  for (const url of PRECACHE_URLS) {
    const response = await stagingCache.match(url);

    if (!response) {
      throw new Error(`Staged response is missing for ${url}`);
    }

    await releaseCache.put(url, response);
  }

  await releaseCache.put(RELEASE_MARKER_URL, createReleaseMarkerResponse());
}

async function installRelease() {
  if (await hasValidReleaseMarker(CACHE_NAME)) {
    return;
  }

  const stagingCache = await downloadReleaseToStaging();

  try {
    await caches.delete(CACHE_NAME);
    const releaseCache = await caches.open(CACHE_NAME);

    try {
      await copyStagedRelease(stagingCache, releaseCache);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  } finally {
    await caches.delete(STAGING_CACHE_NAME);
  }
}

async function inspectCurrentRelease() {
  const cache = await caches.open(CACHE_NAME);
  const [marker, ...responses] = await Promise.all([
    cache.match(RELEASE_MARKER_URL),
    ...PRECACHE_URLS.map((url) => cache.match(url)),
  ]);
  const markerIsValid = Boolean(marker && await marker.text() === CACHE_NAME);

  return (
    markerIsValid
    && responses.every((response) => response && response.ok)
  );
}

async function repairCurrentRelease() {
  const stagingCache = await downloadReleaseToStaging();

  try {
    const releaseCache = await caches.open(CACHE_NAME);
    await copyStagedRelease(stagingCache, releaseCache);
  } finally {
    await caches.delete(STAGING_CACHE_NAME);
  }
}

function isManagedReleaseCache(cacheName) {
  return (
    cacheName.startsWith(CACHE_PREFIX)
    && !cacheName.endsWith("-staging")
  );
}

function parseReleaseCacheOrder(cacheName) {
  if (!isManagedReleaseCache(cacheName)) {
    return null;
  }

  const releaseName = cacheName.slice(CACHE_PREFIX.length);
  const match = releaseName.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-r(\d+))?$/);

  if (!match) {
    return null;
  }

  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] || 0),
    Number(match[4] || 0),
  ];
}

function compareReleaseCacheOrder(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

function getOlderReleaseCacheNames(cacheNames) {
  const currentReleaseOrder = parseReleaseCacheOrder(CACHE_NAME);

  return cacheNames
    .filter((cacheName) => {
      const releaseOrder = parseReleaseCacheOrder(cacheName);

      return (
        releaseOrder
        && compareReleaseCacheOrder(releaseOrder, currentReleaseOrder) < 0
      );
    })
    .sort((left, right) =>
      compareReleaseCacheOrder(
        parseReleaseCacheOrder(left),
        parseReleaseCacheOrder(right)
      )
    );
}

async function getPreviousReleaseCacheNames() {
  if (!previousReleaseCacheNamesPromise) {
    previousReleaseCacheNamesPromise = caches.keys().then((cacheNames) =>
      getOlderReleaseCacheNames(cacheNames).reverse()
    ).catch((error) => {
      console.warn("737 OPS previous cache lookup failed:", error);
      previousReleaseCacheNamesPromise = null;
      return [];
    });
  }

  return previousReleaseCacheNamesPromise;
}

async function previousReleaseIsUsable(cacheName) {
  const responses = await Promise.all(
    PRECACHE_URLS.map((url) =>
      caches.match(url, {
        cacheName,
        ignoreSearch: true,
      })
    )
  );

  return responses.every((response) => response && response.ok);
}

function getUsablePreviousRelease() {
  if (!usablePreviousReleasePromise) {
    usablePreviousReleasePromise = (async () => {
      const cacheNames = await getPreviousReleaseCacheNames();

      for (const cacheName of cacheNames) {
        try {
          if (await previousReleaseIsUsable(cacheName)) {
            return cacheName;
          }
        } catch (error) {
          console.warn(`737 OPS fallback cache check failed for ${cacheName}:`, error);
        }
      }

      return null;
    })();
  }

  return usablePreviousReleasePromise;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createFallbackShellResponse(response) {
  let shellText = await response.text();

  for (const url of PRECACHE_URLS.slice(1)) {
    const assetPath = url.replace(/^\.\//, "");
    const attributePattern = new RegExp(
      `((?:src|href)=["'])(?:\\./)?${escapeRegExp(assetPath)}(?:\\?[^"']*)?(["'])`,
      "g"
    );
    shellText = shellText.replace(
      attributePattern,
      `$1${assetPath}?${FALLBACK_CACHE_PARAM}=1$2`
    );
  }

  const maintenanceScript = `<script>
    requestAnimationFrame(function () {
      window.setTimeout(function () {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: "APP_READY" });
        }
      }, 0);
    });
  </script>`;
  shellText = shellText.replace("</body>", `${maintenanceScript}\n  </body>`);

  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.set("Content-Type", "text/html; charset=utf-8");

  return new Response(shellText, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function cleanupOldReleaseCaches() {
  const cacheNames = await caches.keys();
  const previousCacheNames = getOlderReleaseCacheNames(cacheNames);
  const currentReleaseOrder = parseReleaseCacheOrder(CACHE_NAME);
  const oldStagingCacheNames = cacheNames.filter((cacheName) => {
    if (
      !cacheName.startsWith(CACHE_PREFIX)
      || !cacheName.endsWith("-staging")
    ) {
      return false;
    }

    const releaseCacheName = cacheName.slice(0, -"-staging".length);
    const releaseOrder = parseReleaseCacheOrder(releaseCacheName);

    return (
      releaseOrder
      && compareReleaseCacheOrder(releaseOrder, currentReleaseOrder) < 0
    );
  });
  let retainedCacheName = null;

  for (const cacheName of [...previousCacheNames].reverse()) {
    if (await previousReleaseIsUsable(cacheName)) {
      retainedCacheName = cacheName;
      break;
    }
  }

  await Promise.all(
    [
      ...previousCacheNames.filter(
        (cacheName) => cacheName !== retainedCacheName
      ),
      ...oldStagingCacheNames,
    ].map((cacheName) => caches.delete(cacheName))
  );
  previousReleaseCacheNamesPromise = null;
  usablePreviousReleasePromise = null;
}

function runBackgroundMaintenance() {
  if (!backgroundMaintenancePromise) {
    backgroundMaintenancePromise = (async () => {
      const releaseIsComplete = await inspectCurrentRelease();

      if (!releaseIsComplete) {
        await repairCurrentRelease();
      }

      await cleanupOldReleaseCaches();
    })().catch((error) => {
      console.warn("737 OPS background cache maintenance failed:", error);
      backgroundMaintenancePromise = null;
    });
  }

  return backgroundMaintenancePromise;
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
      html, body { min-height: 100%; background: #f3efe4; }
      body { margin: 0; padding: 24px; color: #101827; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { max-width: 520px; margin: 0 auto; }
      button { min-height: 48px; border: 0; border-radius: 12px; padding: 12px 18px; background: #163b57; color: #fff; font: inherit; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>737 OPS</h1>
      <p>The installed application is unavailable. Reconnect once, then reload.</p>
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

async function networkResponseIsCurrentShell(response) {
  if (!response || !response.ok) {
    return false;
  }

  const contentType = response.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("text/html")) {
    return false;
  }

  const shellText = await response.clone().text();

  return (
    shellText.includes(`<meta name="app-version" content="${APP_VERSION}">`)
    && shellText.includes('src="app.js"')
  );
}

async function matchNamedRelease(request, cacheName, { ignoreSearch = false } = {}) {
  try {
    return await caches.match(request, {
      cacheName,
      ignoreSearch,
    });
  } catch (error) {
    console.warn(`737 OPS cache read failed for ${cacheName}:`, error);
    return null;
  }
}

function requestIsPrecachedPng(requestUrl) {
  return PNG_URLS.some(
    (url) => new URL(url, self.registration.scope).pathname === requestUrl.pathname
  );
}

async function respondToNavigation(request) {
  const cachedShell = await matchNamedRelease(APP_SHELL_URL, CACHE_NAME);

  if (cachedShell) {
    return cachedShell;
  }

  const fallbackCacheName = await getUsablePreviousRelease();

  if (fallbackCacheName) {
    const previousShell = await matchNamedRelease(
      APP_SHELL_URL,
      fallbackCacheName,
      { ignoreSearch: true }
    );

    if (previousShell) {
      try {
        return await createFallbackShellResponse(previousShell);
      } catch (error) {
        console.warn("737 OPS fallback shell preparation failed:", error);
      }
    }
  }

  try {
    const networkResponse = await fetch(request);

    if (await networkResponseIsCurrentShell(networkResponse)) {
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

async function respondToStaticAsset(request) {
  const requestUrl = new URL(request.url);

  if (requestUrl.searchParams.get(FALLBACK_CACHE_PARAM) === "1") {
    const fallbackCacheName = await getUsablePreviousRelease();

    if (!fallbackCacheName) {
      return Response.error();
    }

    const fallbackResponse = await matchNamedRelease(
      request,
      fallbackCacheName,
      { ignoreSearch: true }
    );

    return fallbackResponse || Response.error();
  }

  const cachedResponse = await matchNamedRelease(request, CACHE_NAME);

  if (cachedResponse) {
    return cachedResponse;
  }

  if (requestIsPrecachedPng(requestUrl)) {
    const fallbackCacheName = await getUsablePreviousRelease();

    if (fallbackCacheName) {
      const fallbackResponse = await matchNamedRelease(
        request,
        fallbackCacheName,
        { ignoreSearch: true }
      );

      if (fallbackResponse) {
        return fallbackResponse;
      }
    }
  }

  try {
    const networkResponse = await fetch(request);

    if (!networkResponse || !networkResponse.ok) {
      return Response.error();
    }

    const contentType = networkResponse.headers.get("Content-Type") || "";

    if (contentType.toLowerCase().includes("text/html")) {
      return Response.error();
    }

    return networkResponse;
  } catch {
    return Response.error();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(installRelease());
});

// Intentionally use the default activation lifecycle. A validated update waits
// until the current app session closes, then takes effect on a later launch.
self.addEventListener("activate", () => {});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "APP_READY") {
    return;
  }

  event.waitUntil(runBackgroundMaintenance());
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
    event.respondWith(respondToNavigation(request));
    return;
  }

  event.respondWith(respondToStaticAsset(request));
});
