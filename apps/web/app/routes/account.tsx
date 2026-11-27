import { providersFor, type Provider } from "@worlds/db";

import { workerContext } from "../../worker/context";
import type { Route } from "./+types/account";

export const meta = () => [{ title: "Account · Worlds" }, { name: "robots", content: "noindex" }];

const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", github: "GitHub" };

const SIGN_IN_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "Your sign-in link expired. Try again.",
};

export async function loader({ request, context }: Route.LoaderArgs) {
  const { account, db } = context.get(workerContext);
  const params = new URL(request.url).searchParams;
  if (!account) {
    const reason = params.get("sign_in");
    const next = params.get("next");
    return {
      signedIn: false as const,
      signInError: reason ? (SIGN_IN_ERRORS[reason] ?? null) : null,
      next: next?.startsWith("/") && !next.startsWith("//") ? next : "/worlds",
    };
  }
  return {
    signedIn: true as const,
    email: account.user.email,
    providers: await providersFor(db, account.user.id),
  };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  if (!loaderData.signedIn) return <SignIn error={loaderData.signInError} next={loaderData.next} />;
  const { email, providers } = loaderData;
  return (
    <article>
      <header className="section hero">
        <h1>Account</h1>
        <p className="lede">
          Signed in as <strong>{email}</strong>.
        </p>
        <form method="post" action="/auth/sign-out">
          <button className="button" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="section" id="sign-in-methods">
        <h2>Sign-in methods</h2>
        <p>
          {providers.length
            ? `${providers.map((provider) => PROVIDER_NAMES[provider]).join(" and ")}. Signing in with another provider that has the same verified email opens this account.`
            : "No sign-in method is linked to this account."}
        </p>
      </section>
    </article>
  );
}

function SignIn({ error, next }: { error: string | null; next: string }) {
  const query = `?next=${encodeURIComponent(next)}`;
  return (
    <header className="section hero">
      <h1>Sign in</h1>
      <p className="lede">Sign in to create worlds and API keys.</p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <a className="button primary" href={`/auth/google${query}`}>
          Sign in with Google
        </a>
        <a className="button" href={`/auth/github${query}`}>
          Sign in with GitHub
        </a>
      </div>
      <p className="fine">
        By signing in you agree to the <a href="/privacy">privacy policy</a>.
      </p>
    </header>
  );
}
