import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  type ShouldRevalidateFunction,
  useRouteLoaderData,
} from "react-router";

import { workerContext } from "../worker/context";
import type { Route } from "./+types/root";
import { NavProgress } from "./components/NavProgress";
import { Rail } from "./components/Rail";
import { useMarkHydrated, useReloadOnNewDeploy } from "./deploy-skew";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap",
  },
  { rel: "stylesheet", href: "/styles.css" },
];

export async function loader({ context }: Route.LoaderArgs) {
  const { account } = context.get(workerContext);
  return {
    account: account && {
      user: { name: account.user.name, email: account.user.email, picture: account.user.picture },
      team: { name: account.team.name },
    },
  };
}

export const shouldRevalidate: ShouldRevalidateFunction = ({
  formMethod,
  defaultShouldRevalidate,
}) => (formMethod ? defaultShouldRevalidate : false);

export type RootData = Awaited<ReturnType<typeof loader>>;

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<RootData>("root");
  useMarkHydrated();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <NavProgress />
        <div className="page">
          <Rail account={data?.account ?? null} />
          <main className="content">{children}</main>
        </div>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  const reloading = useReloadOnNewDeploy(!notFound);
  if (reloading) {
    return null;
  }
  if (!notFound) {
    console.error(error);
  }
  return (
    <section className="section hero">
      <title>{notFound ? "Not found · Worlds" : "Error · Worlds"}</title>
      <h1>{notFound ? "Not found" : "Something went wrong"}</h1>
      <p>
        {notFound ? "This page doesn't exist." : "The page failed to load. Try again in a moment."}{" "}
        <a href="/">Go home</a>.
      </p>
    </section>
  );
}
