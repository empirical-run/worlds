import type { LinearDelivery } from "./delivery";
import {
  isoDate,
  randomToken,
  slug,
  stableUuid,
  type AccessToken,
  type AppUser,
  type Attachment,
  type Comment,
  type Grant,
  type Issue,
  type LinearData,
  type Origins,
  type Person,
  type Reaction,
  type TokenPair,
} from "./model";
import type { IssueState, LinearAppState } from "./spec";

const CODE_LIFETIME_MS = 10 * 60_000;
const ACCESS_LIFETIME_S = 24 * 60 * 60;
const REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const REFRESH_RECOVERY_MS = 30 * 60_000;

export type IssueInput = {
  team: string;
  title: string;
  description?: string | null;
  state: IssueState;
  assignee?: string | null;
};

export type IssuePatch = Partial<Omit<IssueInput, "team">>;

export type TokenError = { error: string; error_description: string };

export type RevokeResult = "revoked" | "already_revoked" | "not_found";

export class LinearWorkspace {
  constructor(
    readonly data: LinearData,
    readonly origins: Origins,
    private readonly delivery: LinearDelivery,
  ) {}

  get state() {
    return this.data.state;
  }

  app(clientId: string | null | undefined): LinearAppState | undefined {
    return clientId
      ? this.state.apps.find((app) => app.credentials.client_id === clientId)
      : undefined;
  }

  appUser(clientId: string): AppUser | undefined {
    return this.data.app_users.find((user) => user.client_id === clientId);
  }

  person(id: string | null): Person | null {
    if (!id) {
      return null;
    }
    const member = this.state.users.find((user) => user.id === id);
    if (member) {
      return {
        id: member.id,
        name: member.display_name,
        handle: member.name,
        email: member.email,
        app: false,
        created: 0,
      };
    }
    const appUser = this.data.app_users.find((user) => user.id === id);
    return appUser
      ? {
          id: appUser.id,
          name: appUser.name,
          handle: appUser.handle,
          email: appUser.email,
          app: true,
          created: appUser.created,
        }
      : null;
  }

  member(ref: string) {
    return this.state.users.find((user) => user.id === ref || user.name === ref);
  }

  assignable(ref: string): string | { error: string } {
    const member = this.member(ref);
    if (member) {
      return member.id;
    }
    const appUser = this.data.app_users.find(
      (user) =>
        user.active &&
        (user.id === ref ||
          user.handle === ref ||
          this.app(user.client_id)?.name.toLowerCase() === ref.toLowerCase()),
    );
    if (!appUser) {
      return { error: `No member or installed app named ${ref} in this world.` };
    }
    if (!appUser.scopes.includes("app:assignable")) {
      return { error: `${appUser.name} was installed without app:assignable.` };
    }
    return appUser.id;
  }

  team(key: string) {
    return this.state.teams.find((team) => team.key === key || team.id === key);
  }

  issue(idOrIdentifier: string): Issue | undefined {
    const wanted = idOrIdentifier.toUpperCase();
    return this.data.issues.find(
      (issue) => issue.id === idOrIdentifier || issue.identifier === wanted,
    );
  }

  issueUrl(issue: Issue): string {
    return `${this.origins.app}/${this.state.workspace.url_key}/issue/${issue.identifier}/${slug(issue.title)}`;
  }

  profileUrl(person: Person): string {
    return `${this.origins.app}/${this.state.workspace.url_key}/profiles/${person.handle}`;
  }

  nextSyncId(): number {
    this.data.sync_id += 1;
    return this.data.sync_id;
  }

  installAppUser(app: LinearAppState, scopes: string[]): AppUser {
    const existing = this.appUser(app.credentials.client_id);
    if (existing) {
      existing.active = true;
      existing.scopes = [...new Set([...existing.scopes, ...scopes])];
      return existing;
    }
    const handle = slug(app.name);
    const appUser: AppUser = {
      id: crypto.randomUUID(),
      client_id: app.credentials.client_id,
      name: app.name,
      handle,
      email: `${handle}-${app.credentials.client_id.slice(0, 8).toLowerCase()}@oauthapp.linear.app`,
      scopes,
      active: true,
      created: Date.now(),
    };
    this.data.app_users.push(appUser);
    return appUser;
  }

  issueCode(grant: Grant, redirectUri: string): string {
    const code = randomToken(32);
    this.prune();
    this.data.codes.push({
      ...grant,
      code,
      redirect_uri: redirectUri,
      expires_at: Date.now() + CODE_LIFETIME_MS,
    });
    return code;
  }

