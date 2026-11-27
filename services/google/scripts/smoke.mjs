const apiUrl = process.env.WORLDS_API_URL ?? "http://localhost:8791";
const apiKey = process.env.WORLDS_API_KEY ?? "wk_live_smoke0smoke0smoke0smoke0smoke0smoke00";
const origin = (worldId, service) =>
  `http://${worldId.slice("world_".length)}-${service}.localhost:8787`;
const callbackUrl = "http://localhost:5555/oauth/callback";
const run = Date.now();
const credentials = {
  client_id: `622449777375-smoke${run}.apps.googleusercontent.com`,
  client_secret: `GOCSPX-smoke-secret-${run}`,
  api_key: `AIzaSmokeKey${run}`,
};
const ids = {
  projects: "1projectsFolder000000000000000001",
  picked: "1pickedTextFile00000000000000000002",
  plan: "1planGoogleDoc0000000000000000000003",
  bobDoc: "1bobSharedDoc00000000000000000000004",
  notes: "1notesNotPicked000000000000000000005",
  bobPrivate: "1bobPrivateFile00000000000000000006",
};
const spec = {
  users: [
    { email: "alice@smoke.test", name: "Alice Tester" },
    { email: "bob@smoke.test", name: "Bob Tester" },
  ],
  apps: [
    {
      name: "Probe",
      project_number: "622449777375",
      redirect_uris: [callbackUrl],
      credentials,
    },
  ],
  files: [
    {
      id: ids.projects,
      name: "Projects",
      mime_type: "application/vnd.google-apps.folder",
      owner: "alice@smoke.test",
    },
    {
      id: ids.picked,
      name: "language_model.py",
      mime_type: "text/plain",
      owner: "alice@smoke.test",
      parent: ids.projects,
      content: "print('hi')\n",
    },
    {
      id: ids.plan,
      name: "Plan",
      mime_type: "application/vnd.google-apps.document",
      owner: "alice@smoke.test",
      content: "Ship the picker",
    },
    {
      id: ids.bobDoc,
      name: "JAPAN",
      mime_type: "application/vnd.google-apps.document",
      owner: "bob@smoke.test",
      content: "Itinerary",
      shared_with: [{ user: "alice@smoke.test", role: "reader" }],
    },
    {
      id: ids.notes,
      name: "notes.txt",
      mime_type: "text/plain",
      owner: "alice@smoke.test",
      content: "private",
    },
    {
      id: ids.bobPrivate,
      name: "bob.txt",
      mime_type: "text/plain",
      owner: "bob@smoke.test",
      content: "bob only",
    },
  ],
  grants: [{ app: "Probe", user: "alice@smoke.test", file: ids.picked }],
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

const control = (method, body) => ({
  method,
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const form = (body) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(body),
});

let worldId = "";
try {
  const invalid = await fetch(
    `${apiUrl}/api/worlds`,
    control("POST", {
      name: "Invalid",
      google: {
        ...spec,
        grants: [{ app: "Probe", user: "alice@smoke.test", file: "1doesNotExist0000000" }],
      },
    }),
  );
  assert(
    invalid.status === 400 && (await invalid.json()).error.message.includes("no file with id"),
    "a Google spec that grants an unknown file is refused",
  );

  const created = await fetch(
    `${apiUrl}/api/worlds`,
    control("POST", { name: "Google smoke", google: spec }),
  );
  const world = await created.json();
  worldId = world.id;
  const accounts = origin(worldId, "google");
  const api = origin(worldId, "google-api");
  const alice = world.google.spec.users[0];
  assert(
    created.status === 201 &&
      world.google.accounts_url.includes(`${worldId.slice("world_".length)}-google.`) &&
      world.google.api_url.includes(`${worldId.slice("world_".length)}-google-api.`) &&
      alice.root_folder_id.startsWith("0A") &&
      world.google.spec.apps[0].credentials.api_key === credentials.api_key,
    "POST /api/worlds creates Google accounts, ids and both hosts",
  );

  const authorize = (overrides = {}) =>
    new URLSearchParams({
      client_id: credentials.client_id,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      state: "smoke-state",
      ...overrides,
    });
  const mismatch = await fetch(
    `${accounts}/o/oauth2/v2/auth?${authorize({ redirect_uri: "http://evil.test/cb" })}`,
  );
  assert(
    mismatch.status === 400 && (await mismatch.text()).includes("redirect_uri_mismatch"),
    "authorize refuses an unregistered redirect_uri with redirect_uri_mismatch",
  );
  const wideScope = await fetch(
    `${accounts}/o/oauth2/v2/auth?${authorize({ scope: "https://www.googleapis.com/auth/drive" })}`,
  );
  assert(wideScope.status === 400, "scopes other than drive.file, email and profile are refused");
  const consent = await fetch(`${accounts}/o/oauth2/v2/auth?${authorize()}`);
  const consentHtml = await consent.text();
  assert(
    consent.status === 200 &&
      consentHtml.includes(`value="${alice.id}"`) &&
      consentHtml.includes("only the specific Google Drive files"),
    "authorize shows an account chooser with the drive.file consent text",
  );

  const signIn = async (user) => {
    const accepted = await fetch(`${accounts}/o/oauth2/v2/auth`, {
      method: "POST",
      body: new URLSearchParams([...authorize(), ["user_id", user.id], ["decision", "accept"]]),
      redirect: "manual",
    });
    const location = new URL(accepted.headers.get("location"));
    return { accepted, location, code: location.searchParams.get("code") };
  };
  const { accepted, location, code } = await signIn(alice);
  assert(
    accepted.status === 302 &&
      location.origin + location.pathname === callbackUrl &&
      location.searchParams.get("state") === "smoke-state" &&
      location.searchParams.get("scope") === "https://www.googleapis.com/auth/drive.file" &&
      code.startsWith("4/0"),
    "consent redirects with code, state and scope",
  );

  const badSecret = await fetch(
    `${api}/token`,
    form({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: credentials.client_id,
      client_secret: "nope-nope-nope-nope",
    }),
  );
  assert(
    badSecret.status === 401 && (await badSecret.json()).error === "invalid_client",
    "a wrong client secret is invalid_client",
  );
  const exchange = await fetch(
    `${api}/token`,
    form({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, ...credentials }),
  );
  const tokens = await exchange.json();
  assert(
    exchange.status === 200 &&
      tokens.access_token.startsWith("ya29.") &&
      tokens.refresh_token.startsWith("1//0") &&
      tokens.expires_in === 3599 &&
      tokens.refresh_token_expires_in > 604_000 &&
      tokens.scope === "https://www.googleapis.com/auth/drive.file",
    "the code exchanges for tokens with a 7-day Testing-mode refresh token",
  );
  const reused = await fetch(
    `${api}/token`,
    form({ grant_type: "authorization_code", code, redirect_uri: callbackUrl, ...credentials }),
  );
  assert(
    reused.status === 400 && (await reused.json()).error === "invalid_grant",
    "a used code is invalid_grant",
  );

  const info = await (await fetch(`${api}/tokeninfo?access_token=${tokens.access_token}`)).json();
  assert(
    info.aud === credentials.client_id &&
      info.scope === "https://www.googleapis.com/auth/drive.file" &&
      info.access_type === "offline",
    "tokeninfo reports the client, drive.file scope and offline access",
  );

  const auth = (token) => ({ authorization: `Bearer ${token}` });
  let token = tokens.access_token;
  const driveGet = (path) => fetch(`${api}${path}`, { headers: auth(token) });

  const anonymous = await fetch(`${api}/drive/v3/files`);
  const anonymousBody = await anonymous.json();
  assert(
    anonymous.status === 401 &&
      anonymousBody.error.errors[0].reason === "required" &&
      anonymousBody.error.status === "UNAUTHENTICATED",
    "Drive without a token answers 401 required",
  );

  const listed = await (await driveGet("/drive/v3/files")).json();
  assert(
    listed.kind === "drive#fileList" &&
      listed.files.length === 1 &&
      listed.files[0].id === ids.picked &&
      Object.keys(listed.files[0]).sort().join() === "id,kind,mimeType,name",
    "files.list returns only granted files, with the default fields",
  );
  const picked = await (
    await driveGet(
      `/drive/v3/files/${ids.picked}?fields=id,parents,isAppAuthorized,capabilities(canEdit,canListChildren),webViewLink`,
    )
  ).json();
  assert(
    picked.isAppAuthorized === true &&
      picked.parents[0] === ids.projects &&
      picked.capabilities.canEdit === true &&
      picked.capabilities.canListChildren === false &&
      picked.webViewLink.endsWith(`/file/d/${ids.picked}/view?usp=drivesdk`),
    "a granted file has isAppAuthorized, its parent id and Drive's links",
  );
  const media = await driveGet(`/drive/v3/files/${ids.picked}?alt=media`);
  assert(
    media.status === 200 && (await media.text()) === "print('hi')\n",
    "alt=media returns a granted file's bytes",
  );

  const hidden = await driveGet(`/drive/v3/files/${ids.projects}`);
  const hiddenBody = await hidden.json();
  assert(
    hidden.status === 404 &&
      hiddenBody.error.message === `File not found: ${ids.projects}.` &&
      hiddenBody.error.errors[0].reason === "notFound" &&
      hiddenBody.error.errors[0].location === "fileId",
    "an ungranted file is 404 notFound, even the granted file's parent",
  );
  const children = await (
    await driveGet(`/drive/v3/files?q=${encodeURIComponent(`'${ids.projects}' in parents`)}`)
  ).json();
  assert(
    children.files.map((file) => file.id).join() === ids.picked,
    "listing an ungranted folder's children returns only granted children",
  );
  const exportHidden = await driveGet(`/drive/v3/files/${ids.plan}/export?mimeType=text/plain`);
  const exportHiddenBody = await exportHidden.json();
  assert(
    exportHidden.status === 403 &&
      exportHiddenBody.error.errors[0].reason === "appNotAuthorizedToFile" &&
      exportHiddenBody.error.message.includes("app 622449777375"),
    "export of an ungranted Doc is 403 appNotAuthorizedToFile naming the project",
  );
  const badField = await driveGet("/drive/v3/files?fields=files(nope)");
  assert(
    badField.status === 400 &&
      (await badField.json()).error.errors[0].reason === "invalidParameter",
    "unknown fields are invalidParameter",
  );
  const badQuery = await driveGet(
    `/drive/v3/files?q=${encodeURIComponent("fullText contains 'x'")}`,
  );
  assert(
    badQuery.status === 400 && (await badQuery.json()).error.errors[0].location === "q",
    "unsupported q is Invalid Value",
  );

  const script = await (await fetch(`${accounts}/js/api.js`)).text();
  assert(
    script.includes("PickerBuilder") && script.includes(JSON.stringify(accounts)),
    "/js/api.js serves the Picker shim bound to the world",
  );
  const picker = (path, body, bearer = token) =>
    fetch(`${accounts}/picker/api/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
  const badKey = await picker("files", {
    developerKey: "AIzaWrong",
    view: { viewId: "all", options: {} },
  });
  assert(
    badKey.status === 400 &&
      (await badKey.json()).error.message === "The API developer key is invalid.",
    "the Picker refuses an unknown developer key",
  );
  const treeView = { viewId: "all", options: { selectFolder: true, includeFolders: true } };
  const listing = await (
    await picker("files", { developerKey: credentials.api_key, view: treeView })
  ).json();
  const pickable = listing.files.map((file) => file.id);
  assert(
    listing.root_id === alice.root_folder_id &&
      pickable.includes(ids.notes) &&
      pickable.includes(ids.bobDoc) &&
      pickable.includes(ids.projects) &&
      !pickable.includes(ids.bobPrivate),
    "the Picker lists every file the user can see, granted or not",
  );

  const noAppId = await (
    await picker("pick", {
      developerKey: credentials.api_key,
      view: { viewId: "all", options: {} },
      ids: [ids.plan],
    })
  ).json();
  assert(
    noAppId.action === "picked" &&
      noAppId.docs[0].serviceId === "doc" &&
      noAppId.docs[0].driveSuccess === undefined,
    "picking without setAppId returns the doc without driveSuccess",
  );
  assert(
    (await driveGet(`/drive/v3/files/${ids.plan}`)).status === 404,
    "a pick without setAppId grants nothing",
  );

  const withAppId = await (
    await picker("pick", {
      developerKey: credentials.api_key,
      appId: "622449777375",
      view: treeView,
      ids: [ids.plan, ids.bobDoc, ids.projects],
    })
  ).json();
  const [planDoc, bobDoc, folderDoc] = withAppId.docs;
  assert(
    JSON.stringify(withAppId.viewToken) ===
      JSON.stringify(["all", null, { selectFolder: true, includeFolders: true }]) &&
      planDoc.driveSuccess === true &&
      planDoc.url.endsWith(`/document/d/${ids.plan}/edit?usp=drive_web`) &&
      planDoc.parentId === alice.root_folder_id &&
      bobDoc.isShared === true &&
      bobDoc.parentId === undefined &&
      folderDoc.type === "folder" &&
      folderDoc.sizeBytes === undefined &&
      folderDoc.embedUrl.endsWith(`/embeddedfolderview?id=${ids.projects}`),
    "picking with setAppId returns Picker-shaped docs with driveSuccess",
  );
  const planMedia = await driveGet(`/drive/v3/files/${ids.plan}?alt=media`);
  assert(
    planMedia.status === 403 &&
      (await planMedia.json()).error.errors[0].reason === "fileNotDownloadable",
    "alt=media on a Doc is fileNotDownloadable",
  );
  const planText = await driveGet(`/drive/v3/files/${ids.plan}/export?mimeType=text/plain`);
  assert(
    planText.status === 200 && (await planText.text()) === "Ship the picker",
    "export returns a granted Doc's text",
  );
  const binaryExport = await driveGet(`/drive/v3/files/${ids.picked}/export?mimeType=text/plain`);
  assert(
    binaryExport.status === 403 &&
      (await binaryExport.json()).error.errors[0].reason === "fileNotExportable",
    "export of a non-Docs file is fileNotExportable",
  );
  const shared = await (
    await driveGet(`/drive/v3/files/${ids.bobDoc}?fields=parents,capabilities(canEdit),ownedByMe`)
  ).json();
  assert(
    shared.parents === undefined &&
      shared.capabilities.canEdit === false &&
      shared.ownedByMe === false,
    "a shared Doc follows the user's role and has no parents",
  );
  const folder = await (
    await driveGet(`/drive/v3/files/${ids.projects}?fields=capabilities(canListChildren)`)
  ).json();
  assert(
    folder.capabilities.canListChildren === true,
    "a picked folder is visible with canListChildren",
  );

  const boundary = "smoke-boundary";
  const upload = (parent) =>
    fetch(`${api}/upload/drive/v3/files?uploadType=multipart&fields=id,parents,isAppAuthorized`, {
      method: "POST",
      headers: { ...auth(token), "content-type": `multipart/related; boundary=${boundary}` },
      body: `--${boundary}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify({ name: "probe.txt", mimeType: "text/plain", ...(parent ? { parents: [parent] } : {}) })}\r\n--${boundary}\r\ncontent-type: text/plain\r\n\r\nhello\r\n--${boundary}--`,
    });
  const rootUpload = await (await upload()).json();
  assert(
    rootUpload.parents[0] === alice.root_folder_id && rootUpload.isAppAuthorized === true,
    "a multipart upload lands in My Drive and is granted",
  );
  const otherRoot = await upload(world.google.spec.users[1].root_folder_id);
  assert(otherRoot.status === 404, "uploading into someone else's My Drive is notFound");
  const afterUpload = await (await driveGet("/drive/v3/files?fields=files(id)")).json();
  assert(
    afterUpload.files.some((file) => file.id === rootUpload.id),
    "the app sees the file it created",
  );

  const refreshed = await (
    await fetch(
      `${api}/token`,
      form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, ...credentials }),
    )
  ).json();
  assert(
    refreshed.access_token &&
      refreshed.refresh_token === undefined &&
      refreshed.refresh_token_expires_in > 0,
    "refresh returns a new access token without rotating",
  );
  const revoked = await fetch(`${api}/revoke?token=${tokens.refresh_token}`, { method: "POST" });
  assert(
    revoked.status === 200 && JSON.stringify(await revoked.json()) === "{}",
    "revoke answers 200 {}",
  );
  assert(
    (await fetch(`${api}/drive/v3/files`, { headers: auth(refreshed.access_token) })).status ===
      401,
    "revoking drops the grant's access tokens",
  );

  const again = await signIn(alice);
  const second = await (
    await fetch(
      `${api}/token`,
      form({
        grant_type: "authorization_code",
        code: again.code,
        redirect_uri: callbackUrl,
        ...credentials,
      }),
    )
  ).json();
  token = second.access_token;
  const survived = await (await driveGet("/drive/v3/files?fields=files(id)")).json();
  assert(
    [ids.picked, ids.plan, ids.bobDoc, ids.projects, rootUpload.id].every((id) =>
      survived.files.some((file) => file.id === id),
    ),
    "file grants survive revoke and a new consent",
  );

  const granted = await fetch(
    `${accounts}/_worlds/google/grants`,
    control("POST", { app: "Probe", user: "alice@smoke.test", file: ids.notes }),
  );
  assert(granted.status === 201, "the grants control route adds a grant without the Picker");
  const state = await (await fetch(`${accounts}/_worlds/google/state`, control("GET"))).json();
  assert(
    state.grants.some((grant) => grant.file === ids.notes) &&
      state.files.length === spec.files.length + 1,
    "the state control route lists files and grants",
  );
  const drivePage = await fetch(`${accounts}/`);
  assert(drivePage.status === 401, "the Drive UI is for members of the world's team only");
} finally {
  if (worldId) {
    await fetch(`${apiUrl}/api/worlds/${worldId}`, control("DELETE"));
  }
}
console.log("google smoke passed");
