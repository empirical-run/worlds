import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { actAs, fetchState, Unauthorized, type Channel, type Message, type User, type WorldState } from "./api";
import { Mrkdwn, type Lookup } from "./mrkdwn";

const TOKEN_KEY = "worlds-admin-token";
const ACTOR_KEY = "worlds-acting-user";
const POLL_MS = 2000;
const GROUP_WINDOW_SECONDS = 300;

type Route = { channel: string | null; thread: string | null };

function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  return { channel: params.get("channel"), thread: params.get("thread") };
}

function writeRoute(route: Route) {
  const params = new URLSearchParams();
  if (route.channel) params.set("channel", route.channel);
  if (route.thread) params.set("thread", route.thread);
  const query = params.toString();
  history.replaceState(null, "", query ? `/?${query}` : "/");
}

function hue(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function formatTime(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function isTopLevel(message: Message): boolean {
  return !message.thread_ts || message.thread_ts === message.ts;
}

function encodeMentions(text: string, users: User[]): string {
  const names = [...users].sort((a, b) => b.name.length - a.name.length);
  return text.replace(/(^|[\s(])@([\w.-]+)/g, (whole, lead: string, name: string) => {
    const user = names.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
    return user ? `${lead}<@${user.id}>` : whole;
  });
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState<string | null>(null);

  if (!token) {
    return (
      <Login
        error={authError}
        onSubmit={(value) => {
          localStorage.setItem(TOKEN_KEY, value);
          setAuthError(null);
          setToken(value);
        }}
      />
    );
  }
  return (
    <World
      token={token}
      onUnauthorized={(message) => {
        localStorage.removeItem(TOKEN_KEY);
        setAuthError(message);
        setToken(null);
      }}
    />
  );
}

function Login({ error, onSubmit }: { error: string | null; onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="login">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <h1>Worlds</h1>
        <p>A Slack twin you can drive. Enter the world's admin token to open it.</p>
        <input type="password" autoFocus placeholder="WORLDS_ADMIN_TOKEN" value={value} onChange={(event) => setValue(event.target.value)} />
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={!value.trim()}>
          Open world
        </button>
      </form>
    </div>
  );
}

function World({ token, onUnauthorized }: { token: string; onUnauthorized: (message: string) => void }) {
  const [route, setRoute] = useState(readRoute);
  const [state, setState] = useState<WorldState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorId, setActorId] = useState(() => localStorage.getItem(ACTOR_KEY));

  const navigate = useCallback((next: Route) => {
    writeRoute(next);
    setRoute(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await fetchState(token, route.channel);
      setState(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof Unauthorized) onUnauthorized(caught.message);
      else setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [token, route.channel, onUnauthorized]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!state || route.channel) return;
    const fallback = state.channels.find((channel) => channel.name === "general") ?? state.channels[0];
    if (fallback) navigate({ channel: fallback.id, thread: null });
  }, [state, route.channel, navigate]);

  const humans = useMemo(() => state?.users.filter((user) => !user.is_bot) ?? [], [state]);
  const actor = humans.find((user) => user.id === actorId) ?? humans.find((user) => user.has_token) ?? humans[0] ?? null;

  const lookup = useMemo<Lookup>(() => {
    const users = new Map(state?.users.map((user) => [user.id, user.name]));
    const channels = new Map(state?.channels.map((channel) => [channel.id, channel.name]));
    return { userName: (id) => users.get(id) ?? id, channelName: (id) => channels.get(id) ?? id };
  }, [state]);

  const act = useCallback(
    async (method: string, args: Record<string, unknown>) => {
      if (!actor) throw new Error("No user to act as");
      try {
        const result = await actAs(token, actor.id, method, args);
        await load();
        return result;
      } catch (caught) {
        if (caught instanceof Unauthorized) onUnauthorized(caught.message);
        throw caught;
      }
    },
    [actor, token, load, onUnauthorized],
  );

  if (!state) {
    return error ? <LoadFailed message={error} onRetry={load} /> : <WorldSkeleton />;
  }

  const channel = state.channels.find((candidate) => candidate.id === route.channel) ?? null;
  const channelMessages = channel ? state.messages : [];
  const parent = route.thread ? channelMessages.find((message) => message.ts === route.thread) ?? null : null;

  return (
    <div className={parent ? "app with-thread" : "app"}>
      <Sidebar
        state={state}
        activeChannel={route.channel}
        actor={actor}
        humans={humans}
        onSelect={(id) => navigate({ channel: id, thread: null })}
        onActorChange={(id) => {
          localStorage.setItem(ACTOR_KEY, id);
          setActorId(id);
        }}
        onCreateChannel={async (name) => {
          const result = await act("conversations.create", { name });
          const created = (result as { channel?: { id: string } }).channel;
          if (created) navigate({ channel: created.id, thread: null });
        }}
        onSignOut={() => onUnauthorized("Signed out.")}
      />
      <main className="channel">
        {error && <div className="banner">Live updates failed: {error}. Retrying every few seconds.</div>}
        {channel ? (
          <ChannelView
            key={channel.id}
            channel={channel}
            messages={channelMessages}
            users={state.users}
            lookup={lookup}
            actor={actor}
            openThread={route.thread}
            onOpenThread={(ts) => navigate({ channel: channel.id, thread: ts })}
            act={act}
          />
        ) : (
          <div className="empty">This world has no channels yet. Create one from the sidebar.</div>
        )}
      </main>
      {parent && channel && (
        <ThreadPanel
          key={parent.ts}
          channel={channel}
          parent={parent}
          replies={channelMessages.filter((message) => message.thread_ts === parent.ts && message.ts !== parent.ts)}
          users={state.users}
          lookup={lookup}
          actor={actor}
          onClose={() => navigate({ channel: channel.id, thread: null })}
          act={act}
        />
      )}
    </div>
  );
}

function Sidebar(props: {
  state: WorldState;
  activeChannel: string | null;
  actor: User | null;
  humans: User[];
  onSelect: (id: string) => void;
  onActorChange: (id: string) => void;
  onCreateChannel: (name: string) => Promise<void>;
  onSignOut: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!clean) return;
    try {
      await props.onCreateChannel(clean);
      setName("");
      setCreating(false);
      setCreateError(null);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <nav className="sidebar">
      <header className="workspace">
        <span className="workspace-name">{props.state.team?.name ?? "World"}</span>
        <span className="workspace-tag">twin</span>
      </header>
      <div className="section-title">
        <span>Channels</span>
        <button className="icon-button" title="Create a channel" onClick={() => setCreating((open) => !open)}>
          +
        </button>
      </div>
      {creating && (
        <form className="create-channel" onSubmit={submit}>
          <input autoFocus placeholder="channel-name" value={name} onChange={(event) => setName(event.target.value)} />
          {createError && <p className="inline-error">{createError}</p>}
        </form>
      )}
      <ul className="channel-list">
        {props.state.channels.map((channel) => (
          <li key={channel.id}>
            <button className={channel.id === props.activeChannel ? "channel-link active" : "channel-link"} onClick={() => props.onSelect(channel.id)}>
              <span className="hash">{channel.is_private ? "🔒" : "#"}</span>
              {channel.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="section-title">
        <span>People</span>
      </div>
      <ul className="people-list">
        {props.state.users.map((user) => (
          <li key={user.id} className="person">
            <Avatar user={user} size={20} />
            <span>{user.real_name}</span>
            {user.is_bot && <span className="app-badge">APP</span>}
          </li>
        ))}
      </ul>
      <footer className="sidebar-footer">
        <label>
          <span>Acting as</span>
          <select value={props.actor?.id ?? ""} onChange={(event) => props.onActorChange(event.target.value)}>
            {props.humans.map((user) => (
              <option key={user.id} value={user.id}>
                {user.real_name} (@{user.name})
              </option>
            ))}
          </select>
        </label>
        <div className="footer-links">
          <a href="/_inspector">Inspector</a>
          <button className="link-button" onClick={props.onSignOut}>
            Sign out
          </button>
        </div>
      </footer>
    </nav>
  );
}

function Avatar({ user, size }: { user: User | undefined; size: number }) {
  const label = (user?.real_name || user?.name || "?").slice(0, 1).toUpperCase();
  return (
    <span
      className={user?.is_bot ? "avatar bot" : "avatar"}
      style={{ width: size, height: size, fontSize: size * 0.5, background: `hsl(${hue(user?.id ?? "?")} 45% 42%)` }}
    >
      {label}
    </span>
  );
}

function ChannelView(props: {
  channel: Channel;
  messages: Message[];
  users: User[];
  lookup: Lookup;
  actor: User | null;
  openThread: string | null;
  onOpenThread: (ts: string) => void;
  act: (method: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const topLevel = props.messages.filter(isTopLevel);
  const nonMembers = props.users.filter((user) => !props.channel.members.includes(user.id));
  const [inviteError, setInviteError] = useState<string | null>(null);

  return (
    <>
      <header className="channel-header">
        <div>
          <h2>
            {props.channel.is_private ? "🔒 " : "# "}
            {props.channel.name}
          </h2>
          {props.channel.topic && <p className="topic">{props.channel.topic}</p>}
        </div>
        <div className="members">
          <span className="member-stack">
            {props.channel.members.slice(0, 4).map((id) => (
              <Avatar key={id} user={props.users.find((user) => user.id === id)} size={22} />
            ))}
          </span>
          <span>{props.channel.members.length}</span>
          {nonMembers.length > 0 && (
            <select
              className="invite"
              value=""
              onChange={async (event) => {
                try {
                  await props.act("conversations.invite", { channel: props.channel.id, users: event.target.value });
                  setInviteError(null);
                } catch (caught) {
                  setInviteError(caught instanceof Error ? caught.message : String(caught));
                }
              }}
            >
              <option value="">Add people…</option>
              {nonMembers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.real_name}
                  {user.is_bot ? " (app)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>
      {inviteError && <div className="banner">Couldn't add to channel: {inviteError}</div>}
      <MessageList messages={topLevel} users={props.users} lookup={props.lookup} activeThread={props.openThread} onOpenThread={props.onOpenThread}>
        <div className="empty">No messages in #{props.channel.name} yet. Say something, or @mention the app.</div>
      </MessageList>
      <Composer
        placeholder={`Message #${props.channel.name}`}
        users={props.users}
        actor={props.actor}
        onSend={(text) => props.act("chat.postMessage", { channel: props.channel.id, text })}
      />
    </>
  );
}

function ThreadPanel(props: {
  channel: Channel;
  parent: Message;
  replies: Message[];
  users: User[];
  lookup: Lookup;
  actor: User | null;
  onClose: () => void;
  act: (method: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  return (
    <aside className="thread">
      <header className="thread-header">
        <div>
          <h3>Thread</h3>
          <p className="topic"># {props.channel.name}</p>
        </div>
        <button className="icon-button" title="Close thread" onClick={props.onClose}>
          ×
        </button>
      </header>
      <MessageList messages={[props.parent]} users={props.users} lookup={props.lookup} hideThreadSummary>
        {null}
      </MessageList>
      <div className="reply-divider">
        {props.replies.length} {props.replies.length === 1 ? "reply" : "replies"}
      </div>
      <MessageList messages={props.replies} users={props.users} lookup={props.lookup} grow>
        <div className="empty small">No replies yet.</div>
      </MessageList>
      <Composer
        placeholder="Reply…"
        users={props.users}
        actor={props.actor}
        onSend={(text) => props.act("chat.postMessage", { channel: props.channel.id, thread_ts: props.parent.ts, text })}
      />
    </aside>
  );
}

function MessageList(props: {
  messages: Message[];
  users: User[];
  lookup: Lookup;
  children: ReactNode;
  activeThread?: string | null;
  onOpenThread?: (ts: string) => void;
  hideThreadSummary?: boolean;
  grow?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTs = props.messages.at(-1)?.ts;

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && pinned.current) element.scrollTop = element.scrollHeight;
  }, [lastTs, props.messages.length]);

  const fixed = props.hideThreadSummary && !props.grow;
  return (
    <div
      ref={scroller}
      className={fixed ? "messages fixed" : "messages"}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}
    >
      {props.messages.length === 0
        ? props.children
        : props.messages.map((message, index) => {
            const previous = props.messages[index - 1];
            const newDay = !previous || formatDay(previous.ts) !== formatDay(message.ts);
            const grouped =
              !newDay &&
              previous.user === message.user &&
              Number(message.ts) - Number(previous.ts) < GROUP_WINDOW_SECONDS &&
              previous.reply_count === 0;
            return (
              <div key={message.ts}>
                {newDay && !fixed && <div className="day-divider">{formatDay(message.ts)}</div>}
                <MessageRow
                  message={message}
                  user={props.users.find((user) => user.id === message.user)}
                  lookup={props.lookup}
                  grouped={grouped}
                  active={props.activeThread === message.ts}
                  onOpenThread={props.hideThreadSummary ? undefined : props.onOpenThread}
                />
              </div>
            );
          })}
    </div>
  );
}

function MessageRow(props: {
  message: Message;
  user: User | undefined;
  lookup: Lookup;
  grouped: boolean;
  active: boolean;
  onOpenThread?: (ts: string) => void;
}) {
  const { message, user } = props;
  const name = user?.real_name ?? message.bot_name ?? message.user;
  return (
    <div className={`message${props.grouped ? " grouped" : ""}${props.active ? " active" : ""}`}>
      <div className="gutter">{props.grouped ? <span className="hover-time">{formatTime(message.ts)}</span> : <Avatar user={user} size={36} />}</div>
      <div className="body">
        {!props.grouped && (
          <div className="meta">
            <span className="author">{name}</span>
            {user?.is_bot && <span className="app-badge">APP</span>}
            <span className="time" title={message.ts}>
              {formatTime(message.ts)}
            </span>
          </div>
        )}
        <Mrkdwn text={message.text} lookup={props.lookup} />
        {message.edited && <span className="edited">(edited)</span>}
        {message.reactions.length > 0 && (
          <div className="reactions">
            {message.reactions.map((reaction) => (
              <span key={reaction.name} className="reaction" title={reaction.users.map(props.lookup.userName).join(", ")}>
                :{reaction.name}: {reaction.count}
              </span>
            ))}
          </div>
        )}
        {props.onOpenThread && message.reply_count > 0 && (
          <button className="thread-summary" onClick={() => props.onOpenThread?.(message.ts)}>
            {message.reply_count} {message.reply_count === 1 ? "reply" : "replies"}
            <span className="view-thread">View thread</span>
          </button>
        )}
        {props.onOpenThread && message.reply_count === 0 && (
          <button className="reply-action" onClick={() => props.onOpenThread?.(message.ts)}>
            Reply in thread
          </button>
        )}
      </div>
    </div>
  );
}

function Composer(props: { placeholder: string; users: User[]; actor: User | null; onSend: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);

  const query = /(?:^|\s)@([\w.-]*)$/.exec(text)?.[1];
  const suggestions =
    query === undefined ? [] : props.users.filter((user) => user.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  function complete(user: User) {
    setText((current) => current.replace(/@([\w.-]*)$/, `@${user.name} `));
    setHighlight(0);
    input.current?.focus();
  }

  async function send() {
    const body = text.trim();
    if (!body || sending || !props.actor) return;
    setSending(true);
    try {
      await props.onSend(encodeMentions(body, props.users));
      setText("");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setHighlight((index) => (index + (event.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
      return;
    }
    if (suggestions.length > 0 && (event.key === "Tab" || event.key === "Enter")) {
      event.preventDefault();
      complete(suggestions[Math.min(highlight, suggestions.length - 1)]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="composer">
      {suggestions.length > 0 && (
        <ul className="suggestions">
          {suggestions.map((user, index) => (
            <li key={user.id}>
              <button
                className={index === Math.min(highlight, suggestions.length - 1) ? "suggestion active" : "suggestion"}
                onMouseDown={(event) => {
                  event.preventDefault();
                  complete(user);
                }}
              >
                <Avatar user={user} size={20} />
                <span className="author">{user.real_name}</span>
                <span className="handle">@{user.name}</span>
                {user.is_bot && <span className="app-badge">APP</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="composer-box">
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={props.placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-footer">
          <span className="acting" title="Enter to send, Shift+Enter for a new line">
            as {props.actor ? `@${props.actor.name}` : "nobody"}
          </span>
          <button className="send" disabled={!text.trim() || sending || !props.actor} onClick={send}>
            Send
          </button>
        </div>
      </div>
      {error && <p className="inline-error">Couldn't send: {error}</p>}
    </div>
  );
}

function WorldSkeleton() {
  return (
    <div className="app" aria-busy="true">
      <nav className="sidebar">
        <header className="workspace">
          <span className="skeleton" style={{ width: 90, height: 16 }} />
        </header>
        <div className="section-title">
          <span>Channels</span>
        </div>
        {[70, 110, 90, 130].map((width) => (
          <div key={width} className="skeleton-row">
            <span className="skeleton" style={{ width, height: 12 }} />
          </div>
        ))}
      </nav>
      <main className="channel">
        <header className="channel-header">
          <span className="skeleton" style={{ width: 160, height: 18 }} />
        </header>
        <div className="messages">
          {[260, 420, 180, 340].map((width) => (
            <div key={width} className="message">
              <div className="gutter">
                <span className="skeleton" style={{ width: 36, height: 36, borderRadius: 8 }} />
              </div>
              <div className="body">
                <span className="skeleton" style={{ width: 110, height: 12 }} />
                <span className="skeleton" style={{ width, height: 12, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Couldn't load this world</h1>
        <p className="login-error">{message}</p>
        <button onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}