  exchangeCode(app: LinearAppState, code: string, redirectUri: string): TokenPair | TokenError {
    const index = this.data.codes.findIndex((entry) => entry.code === code);
    const entry = this.data.codes[index];
    if (!entry) {
      return invalidGrant("Invalid authorization code");
    }
    this.data.codes.splice(index, 1);
    if (entry.expires_at < Date.now() || entry.client_id !== app.credentials.client_id) {
      return invalidGrant("Invalid authorization code");
    }
    if (entry.redirect_uri !== redirectUri) {
      return invalidGrant("redirect_uri does not match the one used to authorize");
    }
    return this.mintTokens(entry, crypto.randomUUID());
  }

  refresh(app: LinearAppState, token: string): TokenPair | TokenError {
    const entry = this.data.refresh_tokens.find(
      (candidate) => candidate.token === token && candidate.client_id === app.credentials.client_id,
    );
    const now = Date.now();
    if (!entry || entry.expires_at < now) {
      return invalidGrant("Invalid refresh token");
    }
    if (entry.rotated_at !== null) {
      return entry.replacement && now - entry.rotated_at <= REFRESH_RECOVERY_MS
        ? entry.replacement
        : invalidGrant("Invalid refresh token");
    }
    const replacement = this.mintTokens(entry, entry.grant_id);
    entry.rotated_at = now;
    entry.replacement = replacement;
    return replacement;
  }

  authenticate(authorization: string | null): AccessToken | null {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    const entry = token
      ? this.data.access_tokens.find((candidate) => candidate.token === token)
      : undefined;
    if (!entry || entry.expires_at < Date.now() || !this.app(entry.client_id)) {
      return null;
    }
    if (entry.actor === "app" && !this.appUser(entry.client_id)?.active) {
      return null;
    }
    return entry;
  }

  revokeToken(token: string): RevokeResult {
    const access = this.data.access_tokens.find((entry) => entry.token === token);
    const refresh = this.data.refresh_tokens.find((entry) => entry.token === token);
    const grantId = access?.grant_id ?? refresh?.grant_id;
    if (!grantId) {
      return "not_found";
    }
    if (access && access.expires_at < Date.now()) {
      return "already_revoked";
    }
    this.revokeGrant(grantId);
    return "revoked";
  }

  async uninstall(app: LinearAppState): Promise<void> {
    const clientId = app.credentials.client_id;
    this.data.access_tokens = this.data.access_tokens.filter(
      (entry) => entry.client_id !== clientId,
    );
    this.data.refresh_tokens = this.data.refresh_tokens.filter(
      (entry) => entry.client_id !== clientId,
    );
    const appUser = this.appUser(clientId);
    if (appUser) {
      appUser.active = false;
    }
    await this.sendToApp(app, "OAuthApp", {
      action: "revoked",
      type: "OAuthApp",
      createdAt: isoDate(Date.now()),
      oauthClientId: clientId,
      organizationId: this.state.workspace.id,
    });
  }

  private revokeGrant(grantId: string): void {
    this.data.access_tokens = this.data.access_tokens.filter((entry) => entry.grant_id !== grantId);
    this.data.refresh_tokens = this.data.refresh_tokens.filter(
      (entry) => entry.grant_id !== grantId,
    );
  }

  private mintTokens(grant: Grant, grantId: string): TokenPair {
    this.prune();
    const now = Date.now();
    const base = {
      client_id: grant.client_id,
      user_id: grant.user_id,
      scopes: grant.scopes,
      actor: grant.actor,
      grant_id: grantId,
    };
    const access: AccessToken = {
      ...base,
      token: `lin_oauth_${randomToken(32)}`,
      expires_at: now + ACCESS_LIFETIME_S * 1000,
    };
    const pair: TokenPair = {
      access_token: access.token,
      token_type: "Bearer",
      expires_in: ACCESS_LIFETIME_S - 1,
      scope: grant.scopes.join(" "),
      refresh_token: `lin_refresh_${randomToken(32)}`,
    };
    this.data.access_tokens.push(access);
    this.data.refresh_tokens.push({
      ...base,
      token: pair.refresh_token,
      expires_at: now + REFRESH_LIFETIME_MS,
      rotated_at: null,
      replacement: null,
    });
    return pair;
  }

  private prune(): void {
    const now = Date.now();
    this.data.codes = this.data.codes.filter((entry) => entry.expires_at > now);
    this.data.access_tokens = this.data.access_tokens.filter((entry) => entry.expires_at > now);
    this.data.refresh_tokens = this.data.refresh_tokens.filter(
      (entry) =>
        entry.expires_at > now &&
        (entry.rotated_at === null || now - entry.rotated_at <= REFRESH_RECOVERY_MS),
    );
  }

