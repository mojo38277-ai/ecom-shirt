/*
 * Local test server for the storefront — no dependencies.
 *
 * It serves the static site AND a mock of the Apps Script API on /api,
 * using exactly the same request/response shapes as apps-script/Code.gs.
 * Use it to test the whole app before you deploy to Google Sheets.
 *
 *   Run:   node tools/mock-server.js
 *   Open:  http://127.0.0.1:8787        (storefront)
 *          http://127.0.0.1:8787/admin.html
 *
 * Admin sign-in for the mock:  admin@store.test / admin123
 *
 * To point the site at this server, temporarily set in js/config.js:
 *   API_URL: "http://127.0.0.1:8787/api"
 * (Leave it "" again to ship in demo mode.)
 *
 * Data lives only in memory and resets every time the server restarts.
 */

"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var url = require("url");
var vm = require("vm");
var crypto = require("crypto");

var ROOT = path.resolve(__dirname, "..");
var PORT = Number(process.env.PORT) || 8787;
var HOST = "127.0.0.1";

var ADMIN_EMAIL = "admin@store.test";
var ADMIN_PASSWORD = "admin123";
var TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
var TOKEN_SECRET = crypto.randomBytes(32).toString("hex");
var LOGIN_LIMIT = 5;
var LOGIN_WINDOW_MS = 10 * 60 * 1000;
var ORDER_TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

var ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
var PAYMENT_METHODS = ["cash_on_delivery", "arranged_transfer"];
var PRODUCT_STATUSES = ["available", "unavailable", "archived"];

/* ---------------- seed data from js/config.js ---------------- */

function loadConfig() {
  var src = fs.readFileSync(path.join(ROOT, "js", "config.js"), "utf8");
  var sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "config.js" });
  return sandbox.window.SHOP_CONFIG || {};
}

var CONFIG = loadConfig();
var products = (CONFIG.DEMO_PRODUCTS || []).map(function (p) {
  return JSON.parse(JSON.stringify(p));
});
var orders = [];
var loginAttempts = {};   /* email -> { count, first } */
var orderTokens = {};     /* client_token -> { response, expires } */

/* ---------------- helpers ---------------- */

function base64Url(text) {
  return Buffer.from(text, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  var padded = text.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  return Buffer.from(padded, "base64").toString("utf8");
}

function sign(payload) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function clean(value, maxLen) {
  var s = String(value === null || value === undefined ? "" : value);
  s = s.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function int(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < min || n > max) return fallback;
  return n;
}

function list(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(function (x) { return clean(x, maxLen); }).filter(Boolean);
}

function ok(data) { return { ok: true, data: data }; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }

function activeProducts() {
  return products.filter(function (p) { return p.status === "available"; });
}

function findProduct(id) {
  for (var i = 0; i < products.length; i++) {
    if (products[i].id === String(id)) return products[i];
  }
  return null;
}

/* ---------------- auth ---------------- */

function issueToken() {
  var expiresAt = Date.now() + TOKEN_TTL_MS;
  var payload = base64Url(ADMIN_EMAIL + "|" + expiresAt);
  return { token: payload + "." + sign(payload), expires_at: new Date(expiresAt).toISOString(), email: ADMIN_EMAIL };
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;
  var parts = token.split(".");
  if (sign(parts[0]) !== parts[1]) return null;
  var text;
  try { text = fromBase64Url(parts[0]); } catch (e) { return null; }
  var segments = text.split("|");
  if (segments[0] !== ADMIN_EMAIL) return null;
  var expiresAt = Number(segments[1]);
  if (!isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return segments[0];
}

function rateLimitLogin(email) {
  var now = Date.now();
  var rec = loginAttempts[email];
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) {
    loginAttempts[email] = { count: 1, first: now };
    return true;
  }
  rec.count += 1;
  return rec.count <= LOGIN_LIMIT;
}

/* ---------------- API actions ---------------- */

function handleGet(query) {
  var action = clean(query.action, 40);
  if (action === "products") {
    return ok({ products: activeProducts(), server_time: new Date().toISOString() });
  }
  if (action === "product") {
    var id = clean(query.id, 64);
    var match = null;
    var active = activeProducts();
    for (var i = 0; i < active.length; i++) {
      if (active[i].id === id) { match = active[i]; break; }
    }
    return match ? ok({ product: match }) : fail("not_found", "Product not found.");
  }
  return fail("invalid_request", "Unknown action.");
}

function validateOrder(order) {
  var errors = [];
  var out = {};
  out.customer_name = clean(order.customer_name, 80);
  out.phone = clean(order.phone, 24).replace(/[^0-9+]/g, "");
  out.email = clean(order.email, 120);
  out.wilaya_or_region = clean(order.wilaya_or_region, 60);
  out.address = clean(order.address, 300);
  out.payment_method = clean(order.payment_method, 40);

  if (out.customer_name.length < 2) errors.push("customer_name");
  if (out.phone.length < 8 || out.phone.length > 15) errors.push("phone");
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errors.push("email");
  if (out.wilaya_or_region.length < 2) errors.push("wilaya_or_region");
  if (out.address.length < 8) errors.push("address");
  if (PAYMENT_METHODS.indexOf(out.payment_method) === -1) errors.push("payment_method");

  var items = order.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    errors.push("items");
    items = [];
  }
  out.items = items.map(function (item) {
    return {
      id: clean(item.id, 64),
      size: clean(item.size, 30),
      color: clean(item.color, 30),
      qty: int(item.qty, 1, 99, 0)
    };
  });
  out.items.forEach(function (item, i) {
    if (!item.id || item.qty < 1) errors.push("items[" + i + "]");
  });
  return { errors: errors, order: out };
}

