import { RailIndex, type RailHandle } from "../components/Rail";

export const meta = () => [{ title: "Worlds" }];

export const handle: RailHandle = {
  railIndex: () => (
    <RailIndex heading="On this page">
      <a href="#what">
        <span className="num">01</span>What a world is
      </a>
      <a href="#services">
        <span className="num">02</span>Services
      </a>
      <a href="#how">
        <span className="num">03</span>How it works
      </a>
    </RailIndex>
  ),
};

export default function Home() {
  return (
    <>
      <section className="section hero">
        <h1>The APIs your app depends on, as worlds you control.</h1>
        <p className="lede">
          Worlds runs third-party services like Slack in a hosted, stateful world. Point your app at a world, then drive it from a UI or an
          API to test real flows end to end.
        </p>
        <div className="actions">
          <a className="button primary" href="/docs">
            Read the docs
          </a>
          <a className="button" href="/account">
            Create a world
          </a>
        </div>
      </section>

      <section className="section" id="what">
        <span className="section-num">01</span>
        <h2>What a world is</h2>
        <p>
          A world holds the state of every service in it: users, channels, messages, installs. It persists between requests, so a test can
          set up a scene, run your app against it and check what happened.
        </p>
        <p>Services in a world speak the real wire protocol. Your app keeps its SDK and only changes its base URL.</p>
      </section>

      <section className="section" id="services">
        <span className="section-num">02</span>
        <h2>Services</h2>
        <p>Slack is live. More services follow.</p>
        <div className="services">
          <div className="service live">
            Slack<span>Live</span>
          </div>
          <div className="service">
            GitHub<span>Next</span>
          </div>
          <div className="service">
            Google<span>Planned</span>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <span className="section-num">03</span>
        <h2>How it works</h2>
        <ul>
          <li>
            <strong>Web API and OAuth.</strong> Install your app through the world's OAuth flow and call the same methods you call on the
            real service.
          </li>
          <li>
            <strong>Signed events.</strong> Mentions and messages arrive at your events URL, signed and retried the way the real service
            does it.
          </li>
          <li>
            <strong>A UI to act in.</strong> Post as any user, create channels and add your app, and watch your app reply.
          </li>
        </ul>
      </section>
    </>
  );
}
