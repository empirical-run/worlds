import { CodeBlock } from "../components/CodeBlock";
import { Notice } from "../components/Notice";
import { type RailHandle } from "../components/Rail";
import { highlight } from "../highlight.server";
import type { Route } from "./+types/google-picker";

export const headers: Route.HeadersFunction = () => ({
  "Cache-Control": "private, max-age=10",
  Vary: "Cookie",
});

export const meta = () => [{ title: "Google Picker · Worlds" }];

export const handle: RailHandle = {
  railIndex: () => [
    {
      links: [
        { id: "how", label: "How it works" },
        { id: "world", label: "Create a world" },
        { id: "sign-in", label: "Sign in" },
        { id: "load", label: "Open the Picker" },
        { id: "callback", label: "Callback data" },
        { id: "grants", label: "What the app can see" },
        { id: "csp", label: "Content Security Policy" },
        { id: "headless", label: "Tests without a browser" },
        { id: "support", label: "What's supported" },
      ],
    },
  ],
};

const worldExample = `curl -X POST https://makeworlds.dev/api/worlds \\
  -H "Authorization: Bearer $WORLDS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "name": "Picker test",
    "google": {
      "users": [
        { "email": "alice@acme.test", "name": "Alice Tester" },
        { "email": "bob@acme.test", "name": "Bob Tester" }
      ],
      "apps": [{
        "name": "My app",
        "redirect_uris": ["https://staging.example.com/google/callback"]
      }],
      "files": [
        { "id": "1evalsFolder000000000000000001", "name": "evals",
          "mime_type": "application/vnd.google-apps.folder", "owner": "alice@acme.test" },
        { "name": "notes.txt", "mime_type": "text/plain", "owner": "alice@acme.test",
          "parent": "1evalsFolder000000000000000001", "content": "hello" },
        { "name": "Plan", "mime_type": "application/vnd.google-apps.document",
          "owner": "bob@acme.test", "content": "Ship it",
          "shared_with": [{ "user": "alice@acme.test", "role": "reader" }] }
      ]
    }
  }'`;

const configExample = `const app = world.google.spec.apps[0];

const google = {
  accountsUrl: world.google.accounts_url, // accounts.google.com, apis.google.com
  apiUrl: world.google.api_url, // oauth2.googleapis.com, www.googleapis.com
  clientId: app.credentials.client_id,
  clientSecret: app.credentials.client_secret,
  apiKey: app.credentials.api_key, // the Picker's developer key
  appId: app.project_number, // the Picker's setAppId
};`;

const signInExample = `const authorize = new URL("/o/oauth2/v2/auth", google.accountsUrl);
authorize.search = new URLSearchParams({
  client_id: google.clientId,
  redirect_uri: "https://staging.example.com/google/callback",
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive.file",
  access_type: "offline",
  state,
}).toString();

const tokens = await fetch(\`\${google.apiUrl}/token\`, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: "https://staging.example.com/google/callback",
    client_id: google.clientId,
    client_secret: google.clientSecret,
  }),
}).then((response) => response.json());`;

const scriptExample = `<script src="https://{world}-google.makeworlds.dev/js/api.js"></script>`;

const pickerExample = `gapi.load("picker", () => {
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true);

  new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(accessToken)
    .setDeveloperKey(google.apiKey)
    .setAppId(google.appId)
    .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
    .setCallback((data) => {
      if (data.action === google.picker.Action.PICKED) {
        savePicked(data.docs.map((doc) => doc.id));
      }
    })
    .build()
    .setVisible(true);
});`;

