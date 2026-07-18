# Deploying the sandbox

Three services: **Supabase** holds the rooms, **Render** runs the WebSocket server, **Netlify**
serves the web app. Do them in that order — each needs the one before it.

No secret belongs in this repository. Everything below is pasted into a dashboard.

## 1. Supabase

1. Create a project. Wait for it to finish provisioning.
2. Copy the **Session pooler** connection string (port **5432**, not 6543) from
   *Project settings → Database → Connection string → Session pooler*.
3. Run the migration from your machine:

   ```bash
   DATABASE_URL='<the pooler string>' pnpm db:migrate
   ```

**Check:** the command prints the `sandbox.rooms` columns. If it hangs, you copied the transaction
pooler (6543) — that one does not support the session-level statements the migration uses.

> There is no RLS to configure, and that is deliberate. The ws-server is the only database client
> and connects as a Postgres role; there is no browser-side Supabase client and no anon key. RLS
> guards tables reached through PostgREST with a user JWT, which nothing here does. The security
> boundary is the connection string — treat it like a password.

## 2. Render

1. *New → Blueprint*, point it at this repository. Render reads `render.yaml`.
2. Set `DATABASE_URL` in the dashboard to the Supabase pooler string. It is marked `sync: false`
   precisely so it never lives in git.
3. Deploy, and copy the service host — `crdt-sandbox-ws.onrender.com` or similar.

**Check:**

```bash
curl https://<your-render-host>/health
```

Expected: a 200. If it 502s, read the logs — a missing `DATABASE_URL` is the usual cause, and the
server says so.

> **`--prod=false` in the build command is load-bearing.** Render sets `NODE_ENV=production`, which
> makes pnpm skip `devDependencies` — and the server starts through `tsx`, which lives there. Drop
> the flag and the build succeeds while the start command dies with `tsx: not found`, which reads
> like a corrupt install rather than a missing dev dependency.

> The free plan sleeps after idling, so the first visit takes 30–50 seconds. The app shows
> "waking the sandbox…" rather than a spinner that lies. A paid instance removes the wait.

## 3. Netlify

1. *Add new site → Import an existing project*, point it at this repository. Netlify reads
   `netlify.toml`.
2. Set both variables, using **`wss://`** and your Render host:

   ```
   NEXT_PUBLIC_SYNC_URL = wss://<your-render-host>/sync
   NEXT_PUBLIC_EXEC_URL = wss://<your-render-host>/exec
   ```

3. Deploy.

> **`NEXT_PUBLIC_*` is inlined into the bundle at build time.** Changing either value in the
> Netlify UI does nothing until you trigger a **rebuild**. The failure this produces — a redeployed
> site still talking to the old server — looks exactly like a caching bug and is not one.

> **The scheme must be `wss://`.** Render terminates TLS, and an `ws://` URL from an HTTPS page is
> blocked as mixed content, with a console error that does not obviously blame the scheme.

**Check:** open the site in two browser windows, join the same room, and type in one. The other
updates, and the connection pill reads *Connected*.

## 4. Confirm persistence survives a restart

1. Type something into a room and close every tab.
2. Restart the Render service from the dashboard.
3. Reopen the same room URL.

**Check:** your text is still there. If the room is empty, `DATABASE_URL` is not reaching the
server — the room lived in memory and died with the process.

## What is deliberately not deployed

**Code execution.** The public Piston instance became whitelist-only on 2026-02-15, and
self-hosting Piston needs privileged containers for its `isolate` sandbox, which Render's free plan
does not provide. `EXECUTION_ENABLED=false` makes the server advertise this, and Run explains
itself rather than failing on click.

Exposing a public executor would also mean anyone who found the URL could run arbitrary code on it.
Run the sandbox locally with `pnpm piston:up` to execute code.
