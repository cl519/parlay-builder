// Talking to our local server. POSTs carry this run's token, which only our page has.

const TOKEN = document.querySelector('meta[name="parlay-token"]').content;

export async function getJSON(path, { private: isPrivate = false } = {}) {
  const res = await fetch(path, isPrivate ? { headers: { "X-Token": TOKEN } } : undefined);
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error), { data });
  return data;
}

/** Fire-and-forget POST that still goes out while the page is closing or reloading. */
export function postOnExit(path, body) {
  fetch(path, {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json", "X-Token": TOKEN },
    body: JSON.stringify(body),
  });
}

export async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token": TOKEN },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw Object.assign(new Error(data.error), { data });  // e.data.retry etc.
  return data;
}
