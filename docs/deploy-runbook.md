# Deploy runbook

Everything needed to stand this system up, deploy it, observe it, and roll it back.

**Status of the measurements in this document.** Items marked **`[ ] MEASURE`** have not been run —
they need an authenticated Azure session and a real deployment, which the plan that wrote this file
did not have. They are procedures, not results. Do not cite an unfilled measurement as evidence.

This document describes what `infra/main.bicep` and `.github/workflows/deploy.yml` actually do, not
what an earlier draft of this plan guessed they would do. Where the two disagree, the workflow and
template files are the source of truth — read them alongside this document if anything here seems
stale.

---

## 1. One-time bootstrap

Everything here is done once, by hand, by a subscription Owner.

### 1.1 Register the resource providers

All four are `NotRegistered` on subscription `7bb869f8-053c-4c2d-b444-1bf079bfcef7`. Bicep fails with
a confusing error rather than a clear one if they are missing.

```powershell
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.Insights
az provider register --namespace Microsoft.OperationalInsights
```

Confirm (takes a few minutes to flip to `Registered`):

```powershell
foreach ($ns in @("Microsoft.App","Microsoft.DBforPostgreSQL","Microsoft.Insights","Microsoft.OperationalInsights")) {
  Write-Output "$ns = $(az provider show --namespace $ns --query registrationState --output tsv)"
}
```

Expected: four lines reading `Registered`.

### 1.2 Create the resource group

```powershell
az group create --name irp-rg --location southeastasia
```

Southeast Asia per ADR-0009 D4. If Burstable B1ms capacity is unavailable there, the recorded
fallback is `centralindia` — change the region here and in the workflow's apply step together.

### 1.3 Create the deploy identity

An app registration with a GitHub OIDC federated credential and `Contributor` on **the resource
group only**. No client secret is created, and none is needed.

This needs **no admin consent**: the credential talks to ARM, not Graph. It requests no Graph
permissions, exposes no API, and is assigned to no users.

```powershell
$appId = az ad app create --display-name "irp-progress-management-deploy" --query appId --output tsv
az ad sp create --id $appId
az ad app federated-credential create --id $appId --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:EnderGuardian25/irp-progress-management:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
$spId = az ad sp show --id $appId --query id --output tsv
az role assignment create --assignee-object-id $spId --assignee-principal-type ServicePrincipal `
  --role Contributor `
  --scope "/subscriptions/7bb869f8-053c-4c2d-b444-1bf079bfcef7/resourceGroups/irp-rg"
Write-Output "AZURE_CLIENT_ID = $appId"
```

The `subject` must match **exactly**. A mismatch fails at `azure/login` with a generic token error
that does not mention the subject — if OIDC login fails, check this first.

`workflow_dispatch` runs on `main` also match `ref:refs/heads/main`, so the rollback path in §6 needs
no second credential.

### 1.4 Configure GitHub

Repository **secrets**:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | the `appId` printed above |
| `AZURE_TENANT_ID` | `d5e769b0-fd19-45e4-a4a8-b73545450234` |
| `AZURE_SUBSCRIPTION_ID` | `7bb869f8-053c-4c2d-b444-1bf079bfcef7` |
| `POSTGRES_ADMIN_USERNAME` | e.g. `irpadmin` — not `admin` or `postgres`, both of which Azure rejects |
| `POSTGRES_ADMIN_PASSWORD` | 16+ random characters. URL-unsafe characters (`@ / : ? # % [ ]`) are fine — `main.bicep` wraps the password with `uriComponent()` before building `databaseUrl`, so there is no need to avoid or hand-pick characters here |
| `AUTH_SECRET` | `openssl rand -base64 32` |

Repository **variable** (not a secret — it is an IP list, and `deploy.yml` writes it into a
non-secret parameters file; see §4):

| Name | Value |
|---|---|
| `ALLOWED_CLIENT_IPS` | `[]` initially. Filled in after §4 |

### 1.5 Make the GHCR packages public

After the first push creates them, set each of `irp-api`, `irp-web` and `irp-migrate` to **Public**
under the repository's Packages settings. Container Apps then pulls anonymously and the template
needs no registry credential at all — there is no `registries[]` block anywhere in `main.bicep`.

Until they are public, the pull fails with `UNAUTHORIZED` and the container app shows a
provisioning failure rather than a helpful message.

---

## 2. First deploy

Push to `main`, or run the **Deploy** workflow manually via `workflow_dispatch` (the same dispatch
path used for a rollback — see §6).

**What `deploy.yml` actually does, in order:**

