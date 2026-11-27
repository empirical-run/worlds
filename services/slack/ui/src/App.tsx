import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  actAs,
  fetchState,
  fileObjectUrl,
  uploadAs,
  Unauthorized,
  WORLD_BASE,
  type Channel,
  type FileRef,
  type ImageRef,
  type Message,
  type User,
  type WorldState,
} from "./api";
import { Mrkdwn, type Lookup } from "./mrkdwn";

const ACTOR_KEY = "worlds-acting-user";
const POLL_MS = 2000;
const GROUP_WINDOW_SECONDS = 300;

type Route = { channel: string | null; thread: string | null };

type Upload = (channel: string, threadTs: string | undefined, text: string, file: File) => Promise<void>;

function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  return { channel: params.get("channel"), thread: params.get("thread") };
}

function writeRoute(route: Route) {
  const params = new URLSearchParams();
  if (route.channel) params.set("channel", route.channel);
  if (route.thread) params.set("thread", route.thread);
  const query = params.toString();
  history.replaceState(null, "", `${WORLD_BASE}/${query ? `?${query}` : ""}`);
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
  const [authError, setAuthError] = useState<string | null>(null);
  if (authError) return <SignInNeeded message={authError} />;
  return <World onUnauthorized={setAuthError} />;
}

function SignInNeeded({ message }: { message: string }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Worlds</h1>
        <p>{message}</p>
        <a className="login-button" href={`https://makeworlds.dev/account?next=${encodeURIComponent(location.href)}`}>
          Go to makeworlds.dev
        </a>
      </div>
    </div>
  );
}

function World({ onUnauthorized }: { onUnauthorized: (message: string) => void }) {
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
      const next = await fetchState(route.channel);
      setState(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof Unauthorized) onUnauthorized(caught.message);
      else setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [route.channel, onUnauthorized]);

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
        const result = await actAs(actor.id, method, args);
        await load();
        return result;
      } catch (caught) {
        if (caught instanceof Unauthorized) onUnauthorized(caught.message);
        throw caught;
      }
    },
    [actor, load, onUnauthorized],
  );

  const upload = useCallback<Upload>(
    async (channel, threadTs, text, file) => {
      if (!actor) throw new Error("No user to act as");
      try {
        await uploadAs({ userId: actor.id, channel, threadTs, text, file });
        await load();
      } catch (caught) {
        if (caught instanceof Unauthorized) onUnauthorized(caught.message);
        throw caught;
      }
    },
    [actor, load, onUnauthorized],
  );

  if (!state) {
    return error ? <LoadFailed message={error} onRetry={load} /> : <WorldSkeleton />;
  }

  const channel = state.channels.find((candidate) => candidate.id === route.channel) ?? null;
  const channelMessages = channel ? state.messages : [];
  const parent = route.thread ? channelMessages.find((message) => message.ts === route.thread) ?? null : null;

  return (
    <>
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
              upload={upload}
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
            upload={upload}
          />
        )}
      </div>
    </>
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
        <span className="workspace-tag">world</span>
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
          <a href={`${WORLD_BASE}/_inspector`}>Inspector</a>
          <a href="https://makeworlds.dev/account">Account</a>
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
  upload: Upload;
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
        onUpload={(text, file) => props.upload(props.channel.id, undefined, text, file)}
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
  upload: Upload;
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
        onUpload={(text, file) => props.upload(props.channel.id, props.parent.ts, text, file)}
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
        {message.text && <Mrkdwn text={message.text} lookup={props.lookup} />}
        <Attachments files={message.files} images={message.images} />
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function useFileUrl(fileId: string | undefined) {
  const [state, setState] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    if (!fileId) return;
    let live = true;
    fileObjectUrl(fileId).then(
      (url) => live && setState({ url }),
      (caught: unknown) => live && setState({ error: caught instanceof Error ? caught.message : String(caught) }),
    );
    return () => {
      live = false;
    };
  }, [fileId]);
  return state;
}

