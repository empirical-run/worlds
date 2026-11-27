import { useEffect, useState } from "react";
import { NavLink, useLocation, useMatches } from "react-router";
import type { RootData } from "../root";

export type RailIndexLink = { id: string; label: string };
export type RailIndexGroup = { heading?: string; links: RailIndexLink[] };
export type RailHandle = { railIndex?: (data: unknown) => RailIndexGroup[]; numberedRailIndex?: boolean };

export function Rail({ account }: { account: RootData["account"] }) {
  const matches = useMatches();
  const { pathname } = useLocation();
  const leaf = matches[matches.length - 1];
  const handle = leaf?.handle as RailHandle | undefined;
  const railIndex = handle?.railIndex?.(leaf?.loaderData);
  return (
    <aside className="rail">
      <a className="brand" href="/">
        <img src="/favicon.svg" alt="" width="18" height="18" />
        Worlds
      </a>
      <nav aria-label="Main">
        <NavLink className="rail-link rail-home" to="/" end>
          Home
        </NavLink>
        <NavLink className="rail-link" to="/docs">
          Docs
        </NavLink>
        {pathname.startsWith("/docs") && (
          <>
            <NavLink className="rail-link rail-sublink" to="/docs" end>
              Getting started
            </NavLink>
            <NavLink className="rail-link rail-sublink" to="/docs/api">
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
      {account && <RailAccount account={account} />}
      {railIndex && <RailIndex groups={railIndex} numbered={handle?.numberedRailIndex ?? false} />}
      <div className="rail-foot">
        <span>
          Built by <a href="https://empirical.run">Empirical</a>
        </span>
        <a className="rail-foot-link" href="/privacy">
          Privacy policy
        </a>
      </div>
    </aside>
  );
}

function RailAccount({ account }: { account: NonNullable<RootData["account"]> }) {
  const name = account.user.name ?? account.user.email;
  return (
    <NavLink className="rail-user" to="/account" aria-label={`Account: ${name}`}>
      {account.user.picture ? (
        <img className="avatar" src={account.user.picture} alt="" width="28" height="28" referrerPolicy="no-referrer" />
      ) : (
        <span className="avatar" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="rail-user-text">
        <span className="rail-user-name">{name}</span>
        <span className="rail-user-email">{account.user.email}</span>
      </span>
    </NavLink>
  );
}

function RailIndex({ groups, numbered }: { groups: RailIndexGroup[]; numbered: boolean }) {
  const ids = groups.flatMap((group) => group.links.map((link) => link.id));
  const active = useActiveSection(ids);
  let position = 0;
  return (
    <nav className="rail-index" aria-label="On this page">
      {!groups[0]?.heading && <p className="rail-heading">On this page</p>}
      {groups.map((group, index) => (
        <div className="rail-group" key={group.heading ?? index}>
          {group.heading && <p className="rail-heading rail-subheading">{group.heading}</p>}
          {group.links.map((link) => {
            position += 1;
            return (
              <a key={link.id} href={`#${link.id}`} aria-current={link.id === active ? "location" : undefined}>
                {numbered && <span className="num">{String(position).padStart(2, "0")}</span>}
                {link.label}
              </a>
            );
          })}
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
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const hashed = sections.find((section) => `#${section.id}` === window.location.hash);
      if (atBottom && hashed && hashed.getBoundingClientRect().top < window.innerHeight) {
        setActive(hashed.id);
        return;
      }
      const passed = sections.filter((section) => section.getBoundingClientRect().top <= window.innerHeight * ACTIVE_SECTION_VIEWPORT_FRACTION);
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