1. Resolves the image tag: the `workflow_dispatch` input if one was given, otherwise `GITHUB_SHA`.
2. Builds and pushes all three images (`irp-api`, `irp-web`, `irp-migrate`) to GHCR. The `api` build
   passes `APP_VERSION` as a build arg so `/health` reports the commit that actually produced the
   running image, not a runtime value that could be set to anything.
3. Logs into Azure via OIDC (`azure/login`) — no client secret exists anywhere in this pipeline.
4. Writes `params.json`, an ARM parameters file carrying **only** `allowedClientIpAddresses` (§4
   explains why that one parameter gets a file of its own), then applies `infra/main.bicep` with
   `--parameters @params.json` plus every other parameter — including the two `@secure()` ones,
   `postgresAdminPassword` and `authSecret` — as inline `key=value` pairs read from an `env:` block
   rather than interpolated directly into the script body. (§3 covers why both of those choices are
   first-apply risks worth knowing about in advance.)
5. Starts the migration job and polls its execution **by the identity `az containerapp job start`
   returns**, not by assuming the most recent entry in the execution list is the one just started.
6. Runs three smoke tests against the deployed URLs — `/health` reports the deployed SHA,
   unauthenticated `/api/v1/me` is `401` with a Problem Details body, and `/signin` serves.
   `/health` and `/signin` retry through the scale-from-zero cold start (ADR-0009 D5) using an
   explicit `reached` flag, so an endpoint that is never reachable fails the step outright instead
   of passing because the loop's last command (`sleep 10`) happened to exit `0`. `/api/v1/me`
   deliberately has **no** retry: it runs after `/health` has already warmed the API, and its
   `status=$(curl ...)` is a bare assignment, so `set -e` trips if curl fails outright.

Expected: about 5–7 minutes, dominated by the three image builds.

> **Expect the first one or two runs to fail, and do not treat that as a broken pipeline.** Two
> steps in this document are ordered so that the failure teaches you something you cannot look up:
>
> - **The GHCR packages start private** (§1.5). Until you make them public, the container app cannot
>   pull and the deploy fails with `UNAUTHORIZED`. The packages do not exist to be made public until
>   the first push has happened, so this ordering is unavoidable.
> - **`ALLOWED_CLIENT_IPS` starts empty** (§4). The template deliberately creates no firewall rule at
>   all when it is empty, so the migration job is rejected by Postgres — and the rejection message is
>   how you discover the egress address to allowlist. That is the documented discovery method, not a
>   mistake.
>
> Work through §1.5 and §4 when you hit them, then re-run. A green first attempt would mean someone
> had already done both.

**`[ ] MEASURE` — NFR-5, pipeline under 8 minutes.** Record the total workflow duration on the first
deploy and the first cached deploy: _first: ____ · cached: ____ · target: < 8:00_

If the apply fails, read `az deployment group show`:

```powershell
az deployment group show --resource-group irp-rg --name "deploy-<sha>" --query "properties.error" --output json
```

---

## 3. First-apply risks

Two mechanisms in `deploy.yml` could not be verified against a live Azure subscription while this
plan was written — this environment has no Azure credentials at all, and both
`az deployment group validate` and `az containerapp job start` need one to check against. Both are
already commented at their call site in `deploy.yml`; this section exists so the same reasoning is
visible without opening the workflow file, and so the first person to hit either knows what to do.

1. **Whether `az deployment group create` correctly merges `--parameters @params.json` with inline
   `key=value` pairs in one invocation.** `deploy.yml` writes only `allowedClientIpAddresses` to
   `params.json` and passes the other six parameters (`namePrefix`, `imageTag`,
   `containerRegistryBase`, `postgresAdminUsername`, `postgresAdminPassword`, `authSecret`) inline,
   specifically so the two `@secure()` values never touch a file on disk. Whether the Azure CLI
   actually merges a parameters file with inline pairs in the same call — rather than one silently
   overriding or rejecting the other — is a known ambiguity that cannot be checked without a login.
   - **If it fails:** the apply step errors immediately, typically with a parameter-count or parse
     complaint, before any resource is touched. **Fallback:** revert to passing every parameter
     inline as `key=value`, including `allowedClientIpAddresses="${{ vars.ALLOWED_CLIENT_IPS || '[]' }}"`
     as a plain string — accepting the trade-off that every value then sits in the runner's process
     argument list.
