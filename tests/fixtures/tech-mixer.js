const runId = document.querySelector("main").dataset.runId;
const interest = document.querySelector("#interest");
const status = document.querySelector("#status");
let pending = Promise.resolve();

async function record(event) {
  const response = await fetch("/api/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, ...event }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
}
interest.addEventListener("change", () => {
  const value = interest.value;
  pending = pending
    .then(() => record({ type: "interest-changed", value }))
    .catch((error) => {
      status.textContent = `Not accepted: ${error.message}`;
    });
});
document
  .querySelector("#participant-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await pending;
    try {
      await record({ type: "review-reached" });
      status.textContent = `Local review reached. Primary area of interest: ${interest.value}. Nothing was submitted.`;
    } catch (error) {
      status.textContent = `Not accepted: ${error.message}`;
    }
  });
