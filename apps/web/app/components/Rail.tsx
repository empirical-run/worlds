import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useMatches } from "react-router";

import type { RootData } from "../root";

export type RailIndexLink = { id: string; label: string };
export type RailIndexGroup = { heading?: string; links: RailIndexLink[] };
export type RailHandle = {
  railIndex?: (data: unknown) => RailIndexGroup[];
  numberedRailIndex?: boolean;
};

export function Rail({ account }: { account: RootData["account"] }) {
  const matches = useMatches();
  const { pathname, key: locationKey } = useLocation();
  const leaf = matches[matches.length - 1];
  const handle = leaf?.handle as RailHandle | undefined;
  const railIndex = handle?.railIndex?.(leaf?.loaderData);
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => setSheetOpen(false), [locationKey]);
  useEffect(() => {
    if (!sheetOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [sheetOpen]);
  return (
    <aside id="rail" className="rail" data-sheet={sheetOpen ? "open" : undefined}>
      <div className="rail-top">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="18" height="18" />
          Worlds
        </a>
        <button
          className="rail-toggle"
          type="button"
          aria-expanded={sheetOpen}
          aria-controls="rail"
          aria-label={sheetOpen ? "Close menu" : "Open menu"}
          onClick={() => setSheetOpen((open) => !open)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {sheetOpen ? <path d="M5 5l10 10M15 5L5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
          </svg>
        </button>
      </div>
      <nav aria-label="Main">
        <NavLink prefetch="intent" className="rail-link rail-home" to="/" end>
          Home
        </NavLink>
        <NavLink prefetch="intent" className="rail-link" to="/docs">
          Docs
        </NavLink>
        {pathname.startsWith("/docs") && (
          <>
            <NavLink prefetch="intent" className="rail-link rail-sublink" to="/docs" end>
              Getting started
            </NavLink>
            <NavLink prefetch="intent" className="rail-link rail-sublink" to="/docs/api">
              API reference
            </NavLink>
          </>
        )}
        {account ? (
          <>
            <p className="rail-heading rail-team-heading" title={account.team.name}>
              {account.team.name}
            </p>
            <NavLink className="rail-link" to="/worlds">
              Worlds
            </NavLink>
            <NavLink className="rail-link" to="/settings">
              Settings
            </NavLink>
          </>
        ) : (
          <NavLink className="rail-link" to="/account">
            Sign in
          </NavLink>
        )}
      </nav>
      {railIndex && (
        <RailIndex
          groups={railIndex}
          numbered={handle?.numberedRailIndex ?? false}
          onNavigate={() => setSheetOpen(false)}
        />
      )}
      {account ? (
        <RailAccountMenu account={account} />
      ) : (
        <div className="rail-foot">
          <BuiltBy />
          <a className="rail-foot-link" href="/privacy">
            Privacy policy
          </a>
        </div>
      )}
    </aside>
  );
}

function BuiltBy() {
  return (
    <span>
      Built by <a href="https://empirical.run">Empirical</a>
    </span>
  );
}

function RailAccountMenu({ account }: { account: NonNullable<RootData["account"]> }) {
  const name = account.user.name ?? account.user.email;
  const menu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="rail-foot rail-account" ref={menu}>
      <summary className="rail-user" aria-label={`Account menu: ${name}`}>
        {account.user.picture ? (
          <img
            className="avatar"
            src={account.user.picture}
            alt=""
            width="28"
            height="28"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="avatar" aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="rail-user-text">
          <span className="rail-user-name">{name}</span>
          <span className="rail-user-email">{account.user.email}</span>
        </span>
      </summary>
      <div className="rail-menu">
        <NavLink className="rail-menu-item" to="/account">
          Account
        </NavLink>
        <a className="rail-menu-item" href="/privacy">
          Privacy policy
        </a>
        <form method="post" action="/auth/sign-out">
          <button className="rail-menu-item" type="submit">
            Sign out
          </button>
        </form>
        <div className="rail-menu-built-by">
          <BuiltBy />
        </div>
      </div>
    </details>
  );
}

function RailIndex({
  groups,
  numbered,
  onNavigate,
}: {
  groups: RailIndexGroup[];
  numbered: boolean;
  onNavigate: () => void;
}) {
  const ids = groups.flatMap((group) => group.links.map((link) => link.id));
  const active = useActiveSection(ids);
  return (
    <nav className="rail-index" aria-label="On this page">
      {!groups[0]?.heading && <p className="rail-heading">On this page</p>}
      {groups.map((group, index) => (
        <div className="rail-group" key={group.heading ?? index}>
          {group.heading && <p className="rail-heading rail-subheading">{group.heading}</p>}
          {group.links.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              aria-current={link.id === active ? "location" : undefined}
              onClick={onNavigate}
            >
              {numbered && (
                <span className="num">{String(ids.indexOf(link.id) + 1).padStart(2, "0")}</span>
              )}
              {link.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

const ACTIVE_SECTION_VIEWPORT_FRACTION = 0.25;

function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(" ");
  useEffect(() => {
    const sectionIds = key.split(" ");
    let frame = 0;
    const update = () => {
      frame = 0;
      const sections = sectionIds.flatMap((id) => document.getElementById(id) ?? []);
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const hashed = sections.find((section) => `#${section.id}` === window.location.hash);
      if (atBottom && hashed && hashed.getBoundingClientRect().top < window.innerHeight) {
        setActive(hashed.id);
        return;
      }
      const passed = sections.filter(
        (section) =>
          section.getBoundingClientRect().top <=
          window.innerHeight * ACTIVE_SECTION_VIEWPORT_FRACTION,
      );
      const current = atBottom ? sections.at(-1) : passed.at(-1);
      setActive(current?.id ?? null);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("hashchange", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("hashchange", schedule);
    };
  }, [key]);
  return active;
}