function SlackImage({ fileId, url, alt, file }: { fileId?: string; url?: string; alt: string; file?: FileRef }) {
  const loaded = useFileUrl(fileId);
  const [broken, setBroken] = useState(false);
  if (broken) return file ? <FileChip file={file} /> : <span className="inline-error">Couldn't show image {alt}</span>;
  if (url) return <img className="attachment-image" src={url} alt={alt} onError={() => setBroken(true)} />;
  if (!loaded) return <span className="skeleton attachment-image-skeleton" />;
  if ("error" in loaded) return <span className="inline-error">Couldn't load image: {loaded.error}</span>;
  return (
    <a href={loaded.url} target="_blank" rel="noreferrer">
      <img className="attachment-image" src={loaded.url} alt={alt} onError={() => setBroken(true)} />
    </a>
  );
}

function FileChip({ file }: { file: FileRef }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <button
      className="file-chip"
      onClick={async () => {
        try {
          window.open(await fileObjectUrl(file.id), "_blank");
          setError(null);
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }}
    >
      <span className="file-icon">{file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>
      <span className="file-meta">
        <span className="file-name">{file.name}</span>
        <span className="file-size">{error ? `Couldn't open: ${error}` : formatSize(file.size)}</span>
      </span>
    </button>
  );
}

function Attachments({ files, images }: { files: FileRef[]; images: ImageRef[] }) {
  const imageFiles = files.filter((file) => file.mimetype.startsWith("image/"));
  const otherFiles = files.filter((file) => !file.mimetype.startsWith("image/"));
  const blockImages = images.filter((image) => !image.file_id || !files.some((file) => file.id === image.file_id));
  if (imageFiles.length + otherFiles.length + blockImages.length === 0) return null;
  return (
    <div className="attachments">
      {imageFiles.map((file) => (
        <SlackImage key={file.id} fileId={file.id} alt={file.name} file={file} />
      ))}
      {blockImages.map((image, index) => (
        <SlackImage key={image.file_id ?? image.url ?? index} fileId={image.file_id} url={image.url} alt={image.alt} />
      ))}
      {otherFiles.map((file) => (
        <FileChip key={file.id} file={file} />
      ))}
    </div>
  );
}

function Composer(props: {
  placeholder: string;
  users: User[];
  actor: User | null;
  onSend: (text: string) => Promise<unknown>;
  onUpload: (text: string, file: File) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const query = /(?:^|\s)@([\w.-]*)$/.exec(text)?.[1];
  const suggestions =
    query === undefined ? [] : props.users.filter((user) => user.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);
  const canSend = Boolean(text.trim() || file) && !sending && Boolean(props.actor);

  function complete(user: User) {
    setText((current) => current.replace(/@([\w.-]*)$/, `@${user.name} `));
    setHighlight(0);
    input.current?.focus();
  }

  async function send() {
    if (!canSend) return;
    const body = encodeMentions(text.trim(), props.users);
    setSending(true);
    try {
      if (file) await props.onUpload(body, file);
      else await props.onSend(body);
      setText("");
      setFile(null);
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

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.files[0];
    if (!pasted) return;
    event.preventDefault();
    setFile(pasted);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) setFile(dropped);
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
      <div
        className={dragging ? "composer-box dragging" : "composer-box"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {file && (
          <div className="pending-file">
            <span className="file-icon">{file.name.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</span>
            <span className="file-meta">
              <span className="file-name">{file.name}</span>
              <span className="file-size">{formatSize(file.size)}</span>
            </span>
            <button className="remove-file" title="Remove file" onClick={() => setFile(null)}>
              ×
            </button>
          </div>
        )}
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
          onPaste={onPaste}
        />
        <div className="composer-footer">
          <span className="composer-tools">
            <button className="attach" title="Attach a file (or paste / drop one)" onClick={() => picker.current?.click()}>
              Attach
            </button>
            <input
              ref={picker}
              type="file"
              hidden
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <span className="acting" title="Enter to send, Shift+Enter for a new line">
              as {props.actor ? `@${props.actor.name}` : "nobody"}
            </span>
          </span>
          <button className="send" disabled={!canSend} onClick={send}>
            {sending && file ? "Uploading" : "Send"}
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