2. **Whether `az containerapp job start`'s JSON output carries the started execution's identifier at
   top-level `.name`.** `deploy.yml` captures `exec_name=$(az containerapp job start ... | jq -r '.name')`
   and polls `az containerapp job execution list` filtered to that identity, specifically to avoid
   trusting `[0]` of the execution list — an assumption that the most recent execution is always the
   one just started, which does not hold in general (a stale execution from a prior run, or a
   concurrent trigger despite the workflow's `concurrency: group` serialising this pipeline).
   - **If it fails:** `exec_name` comes back empty or the literal string `null`, and the workflow's
     own guard (`if [ -z "$exec_name" ] || [ "$exec_name" = "null" ]`) fails the step loudly rather
     than polling nothing forever. **Fallback:** revert to `[0]` of the execution list, accepting the
     staleness assumption above.

Neither risk blocks a first attempt — both fail closed with a clear error rather than silently doing
the wrong thing — but both are worth watching on the very first real run rather than assuming success.

---

## 4. The firewall allowlist

The API reaches Postgres over its public endpoint (ADR-0009 D2), so whatever address Postgres
actually sees a connection arrive from must be allowlisted. `main.bicep`'s `firewallRules` resource
creates one single-address rule per entry in `allowedClientIpAddresses`; an empty array creates **no
rules at all**, which is a deliberate fail-closed default — a forgotten value produces a clear
connection error, not a silently open server.

### 4.1 There is no template-derived egress address to reference

`main.bicep` cannot compute this address for you, and this runbook cannot supply one either.
`ManagedEnvironmentProperties@2024-03-01` — the API version the environment resource uses — exposes
exactly one IP-shaped property, `staticIp`, and that is the environment's **inbound** address (where
ingress traffic arrives), not the address its outbound traffic egresses from. There is no
`outboundIPs`, `outboundIpAddresses`, or equivalent anywhere on that type. This was verified offline
in Task 1 of this plan by inspecting the resource type directly, not assumed — see the design spec §5.

**Do not run `az containerapp env show --name irp-env --resource-group irp-rg | Select-String staticIp`
and allowlist whatever it prints.** That value is the inbound address. Allowlisting it would put the
wrong address on the Postgres firewall entirely — it has nothing to do with which address Postgres
sees the API's outbound connections arrive from.

### 4.2 Finding the address Postgres actually sees

Two practical options, in the order to try them:

1. **Attempt a connection and read the rejection.** With `ALLOWED_CLIENT_IPS` still `[]`, trigger the
   migration job (§2) or connect with `psql` against the Postgres FQDN from something running inside
   the same Container Apps environment. Azure Database for PostgreSQL Flexible Server's firewall
   rejection names the address it saw, e.g.
   `FATAL: connection ... is not allowed for the IP address 'x.x.x.x'` (exact wording varies slightly
   by client). That address is the true source Postgres observed for this environment, today — a
   measurement, not a guess.
2. **Consult Azure's documented Container Apps outbound-IP behaviour** for a Consumption-plan
   environment without VNet integration (Microsoft Learn → Azure Container Apps → networking). Use
   this to narrow the search before the first connection attempt, not as a substitute for the
   rejection message above — Microsoft's own documentation does not guarantee a single fixed egress
   IP over time for an environment configured this way (no NAT Gateway, no VNet integration).

**Be honest about this step.** It is the part of this whole runbook most likely to need a second
iteration on the very first real apply: the rejected-address message is ground truth, but it is not
available until a connection has actually been attempted and refused. Expect to update
`ALLOWED_CLIENT_IPS` and re-run the Deploy workflow at least once before the migration job or a
`psql` session succeeds.

**If the outbound address turns out to rotate** — different rejected addresses across separate
attempts, or Microsoft's documentation confirms non-determinism for this environment configuration —
the fallback is to **reconsider ADR-0009 D2** (move to VNet integration with a NAT Gateway for a
fixed egress address, or to a private endpoint), not to widen the allowlist to admit everything.
ADR-0009 already rejected the "allow public access from all Azure services" rule (start/end
`0.0.0.0`) by name: it admits any Azure tenant's resources, which reads as a restriction while being
close to no network control at all. Do not reach for it here either.

### 4.3 Setting the allowlist

Set the `ALLOWED_CLIENT_IPS` repository variable to a JSON array of the addresses found above — plus
your own IP if you want to connect with `psql` directly — and re-run the Deploy workflow:

```
["203.0.113.10","198.51.100.4"]
```

`deploy.yml` writes this variable's value verbatim into `params.json`'s `allowedClientIpAddresses`
field (§3, risk 1), so it must already be valid JSON array syntax — not a bare comma-separated
string — or the `jq empty params.json` check in that step fails the workflow before anything is
applied.

