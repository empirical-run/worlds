import type { ReactNode } from "react";
import { NavLink, useMatches } from "react-router";
import type { RootData } from "../root";

export type RailHandle = { railIndex?: (data: unknown) => ReactNode };

export function Rail({ account }: { account: RootData["account"] }) {
  const matches = useMatches();
  const leaf = matches[matches.length - 1];
  const railIndex = (leaf?.handle as RailHandle | undefined)?.railIndex?.(leaf?.loaderData);
  return (
    <aside className="rail">
      <a className="brand" href="/">
        <img src="/favicon.svg" alt="" width="18" height="18" />
        Worlds
      </a>
      <nav aria-label="Main">
        <NavLink className="rail-link" to="/" end>
          Home
        </NavLink>
        <NavLink className="rail-link" to="/docs">
          Docs
        </NavLink>
        <NavLink className="rail-link" to="/account">
          Account
        </NavLink>
      </nav>
      {account && <RailAccount account={account} />}
      {railIndex}
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
    <div className="rail-account">
      <a className="rail-user" href="/account">
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
      </a>
      <a className="rail-team" href="/account#team">
        <span className="rail-heading">Team</span>
        <span className="rail-team-name">{account.team.name}</span>
      </a>
    </div>
  );
}

export function RailIndex({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="rail-index">
      <p className="rail-heading">{heading}</p>
      {children}
    </div>
  );
}