const fileCallback = `{
  "action": "picked",
  "viewToken": ["all", null, { "selectFolder": true, "includeFolders": true }],
  "docs": [{
    "id": "1PkTjKF2JCbeXbIsmB8hjuQgKKzJGKeZr",
    "serviceId": "DoclistBlob",
    "mimeType": "text/plain",
    "name": "notes.txt",
    "description": "",
    "type": "file",
    "lastEditedUtc": 1795770581558,
    "iconUrl": "https://drive-thirdparty.googleusercontent.com/16/type/text/plain",
    "url": "https://{world}-google.makeworlds.dev/file/d/1PkTjKF2JCbeXbIsmB8hjuQgKKzJGKeZr/view?usp=drive_web",
    "embedUrl": "https://{world}-google.makeworlds.dev/file/d/1PkTjKF2JCbeXbIsmB8hjuQgKKzJGKeZr/preview?usp=drive_web",
    "driveSuccess": true,
    "sizeBytes": 5,
    "parentId": "1evalsFolder000000000000000001"
  }]
}`;

const docCallback = `{
  "id": "1yj5mTaLERFlULDag-jnVliN9VAcwY9hRTKkzHfYcuRU",
  "serviceId": "doc",
  "mimeType": "application/vnd.google-apps.document",
  "name": "Plan",
  "description": "",
  "type": "document",
  "lastEditedUtc": 1795092130544,
  "iconUrl": "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.document",
  "url": "https://{world}-google.makeworlds.dev/document/d/1yj5mTaLERFlULDag-jnVliN9VAcwY9hRTKkzHfYcuRU/edit?usp=drive_web",
  "embedUrl": "https://{world}-google.makeworlds.dev/document/d/1yj5mTaLERFlULDag-jnVliN9VAcwY9hRTKkzHfYcuRU/preview",
  "driveSuccess": true,
  "sizeBytes": 7,
  "isShared": true
}`;

const folderCallback = `{
  "id": "1evalsFolder000000000000000001",
  "serviceId": "docs",
  "mimeType": "application/vnd.google-apps.folder",
  "name": "evals",
  "description": "",
  "type": "folder",
  "lastEditedUtc": 1795770581558,
  "iconUrl": "https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.google-apps.folder",
  "url": "https://{world}-google.makeworlds.dev/drive/folders/1evalsFolder000000000000000001",
  "embedUrl": "https://{world}-google.makeworlds.dev/embeddedfolderview?id=1evalsFolder000000000000000001",
  "driveSuccess": true,
  "parentId": "0ATiBAiKc4jyzBZpbgqPVA"
}`;

const cspExample = `Content-Security-Policy:
  script-src 'self' https://apis.google.com https://*.makeworlds.dev;
  frame-src https://docs.google.com https://*.makeworlds.dev;
  connect-src 'self' https://www.googleapis.com https://*.makeworlds.dev`;

const grantExample = `curl -X POST "https://{world}-google.makeworlds.dev/_worlds/google/grants" \\
  -H "Authorization: Bearer $WORLDS_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{
    "app": "My app",
    "user": "alice@acme.test",
    "file": "1evalsFolder000000000000000001"
  }'`;

export async function loader() {
  const [world, config, signIn, script, picker, file, doc, folder, csp, grant] = await Promise.all([
    highlight(worldExample, "bash"),
    highlight(configExample, "ts"),
    highlight(signInExample, "ts"),
    highlight(scriptExample, "ts"),
    highlight(pickerExample, "ts"),
    highlight(fileCallback, "ts"),
    highlight(docCallback, "ts"),
    highlight(folderCallback, "ts"),
    highlight(cspExample, "bash"),
    highlight(grantExample, "bash"),
  ]);
  return { examples: { world, config, signIn, script, picker, file, doc, folder, csp, grant } };
}