function placeOrder(order, clientToken) {
  if (clientToken && orderTokens[clientToken] && orderTokens[clientToken].expires > Date.now()) {
    return ok(JSON.parse(JSON.stringify(orderTokens[clientToken].response)));
  }

  var check = validateOrder(order || {});
  if (check.errors.length) {
    return fail("invalid_request", "Invalid order data: " + check.errors.join(", ") + ".");
  }
  var valid = check.order;

  var lines = [];
  var qtyByProduct = {};
  var total = 0;
  for (var i = 0; i < valid.items.length; i++) {
    var item = valid.items[i];
    var product = findProduct(item.id);
    if (!product) return fail("stock", "A product in your cart is no longer available. Please refresh your cart.");
    if (product.sizes.length && product.sizes.indexOf(item.size) === -1) {
      return fail("invalid_request", "Invalid size for " + product.name + ".");
    }
    if (product.colors.length && product.colors.indexOf(item.color) === -1) {
      return fail("invalid_request", "Invalid color for " + product.name + ".");
    }
    qtyByProduct[product.id] = (qtyByProduct[product.id] || 0) + item.qty;
    if (qtyByProduct[product.id] > product.stock) {
      return fail("stock", "Not enough stock for " + product.name + " (" + product.stock + " left).");
    }
    lines.push({ id: product.id, name: product.name, size: item.size, color: item.color, qty: item.qty, price: product.price });
    total += product.price * item.qty;
  }

  Object.keys(qtyByProduct).forEach(function (pid) {
    var p = findProduct(pid);
    if (p) p.stock = Math.max(0, p.stock - qtyByProduct[pid]);
  });

  var createdAt = new Date().toISOString();
  var orderId = "ORD-" + createdAt.slice(2, 19).replace(/[-:T]/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
  orders.push({
    order_id: orderId,
    created_at: createdAt,
    customer_name: valid.customer_name,
    phone: valid.phone,
    email: valid.email,
    wilaya_or_region: valid.wilaya_or_region,
    address: valid.address,
    items: lines,
    total_amount: total,
    payment_method: valid.payment_method,
    order_status: "pending"
  });

  var response = { order_id: orderId, created_at: createdAt, total_amount: total, status: "pending" };
  if (clientToken) {
    orderTokens[clientToken] = { response: response, expires: Date.now() + ORDER_TOKEN_TTL_MS };
  }
  return ok(response);
}

function validateProductInput(input) {
  var errors = [];
  var p = {};
  p.name = clean(input.name, 120);
  p.category = clean(input.category, 40);
  p.price = int(input.price, 1, 100000000, -1);
  p.old_price = input.old_price === null || input.old_price === undefined || input.old_price === ""
    ? null : int(input.old_price, 1, 100000000, -1);
  p.description = clean(input.description, 2000);
  p.image_url = clean(input.image_url, 500);
  p.sizes = list(input.sizes, 12, 30);
  p.colors = list(input.colors, 12, 30);
  p.additional_images = list(input.additional_images, 6, 500);
  p.stock = int(input.stock, 0, 999999, -1);
  p.status = clean(input.status, 20);

  if (p.name.length < 2) errors.push("name");
  if (p.category.length < 2) errors.push("category");
  if (p.price < 0) errors.push("price");
  if (p.old_price === -1) errors.push("old_price");
  if (p.stock < 0) errors.push("stock");
  if (PRODUCT_STATUSES.indexOf(p.status) === -1) errors.push("status");
  if (p.image_url && !/^https:\/\/\S{10,500}$/i.test(p.image_url)) errors.push("image_url");
  p.additional_images.forEach(function (u) {
    if (!/^https:\/\/\S{10,500}$/i.test(u)) errors.push("additional_images");
  });
  return { errors: errors, product: p };
}

function saveProduct(input) {
  var check = validateProductInput(input || {});
  if (check.errors.length) {
    return fail("invalid_request", "Invalid product data: " + check.errors.join(", ") + ".");
  }
  var p = check.product;
  var now = new Date().toISOString();
  var id = clean(input.id, 64);
  var existing = id ? findProduct(id) : null;

  var record;
  if (existing) {
    record = {
      id: existing.id, name: p.name, category: p.category, price: p.price, old_price: p.old_price,
      description: p.description, image_url: p.image_url, additional_images: p.additional_images,
      sizes: p.sizes, colors: p.colors, stock: p.stock, status: p.status,
      created_at: existing.created_at || now, updated_at: now
    };
    var idx = products.indexOf(existing);
    products[idx] = record;
  } else {
    record = {
      id: "p_" + crypto.randomBytes(6).toString("hex"), name: p.name, category: p.category,
      price: p.price, old_price: p.old_price, description: p.description, image_url: p.image_url,
      additional_images: p.additional_images, sizes: p.sizes, colors: p.colors, stock: p.stock,
      status: p.status, created_at: now, updated_at: now
    };
    products.push(record);
  }
  return ok({ product: record });
}

function handleAdmin(action, body) {
  if (action === "admin_list_products") {
    return ok({ products: products.slice() });
  }
  if (action === "admin_list_orders") {
    return ok({ orders: orders.slice().sort(function (a, b) { return b.created_at.localeCompare(a.created_at); }) });
  }
  if (action === "admin_save_product") {
    return saveProduct(body.product || {});
  }
  if (action === "admin_set_status") {
    var status = clean(body.status, 20);
    if (PRODUCT_STATUSES.indexOf(status) === -1) return fail("invalid_request", "Invalid status.");
    var p = findProduct(body.id);
    if (!p) return fail("not_found", "Product not found.");
    p.status = status;
    p.updated_at = new Date().toISOString();
    return ok({ product: p });
  }
  if (action === "admin_update_stock") {
    var stock = int(body.stock, 0, 999999, -1);
    if (stock < 0) return fail("invalid_request", "Invalid stock value.");
    var sp = findProduct(body.id);
    if (!sp) return fail("not_found", "Product not found.");
    sp.stock = stock;
    sp.updated_at = new Date().toISOString();
    return ok({ product: sp });
  }
  if (action === "admin_update_order_status") {
    var orderStatus = clean(body.status, 20);
    if (ORDER_STATUSES.indexOf(orderStatus) === -1) return fail("invalid_request", "Invalid order status.");
    for (var i = 0; i < orders.length; i++) {
      if (orders[i].order_id === String(body.order_id)) {
        orders[i].order_status = orderStatus;
        return ok({ order: orders[i] });
      }
    }
    return fail("not_found", "Order not found.");
  }
  return fail("invalid_request", "Unknown action.");
}

function handlePost(body) {
  var action = clean(body.action, 40);

  if (action === "place_order") {
    return placeOrder(body.order, clean(body.client_token, 64));
  }
  if (action === "admin_login") {
    var email = clean(body.email, 120).toLowerCase();
    var password = String(body.password || "").slice(0, 200);
    if (!email || !password) return fail("invalid_request", "Email and password are required.");
    if (!rateLimitLogin(email)) return fail("rate_limited", "Too many sign-in attempts. Try again in 10 minutes.");
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return fail("invalid_credentials", "Wrong email or password.");
    }
    return ok(issueToken());
  }

  if (!verifyToken(body.token)) {
    return fail("unauthorized", "Your session is invalid or expired. Sign in again.");
  }
  return handleAdmin(action, body);
}

