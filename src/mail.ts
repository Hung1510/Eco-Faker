import MailDev from "maildev";
import nodemailer from "nodemailer";
import type { Dataset, EmailMessage } from "./types.js";
import { replayEvents, type ReplayOptions } from "./webhook.js";

/**
 * One `EmailMessage` paired with the real recipient address resolved off
 * `dataset.users` -- `EmailMessage` itself only carries `userId`, the same
 * way every other post-processing-pass table references its parent by id
 * rather than duplicating the parent's fields.
 */
export interface MailReplayItem {
  type: string;
  timestamp: string;
  to: string;
  email: EmailMessage;
}

/**
 * Turns `dataset.emailMessages` into a chronologically-ordered, directly-
 * sendable list -- resolving each message's real recipient off
 * `dataset.users` (skipping the rare message whose user was filtered out
 * of a `--tables` subset elsewhere, rather than throwing). `type` is
 * namespaced as `email.<EmailType>` so it composes with the same
 * `--events`-style filtering the webhook simulator already supports.
 */
export function buildMailReplayItems(dataset: Dataset): MailReplayItem[] {
  const usersById = new Map(dataset.users.map((u) => [u.id, u] as const));
  const items: MailReplayItem[] = [];
  for (const email of dataset.emailMessages) {
    const user = usersById.get(email.userId);
    if (!user) continue;
    items.push({ type: `email.${email.type}`, timestamp: email.sentAt, to: user.email, email });
  }
  items.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return items;
}

export interface MailServerOptions {
  smtpPort: number;
  webPort: number;
  open: boolean;
}

export interface MailServerHandle {
  webUrl: string;
  close: () => Promise<void>;
}

/**
 * Starts a local MailDev instance (SMTP catch-all + web inbox UI) --
 * `smtp-server`/`mailparser` under the hood, the same libraries real
 * MailDev/MailCatcher-style tools are built on, so anything that already
 * knows how to read a MailDev inbox works unmodified here.
 */
export function startMailServer(options: MailServerOptions): Promise<MailServerHandle> {
  const maildev = new MailDev({
    ip: "127.0.0.1",
    webIp: "127.0.0.1",
    smtp: options.smtpPort,
    web: options.webPort,
    open: options.open,
    silent: true,
  });
  return new Promise((resolve, reject) => {
    maildev.listen((err?: Error) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({
        webUrl: `http://127.0.0.1:${options.webPort}`,
        close: () => new Promise((res) => maildev.close(() => res())),
      });
    });
  });
}

export interface MailReplayOptions extends ReplayOptions {
  smtpPort: number;
  /** Sender address on every outgoing message -- eco-faker has no concept of a "from" address, so this is a synthetic stand-in, stated plainly rather than invented per-message. */
  from: string;
}

/**
 * Sends each `MailReplayItem` through a real SMTP connection (nodemailer)
 * to the running MailDev instance, paced by the same `replayEvents` helper
 * the webhook simulator uses -- so `--speed`/`--max-wait-ms`/`--limit`
 * behave identically across both commands instead of two subtly different
 * implementations of the same pacing logic.
 */
export async function replayMail(
  items: MailReplayItem[],
  options: MailReplayOptions,
  onSent: (item: MailReplayItem, index: number, total: number, error?: Error) => void
): Promise<number> {
  const transport = nodemailer.createTransport({
    host: "127.0.0.1",
    port: options.smtpPort,
    secure: false,
    ignoreTLS: true,
  });

  try {
    return await replayEvents(items, options, async (item, index, total) => {
      try {
        await transport.sendMail({
          from: options.from,
          to: item.to,
          subject: item.email.subject,
          text: item.email.body,
        });
        onSent(item, index, total);
      } catch (err) {
        onSent(item, index, total, err as Error);
      }
    });
  } finally {
    transport.close();
  }
}