export default function GooglePicker({ loaderData: { examples } }: Route.ComponentProps) {
  return (
    <article>
      <header className="section hero">
        <h1>Google Picker</h1>
        <p className="lede">
          Test an app that asks for <code>drive.file</code> and lets people pick Drive files with
          the Google Picker. The world copies how real Google behaves, down to which files the app
          can see after a pick.
        </p>
      </header>

      <section className="section" id="how">
        <h2>How it works</h2>
        <p>
          The Picker is not an HTTP API. It is a browser library: your page loads{" "}
          <code>apis.google.com/js/api.js</code>, builds a picker, and Google opens an iframe where
          the person picks files. The iframe posts the result back to your page, and Google records
          on its servers that your app may now open those files. Only then can your backend read
          them with the <code>drive.file</code> scope.
        </p>
        <p>A world does the same, on its own hosts:</p>
        <ul>
          <li>
            <code>/js/api.js</code> on the world&apos;s accounts URL defines <code>gapi.load</code>{" "}
            and <code>google.picker</code> with Google&apos;s class and method names.
          </li>
          <li>
            <code>setVisible(true)</code> opens an iframe from the world. It lists the signed-in
            user&apos;s files, then posts <code>loaded</code> and <code>picked</code> (or{" "}
            <code>cancel</code>) to your callback.
          </li>
          <li>
            A pick from a picker built with <code>setAppId</code> set to your app&apos;s project
            number grants your app those files for that user. Drive v3 on the world&apos;s API URL
            then shows them to your app&apos;s tokens.
          </li>
        </ul>
        <p>
          Apart from base URLs and credentials, your code doesn&apos;t change. That includes the
          OAuth flow, the Picker code and the Drive calls.
        </p>
      </section>

      <section className="section" id="world">
        <h2>Create a world</h2>
        <p>
          Give the world users, an OAuth app with your redirect URI, and the files the users should
          have. Pin a file&apos;s <code>id</code> to put files in it or refer to it later. Leave out
          the app&apos;s <code>project_number</code> and <code>credentials</code> to have them
          generated.
        </p>
        <CodeBlock lines={examples.world} />
        <p>Everything your app needs comes back in the response:</p>
        <CodeBlock lines={examples.config} />
      </section>

      <section className="section" id="sign-in">
        <h2>Sign in</h2>
        <p>
          The OAuth flow is Google&apos;s authorization code flow. The consent page lets you choose
          which of the world&apos;s users signs in. Every user is a test user, as in an app in
          Testing mode. <code>redirect_uri</code> must equal one of the app&apos;s{" "}
          <code>redirect_uris</code> exactly.
        </p>
        <CodeBlock lines={examples.signIn} />
        <p>
          Scopes are <code>drive.file</code>, <code>email</code> and <code>profile</code>; others
          are refused. Access tokens last an hour. Refresh tokens don&apos;t change on refresh and
          expire after 7 days, as in Testing mode.
        </p>
      </section>

      <section className="section" id="load">
        <h2>Open the Picker</h2>
        <p>
          Load the script from the world&apos;s accounts URL instead of{" "}
          <code>https://apis.google.com</code>:
        </p>
        <CodeBlock lines={examples.script} />
        <p>Then build the Picker exactly as you would against Google:</p>
        <CodeBlock lines={examples.picker} />
        <ul>
          <li>
            <code>setOAuthToken</code> takes an access token from the world with the{" "}
            <code>drive.file</code> scope.
          </li>
          <li>
            <code>setDeveloperKey</code> must be the app&apos;s <code>api_key</code>. The Picker
            shows &ldquo;The API developer key is invalid.&rdquo; otherwise.
          </li>
          <li>
            <code>setAppId</code> must be the app&apos;s <code>project_number</code>, or picks grant
            nothing.
          </li>
        </ul>
      </section>

      <section className="section" id="callback">
        <h2>Callback data</h2>
        <p>
          The callback first gets <code>{`{ "action": "loaded" }`}</code> when the Picker opens,
          then a <code>picked</code> result. The document fields and their order match the real
          Picker. This is a picked file:
        </p>
        <CodeBlock lines={examples.file} />
        <p>
          A shared Google Doc has no <code>parentId</code> and is marked as shared:
        </p>
        <CodeBlock lines={examples.doc} />
        <p>
          A folder has no <code>sizeBytes</code>:
        </p>
        <CodeBlock lines={examples.folder} />
        <p>
          <code>driveSuccess: true</code> appears only when the pick granted the file, that is, when
          the picker had the right <code>setAppId</code>. Cancelling sends{" "}
          <code>{`{ "action": "cancel" }`}</code>.
        </p>
      </section>

      <section className="section" id="grants">
        <h2>What the app can see</h2>
        <p>
          A grant belongs to the app and the user, not to a token. It outlives token refresh,
          revocation and a new consent.
        </p>
        <p>A grant comes from:</p>
        <ul>
          <li>
            a pick in a Picker built with the app&apos;s <code>setAppId</code>;
          </li>
          <li>a file the app created through Drive;</li>
          <li>
            the <code>grants</code> in the world spec or the grants control route (see{" "}
            <a href="#headless">below</a>).
          </li>
        </ul>
        <p>
          With a <code>drive.file</code> token, Drive v3 behaves as it does at Google:
        </p>
        <ul>
          <li>
            <code>files.list</code> and <code>q</code> searches return only granted files. Listing a
            folder&apos;s children returns only the granted children, even when the folder itself
            isn&apos;t granted.
          </li>
          <li>
            <code>files.get</code> and <code>alt=media</code> on any other file are 404{" "}
            <code>notFound</code>, the same answer as for a file that doesn&apos;t exist.{" "}
            <code>export</code> on an ungranted Google Doc is 403{" "}
            <code>appNotAuthorizedToFile</code>.
          </li>
          <li>
            Picking a folder grants the folder, not what&apos;s in it. The folder shows{" "}
            <code>canListChildren: true</code>, and its children still need their own grants.
          </li>
          <li>
            Google Docs files download with <code>export</code> (plain text, Markdown or HTML);{" "}
            <code>alt=media</code> on them is 403 <code>fileNotDownloadable</code>.
          </li>
          <li>
            The app can upload into any folder the user can write to, including folders it
            can&apos;t read. The new file is granted to the app.
          </li>
          <li>
            Capabilities follow the user&apos;s role, so a Doc shared with them as a reader has{" "}
            <code>canEdit: false</code>.
          </li>
        </ul>
      </section>

      <section className="section" id="csp">
        <h2>Content Security Policy</h2>
        <Notice>
          <p>
            If your app sends a Content Security Policy, allow the world&apos;s hosts next to
            Google&apos;s. Otherwise the browser blocks the Picker script or its iframe. The page
            shows nothing and logs only a CSP error in the console. A CSP wildcard covers a whole
            host label, so allow <code>https://*.makeworlds.dev</code> or the world&apos;s exact
            hosts.
          </p>
        </Notice>
        <CodeBlock lines={examples.csp} />
      </section>

      <section className="section" id="headless">
        <h2>Tests without a browser</h2>
        <p>
          Most end-to-end tests want the result of a pick, not the clicks. The grants control route
          gives the app a file for a user, as picking it would:
        </p>
        <CodeBlock lines={examples.grant} />
        <p>
          <code>GET /_worlds/google/state</code> lists every file and grant, and{" "}
          <code>POST /_worlds/google/files</code> adds files mid-test. Both are in the{" "}
          <a href="/docs/api">API reference</a> under Google Drive world.
        </p>
      </section>

      <section className="section" id="support">
        <h2>What&apos;s supported</h2>
        <ul>
          <li>
            <strong>Picker:</strong> <code>PickerBuilder</code>, <code>DocsView</code> with{" "}
            <code>setIncludeFolders</code>, <code>setSelectFolderEnabled</code>,{" "}
            <code>setMimeTypes</code> and <code>setOwnedByMe</code>; the <code>ViewId</code> views
            for Docs, Sheets, Slides, PDFs, images, videos and folders;{" "}
            <code>MULTISELECT_ENABLED</code> and <code>setMaxItems</code>; search, folder browsing
            and a Shared with me tab.
          </li>
          <li>
            <strong>Not yet:</strong> the upload view, shared drives, <code>setParent</code> as a
            starting folder, the recently picked view, thumbnails and the grid layout.
          </li>
          <li>
            <strong>Not checked against Google yet:</strong> the <code>cancel</code> payload, and{" "}
            <code>serviceId</code> and <code>type</code> for Sheets (<code>spread</code>,{" "}
            <code>spreadsheet</code>) and Slides (<code>pres</code>, <code>presentation</code>).
            Files, Docs and folders were checked against the real Picker.
          </li>
        </ul>
      </section>
    </article>
  );
}