/* ---------------- static file serving ---------------- */

var MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

function sendJson(res, payload, status) {
  var body = JSON.stringify(payload);
  res.writeHead(status || 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendFile(res, filePath) {
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

function readBody(req, done) {
  var chunks = [];
  var size = 0;
  req.on("data", function (chunk) {
    size += chunk.length;
    if (size > 1024 * 1024) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on("end", function () {
    done(Buffer.concat(chunks).toString("utf8"));
  });
}

/* ---------------- server ---------------- */

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname || "/";

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    res.end();
    return;
  }

  if (pathname === "/api" || pathname === "/api/") {
    if (req.method === "GET") {
      sendJson(res, handleGet(parsed.query));
      return;
    }
    if (req.method === "POST") {
      readBody(req, function (text) {
        var body;
        try { body = JSON.parse(text || "{}"); }
        catch (e) { sendJson(res, fail("invalid_request", "Malformed request body.")); return; }
        sendJson(res, handlePost(body));
      });
      return;
    }
    sendJson(res, fail("invalid_request", "Method not allowed."), 405);
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("405 Method Not Allowed");
    return;
  }

  var rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  var target = path.normalize(path.join(ROOT, rel));
  if (target.indexOf(ROOT) !== 0) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  fs.stat(target, function (err, stat) {
    if (!err && stat.isDirectory()) {
      sendFile(res, path.join(target, "index.html"));
    } else {
      sendFile(res, target);
    }
  });
});

server.listen(PORT, HOST, function () {
  console.log("Mock store server running:");
  console.log("  Site  : http://" + HOST + ":" + PORT + "/");
  console.log("  Admin : http://" + HOST + ":" + PORT + "/admin.html");
  console.log("  API   : http://" + HOST + ":" + PORT + "/api");
  console.log("");
  console.log("Set API_URL in js/config.js to http://" + HOST + ":" + PORT + "/api to test live mode.");
  console.log("Admin sign-in: " + ADMIN_EMAIL + " / " + ADMIN_PASSWORD);
  console.log("Press Ctrl+C to stop.");
});
