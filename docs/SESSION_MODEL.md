# Multiple users, sessions, and VS Code windows

Supporting simultaneous users and VS Code instances is a Stage 1 requirement.

## Ownership

| Resource | Scope |
| --- | --- |
| Saved profiles | VS Code's extension global storage location for that OS user and VS Code profile/user-data directory. Windows using the same location share profiles. |
| Passwords | VS Code SecretStorage, addressed by immutable secret identifiers referenced by profile revisions. |
| Selected connection and SQL-document association | One extension host/window; not persisted globally. |
| Unsaved connection form and its test controller | One editor within one extension host. Tests never save profiles or passwords. |
| Active clients, read-only transactions, and cancellation controllers | One operation within one extension host. |
| Query handles, cached results, and history | One extension host session, in memory. |
| Copilot tool calls | The extension host serving the VS Code window invoking the native tool. |

Separate OS users normally have separate VS Code storage and credential contexts. This extension uses those platform boundaries; it is not a security sandbox against other code running as the same OS user. Different VS Code profiles or custom user-data directories may intentionally use different storage locations even for the same OS user.

With remote development, the workspace extension runs where the extension host runs. Its profile files and outbound database connectivity are associated with that host. Remote development and concurrent Windows/RDP sessions remain deployment validation targets.

## Query isolation

- Generate a random session ID when each extension host activates.
- Prefix every query handle with that session ID and add a separate random query UUID.
- Keep the execution registry in that host's memory. Lookups also require the matching connection ID.
- PostgreSQL, SQL Server and Oracle allocate a dedicated client/pool for an operation. BigQuery allocates a unique job ID. Snowflake reuses idle authenticated connections only within the owning host and assigns one operation per connection. No connection, transaction or cursor is shared between windows.
- Cancelling, disconnecting, clearing history, or disposing one host acts only on that host's operations and results.
- Do not expose a query HTTP listener or use a shared port for Copilot. Native tools invoke the local service directly. Snowflake OAuth can open a temporary loopback authentication callback on an available port; it is not a query endpoint.
- Recheck the current profile and Copilot opt-in before agent operations and result retrieval.

A query ID from window A cannot retrieve or cancel work in window B, even when both windows use the same saved profile.

The Database Results bottom-panel tab belongs to its window. Switching to Output or Terminal preserves its current result in memory; opening another VS Code window starts with no active connection or query results.

## Shared profile edits

Profiles are read fresh from disk for each operation. Writes use a short directory lock, a temporary file, and atomic rename. An expected revision must match before an edit or removal succeeds; a stale editor gets a conflict message and must reopen the profile.

Adding and editing use a full connection form. A second request to edit the same connection in one window reveals the existing form. Different windows may keep separate drafts; saved revisions detect conflicting edits. Closing a form aborts its in-flight connection test. Tests share that window's four-operation limit but never register a saved profile or change another window's connection state.

New profile revisions use new secret references. Previous references are retained in the profile until removal to avoid replacing credentials that another host is about to use. A successful profile removal deletes those referenced secrets.

The explorer refreshes after storage changes and when the window regains focus. Shared changes are visible to other windows, but they do not silently change a running operation's connection snapshot. Removing or disabling a profile blocks new access; it is not a cross-window cancellation broadcast. An already-running operation in another window may finish, but removed profiles cannot be used to retrieve its results through the service.

The lock has a bounded wait. It deliberately does not steal an apparently stale lock based only on elapsed time. If a process crashes during a write and leaves `connections.lock`, close all windows using that storage location before removing that lock directory and retrying. Existing profile data is preserved.

## Verification

- Two simultaneous VS Code windows share saved profiles and select different connections; selecting one does not change the other window’s active connection or results.
- Three independent Node processes add profiles to the same storage directory; all 45 profiles must remain.
- Two repositories load/edit the same profile; stale edits and removals must fail.
- Two service instances share a profile; neither can read or cancel the other's query handles.
- Real PostgreSQL queries run concurrently in two service instances; cancelling one leaves the other running successfully.

Actual simultaneous OS logins, Windows ACLs, remote hosts, and shared SecretStorage behavior across production VS Code profiles still require environment-specific validation.