  seedIssue(creator: string, input: IssueInput, created = Date.now()): Issue {
    const team = this.team(input.team);
    if (!team) {
      throw new Error(`unknown team ${input.team}`);
    }
    const number =
      this.data.issues
        .filter((issue) => issue.team === team.key)
        .reduce((max, issue) => Math.max(max, issue.number), 0) + 1;
    const issue: Issue = {
      id: crypto.randomUUID(),
      identifier: `${team.key}-${number}`,
      number,
      team: team.key,
      title: input.title,
      description: input.description ?? null,
      state: input.state,
      creator,
      assignee: input.assignee ?? null,
      created,
      updated: created,
      comments: [],
      reactions: [],
      attachments: [],
    };
    this.data.issues.push(issue);
    return issue;
  }

  addComment(issue: Issue, user: string, body: string): Comment {
    const now = Date.now();
    const comment: Comment = { id: crypto.randomUUID(), user, body, created: now, updated: now };
    issue.comments.push(comment);
    issue.updated = now;
    return comment;
  }

  addReaction(issue: Issue, user: string, emoji: string): Reaction {
    const reaction: Reaction = { id: crypto.randomUUID(), user, emoji, created: Date.now() };
    issue.reactions.push(reaction);
    return reaction;
  }

  upsertAttachment(
    issue: Issue,
    creator: string,
    input: {
      title: string;
      subtitle?: string | null;
      url: string;
      iconUrl?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): Attachment {
    const now = Date.now();
    const existing = issue.attachments.find((attachment) => attachment.url === input.url);
    if (existing) {
      existing.title = input.title;
      existing.subtitle = input.subtitle ?? existing.subtitle;
      existing.icon_url = input.iconUrl ?? existing.icon_url;
      existing.metadata = input.metadata ?? existing.metadata;
      existing.updated = now;
      return existing;
    }
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      creator,
      title: input.title,
      subtitle: input.subtitle ?? null,
      url: input.url,
      icon_url: input.iconUrl ?? null,
      metadata: input.metadata ?? {},
      created: now,
      updated: now,
    };
    issue.attachments.push(attachment);
    return attachment;
  }

  async createIssue(actor: string, input: IssueInput): Promise<Issue> {
    const issue = this.seedIssue(actor, input);
    await this.notifyAssignment(actor, issue, null, issue.assignee);
    return issue;
  }

  async updateIssue(actor: string, issue: Issue, patch: IssuePatch): Promise<void> {
    const before = issue.assignee;
    if (patch.title !== undefined) {
      issue.title = patch.title;
    }
    if (patch.description !== undefined) {
      issue.description = patch.description;
    }
    if (patch.state !== undefined) {
      issue.state = patch.state;
    }
    if (patch.assignee !== undefined) {
      issue.assignee = patch.assignee;
    }
    issue.updated = Date.now();
    await this.notifyAssignment(actor, issue, before, issue.assignee);
  }

  private async notifyAssignment(
    actor: string,
    issue: Issue,
    from: string | null,
    to: string | null,
  ): Promise<void> {
    if (from === to) {
      return;
    }
    const unassigned = this.data.app_users.find((user) => user.id === from);
    if (unassigned) {
      await this.notifyAppUser(unassigned, "issueUnassignedFromYou", actor, issue);
    }
    const assigned = this.data.app_users.find((user) => user.id === to);
    if (assigned) {
      await this.notifyAppUser(assigned, "issueAssignedToYou", actor, issue);
    }
  }

  private async notifyAppUser(
    appUser: AppUser,
    type: string,
    actorId: string,
    issue: Issue,
  ): Promise<void> {
    const app = this.app(appUser.client_id);
    if (!app || !appUser.active) {
      return;
    }
    const now = isoDate(Date.now());
    const actor = this.person(actorId);
    const team = this.team(issue.team);
    await this.sendToApp(app, "AppUserNotification", {
      type: "AppUserNotification",
      action: type,
      createdAt: now,
      organizationId: this.state.workspace.id,
      oauthClientId: app.credentials.client_id,
      appUserId: appUser.id,
      notification: {
        id: crypto.randomUUID(),
        type,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        actorId: actor?.id ?? null,
        actor: actor
          ? {
              id: actor.id,
              name: actor.name,
              email: actor.email,
              avatarUrl: null,
              url: this.profileUrl(actor),
            }
          : null,
        externalUserActorId: null,
        userId: appUser.id,
        issueId: issue.id,
        issue: {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          url: this.issueUrl(issue),
          teamId: team?.id ?? "",
          team: { id: team?.id ?? "", key: issue.team, name: team?.name ?? issue.team },
        },
      },
    });
  }

  private async sendToApp(
    app: LinearAppState,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!app.webhook_url) {
      return;
    }
    await this.delivery.enqueue(
      { url: app.webhook_url, clientId: app.credentials.client_id },
      event,
      {
        ...payload,
        webhookId: stableUuid(`webhook:${app.credentials.client_id}`),
      },
    );
  }
}

function invalidGrant(description: string): TokenError {
  return { error: "invalid_grant", error_description: description };
}
