/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("message", (ev) => {
        if (!ev.data) {
            return;
        } else if (ev.data.type === "deregister") {
            self.registration
                .unregister()
                .then(() => {
                    return self.clients.matchAll();
                })
                .then(clients => {
                    clients.forEach((client) => client.navigate(client.url));
                });
        } else if (ev.data.type === "coepCredentialless") {
            coepCredentialless = ev.data.value;
        }
    });

    self.addEventListener("fetch", function (event) {
        const r = event.request;
        if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
            return;
        }

        const request = (coepCredentialless && r.mode === "no-cors")
            ? new Request(r, {
                credentials: "omit",
            })
            : r;
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy",
                        coepCredentialless ? "credentialless" : "require-corp"
                    );
                    if (!coepCredentialless) {
                        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                    }
                    newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => {
                    console.error(e);
                    throw e;
                })
        );
    });
} else {
    (() => {
        const reloadedKey = "coiReloaded";
        const script = document.currentScript;
        const coepCredentialless = script && script.hasAttribute("data-coep-credentialless");

        if (window.crossOriginIsolated) {
            // Already cross-origin isolated
            console.log("Cross-Origin Isolation is active via headers.");
        } else if (window.crossOriginIsolated === false && "serviceWorker" in navigator) {
            navigator.serviceWorker.register(window.document.currentScript.src).then((registration) => {
                console.log("COI Service Worker registered with scope: ", registration.scope);

                registration.addEventListener("updatefound", () => {
                    if (navigator.serviceWorker.controller) {
                        console.log("New Service Worker version found. Reloading...");
                        window.location.reload();
                    }
                });

                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: "coepCredentialless",
                        value: coepCredentialless,
                    });
                    
                    if (!sessionStorage.getItem(reloadedKey)) {
                        sessionStorage.setItem(reloadedKey, "true");
                        console.log("Service Worker active. Reloading page to apply COOP/COEP headers...");
                        window.location.reload();
                    }
                }
            }).catch((err) => {
                console.error("COI Service Worker registration failed: ", err);
            });
        }
    })();
}
