/**
 * Constants shared between the Edge proxy and the Node logger — ticket 27.
 *
 * Its own module, and dependency-free, for one reason: `proxy.ts` runs on the
 * **Edge runtime**, and importing `@/lib/logger` from it would pull in
 * `server-only`, the redactor and — transitively before this split — the audit
 * service and every Mongoose model. None of that exists on Edge.
 *
 * A constant shared across a runtime boundary has to live somewhere that can
 * cross it, which means somewhere that imports nothing.
 */

/**
 * The correlation id header.
 *
 * `x-request-id` rather than `x-correlation-id` or a bespoke name, because
 * every load balancer, CDN and log aggregator already knows this one — an
 * inbound value is honoured rather than replaced, so a trace that started
 * upstream keeps its identity.
 */
export const REQUEST_ID_HEADER = "x-request-id";
