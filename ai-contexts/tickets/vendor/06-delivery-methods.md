# 06 — Delivery Methods

**Bucket:** §20.6 · **Depends on:** vendor 04, 05; tickets 07, 14 · **Blocks:** vendor 12 · **Size:** L
**Spec:** §44 (product uploads), §45 (product versioning), §66 (downloads — signed, never permanent), §85 (file storage), §88 (secure file handling), §86 (background jobs)

## Why
The brief asks for three ways a vendor can supply their software: self-hosted,
an archive, or a repository. The customer must not be able to tell which was
used. §66 says a paid artefact is never behind an unsigned permanent URL, and
that guarantee cannot depend on which of the three a vendor chose.

## Scope

### One download path, three ways of filling it

The customer-facing path does not change and must not: `/api/downloads/[fileId]`
authorises, records the download, and 307s to a five-minute presigned GET. Every
delivery method resolves to a `ProductFile` in the platform's own bucket before
a customer ever asks for it.

That is the load-bearing decision in this ticket. The alternatives — redirecting
a paying customer to a vendor's server, or handing out a repository URL — put
the platform's licensing guarantee in the hands of somebody whose uptime,
retention and access control it does not control.

| Method | Vendor provides | When the platform fetches | Customer sees |
|---|---|---|---|
| **Archive** | A direct upload | Presigned PUT at authoring time | Unchanged from ticket 07 |
| **Vendor-hosted** | A URL and a SHA-256 | At release, mirrored into the bucket | Unchanged |
| **Repository** | A repo URL and a tag | At release, tarball pulled and stored | Unchanged |

### Order of work: archive first

All three methods are in scope and **all three shipped**, in that order. Archive was
already built — the presigned PUT and `verifyUpload()` came with ticket 07 — so it
needed only vendor ticket 04's ownership scoping threaded through the nine version
and file service functions, which is what vendor ticket 04 deferred to here.

The other two share machinery archive needs none of, and it is the part worth
reviewing: an outbound fetcher hardened against SSRF, a job with backoff and visible
dead-lettering, a size cap enforced mid-stream, and digest verification.

`deliveryMethod` is the seam and carries all three values, so switching needs no
migration and every already-released version keeps its stored `ProductFile`.

> **Two things found by writing the tests.**
>
> 1. **The release gate blocked every archive release.** It read
>    `if (version.artefactSource && status !== "stored")`, and Mongoose materialises an
>    unset *nested path* as `{}` — the `status` default then filled in `"pending"`, so a
>    version with no source at all looked mid-fetch. `OrderDoc.discount` carries the
>    same warning. The condition is now whether a source names somewhere to fetch
>    **from**.
> 2. **`select: false` on the leaves of a cipher is not `select: false` on the path.**
>    The parent still materialises and `.select("+artefactSource.tokenCipher")` cannot
>    re-add leaves it does not name. It is a shared sub-schema now, excluded and
>    re-requested as one path.

### Archive — already built

The existing path: presigned PUT to
`products/{productId}/versions/{versionId}/{nanoid}-{safeName}`, then
`verifyUpload()` HEADs the object, checks size and declared type, range-reads
4KB and sniffs magic numbers, deleting the object on any mismatch. Vendor
ticket 04 already scopes it by ownership. Nothing new here except that the
uploader is now external, which makes the sniff matter more rather than less.

### The address filter is the part that needed the most care

`fetchRemoteArtefact` is a server-side request forgery primitive if written naively:
the vendor picks the address and this process sits inside a network nobody outside it
can reach. So it refuses non-HTTPS, refuses credentials in the URL, **resolves DNS and
checks the answers** rather than judging the hostname, refuses every private,
loopback, link-local, unique-local, CGNAT and multicast range, handles redirects
manually one hop at a time and refuses any that leaves the declared host, and counts
bytes as they arrive rather than trusting `Content-Length`.

`169.254.169.254` gets its own line in the filter even though `169.254.0.0/16` already
covers it, because it is the reason the function exists. The IPv4-mapped IPv6 case
(`::ffff:10.0.0.1`) has its own test: judging it by the v6 prefix waves every private
range through, and it looks like a v6 address to every eye and most regexes.

