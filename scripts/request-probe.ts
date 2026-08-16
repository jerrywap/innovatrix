/**
 * A conversation becoming a request — tickets 17/18 → 19, end to end.
 *
 * The one path a unit test cannot cover: real model, real extraction, real
 * transaction, real reference. Verifies the §34 split survives the whole
 * journey and that a submitted request is something staff can pick up.
 */
import "dotenv/config";
import mongoose from "mongoose";
import type { AiMessage } from "../src/lib/db/models/requests";

function verdict(ok: boolean, label: string, detail = "") {
  console.log(
    `  ${ok ? "\x1b[32mok  \x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${label}${detail ? `  ${detail}` : ""}`,
  );
  if (!ok) process.exitCode = 1;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });

  const { AiConversation } = await import("../src/lib/db/models/requests");
  const { ActivityEvent } = await import("../src/lib/db/models/communication");
  const { Organization, User } = await import("../src/lib/db/models/identity");
  const { resolveAiConfig } = await import("../src/services/ai/settings");
  const { summariseConversation } = await import("../src/services/ai/summary");
  const requests = await import("../src/services/requests/request-service");
  const { formatCostMicros } = await import("../src/services/ai/usage");

  const org = await Organization.findOne({ slug: "brightpath-care" }).lean<{
    _id: mongoose.Types.ObjectId;
  }>();
  const user = await User.findOne({ email: "amara@brightpath.test" }).lean<{
    _id: mongoose.Types.ObjectId;
  }>();
  if (!org || !user) throw new Error("seed the database first");

  const organizationId = String(org._id);
  const userId = String(user._id);

  await AiConversation.deleteMany({ "messages.content": /PROBE/ });

  const at = (role: "user" | "assistant", content: string) => ({
    role,
    content,
    at: new Date(),
  });
  const conversation = (await AiConversation.create({
    contextType: "custom_build",
    organizationId: org._id,
    userId: user._id,
    status: "active",
    messages: [
      at("user", "PROBE: I run a care agency with 40 carers across two branches."),
      at("assistant", "Would shift scheduling and timesheets be the core of it?"),
      at("user", "Yes both. And carers need the rota on their phones."),
      at("assistant", "Would you want payroll integration and client records?"),
      at("user", "Payroll yes. Client records not for now."),
    ],
  })) as unknown as { _id: mongoose.Types.ObjectId; messages: AiMessage[] };

  /* ── 1. summarise ─────────────────────────────────────────── */
  console.log("\n\x1b[1m1. the conversation becomes a summary\x1b[0m");
  const config = await resolveAiConfig();
  const summary = await summariseConversation({
    config,
    contextType: "custom_build",
    messages: conversation.messages,
  });

  verdict(
    summary.confirmed.length >= 2,
    "confirmed lines extracted",
    `${summary.confirmed.length}`,
  );
  verdict(
    summary.assumptions.length >= 1,
    "unaccepted lines kept separate",
    `${summary.assumptions.length}`,
  );
  for (const line of [...summary.confirmed, ...summary.assumptions]) {
    console.log(`       ${line.origin.padEnd(9)} ${line.label}`);
  }

  /* ── 2. submit ────────────────────────────────────────────── */
  console.log("\n\x1b[1m2. the summary becomes a request\x1b[0m");

  const { supportsTransactions } = await import("../src/lib/db/client");
  if (!supportsTransactions()) {
    /*
     * Not a defect in this code. `submitFromConversation` runs in one
     * transaction so a rolled-back submission cannot burn a reference number,
     * and a standalone mongod cannot start one. Checkout, payment fulfilment
     * and product publishing are in the same position.
     *
     * `requests.integration.test.ts` covers all of it against a real replica
     * set, so correctness is tested — what cannot be demonstrated here is the
     * live path on this machine.
     */
    console.log(
      "  \x1b[33mskipped\x1b[0m  this MongoDB is a standalone, so no transaction can start.\n" +
        "            Run `npm run db:up` for the project's single-node replica set\n" +
        "            (stop the local mongod on 27017 first — the compose file binds it).\n" +
        "            Checkout and payment fulfilment are blocked by the same thing.",
    );
    await mongoose.disconnect();
    return;
  }

  const request = await requests.submitFromConversation({
    conversationId: String(conversation._id),
    kind: "custom_build",
    title: summary.summary.title,
    organizationId,
    userId,
    userName: "Amara Okonjo",
    customerRequirements: summary.confirmed,
    assumptions: summary.assumptions,
  });

  verdict(/^REQ-\d{4}-\d{4}$/.test(request.reference), "reference minted", request.reference);
  verdict(request.status === "submitted", "status is submitted");
  verdict(request.waitingOn === "innovatrix", "queued as waiting on us");

  const conv = await AiConversation.findById(conversation._id).lean();
  verdict(conv!.status === "submitted", "conversation marked submitted");
  verdict(
    String(conv!.submittedRequestId) === String(request._id),
    "conversation points at the request",
  );

  /* ── 3. §34 — staff cannot rewrite what the customer confirmed ── */
  console.log("\n\x1b[1m3. §34 — confirmed requirements are the customer's\x1b[0m");
  let refused = false;
  try {
    await requests.reviseRequirements({
      requestId: String(request._id),
      actor: {
        type: "staff",
        userId,
        name: "Sam",
        permissions: new Set(["request.update_status"]),
      },
      requirements: [],
    });
  } catch {
    refused = true;
  }
  verdict(refused, "a staff actor is refused through the service, not just the UI");

  /* ── 4. the timeline a customer sees ──────────────────────── */
  console.log("\n\x1b[1m4. §70 — the timeline\x1b[0m");
  await requests.transition({
    requestId: String(request._id),
    to: "under_review",
    actor: {
      type: "staff",
      userId,
      name: "Sam",
      permissions: new Set(["request.update_status"]),
    },
    internalNote: "PROBE internal: looks bigger than it reads.",
  });

  const customerVisible = await ActivityEvent.find({
    subjectId: request._id,
    visibility: "customer",
  })
    .sort({ createdAt: 1 })
    .lean();

  for (const event of customerVisible) console.log(`       ${event.message}`);
  verdict(customerVisible.length === 2, "two customer-visible entries");
  verdict(
    customerVisible.every((event) => !/PROBE internal/.test(event.message)),
    "the internal note is not on the customer's timeline",
  );

  const internal = await ActivityEvent.find({
    subjectId: request._id,
    visibility: "internal",
  }).lean();
  verdict(internal.length === 1, "and it is recorded internally");

  console.log(`\n\x1b[1mspend: ${formatCostMicros(summary.costMicros)}\x1b[0m`);

  // Leave the request behind: the staff portal in phase 6 needs something real
  // to render, and a probe that cleans up perfectly leaves nothing to look at.
  console.log(`\nleft in place for the staff screens: ${request.reference}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