**This is the failure that looks like something else.** A wrong or empty allowlist does not fail the
deploy. The apply succeeds, `/health` succeeds — it does not touch the database — and only requests
that read data fail. If `/api/v1/me` returns 500 for a valid token while `/health` is green, suspect
this before suspecting the application.

---

## 5. Observability

### Container logs (both apps' stdout)

```powershell
az monitor log-analytics query --workspace (az monitor log-analytics workspace show --resource-group irp-rg --workspace-name irp-logs --query customerId --output tsv) --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == 'irp-api' | order by TimeGenerated desc | take 50" --output table
```

`apps/api` logs pino JSON, so `Log_s` carries the structured record including `reqId` and `traceId`.

The `log-analytics` extension is not installed by default; the CLI prompts to install it on first
use. Either accept the prompt interactively, or set
`az config set extension.use_dynamic_install=yes_without_prompt` first to auto-install without a
prompt. Because it is a **preview** extension in CLI 2.88.0, auto-install additionally needs
`az config set extension.dynamic_install_allow_preview=true` — without it the install is refused and
the command fails on a machine that has never run it.

**Scope of what was verified:** that these are real commands in CLI 2.88.0 and that `az monitor
app-insights query` comes from the `application-insights` extension — checked via `--help`, which
needs no Azure login. **The queries themselves have never been run against a live workspace**, since
no deployment exists yet. Treat the KQL below as unexecuted.

### Traces

`selectSpanExporter` (ADR-0014) switched to the Azure Monitor exporter because
`APPLICATIONINSIGHTS_CONNECTION_STRING` is set by the template. No application code was changed to
achieve this.

Issue a request, then:

```powershell
az monitor app-insights query --app irp-insights --resource-group irp-rg --analytics-query "dependencies | union requests | where timestamp > ago(10m) | project timestamp, name, duration, success | order by timestamp desc | take 20" --output table
```

Same dynamic-install note as above: this command needs the `application-insights` extension, also
preview-only in this CLI's extension index, so `dynamic_install_allow_preview` must also be set to
`true` for a non-interactive install. Both `--app irp-insights --resource-group irp-rg` (an app name
plus its resource group, rather than a GUID) and the query syntax were confirmed against the
installed extension's own `--help` output.

**`[ ] MEASURE` — NFR-6, traces visible within 60 seconds.** Note the wall-clock gap between issuing
a request and the span appearing: _observed: ____ s · target: < 60 s_

**Limitation:** `apps/web` is **not** traced. The exporter seam is `apps/api`-only and instrumenting
Next is a separate decision.

---

## 6. Rollback

**`[ ] MEASURE` — this procedure has NOT been executed.** T-22 asks for a *tested* rollback path; the
honest status until someone runs §6.1 once is "procedure written, execution outstanding."

### 6.1 Roll the application back

Both container apps set `activeRevisionsMode: 'Single'` explicitly in `infra/main.bicep`, so one
revision serves all traffic and there are no traffic weights to reason about. Rolling back means
**redeploying an image that already exists in GHCR** — the workflow builds nothing.

> **Why the workflow skips its build steps on a rollback, and why that matters.**
> `actions/checkout` in `deploy.yml` takes no `ref:`, so a `workflow_dispatch` run checks out the tip
> of the selected branch — **not** the commit named by `imageTag`, which only ever names an image
> tag. Before this was fixed, the three build steps ran unconditionally, so a "rollback" rebuilt the
> *current* code, tagged it with the *old* SHA, and pushed it — **overwriting the known-good image in
> GHCR and destroying the artifact being rolled back to.** `/health` then reported the old SHA,
> because `APP_VERSION` is baked from the same input, while the container ran current code. Every
> success signal below would have been satisfied while nothing had actually been rolled back.
> The build steps are now gated on `steps.tag.outputs.mode == 'build'`, which is only set when
> `imageTag` is empty. Caught in review; never ran against a real deployment.

1. Find the SHA currently deployed:

   ```powershell
   curl.exe -s https://<api-fqdn>/health
   ```

2. Find the previous good SHA — the commit before it on `main`. It must be a SHA that was
   **actually deployed**, because the rollback redeploys its image rather than building one.

3. Run the **Deploy** workflow via `workflow_dispatch` with `imageTag` set to that SHA. The build
   steps are skipped entirely, so this is fast: it applies the template and runs the migration job.
   The run log says `Rollback: redeploying the EXISTING image <sha> without rebuilding`.

   **If that tag is not in GHCR**, the container app cannot pull it and the deploy fails loudly.
   That is the correct outcome — far better than silently deploying the wrong code. Pick a tag you
   can see in the repository's Packages list.

