import { useEffect, useState } from "react";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_CHECK_GAP_MS = 30 * 1000;

declare global {
  interface Window {
    __reactRouterManifest?: { version: string };
  }
}

let stale = false;
let hydrated = false;
let lastCheckAt = 0;

async function isNewDeployLive() {
  if (stale) {
    return true;
  }
  const ownVersion = window.__reactRouterManifest?.version;
  if (!ownVersion || import.meta.env.DEV) {
    return false;
  }
  lastCheckAt = Date.now();
  try {
    const response = await fetch("/__version", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    stale = (await response.text()) !== ownVersion;
  } catch {
    return false;
  }
  if (stale) {
    window.addEventListener("click", loadLinkInFull, true);
  }
  return stale;
}

export function watchForNewDeploys() {
  const check = () => {
    if (document.visibilityState !== "visible" || Date.now() - lastCheckAt < MIN_CHECK_GAP_MS) {
      return;
    }
    void isNewDeployLive();
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
  setInterval(check, CHECK_INTERVAL_MS);
}

export function useMarkHydrated() {
  useEffect(() => {
    hydrated = true;
  }, []);
}

export function useReloadOnNewDeploy(failed: boolean) {
  const [checking, setChecking] = useState(() => failed && hydrated);
  useEffect(() => {
    if (!checking) {
      return;
    }
    void isNewDeployLive().then((isNew) => {
      if (isNew) {
        window.location.reload();
      } else {
        setChecking(false);
      }
    });
  }, [checking]);
  return checking;
}

function loadLinkInFull(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.target instanceof Element)
  ) {
    return;
  }
  const anchor = event.target.closest("a[href]");
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    (anchor.target && anchor.target !== "_self") ||
    anchor.hasAttribute("download")
  ) {
    return;
  }
  const url = new URL(anchor.href);
  const samePage =
    url.pathname === window.location.pathname && url.search === window.location.search;
  if (url.origin !== window.location.origin || samePage) {
    return;
  }
  event.stopPropagation();
}
