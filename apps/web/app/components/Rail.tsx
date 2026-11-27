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
        <NavLink className="rail-link rail-home" to="/" end>
          Home
        </NavLink>
        <NavLink className="rail-link" to="/docs">
          Docs
        </NavLink>
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

export function RailIndex({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="rail-index">
      <p className="rail-heading">{heading}</p>
      {children}
    </div>
  );
}
