import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const interests = [
  "Technology",
  "Digital",
  "Data",
  "Customer Service",
  "Sales",
  "Finance",
  "Risk",
  "Controls and Functions",
  "Human Resources",
  "Project Management",
  "Commercial Banking",
  "Wealth",
  "Markets",
];

interface FixtureEvent {
  sequence: number;
  type: string;
  at: string;
  requestId?: string;
  value?: string;
  source?: string;
  outcome?: string;
}

/** Loopback-only synthetic fixture; it has no registration/submission endpoint. */
export async function startFormFixture(port = 0) {
  const runId = randomUUID();
  const events: FixtureEvent[] = [];
  const requests = new Map<string, "waiting" | "answered" | "cancelled">();
  let interest = "";
  let reviewed = false;
  let origin = "";
  const add = (event: Omit<FixtureEvent, "sequence" | "at">) => {
    events.push({
      ...event,
      sequence: events.length + 1,
      at: new Date().toISOString(),
    });
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'",
    );
    const json = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    if (req.headers.host !== new URL(origin).host)
      return json(403, { error: "Unexpected host" });
    try {
      if (req.method === "GET" && req.url === "/api/state") {
        return json(200, {
          kind: "synthetic-tech-mixer",
          runId,
          interest,
          reviewed,
          consentChecked: false,
          uploadEnabled: false,
          submissionEnabled: false,
          events,
        });
      }
      if (
        req.method === "GET" &&
        (req.url === "/" || req.url === "/fixture.js")
      ) {
        const name = req.url === "/" ? "tech-mixer.html" : "tech-mixer.js";
        const text = await readFile(
          new URL(`../tests/fixtures/${name}`, import.meta.url),
          "utf8",
        );
        res.writeHead(200, {
          "Content-Type":
            req.url === "/"
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
        });
        res.end(text.replaceAll("__RUN_ID__", runId));
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/event")
        return json(404, { error: "No such endpoint" });
      if (
        req.headers.origin !== origin ||
        !req.headers["content-type"]?.startsWith("application/json")
      ) {
        return json(403, { error: "Same-origin JSON required" });
      }
      let body = "";
      for await (const chunk of req) {
        body += String(chunk);
        if (body.length > 4096) return json(413, { error: "Event too large" });
      }
      const event = JSON.parse(body) as Record<string, unknown>;
      if (event.runId !== runId)
        return json(409, { error: "Wrong fixture run" });
      if (event.type === "question-opened") {
        if (
          typeof event.requestId !== "string" ||
          !/^[a-zA-Z0-9-]{1,80}$/.test(event.requestId) ||
          requests.has(event.requestId)
        ) {
          return json(409, { error: "Invalid or duplicate question" });
        }
        requests.set(event.requestId, "waiting");
        add({ type: "question-opened", requestId: event.requestId });
      } else if (
        event.type === "answer-returned" ||
        event.type === "question-cancelled"
      ) {
        if (
          typeof event.requestId !== "string" ||
          requests.get(event.requestId) !== "waiting"
        ) {
          return json(409, { error: "No matching waiting question" });
        }
        if (
          event.type === "answer-returned" &&
          (event.confirmed !== true ||
            event.captureMayBeActive !== false ||
            !["typed", "dictation-reviewed"].includes(String(event.source)))
        ) {
          return json(422, { error: "Reviewed, stopped capture required" });
        }
        requests.set(
          event.requestId,
          event.type === "answer-returned" ? "answered" : "cancelled",
        );
        add({
          type: event.type,
          requestId: event.requestId,
          source:
            event.type === "answer-returned" ? String(event.source) : undefined,
        });
      } else if (event.type === "interest-changed") {
        if (
          typeof event.value !== "string" ||
          (event.value !== "" && !interests.includes(event.value))
        )
          return json(422, { error: "Unknown choice" });
        if (![...requests.values()].includes("answered"))
          return json(409, { error: "Wait for the reviewed human answer" });
        interest = event.value;
        reviewed = false;
        add({ type: "interest-changed", value: interest });
      } else if (event.type === "review-reached") {
        if (!interest || ![...requests.values()].includes("answered"))
          return json(409, { error: "Resolve the missing value first" });
        reviewed = true;
        add({ type: "review-reached", value: interest });
      } else return json(422, { error: "Unsupported event" });
      json(200, { ok: true });
    } catch {
      json(400, { error: "Invalid fixture request" });
    }
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture address");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: origin,
    runId,
    close: () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const fixture = await startFormFixture();
  console.log(
    JSON.stringify({
      url: fixture.url,
      runId: fixture.runId,
      pid: process.pid,
    }),
  );
  process.once("SIGINT", () => {
    void fixture.close();
  });
  process.once("SIGTERM", () => {
    void fixture.close();
  });
}
