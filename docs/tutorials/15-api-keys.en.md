# Walkthrough: Reading documents you can access with an API key

Run `just dev`, sign in, and open "API Keys" from the settings group at the bottom of the left navigation (the old address `/api-keys` is unchanged). The interface follows the "Appearance & language" setting (in English: Name, Validity, Allowed operations, Create key, and so on); scope labels come from the server's capability registration and keep their registered wording in both languages. Enter a recognizable name, choose "read documents you can access" and a validity period, then click "Create key". Save the full secret shown this one time; you can copy it, and once saved click "I saved it — hide the key". After hiding, leaving the page, reloading, or switching the language or theme, the full value can never be retrieved again — the list shows only the name, prefix, scopes, expiry and revocation status.

The same page can also create a Core Key that only allows "reading your own basic profile". A scope is the permission ceiling of the credential: having the documents scope still requires your current permission on the matching knowledge base, and having the profile scope does not mean you can read documents. Keys provide no member management, no document writes and no ability to create other keys.

## 1. Call it over real HTTP

Open a document you are allowed to read and copy its document ID from the address. In Bash, read the secret interactively as shown so the actual value never enters your command history; the curl below takes its request configuration from standard input:

```bash
read -rsp 'API Key: ' SAAS_API_KEY
read -rp 'Document ID: ' SAAS_DOCUMENT_ID
curl --fail-with-body --config - <<CURL
url = "http://127.0.0.1:3000/api/v1/knowledge/documents/${SAAS_DOCUMENT_ID}"
header = "Authorization: Bearer ${SAAS_API_KEY}"
CURL
unset SAAS_API_KEY
```

The response contains the Markdown, but `can_edit` is false. Calling `GET /api/v1/knowledge/documents` with the same key reads your document summaries; passing `knowledge_base_id` queries the bases you can access, with `can_create` false. Both endpoints support the existing search/pagination contract.

A key holding only `profile:read` can call `GET /api/v1/profile` to read your own basic profile. Machine requests depend on neither cookies nor CSRF; creating, listing and revoking keys still requires a signed-in session, and mutations additionally require a trusted Origin and CSRF.

After revoking the key, replaying the previously saved value against the document request returns 401. Once an administrator revokes the base grant, key reads of that base's resources return 404; a missing scope returns 403. An expired key or a deactivated creator also returns 401. In-flight requests that already passed authentication before the revocation cannot be recalled; every later request must re-check the credential.

## 2. Store only the hash; the creation response never replays

[Core API keys](../../crates/app/src/modules/api_keys/management.rs) generate a 256-bit unpredictable secret from the operating system's random source and store its SHA-256 hash. Name, prefix, creator, scopes, expiry, revocation time and last-used time are written to the [api_keys table](../../migrations/0015_api_keys.sql). The prefix exists only for recognition; it cannot authenticate.

The creation endpoint accepts only a name, the supported scopes and a 1–365 day validity; the creator comes from the current session and cannot be specified by the request. It first locks the current active membership and re-checks the session, then writes the key and the audit entry in one transaction; if the audit fails, the key never comes into existence on its own.

This POST uses no general idempotent-replay table, and the SDK and page do not retry automatically. Submitting again is a new creation: it yields an independent key and secret. If you lose the response, refresh the list, revoke the record by its name and time, and deliberately create a new key. The server cannot recover a lost secret.

The frontend [ApiKeysView](../../packages/views/src/api-keys/api-keys-view.tsx) renders inside the universal shell's settings group. It keeps the secret from the creation response only in the current page state — never in the TanStack Query/Mutation caches, localStorage or persisted state — and cancels a still-pending creation response when you leave. When you return after switching the language or theme, the interface is rebuilt from list metadata; the secret does not appear again. Copying goes through the clipboard callback provided by the app shell. Revoking the new key while its secret is still displayed clears that secret too.

## 3. Permission is the intersection of two conditions

[Credential authentication](../../crates/app/src/modules/api_keys/authentication.rs) checks, on every request, the hash, expiry, revocation, whether the creator is still an active member, and the scopes the request needs. The membership lock is taken before the credential lock; creation, revocation and authentication follow the same order. After authentication, the business module still runs its own base-permission and deletion-state checks.

A request that explicitly carries an Authorization header never falls back to the browser cookie after a failure; session-only management endpoints reject Bearer, so mixed credentials cannot widen machine permissions. A read-only key also gains no write ability through UI capability flags in responses.

The [knowledge-base read entry](../../crates/app/src/modules/knowledge/mod.rs) enables `knowledge:read` only for document detail and document list. Attachment download, export, writes and permission management keep the original session flow; "supports API keys" is never interpreted as opening every route by default.

## 4. Scopes are registered by the actual modules

Core registers `profile:read`; the knowledge base appends `knowledge:read` through the [API assembly entry](../../apps/api/src/lib.rs). `GET /api/v1/api-keys/scopes` returns the options the assembled application really supports, and the creation endpoint rejects anything else. Core contains no knowledge-base scope names or business model.

Removing the knowledge base removes its read routes and scope registration with it; Core key listing, creation, revocation and profile reads keep working. Historical metadata of old keys may remain, but the removed business routes no longer provide capability.

When building your own business, register an explicit scope at the assembly point, call `api_keys::require_read` in the corresponding read handler, and then verify the user's current permission on that business resource. Never skip business authorization based only on the key's scope; when you add a new write operation, design that operation's credential permissions and audit rules separately.

## 5. Verify

```bash
node scripts/test-backend.mjs --test api_keys --test key_documents --test sessions
pnpm exec vitest run apps/web/src/api-keys.test.tsx
just check
```

Core HTTP tests cover the single reveal, the private list, scope/expiry input, CSRF, audit rollback, expiry, user deactivation, revocation, and the rejection of mixed Cookie/Bearer requests. Reference HTTP tests verify the intersection of scope and base grants, that Reader/Editor cannot write through a read-only key either, and that revoked grants are rejected.

`key_documents` additionally starts a real TCP HTTP service, registers, creates a document and a key through an actual reqwest client, reads with Bearer, then revokes and receives 401. It uses no browser interception or fake authentication service; this chapter adds no separate full browser E2E.

View tests verify create/copy/hide, metadata-only after refresh, retrying a failed revocation, and that a failed creation never automatically issues a second POST. The generated contract, the [ownership manifest](../../examples/knowledge-base/manifest.json) and the online documentation are updated together with this chapter.
