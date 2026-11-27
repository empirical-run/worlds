import {
  buildSchema,
  execute,
  GraphQLError,
  parse,
  validate,
  type DocumentNode,
  type GraphQLFormattedError,
} from "graphql";

import {
  isoDate,
  stableUuid,
  type AccessToken,
  type Attachment,
  type Comment,
  type Issue,
  type Person,
  type Reaction,
} from "./model";
import type { IssueState } from "./spec";
import type { LinearWorkspace } from "./workspace";

const schema = buildSchema(`
  scalar DateTime
  scalar JSONObject

  type Query {
    viewer: User!
    organization: Organization!
    teams(first: Int, after: String): TeamConnection!
    team(id: String!): Team!
    users(first: Int, after: String): UserConnection!
    issue(id: String!): Issue!
  }

  type Mutation {
    commentCreate(input: CommentCreateInput!): CommentPayload!
    reactionCreate(input: ReactionCreateInput!): ReactionPayload!
    attachmentCreate(input: AttachmentCreateInput!): AttachmentPayload!
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type Organization {
    id: ID!
    name: String!
    urlKey: String!
    logoUrl: String
    createdAt: DateTime!
    updatedAt: DateTime!
    teams(first: Int, after: String): TeamConnection!
    users(first: Int, after: String): UserConnection!
  }

  type User {
    id: ID!
    name: String!
    displayName: String!
    email: String!
    avatarUrl: String
    active: Boolean!
    admin: Boolean!
    app: Boolean!
    guest: Boolean!
    isMe: Boolean!
    url: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    organization: Organization!
  }

  type UserConnection {
    nodes: [User!]!
    pageInfo: PageInfo!
  }

  type Team {
    id: ID!
    key: String!
    name: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    organization: Organization!
  }

  type TeamConnection {
    nodes: [Team!]!
    pageInfo: PageInfo!
  }

  type WorkflowState {
    id: ID!
    name: String!
    type: String!
    color: String!
    position: Float!
    team: Team!
  }

  type Issue {
    id: ID!
    identifier: String!
    number: Float!
    title: String!
    description: String
    priority: Float!
    url: String!
    branchName: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    team: Team!
    state: WorkflowState!
    creator: User
    assignee: User
    comments(first: Int, after: String): CommentConnection!
    attachments(first: Int, after: String): AttachmentConnection!
    reactions: [Reaction!]!
  }

  type Comment {
    id: ID!
    body: String!
    url: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    user: User
    issue: Issue
  }

  type CommentConnection {
    nodes: [Comment!]!
    pageInfo: PageInfo!
  }

  type Reaction {
    id: ID!
    emoji: String!
    createdAt: DateTime!
    updatedAt: DateTime!
    user: User
    issue: Issue
  }

  type Attachment {
    id: ID!
    title: String!
    subtitle: String
    url: String!
    metadata: JSONObject!
    createdAt: DateTime!
    updatedAt: DateTime!
    creator: User
    issue: Issue!
  }

  type AttachmentConnection {
    nodes: [Attachment!]!
    pageInfo: PageInfo!
  }

  type CommentPayload {
    comment: Comment!
    lastSyncId: Float!
    success: Boolean!
  }

  type ReactionPayload {
    reaction: Reaction!
    lastSyncId: Float!
    success: Boolean!
  }

  type AttachmentPayload {
    attachment: Attachment!
    lastSyncId: Float!
    success: Boolean!
  }

  input CommentCreateInput {
    body: String
    createAsUser: String
    displayIconUrl: String
    id: String
    issueId: String
    parentId: String
  }

  input ReactionCreateInput {
    commentId: String
    emoji: String!
    id: String
    initiativeUpdateId: String
    issueId: String
    projectUpdateId: String
  }

  input AttachmentCreateInput {
    commentBody: String
    createAsUser: String
    displayIconUrl: String
    groupBySource: Boolean
    iconUrl: String
    id: String
    issueId: String!
    metadata: JSONObject
    subtitle: String
    title: String!
    url: String!
  }
`);

const STATE_DETAILS: Record<IssueState, { type: string; color: string; position: number }> = {
  Backlog: { type: "backlog", color: "#bec2c8", position: 0 },
  Todo: { type: "unstarted", color: "#e2e2e2", position: 1 },
  "In Progress": { type: "started", color: "#f2c94c", position: 2 },
  Done: { type: "completed", color: "#5e6ad2", position: 3 },
  Canceled: { type: "canceled", color: "#95a2b3", position: 4 },
};

type Context = { workspace: LinearWorkspace; token: AccessToken };

type GraphqlBody = { query?: unknown; variables?: unknown; operationName?: unknown };

export type GraphqlResult = { status: number; body: unknown };

export const AUTHENTICATION_ERROR: GraphQLFormattedError = {
  message: "Authentication required, not authenticated",
  extensions: {
    type: "authentication error",
    code: "AUTHENTICATION_ERROR",
    statusCode: 401,
    userError: true,
    userPresentableMessage: "You need to authenticate to access this operation.",
    meta: {},
    http: { status: 401 },
  },
};

