import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedMethods = [
  "item/tool/requestUserInput",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
];

test("installed generated ServerRequest union contains every MVP intervention source", async () => {
  const source = await readFile(
    new URL("../schemas/typescript/ServerRequest.ts", import.meta.url),
    "utf8",
  );
  for (const method of expectedMethods) assert.match(source, new RegExp(method.replaceAll("/", "\\/")));
});

test("generated schema confirms turn interrupt is cancellation, not a pause response", async () => {
  const source = await readFile(
    new URL("../schemas/typescript/v2/TurnInterruptParams.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /threadId: string/);
  assert.match(source, /turnId: string/);
  assert.doesNotMatch(source, /resume|pause|answer/);
});
