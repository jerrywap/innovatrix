/**
 * Opening lines for the assistant, in the customer's words.
 *
 * ## Why a hundred and not four
 *
 * There were four, hardcoded inline, identical for every visitor forever:
 * staff and shifts, bookings, clients, something else. Fine for exercising the
 * chip UI; useless as an invitation. A care manager, a letting agent and a
 * freight broker all arrived at the same three sentences, and if none of them
 * described your business the page implied we build three things.
 *
 * A wide pool does the opposite job — whatever you run, something close to it
 * is on screen, which is the fastest way to convey "describe it in your own
 * words, we will follow".
 *
 * ## How they are written
 *
 * §100, strictly. These are the customer's vocabulary, not ours: "rotas are a
 * mess", never "shift scheduling module with role-based access". First person,
 * present tense, describing a **problem or a job**, never a feature list — the
 * assistant's first move is to understand the business, and an opener that
 * names a solution has already skipped that step (§22).
 *
 * Spread across the §7 industries so the draw is unlikely to be four variations
 * of one trade.
 *
 * ## Duplicates would break the chips
 *
 * `conversation.tsx` keys its chips on the string itself, so two identical
 * entries would collide in React's reconciliation. `openersFor()` samples
 * without replacement, and the list is asserted duplicate-free by its test.
 */

/** Always offered, never sampled — the way out for anyone the pool missed. */
export const ESCAPE_HATCH = "Something else";

export const OPENERS: readonly string[] = [
  // ── care, health, community
  "I run a care agency and the rotas are a mess",
  "I need to know which of my carers turned up, and when",
  "My clinic is double-booking patients",
  "I want patients to book their own appointments",
  "We keep client notes in three places and none of them agree",
  "I need to track medication for the people we support",
  "Our therapists each keep their own diary and nobody can see the others",
  "I want to stop chasing people for consent forms",
  "I run a dental practice and reminders go out by hand",
  "We need to record safeguarding concerns properly",

  // ── property and lettings
  "I manage rental properties and rent chasing eats my week",
  "I want tenants to report repairs without phoning me",
  "I need somewhere to keep tenancy agreements and their end dates",
  "My landlords want statements they can actually understand",
  "I want to stop losing track of which certificates expire when",
  "We manage a block of flats and service charges are a spreadsheet",
  "I need viewings booked without me arranging every one",

  // ── hospitality, bookings, events
  "I take bookings by phone and write them in a diary",
  "I run a salon and no-shows are costing me",
  "I want customers to book and pay a deposit online",
  "We run a restaurant and table bookings clash constantly",
  "I hire out equipment and I never know what is out",
  "I run classes and take registrations over WhatsApp",
  "I need a way to sell tickets to our events",
  "We run a campsite and pitch availability is guesswork",

  // ── logistics and field work
  "I run a delivery business and drivers phone in their drops",
  "I need proof of delivery with a photo and a signature",
  "My engineers need their jobs on their phones",
  "I want to see where every job is up to without ringing round",
  "We move freight and every customer asks where their load is",
  "I need to plan routes rather than guess them",
  "Our vans need service and MOT dates tracked somewhere",

  // ── retail, e-commerce, stock
  "I sell in a shop and online and the stock never matches",
  "I need to know what to reorder before it runs out",
  "I want to take orders from trade customers at their own prices",
  "We have a shop and want click-and-collect",
  "I need barcodes and a till that talks to my stock",
  "Returns are handled on paper and it is chaos",

  // ── professional services and agencies
  "I run an agency and timesheets arrive late or not at all",
  "I need to know whether a project made money",
  "I want to send quotes that clients can accept online",
  "Our proposals are copy-pasted from the last one",
  "I need to track retainers and what is left of them",
  "We bill by the hour and invoicing takes two days a month",
  "I want a client portal so people stop emailing me for files",

  // ── finance, admin, back office
  "I want quotes, invoices and payments in one place",
  "I need to chase unpaid invoices without doing it myself",
  "Expenses come to me as photos in a group chat",
  "I need approvals to happen in order and be recorded",
  "We reconcile payments by hand every Friday",
  "I want recurring invoices to go out on their own",

  // ── HR, staff, scheduling
  "I need to know who is on holiday before I plan the week",
  "Staff onboarding is a checklist somebody always loses",
  "I want people to swap shifts without asking me first",
  "I need training and certificates tracked per person",
  "Our staff handbook is a PDF nobody has read",
  "I want to run appraisals without a spreadsheet",

  // ── education and training
  "I run courses and enrolment is done over email",
  "I need to track attendance and report on it",
  "Parents want to see how their child is getting on",
  "I want to sell training online and issue certificates",
  "We need to match tutors to students by availability",

  // ── membership, nonprofit, community
  "I run a membership and renewals are manual",
  "We take donations and thank people by hand",
  "I need to manage volunteers and who is available when",
  "Our members want to book facilities themselves",
  "I need to report to funders and it takes weeks",

  // ── trades and construction
  "I quote jobs on site and write them up later that night",
  "I need materials costed against each job",
  "My subcontractors invoice me in every format imaginable",
  "I want customers to sign off work before we leave",
  "Snagging lists live on WhatsApp and get lost",

  // ── manufacturing and workshop
  "I make things to order and track it on a whiteboard",
  "I need to know what stage each order is at",
  "We need job cards the workshop will actually use",
  "I want to trace which batch a part came from",

  // ── automotive and repair
  "I run a garage and service reminders never go out",
  "I need job sheets and parts on the same screen",
  "Customers want to approve extra work from their phone",

  // ── legal, insurance, regulated
  "I need a case file per client with everything in it",
  "Deadlines are in my head and that is not sustainable",
  "I need an audit trail of who changed what",
  "We handle claims and each one takes too many emails",

  // ── generic business problems, no industry
  "Everything we do lives in spreadsheets and it has stopped working",
  "I have a system but it does not do what we need any more",
  "We have outgrown the software we started with",
  "I want to stop paying for five tools that half overlap",
  "Two systems we use should talk to each other and do not",
  "I need reports my accountant will accept without reworking",
  "I want customers to self-serve instead of emailing us",
  "My team are re-typing the same data into three places",
  "I need one place to see what is happening today",
  "We are growing and the manual bits are breaking first",
  "I want to automate the boring half of what we do",
  "I need this to work on a phone, out in the field",
  "Nobody can cover for anyone because it is all in their heads",
  "I want to know which customers are worth keeping",
  "We need to stop losing enquiries that come in overnight",
  "I have a spreadsheet that has become a business system",
  "I need something my staff will actually use",
];

/**
 * `count` openers plus the escape hatch, in a stable random order.
 *
 * **Call this in a Server Component.** The result is serialised into the RSC
 * payload, so the server and the client agree; sampling inside the client island
 * instead would produce a different draw on hydration and React would complain.
 *
 * The escape hatch is appended rather than mixed in, so it is always present and
 * always last — it is the way out, not a suggestion competing with the others.
 */
export function openersFor(count = 3): string[] {
  const pool = [...OPENERS];

  // Partial Fisher–Yates: only shuffle as far as we need to draw.
  const take = Math.min(count, pool.length);
  for (let index = 0; index < take; index += 1) {
    const pick = index + Math.floor(Math.random() * (pool.length - index));
    [pool[index], pool[pick]] = [pool[pick]!, pool[index]!];
  }

  return [...pool.slice(0, take), ESCAPE_HATCH];
}