export async function runGraphql(
  workspace: LinearWorkspace,
  body: GraphqlBody | null,
  authorization: string | null,
): Promise<GraphqlResult> {
  if (typeof body?.query !== "string") {
    return requestError("GRAPHQL_PARSE_FAILED", "Must provide query string.");
  }
  let document: DocumentNode;
  try {
    document = parse(body.query);
  } catch (error) {
    return requestError(
      "GRAPHQL_PARSE_FAILED",
      error instanceof GraphQLError ? error.message : "Syntax Error",
      error instanceof GraphQLError ? error.locations : undefined,
    );
  }
  const invalid = validate(schema, document);
  if (invalid.length) {
    return {
      status: 400,
      body: {
        errors: invalid.map((error) => ({
          message: error.message,
          locations: error.locations,
          extensions: {
            http: { status: 400, headers: {} },
            code: "GRAPHQL_VALIDATION_FAILED",
            type: "graphql error",
            userError: true,
          },
        })),
      },
    };
  }
  const token = workspace.authenticate(authorization);
  if (!token) {
    return { status: 401, body: { errors: [AUTHENTICATION_ERROR] } };
  }
  const result = await execute({
    schema,
    document,
    rootValue: rootValue(),
    contextValue: { workspace, token } satisfies Context,
    variableValues:
      body.variables && typeof body.variables === "object"
        ? (body.variables as Record<string, unknown>)
        : undefined,
    operationName: typeof body.operationName === "string" ? body.operationName : undefined,
  });
  const errors = result.errors?.map((error) => error.toJSON());
  const status = Math.max(
    200,
    ...(errors ?? []).map(
      (error) => (error.extensions?.http as { status?: number } | undefined)?.status ?? 200,
    ),
  );
  return { status, body: errors?.length ? { ...result, errors } : { data: result.data } };
}

function requestError(
  code: string,
  message: string,
  locations?: readonly { line: number; column: number }[],
): GraphqlResult {
  return {
    status: 400,
    body: {
      errors: [
        {
          message,
          ...(locations ? { locations } : {}),
          extensions: {
            http: { status: 400, headers: {} },
            code,
            type: "graphql error",
            userError: true,
          },
        },
      ],
    },
  };
}

function userError(
  type: string,
  code: string,
  status: number,
  message: string,
  presentable: string,
) {
  return new GraphQLError(message, {
    extensions: {
      type,
      code,
      statusCode: status,
      userError: true,
      userPresentableMessage: presentable,
      meta: {},
      http: { status },
    },
  });
}

function notFound(entity: string) {
  return userError(
    "invalid input",
    "INPUT_ERROR",
    400,
    `Entity not found: ${entity}`,
    `Could not find referenced ${entity}.`,
  );
}

function requireScope(context: Context, ...scopes: string[]) {
  if (!scopes.some((scope) => context.token.scopes.includes(scope))) {
    throw userError(
      "forbidden",
      "FORBIDDEN",
      403,
      `Invalid scope: \`${scopes.join("` or `")}\` required`,
      "You don't have permission to perform this operation.",
    );
  }
}

function connection<T>(nodes: T[]) {
  return {
    nodes,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    },
  };
}