4. Confirm:

   ```powershell
   curl.exe -s https://<api-fqdn>/health
   ```

   Expected: the previous SHA. Because nothing was rebuilt, this is now genuine evidence that the
   older image is running, not merely that a build arg was set.

Record the result:

| Step | Expected | Observed | Time |
|---|---|---|---|
| Note the current SHA | matches `main` | | |
| Dispatch with the previous SHA | workflow succeeds, build steps show as skipped | | |
| `/health` reports the previous SHA | previous SHA | | |
| `/signin` still serves | 200 | | |
| The old image is still in GHCR afterwards | present, not overwritten | | |
| Total rollback duration | < 5 min | | |

### 6.2 What rollback does NOT cover

**The database.** Migrations are forward-only: rolling an image back does not roll a migration back.
If a migration is the problem, the recovery is a new forward migration that reverses it, or a
point-in-time restore of the Postgres server — a far heavier operation with data loss between the
restore point and now.

Before deploying a destructive migration, take a manual backup and record how to restore it. Plan 5
owns the first real schema and inherits this.

---

## 7. Cost

The $200 credit expires around **2026-08-27**. After that every choice is measured against the free
grant alone.

```powershell
az consumption usage list --start-date 2026-07-01 --end-date 2026-08-31 --query "[].{name:instanceName, cost:pretaxCost}" --output table
```

Both apps run at `minReplicas: 0` (ADR-0009 D5), so at rest the dominant cost is the B1ms Postgres
server, which does **not** scale to zero.

---

## 8. Stated limitations

Not oversights. Each is a recorded decision with a trigger for revisiting.

| Limitation | Why, and what would change it |
|---|---|
| **Postgres is on a public endpoint** and holds student submission text, which is personal data. A firewall allowlist and TLS are real controls but weaker than a private endpoint | ADR-0009 D2, accepted on demo-scoped grounds; the same concern class as O-5. **The first thing to change if this ever holds real student data** |
| **There is no working sign-in, and that is expected.** Entra is deferred a fourth time, so no provider is registered and `/signin` renders an explicit "Sign-in is not configured in this environment" panel with no control at all — not a disabled button, not a broken link, nothing to click | Deferred by decision. `bistecglobal.com` and `bisteccare.lk` are in fact ONE tenant, so a single-tenant app registration would work — see the design spec §2. That is a governance decision about a live corporate directory, not a technical blocker |
| **NFR-3 cannot be measured.** The auth-gated load test needs real tokens via the k6 service principal | Follows from the Entra deferral. Plan 11 inherits it |
| **NFR-1's p95 is only valid with the replica floor raised.** A scale-from-zero cold start is seconds | ADR-0009 D5. Plan 11 raises the API's `minReplicas` for the run and must not forget to — a run that forgets produces misleading numbers rather than an obvious error |
| **`apps/web` is untraced** | The exporter seam is `apps/api`-only |
| **Migrations run just after the apply**, leaving a brief window where new code can meet an old schema | Documented in `deploy.yml`. Revisit on the first non-additive migration or `minReplicas > 0` |
| **Rollback is application-only** | See §6.2 |

### On the Entra cutover, when it happens

`/signin` is rendered `force-dynamic` (a Task 7 fix — an earlier version was statically prerendered,
which would have baked the "not configured" panel into a static HTML file that a later env-var change
could not update). Enabling Entra later means setting these three environment variables on the web
Container App, per `isEntraConfigured` in `apps/web/auth.config.ts` and the Plan 3 spec §7 cutover:

| Variable | Value |
|---|---|
| `AUTH_MICROSOFT_ENTRA_ID_ID` | The app registration's Application (client) ID |
| `AUTH_MICROSOFT_ENTRA_ID_SECRET` | A client secret generated for that registration |
| `AUTH_MICROSOFT_ENTRA_ID_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |

All three are required together — `isEntraConfigured` checks each is present and non-empty
(whitespace-only counts as unset), and Auth.js registers the real Entra provider only when all
three pass; leaving any one blank leaves the app in the same "not configured" state as today, not
a partially-working sign-in. That change alone is sufficient: setting a Container App's
environment variables creates a **new revision**, and therefore a **new process**, and
`bypassEnabled`/`entraConfigured` are read once per process at module load — so the new process
reads the new values on its own. **No image rebuild is needed.** (What this does *not* mean: the
flags are not re-read on a live, already-running process — only a new revision's new process
reads them, which is exactly what a Container Apps env-var update produces.)
