const form = document.getElementById("team-form");
const status = document.getElementById("team-status");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  const name = form.elements.namedItem("name").value;
  button.disabled = true;
  status.textContent = "";
  status.classList.remove("error");
  try {
    const response = await fetch(`/api/teams/${form.dataset.teamId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? `Request failed (${response.status})`);
    form.elements.namedItem("name").value = body.name;
    for (const element of document.querySelectorAll(".rail-team-name")) element.textContent = body.name;
    status.textContent = "Saved.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not save.";
    status.classList.add("error");
  } finally {
    button.disabled = false;
  }
});
