import { describe, expect, it } from "vitest";
import { chooseTransportKind } from "./index";

/**
 * Which transport sends — the decision, not the sending.
 *
 * Worth testing on its own because getting it wrong is **silent**. With SMTP
 * configured, a password reset for `super@innovatrix.test` goes to a real mail
 * server; `.test` is an IANA-reserved TLD that can never receive it, so it
 * bounces, `sendAuthEmail` swallows the failure outside development, and the
 * developer concludes password reset is broken.
 */

describe("chooseTransportKind", () => {
  it("honours an explicit log, even with SMTP configured", () => {
    // The case the variable exists for: real credentials, unreachable recipients.
    expect(chooseTransportKind({ EMAIL_TRANSPORT: "log", SMTP_HOST: "mail.example.com" })).toBe(
      "log",
    );
  });

  it("honours an explicit smtp", () => {
    expect(
      chooseTransportKind({ EMAIL_TRANSPORT: "smtp", SMTP_HOST: "mail.example.com" }),
    ).toBe("smtp");
  });

  it("derives smtp from a configured host when unset", () => {
    // Backwards compatible: an existing .env.local does not change meaning.
    expect(chooseTransportKind({ SMTP_HOST: "mail.example.com" })).toBe("smtp");
  });

  it("derives log when nothing is configured", () => {
    // The safe default. Nobody should start sending real mail from a laptop
    // because they forgot to unset something.
    expect(chooseTransportKind({})).toBe("log");
  });

  it("treats a blank host as unconfigured", () => {
    // `SMTP_HOST=` in a .env file is the empty string; `optionalShaped` maps it
    // to undefined, and this must agree with that rather than see a truthy "".
    expect(chooseTransportKind({ SMTP_HOST: "" })).toBe("log");
  });
});
