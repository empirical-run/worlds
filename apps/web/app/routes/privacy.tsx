export const meta = () => [{ title: "Privacy · Worlds" }];

export default function Privacy() {
  return (
    <article>
      <header className="section hero">
        <h1>Privacy policy</h1>
        <p className="lede">Last updated 27 November 2026</p>
        <p>
          Worlds is run by Empirical. This page explains what Worlds stores about you and the worlds
          you create.
        </p>
      </header>

      <section className="section">
        <h2>Signing in with Google or GitHub</h2>
        <p>
          When you sign in with Google, Worlds receives your name, email address, profile picture
          and Google account ID. When you sign in with GitHub, Worlds receives your name or
          username, your verified primary email address, your avatar and your GitHub user ID. We use
          them only to sign you in, to show you your account, and to contact you about it. We do not
          request access to any other data in those accounts, such as Gmail, Drive, Calendar or your
          repositories.
        </p>
        <p>
          If you sign in with both and they share a verified email address, they open the same
          Worlds account. We do not store the access tokens Google or GitHub issue at sign-in.
        </p>
        <p>
          Worlds' use of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We do not use Google user data for advertising,
          we do not sell it, and we do not use it to train AI models.
        </p>
      </section>

      <section className="section">
        <h2>API keys</h2>
        <p>
          API keys you create are shown once and stored only as a hash. We record when each key was
          created and last used.
        </p>
      </section>

      <section className="section">
        <h2>What you put in a world</h2>
        <p>
          A world stores what you seed it with and what your app and its users do in it: workspaces,
          users, channels, messages, files, repositories and similar records, plus a journal of
          every request, change and outbound event. You decide what goes in. If you seed a world
          with real data, such as recorded conversations, you are responsible for having the right
          to use it.
        </p>
        <p>
          Worlds and their snapshots are private to your team. When you archive a world it goes
          offline for good: its URLs stop working and nobody, including your team, can reach what is
          in it.
        </p>
      </section>

      <section className="section">
        <h2>Where it is stored</h2>
        <p>
          Everything is stored on Cloudflare. We use a session cookie to keep you signed in. We do
          not use advertising or tracking cookies, and we do not sell or share your data.
        </p>
      </section>

      <section className="section">
        <h2>Deleting your data</h2>
        <p>
          You can delete any API key and archive any world yourself. To delete an archived world's
          data, or your account and everything in it, email{" "}
          <a href="mailto:company@empirical.run">company@empirical.run</a>.
        </p>
      </section>
    </article>
  );
}
