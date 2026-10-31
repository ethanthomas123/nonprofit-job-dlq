import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { infrai, InfraiError } from "./infrai_client.ts";

export const reviewRequestSchema = z.object({
  jobType: z.enum(["donor_receipt", "volunteer_reminder", "campaign_report"]),
  queue: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  failureCount: z.number().int().positive(),
  correctionApplied: z.boolean(),
  reviewId: z.string().uuid(),
});

export type ReviewRequest = z.infer<typeof reviewRequestSchema>;

export type ReviewDecision = {
  action: "redrive" | "manual_review";
  reason: string;
};

export function decideDeadLetter(input: ReviewRequest): ReviewDecision {
  if (input.jobType === "donor_receipt") {
    return {
      action: "manual_review",
      reason: "Receipt delivery stays held until a person verifies the donor record.",
    };
  }
  if (!input.correctionApplied) {
    return {
      action: "manual_review",
      reason: "Apply and verify a correction before replaying this job.",
    };
  }
  return {
    action: "redrive",
    reason: `${input.jobType} is corrected and ready for another delivery attempt.`,
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function reviewDeadLetters(input: ReviewRequest): Promise<{
  decision: ReviewDecision;
  deadLetterCount: number;
}> {
  const decision = decideDeadLetter(input);
  const snapshot = await infrai.queue.dlq.list(input.queue);

  if (decision.action === "redrive") {
    await infrai.queue.dlq.redrive(input.queue, input.reviewId);
  }

  return { decision, deadLetterCount: snapshot.items?.length ?? 0 };
}

export const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/dead-letters/review") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const input = reviewRequestSchema.parse(await readJson(request));
    send(response, 200, await reviewDeadLetters(input));
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "Invalid review request" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.message, code: error.code });
      return;
    }
    send(response, 500, { error: "Unexpected service error" });
  }
});

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`Nonprofit DLQ reviewer listening on ${port}`));
}
