// ── Hardcode your URL here as a fallback ──────────────────────
// Replace the string below with your actual Apps Script URL
const BASE_URL = import.meta.env.VITE_GAS_URL || "https://script.google.com/macros/s/AKfycbxMFJNfCctMkSS8ebEMD7RQZNABXOQwWw_hOcG_K2BztKdcf1zZc7YojX50tEBzPZCp5Q/exec";

if (!BASE_URL || BASE_URL === "PASTE_YOUR_GAS_URL_HERE") {
  console.error("❌ GAS URL not set! Open src/api.js and paste your Apps Script URL.");
}

async function request(url, options = {}) {
  const res = await fetch(url, { redirect: "follow", ...options });
  const text = await res.text();

  if (text.trimStart().startsWith("<")) {
    throw new Error(
      "Server returned HTML instead of JSON. " +
      "Make sure your Apps Script is deployed as 'Anyone' access."
    );
  }

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("Invalid JSON from server: " + text.slice(0, 120)); }

  if (json.data?.error) throw new Error(json.data.error);
  return json.data;
}

const get = (params) =>
  request(`${BASE_URL}?${new URLSearchParams(params)}`);

const post = (body) => {
  console.log("📤 POST payload:", JSON.stringify(body));
  // Use encodeURIComponent directly — URLSearchParams can mangle JSON strings
  const encoded = BASE_URL + "?payload=" + encodeURIComponent(JSON.stringify(body));
  return request(encoded);
};

export const api = {
  login:          (email, password)      => post({ action: "login", email, password }),
  list:           (params = {})          => get({ action: "list", ...params }),
  search:         (q)                    => get({ action: "search", q }),
  stats:          ()                     => get({ action: "stats" }),
  analytics:      (months = 6)           => get({ action: "analytics", months }),
  getOrder:       (orderId)              => get({ action: "get", orderId }),
  history:        (orderId)              => get({ action: "history", orderId }),
  create:         (data)                 => post({ action: "create", ...data }),
  // Wrap data under a nested key so GAS can clearly separate orderId from data fields
  update:         (orderId, d)           => post({ action: "update", orderId, ...d }),
  delete:         (orderId)              => post({ action: "delete", orderId }),
  bulkStatus:     (orderIds, status)     => post({ action: "bulkStatus", orderIds, status }),
  bulkDelete:     (orderIds)             => post({ action: "bulkDelete", orderIds }),
  getCustomers:   ()                     => get({ action: "customers" }),
  getProducts:    ()                     => get({ action: "products" }),
  addCustomer:    (d)                    => post({ action: "addCustomer", ...d }),
  addProduct:     (d)                    => post({ action: "addProduct",  ...d }),
  deleteCustomer: (rowIndex)             => post({ action: "deleteCustomer", rowIndex }),
  deleteProduct:  (rowIndex)             => post({ action: "deleteProduct",  rowIndex }),
};