function views(workspace: LinearWorkspace, viewerId: string) {
  const { state } = workspace;
  const organization = () => ({
    id: state.workspace.id,
    name: state.workspace.name,
    urlKey: state.workspace.url_key,
    logoUrl: null,
    createdAt: isoDate(0),
    updatedAt: isoDate(0),
    teams: () => connection(state.teams.map(team)),
    users: () =>
      connection(
        state.users.flatMap((member) => {
          const person = workspace.person(member.id);
          return person ? [user(person)] : [];
        }),
      ),
  });
  const user = (person: Person) => ({
    id: person.id,
    name: person.name,
    displayName: person.handle,
    email: person.email,
    avatarUrl: null,
    active: true,
    admin: false,
    app: person.app,
    guest: false,
    isMe: person.id === viewerId,
    url: workspace.profileUrl(person),
    createdAt: isoDate(person.created),
    updatedAt: isoDate(person.created),
    organization,
  });
  const userById = (id: string | null) => {
    const person = workspace.person(id);
    return person ? user(person) : null;
  };
  const team = (entry: (typeof state.teams)[number]) => ({
    id: entry.id,
    key: entry.key,
    name: entry.name,
    createdAt: isoDate(0),
    updatedAt: isoDate(0),
    organization,
  });
  const teamByKey = (key: string) => {
    const entry = workspace.team(key);
    if (!entry) {
      throw notFound("Team");
    }
    return team(entry);
  };
  const workflowState = (issue: Issue) => {
    const details = STATE_DETAILS[issue.state];
    return {
      id: stableUuid(`${issue.team}:${issue.state}`),
      name: issue.state,
      type: details.type,
      color: details.color,
      position: details.position,
      team: () => teamByKey(issue.team),
    };
  };
  const comment = (parent: Issue, entry: Comment) => ({
    id: entry.id,
    body: entry.body,
    url: `${workspace.issueUrl(parent)}#comment-${entry.id.slice(0, 8)}`,
    createdAt: isoDate(entry.created),
    updatedAt: isoDate(entry.updated),
    user: () => userById(entry.user),
    issue: () => issue(parent),
  });
  const reaction = (parent: Issue, entry: Reaction) => ({
    id: entry.id,
    emoji: entry.emoji,
    createdAt: isoDate(entry.created),
    updatedAt: isoDate(entry.created),
    user: () => userById(entry.user),
    issue: () => issue(parent),
  });
  const attachment = (parent: Issue, entry: Attachment) => ({
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    url: entry.url,
    metadata: entry.metadata,
    createdAt: isoDate(entry.created),
    updatedAt: isoDate(entry.updated),
    creator: () => userById(entry.creator),
    issue: () => issue(parent),
  });
  const issue = (entry: Issue) => ({
    id: entry.id,
    identifier: entry.identifier,
    number: entry.number,
    title: entry.title,
    description: entry.description,
    priority: 0,
    url: workspace.issueUrl(entry),
    branchName: `${entry.identifier.toLowerCase()}-${workspace.issueUrl(entry).split("/").pop()}`,
    createdAt: isoDate(entry.created),
    updatedAt: isoDate(entry.updated),
    team: () => teamByKey(entry.team),
    state: () => workflowState(entry),
    creator: () => userById(entry.creator),
    assignee: () => userById(entry.assignee),
    comments: () => connection(entry.comments.map((item) => comment(entry, item))),
    attachments: () => connection(entry.attachments.map((item) => attachment(entry, item))),
    reactions: () => entry.reactions.map((item) => reaction(entry, item)),
  });
  return { organization, user, userById, team, teamByKey, issue, comment, reaction, attachment };
}

function rootValue() {
  const issueFor = (context: Context, id: string | null | undefined) => {
    const issue = id ? context.workspace.issue(id) : undefined;
    if (!issue) {
      throw notFound("Issue");
    }
    return issue;
  };
  const viewsFor = (context: Context) => views(context.workspace, context.token.user_id);
  return {
    viewer: (_args: unknown, context: Context) => {
      requireScope(context, "read");
      const viewer = viewsFor(context).userById(context.token.user_id);
      if (!viewer) {
        throw notFound("User");
      }
      return viewer;
    },
    organization: (_args: unknown, context: Context) => {
      requireScope(context, "read");
      return viewsFor(context).organization();
    },
    teams: (_args: unknown, context: Context) => {
      requireScope(context, "read");
      return connection(context.workspace.state.teams.map(viewsFor(context).team));
    },
    team: ({ id }: { id: string }, context: Context) => {
      requireScope(context, "read");
      return viewsFor(context).teamByKey(id);
    },
    users: (_args: unknown, context: Context) => {
      requireScope(context, "read");
      return viewsFor(context).organization().users();
    },
    issue: ({ id }: { id: string }, context: Context) => {
      requireScope(context, "read");
      return viewsFor(context).issue(issueFor(context, id));
    },
    commentCreate: (
      { input }: { input: { body?: string | null; issueId?: string | null } },
      context: Context,
    ) => {
      requireScope(context, "write", "comments:create");
      const issue = issueFor(context, input.issueId);
      if (!input.body?.trim()) {
        throw userError(
          "invalid input",
          "INPUT_ERROR",
          400,
          "Argument Validation Error",
          "Comment body can't be empty.",
        );
      }
      const comment = context.workspace.addComment(issue, context.token.user_id, input.body);
      return {
        success: true,
        lastSyncId: context.workspace.nextSyncId(),
        comment: viewsFor(context).comment(issue, comment),
      };
    },
    reactionCreate: (
      { input }: { input: { emoji: string; issueId?: string | null } },
      context: Context,
    ) => {
      requireScope(context, "write");
      const issue = issueFor(context, input.issueId);
      const reaction = context.workspace.addReaction(issue, context.token.user_id, input.emoji);
      return {
        success: true,
        lastSyncId: context.workspace.nextSyncId(),
        reaction: viewsFor(context).reaction(issue, reaction),
      };
    },
    attachmentCreate: (
      {
        input,
      }: {
        input: {
          issueId: string;
          title: string;
          subtitle?: string | null;
          url: string;
          iconUrl?: string | null;
          metadata?: Record<string, unknown> | null;
        };
      },
      context: Context,
    ) => {
      requireScope(context, "write");
      const issue = issueFor(context, input.issueId);
      const attachment = context.workspace.upsertAttachment(issue, context.token.user_id, input);
      return {
        success: true,
        lastSyncId: context.workspace.nextSyncId(),
        attachment: viewsFor(context).attachment(issue, attachment),
      };
    },
  };
}
