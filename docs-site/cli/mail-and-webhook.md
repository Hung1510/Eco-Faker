# mail & webhook

## Local email inbox (`mail`)

```bash
my-eco-gen mail --users 300
# Inbox running at http://127.0.0.1:1080
```

Starts a local [MailDev](https://github.com/maildev/maildev) SMTP + web inbox and replays every generated email into it via real SMTP, chronologically, paced like `webhook` (`--speed`, `--max-wait-ms`, `--limit`).

```bash
my-eco-gen mail --users 300 --email-types order_confirmation,shipping_notification
my-eco-gen mail --users 300 --smtp-port 1035 --web-port 1090 --no-open
```

## Webhook event simulator

```bash
my-eco-gen webhook --url http://localhost:3000/webhooks --scenario post-holiday-returns --speed 3600
my-eco-gen webhook --url https://example.com/hook --events order.created,shipment.delivered --limit 50 --dry-run
```

`--speed 3600` = 1 simulated hour per real second. `--max-wait-ms` caps the real-world wait between events. `--dry-run` previews the timeline instead of POSTing.

## Related

- [`generate`](/cli/generate) — transactional email generation (`--no-email-messages` to disable)
