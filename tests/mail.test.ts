import { afterAll, describe, expect, it } from "vitest";
import { generate } from "../src/generator.js";
import { buildMailReplayItems, replayMail, startMailServer } from "../src/mail.js";

const dataset = generate({ seed: 3, scaleFactor: 20 });

describe("buildMailReplayItems", () => {
  const items = buildMailReplayItems(dataset);

  it("produces one item per email message, namespaced as email.<type>", () => {
    expect(items.length).toBe(dataset.emailMessages.length);
    for (const item of items) {
      expect(item.type).toBe(`email.${item.email.type}`);
    }
  });

  it("resolves the real recipient off dataset.users, not a fabricated address", () => {
    const usersById = new Map(dataset.users.map((u) => [u.id, u] as const));
    for (const item of items) {
      expect(item.to).toBe(usersById.get(item.email.userId)?.email);
    }
  });

  it("is chronologically ordered by the email's real sentAt", () => {
    for (let i = 1; i < items.length; i++) {
      expect(Date.parse(items[i].timestamp)).toBeGreaterThanOrEqual(Date.parse(items[i - 1].timestamp));
    }
  });
});

describe("mail replay (startMailServer + replayMail)", () => {
  it("actually delivers real subject/body/recipient content to the MailDev inbox", async () => {
    const server = await startMailServer({ smtpPort: 12525, webPort: 12580, open: false });
    try {
      const items = buildMailReplayItems(dataset).slice(0, 3);
      let sent = 0;
      let failed = 0;
      const total = await replayMail(
        items,
        { smtpPort: 12525, from: "orders@eco-faker.test", speed: 1_000_000, maxWaitMs: 50 },
        (_item, _index, _count, error) => {
          if (error) failed++;
          else sent++;
        }
      );

      expect(total).toBe(3);
      expect(sent).toBe(3);
      expect(failed).toBe(0);

      const res = await fetch(`${server.webUrl}/email`);
      const inbox = (await res.json()) as any[];
      expect(inbox.length).toBe(3);
      const bySubject = new Map(inbox.map((m) => [m.subject, m]));
      for (const item of items) {
        const delivered = bySubject.get(item.email.subject);
        expect(delivered).toBeDefined();
        expect(delivered.headers.to).toBe(item.to);
        expect(delivered.headers.from).toBe("orders@eco-faker.test");
        expect(delivered.text.trim()).toBe(item.email.body);
      }
    } finally {
      await server.close();
    }
  }, 15000);
});
