/**
 * Generates STATES.md from `states.ts`, so the prose can never drift from the
 * code that actually enforces it (§91). Run after changing a transition map.
 *
 *   npm run db:docs
 */
import { writeFileSync } from "node:fs";
import { STATE_MACHINES, isTerminal } from "../src/lib/db/states";

const lines: string[] = [
  "# State machines",
  "",
  "> **Generated from `src/lib/db/states.ts` — do not edit by hand.**",
  "> Run `npm run db:docs` after changing a transition map.",
  "",
  'Spec §91: *"State transitions must be validated server-side."* The maps in',
  "`states.ts` are that validation. `assertTransition()` is the only sanctioned",
  "way to change a status field — a service writing `{ $set: { status } }`",
  "directly has bypassed the machine, and that is a review failure.",
  "",
  "A state with no outgoing transitions is **terminal**. No machine allows a",
  "state to transition to itself: re-entering a state would hide a double-write,",
  "which for `order.paid` means fulfilling twice.",
  "",
];

for (const [name, map] of Object.entries(STATE_MACHINES)) {
  const entries = Object.entries(map) as [string, readonly string[]][];
  lines.push(`## ${name}`, "");
  lines.push("| From | To | |", "|---|---|---|");
  for (const [from, targets] of entries) {
    const terminal = isTerminal(map as never, from as never);
    lines.push(
      `| \`${from}\` | ${terminal ? "—" : targets.map((t) => `\`${t}\``).join(" · ")} | ${terminal ? "**terminal**" : ""} |`,
    );
  }
  lines.push("", "```mermaid", "stateDiagram-v2");
  for (const [from, targets] of entries) {
    for (const to of targets) lines.push(`    ${from} --> ${to}`);
  }
  lines.push("```", "");
}

writeFileSync("src/lib/db/STATES.md", lines.join("\n"));
console.log(`STATES.md written — ${Object.keys(STATE_MACHINES).length} machines`);
