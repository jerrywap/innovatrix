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

### Archive — already built

The existing path: presigned PUT to
`products/{productId}/versions/{versionId}/{nanoid}-{safeName}`, then
`verifyUpload()` HEADs the object, checks size and declared type, range-reads
4KB and sniffs magic numbers, deleting the object on any mismatch. Vendor
ticket 04 already scopes it by ownership. Nothing new here except that the
uploader is now external, which makes the sniff matter more rather than less.

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
- [ ] A customer's download is identical for all three methods: same route, same audit row, same short-lived signed URL.
- [ ] No customer request is ever redirected to a vendor-controlled host.
- [ ] A mirrored artefact whose SHA-256 does not match the vendor's declaration is rejected, and the release does not complete.
- [ ] The mirror fetcher refuses http, private and link-local addresses, and a redirect that leaves the declared host.
- [ ] An artefact exceeding the scope's size cap is abandoned mid-fetch rather than written.
- [ ] A failed mirror or pull retries with backoff and dead-letters visibly rather than leaving a version half-released.
- [ ] A `.exe` renamed `.zip` is rejected by the magic-byte sniff whichever method delivered it.
- [ ] A repository token is sealed at rest and never rendered back to the vendor.
- [ ] A version cannot reach `released` while its artefact is missing or unverified.
- [ ] `ProductVersionReleased` fires only after the artefact is in place, and entitled owners are notified once.
- [ ] Switching a product's delivery method leaves every previously released version downloadable.