**What it does not close**, stated rather than implied: the DNS rebind window between
the lookup and the connection. Closing it means connecting to the validated IP with
the original `Host` header, which `fetch` cannot express — it needs an undici `Agent`
with a `connect` hook. The window is narrow, the fetch runs in a job rather than a
request, and a build artefact is what is behind it.

### Vendor-hosted — mirrored, not proxied

The vendor gives a URL and the SHA-256 of what is there. At release the platform
fetches it once, verifies the digest, runs the same policy checks as an upload,
and stores it. From then on it is an ordinary `ProductFile`.

"Self-hosted" therefore means *the vendor's build pipeline is the source*, not
*the customer's download comes from the vendor*. Worth stating plainly on the
vendor's screen, because it is not what the phrase suggests.

The fetch is a **job**, not a request: a 2GB artefact over somebody else's link
does not belong in a request lifecycle. It gets its own row in `JobPayloadMap`,
retries with backoff, and dead-letters visibly on `/admin/jobs` — a release
whose mirror failed must not look like a release.

Fetching a URL a third party controls is an SSRF surface. The fetcher refuses
non-HTTPS, private and link-local address ranges, and redirects that leave the
original host, and it is size-capped before it starts writing.

### Repository — a pulled release, not granted access

The vendor registers a repository URL and a tag or release name. At release the
platform pulls that tag's tarball, verifies it, and stores it exactly like a
mirrored artefact. A private repository needs a token the vendor supplies, held
with the same AES-256-GCM sealing as demo credentials (§89) and never displayed
again after entry.

**Not** inviting customers as collaborators. That was considered and is named in
`README.md` as deferred: it is a per-forge OAuth integration, revocation is its
own unsolved problem, and it requires the customer to hold an account on a forge
they may not use. Pulling the release keeps one download path.

### Scanning

> `scanStatus` still has one value in practice. The structural checks — policy,
> extension allowlist, double-extension, declared type, magic bytes — all run on a
> mirrored or pulled artefact exactly as on an upload, because they go through the same
> `assertUploadAllowed`. What has not changed is that nothing advances `scanStatus` past
> `pending`: the seam is there and a scanner is not, so the criterion below about a
> version not being releasable until it passes is **not** met and is not claimed.

Every artefact, however it arrived, gets the same treatment: policy check,
magic-byte sniff, and the `scanStatus` field that already exists on
`ProductFile` and is currently written once as `pending` and never advanced.
This ticket gives it a second value by putting a scan behind it, and a version
whose artefact has not passed cannot be released.

### The release is atomic from the customer's side

A version moves to `released` only once its artefact is present and verified.
Until then the release is pending, the vendor sees why, and no customer is
offered a download that resolves to nothing. `ProductVersionReleased` — which
already exists and already notifies entitled owners — fires after the artefact
is in place, not before.

## Out of scope
Forge collaborator provisioning and deploy keys (see `README.md`). Delta or
patch updates — a version is a whole artefact. Virus scanning by a third-party
engine; the seam is `scanStatus` and the checks here are structural.

## Acceptance criteria
- [x] A customer's download is identical for all three methods: same route, same audit row, same short-lived signed URL.
- [x] No customer request is ever redirected to a vendor-controlled host.
- [x] A mirrored artefact whose SHA-256 does not match the vendor's declaration is rejected, and the release does not complete.
- [x] The mirror fetcher refuses http, private and link-local addresses, and a redirect that leaves the declared host.
- [x] An artefact exceeding the scope's size cap is abandoned mid-fetch rather than written.
- [x] A failed mirror or pull retries with backoff and dead-letters visibly rather than leaving a version half-released.
- [x] A `.exe` renamed `.zip` is rejected by the magic-byte sniff whichever method delivered it.
- [x] A repository token is sealed at rest and never rendered back to the vendor.
- [x] A version cannot reach `released` while its artefact is missing or unverified.
- [x] `ProductVersionReleased` fires only after the artefact is in place, and entitled owners are notified once.
- [x] Switching a product's delivery method leaves every previously released version downloadable, and needs no migration.
- [x] A delivery method whose path is not yet built is not selectable — all three are built, so all three are offered by a vendor.
