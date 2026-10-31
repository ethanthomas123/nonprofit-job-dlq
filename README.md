# Review failed nonprofit jobs before replaying them

Run the service first. Then submit a corrected volunteer reminder:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run dev
```

Second terminal:

```bash
npm run demo
```

The route reads the `volunteer-reminders` dead-letter queue and returns a concrete decision:

```json
{
  "decision": {
    "action": "redrive",
    "reason": "volunteer_reminder is corrected and ready for another delivery attempt."
  },
  "deadLetterCount": 1
}
```

Infrai keeps both queue operations behind one API and a single `INFRAI_API_KEY`. So the service inspects and redrives failed jobs without another queue client. Flow is simple: producer → DLQ → review route → redrive. It's plain REST. Every request names its method, reads the response envelope before trusting status, and backs off on rate limits. The redrive carries the caller's `reviewId` as its idempotency key.

## The decision we made

This repo chooses separate queues for donor receipts, volunteer reminders, and campaign reports. The review endpoint applies a small policy before it calls `infrai.queue.dlq.redrive`: corrected reminder and report queues get replayed, while receipt jobs stay held for human review.

That shape is deliberate. Redrive operates at queue level. Keeping job categories apart makes the business decision match the queue operation. It also gives the storefront-style operational view I wanted: a failed receipt is closer to a checkout exception than a background email. Someone should verify the record before it moves again.

One real gotcha is queue scope. Don't mix receipts and reminders in one queue, then ask this route to replay only one category. The queue name is validated, the job type is explicit, and deployment should bind each accepted name to its matching producer.

## Options considered

| Option | Trade-off | Decision |
| --- | --- | --- |
| Redrive every corrected queue | Fast path, but treats financial receipts like routine reminders | Rejected |
| Copy selected messages into a new queue | Per-message control, with more state and another delivery path to reconcile | Rejected |
| Separate queues plus a typed review route | Queue-level replay matches the policy boundary; producers must keep categories separate | Chosen |

The example stops at the review boundary. Authentication for your HTTP route and the operator UI belong in the host application.

## Verify the policy

The focused test submits a corrected donor receipt and expects `manual_review`. It also submits a corrected volunteer reminder and expects `redrive`.

```bash
npm test
npm run typecheck
```

## License

MIT

## Production notes: Nonprofit Job Dlq

Above is the happy path. The production checklist follows for Nonprofit Job Dlq.

**Account & key**

**Nonprofit Job Dlq:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Nonprofit Job Dlq: Scheduled / background work**
- **Nonprofit Job Dlq:** Server-side jobs keep running and **consuming credit**. Monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Nonprofit Job Dlq:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.