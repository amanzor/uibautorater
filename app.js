// ---------------------------------------------------------------------
// UIB Auto Rater — dummy/simulated rating engine.
//
// HOW TO GO LIVE LATER:
// Replace the body of fetchCarrierRate() with a real call to each
// carrier's rating API or EDI gateway (using the endpoint/credentials
// saved in CARRIERS via the Carrier Connections screen). Keep the same
// return shape: { premium, downPayment, numPayments, paymentAmount }.
// Everything else (UI, table rendering, sorting) stays unchanged.
// ---------------------------------------------------------------------

const CARRIERS_KEY = "uib_carrier_connections";

const DEFAULT_CARRIERS = [
  { name: "Progressive", type: "Real-Time API", endpoint: "", status: "mock" },
  { name: "GEICO", type: "Real-Time API", endpoint: "", status: "mock" },
  { name: "Kemper Auto", type: "EDI / Batch", endpoint: "", status: "mock" },
  { name: "National General", type: "Real-Time API", endpoint: "", status: "mock" },
  { name: "Bristol West", type: "Real-Time API", endpoint: "", status: "mock" },
  { name: "United Auto", type: "EDI / Batch", endpoint: "", status: "mock" },
];

function loadCarriers() {
  try {
    const saved = JSON.parse(localStorage.getItem(CARRIERS_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  return DEFAULT_CARRIERS.map(c => ({ ...c }));
}

function saveCarriers(carriers) {
  localStorage.setItem(CARRIERS_KEY, JSON.stringify(carriers));
}

let carriers = loadCarriers();

// ---- Navigation -------------------------------------------------------

document.querySelectorAll(".nav-buttons button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById("view-" + name).classList.add("active");
}

// ---- Mock rating engine ------------------------------------------------

function mockRate(carrierName, quote) {
  const base = 450;
  const ageFactor = quote.age < 25 ? 1.6 : quote.age < 35 ? 1.15 : quote.age < 60 ? 1.0 : 1.1;
  const experienceFactor = Math.max(0.85, 1.3 - quote.yearsLicensed * 0.03);
  const liabFactor = { "10/20": 0.85, "25/50": 1.0, "50/100": 1.2, "100/300": 1.45 }[quote.liab] || 1.0;
  const compFactor = quote.comp === "No Coverage" ? 0.8 : quote.comp === "1000" ? 0.95 : 1.05;
  const collFactor = quote.coll === "No Coverage" ? 0.8 : quote.coll === "1000" ? 0.95 : 1.05;
  const vehicleAgeFactor = Math.max(0.8, 1.2 - (2026 - quote.vehicleYear) * 0.02);
  const priorFactor = quote.prior === "None" ? 1.2 : 1.0;

  // Deterministic per-carrier variance so the same inputs always
  // produce the same comparison table (purely cosmetic spread).
  let seed = 0;
  for (const ch of carrierName) seed += ch.charCodeAt(0);
  const carrierFactor = 0.85 + ((seed * 37) % 60) / 100;

  const premium = Math.round(
    base * ageFactor * experienceFactor * liabFactor * compFactor *
    collFactor * vehicleAgeFactor * priorFactor * carrierFactor
  );

  const numPayments = 6;
  const downPayment = Math.round(premium * 0.18);
  const paymentAmount = Math.round((premium - downPayment) / (numPayments - 1));

  return { premium, downPayment, numPayments, paymentAmount };
}

// Swap this function's internals to call real carrier APIs/EDI.
async function fetchCarrierRate(carrier, quote) {
  // const res = await fetch(carrier.endpoint, { method: "POST", body: JSON.stringify(quote) });
  // return await res.json();
  return mockRate(carrier.name, quote);
}

// ---- Quote form ---------------------------------------------------------

document.getElementById("quote-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const dob = new Date(document.getElementById("f-dob").value || "2000-01-01");
  const age = Math.max(16, new Date().getFullYear() - dob.getFullYear());

  const quote = {
    firstName: document.getElementById("f-fname").value,
    lastName: document.getElementById("f-lname").value,
    street: document.getElementById("f-street").value,
    city: document.getElementById("f-city").value,
    state: document.getElementById("f-state").value,
    zip: document.getElementById("f-zip").value,
    age,
    yearsLicensed: Number(document.getElementById("f-years").value),
    vehicleYear: Number(document.getElementById("f-year").value),
    vehicle: document.getElementById("f-vehicle").value,
    liab: document.getElementById("f-liab").value,
    comp: document.getElementById("f-comp").value,
    coll: document.getElementById("f-coll").value,
    prior: document.getElementById("f-prior").value,
  };

  const results = await Promise.all(
    carriers.map(async c => ({ carrier: c, rate: await fetchCarrierRate(c, quote) }))
  );
  results.sort((a, b) => a.rate.premium - b.rate.premium);

  renderComparison(results);
  showView("compare");
});

function renderComparison(results) {
  const tbody = document.getElementById("rate-table-body");
  tbody.innerHTML = "";
  results.forEach((r, i) => {
    const tr = document.createElement("tr");
    if (i === 0) tr.classList.add("row-best");
    tr.innerHTML = `
      <td>${r.carrier.name}</td>
      <td>$${r.rate.premium.toLocaleString()}</td>
      <td>$${r.rate.downPayment.toLocaleString()}</td>
      <td>${r.rate.numPayments}</td>
      <td>$${r.rate.paymentAmount.toLocaleString()}</td>
      <td><button class="btn-success btn-sm">Select</button></td>
    `;
    tbody.appendChild(tr);
  });

  const premiums = results.map(r => r.rate.premium);
  document.getElementById("compare-stats").style.display = "grid";
  document.getElementById("stat-best").textContent = "$" + Math.min(...premiums).toLocaleString();
  document.getElementById("stat-avg").textContent = "$" + Math.round(premiums.reduce((a, b) => a + b, 0) / premiums.length).toLocaleString();
  document.getElementById("stat-count").textContent = results.length;
}

// ---- Carrier Connections settings ---------------------------------------

function renderCarrierConnections() {
  const tbody = document.getElementById("conn-table-body");
  tbody.innerHTML = "";
  carriers.forEach((c, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" value="${c.name}" data-idx="${idx}" data-field="name"></td>
      <td>
        <select data-idx="${idx}" data-field="type">
          <option ${c.type === "Real-Time API" ? "selected" : ""}>Real-Time API</option>
          <option ${c.type === "EDI / Batch" ? "selected" : ""}>EDI / Batch</option>
        </select>
      </td>
      <td><input type="text" placeholder="https://api.carrier.com/rate or EDI endpoint" value="${c.endpoint}" data-idx="${idx}" data-field="endpoint"></td>
      <td><span class="badge ${c.status === "live" ? "badge-live" : "badge-mock"}">${c.status === "live" ? "Connected" : "Not Connected"}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("conn-table-body").addEventListener("change", (e) => {
  const idx = e.target.dataset.idx;
  const field = e.target.dataset.field;
  if (idx === undefined) return;
  carriers[idx][field] = e.target.value;
  if (field === "endpoint") {
    carriers[idx].status = e.target.value ? "live" : "mock";
  }
  saveCarriers(carriers);
  renderCarrierConnections();
});

document.getElementById("add-carrier").addEventListener("click", () => {
  carriers.push({ name: "New Carrier", type: "Real-Time API", endpoint: "", status: "mock" });
  saveCarriers(carriers);
  renderCarrierConnections();
});

renderCarrierConnections();

// ---- Google Places address autocomplete ---------------------------------
function initAddressAutocomplete() {
  const status = document.getElementById("addr-status");
  const streetEl = document.getElementById("f-street");
  if (!window.google || !google.maps || !google.maps.places) {
    if (status) status.textContent = "(address verification unavailable)";
    return;
  }

  const ac = new google.maps.places.Autocomplete(streetEl, {
    types: ["address"],
    componentRestrictions: { country: "us" },
    fields: ["address_components", "formatted_address"],
  });

  ac.addListener("place_changed", () => {
    const place = ac.getPlace();
    if (!place.address_components) {
      status.textContent = "✗ Address not verified";
      status.className = "addr-status addr-bad";
      return;
    }

    let streetNumber = "", route = "", city = "", state = "", zip = "";
    for (const c of place.address_components) {
      if (c.types.includes("street_number")) streetNumber = c.long_name;
      else if (c.types.includes("route")) route = c.long_name;
      else if (c.types.includes("locality")) city = c.long_name;
      else if (c.types.includes("administrative_area_level_1")) state = c.short_name;
      else if (c.types.includes("postal_code")) zip = c.long_name;
    }

    streetEl.value = (streetNumber + " " + route).trim();
    document.getElementById("f-city").value = city;
    if (state) document.getElementById("f-state").value = state;
    document.getElementById("f-zip").value = zip;

    status.textContent = "✓ Verified";
    status.className = "addr-status addr-ok";
  });
}
window.initAddressAutocomplete = initAddressAutocomplete;
