/**************************************************************
 * Clothing store backend — Google Apps Script Web App
 * Spreadsheet tabs: "Products" and "Orders" (created by setup()).
 *
 * Setup (run once from the Apps Script editor):
 *   1. setup()                    — creates sheets, secret, sample data
 *   2. setAdminPassword()        — prompts for admin email + password
 *
 * Deploy: Deploy > New deployment > Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 *   - Copy the /exec URL into js/config.js → API_URL
 *
 * Public API (GET):
 *   ?action=products            → active products
 *   ?action=product&id=XYZ      → one product
 * Admin API (POST, JSON body, token from admin_login):
 *   place_order, admin_login, admin_list_products,
 *   admin_list_orders, admin_save_product, admin_set_status,
 *   admin_update_stock, admin_update_order_status
 **************************************************************/

var PRODUCT_HEADERS = ['id', 'name', 'category', 'price', 'old_price', 'description',
  'image_url', 'additional_images', 'sizes', 'colors', 'stock', 'status',
  'created_at', 'updated_at'];

var ORDER_HEADERS = ['order_id', 'created_at', 'customer_name', 'phone', 'email',
  'wilaya_or_region', 'address', 'items_json', 'total_amount', 'payment_method',
  'order_status', 'client_token'];

var STATUSES = ['available', 'unavailable', 'archived'];
var ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
var PAYMENT_METHODS = ['cash_on_delivery', 'arranged_transfer'];
var TOKEN_TTL_SECONDS = 8 * 60 * 60;
var PRODUCTS_CACHE_KEY = 'products_json_v1';
var PRODUCTS_CACHE_SECONDS = 60;

var SAMPLE_PRODUCTS = [
  ['Oversized Black Hoodie', 'Men', 3500, 4200, 'Premium cotton oversized hoodie with a double-layer hood and ribbed cuffs.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], ['S', 'M', 'L', 'XL'], ['Black', 'White', 'Grey'], 15, 'available'],
  ['Classic White Tee', 'Men', 1800, null, 'Soft combed cotton crew neck. Clean boxy silhouette.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], ['S', 'M', 'L'], ['White', 'Black'], 24, 'available'],
  ['High-Waist Straight Jeans', 'Women', 4200, 4900, 'Rigid-wash denim, high rise, straight leg.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], ['36', '38', '40', '42'], ['Blue', 'Black'], 10, 'available'],
  ['Leather Crossbody Bag', 'Accessories', 2900, null, 'Compact pebbled-leather crossbody with brushed gold hardware.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], [], ['Brown', 'Black'], 8, 'available'],
  ['Everyday Runner Sneakers', 'Shoes', 5500, 6500, 'Cushioned low-top runners with a breathable knit upper.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], ['40', '41', '42', '43', '44'], ['White', 'Grey'], 12, 'available'],
  ['Ribbed Knit Beanie', 'Accessories', 1200, null, 'Merino-blend ribbed beanie with a fold-up brim.',
    'https://res.cloudinary.com/demo/image/upload/sample.jpg', [], [], ['Beige', 'Black'], 0, 'available']
];

/* ---------------- setup helpers ---------------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getProp_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

function ensureSheet_(name, headers) {
  var book = ss_();
  var sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function productsSheet_() { return ensureSheet_('Products', PRODUCT_HEADERS); }
function ordersSheet_() { return ensureSheet_('Orders', ORDER_HEADERS); }

function setup() {
  productsSheet_();
  ordersSheet_();
  if (!getProp_('TOKEN_SECRET')) {
    setProp_('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  var sheet = productsSheet_();
  if (sheet.getLastRow() <= 1) {
    var now = new Date().toISOString();
    var rows = SAMPLE_PRODUCTS.map(function (p) {
      return [Utilities.getUuid(), p[0], p[1], p[2], p[3], p[4], p[5],
        JSON.stringify(p[6]), JSON.stringify(p[7]), JSON.stringify(p[8]),
        p[9], p[10], now, now];
    });
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.getActive().toast('Setup complete: sheets + ' + rows.length + ' sample products.');
  } else {
    SpreadsheetApp.getActive().toast('Setup complete: sheets ready.');
  }
}

function setAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var emailResponse = ui.prompt('Admin account', 'Enter the admin email:', ui.ButtonSet.OK_CANCEL);
  if (emailResponse.getSelectedButton() !== ui.Button.OK) return;
  var email = emailResponse.getResponseText().trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    ui.alert('That does not look like a valid email. Run setAdminPassword() again.');
    return;
  }
  var passResponse = ui.prompt('Admin account', 'Enter a strong password (min 8 characters):', ui.ButtonSet.OK_CANCEL);
  if (passResponse.getSelectedButton() !== ui.Button.OK) return;
  var password = passResponse.getResponseText();
  if (password.length < 8) {
    ui.alert('Password must be at least 8 characters. Run setAdminPassword() again.');
    return;
  }
  var salt = Utilities.getUuid();
  setProp_('ADMIN_EMAIL', email);
  setProp_('ADMIN_PASSWORD_SALT', salt);
  setProp_('ADMIN_PASSWORD_HASH', sha256_(salt + password));
  if (!getProp_('TOKEN_SECRET')) setProp_('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ui.alert('Admin account saved for ' + email + '. You can sign in at admin.html once the site is deployed.');
}

function revokeAllSessions() {
  setProp_('TOKEN_NOT_BEFORE', String(Date.now()));
  Logger.log('All existing admin sessions are now invalid. Users must sign in again.');
}

/* ---------------- small utilities ---------------- */

function sha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function sign_(payload, secret) {
  return base64Url_(Utilities.computeHmacSha256Signature(payload, secret));
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: { code: code, message: message } }))
    .setMimeType(ContentService.MimeType.JSON);
}

function clean_(value, maxLen) {
  var s = String(value === null || value === undefined ? '' : value);
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function int_(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  n = Math.round(n);
  if (n < min) return fallback;
  if (n > max) return fallback;
  return n;
}

function parseJsonArray_(value, maxItems, maxLen) {
  var arr = [];
  if (!value) return arr;
  try {
    var parsed = JSON.parse(value);
    if (Array.isArray(parsed)) arr = parsed;
  } catch (e) { arr = []; }
  return arr.slice(0, maxItems).map(function (item) { return clean_(item, maxLen); }).filter(Boolean);
}

/* ---------------- products ---------------- */

function readProducts_(includeAll) {
  var sheet = productsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, PRODUCT_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    var status = String(r[11] || 'available');
    if (!includeAll && status !== 'available') continue;
    out.push({
      id: String(r[0]),
      name: String(r[1]),
      category: String(r[2]),
      price: Math.round(Number(r[3]) || 0),
      old_price: r[4] === '' || r[4] === null ? null : Math.round(Number(r[4]) || 0),
      description: String(r[5] || ''),
      image_url: String(r[6] || ''),
      additional_images: parseJsonArray_(r[7], 6, 500),
      sizes: parseJsonArray_(r[8], 12, 30),
      colors: parseJsonArray_(r[9], 12, 30),
      stock: int_(r[10], 0, 999999, 0),
      status: status,
      created_at: r[12] ? new Date(r[12]).toISOString() : '',
      updated_at: r[13] ? new Date(r[13]).toISOString() : ''
    });
  }
  return out;
}

function getCachedProducts_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(PRODUCTS_CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* re-read */ }
  }
  var products = readProducts_(false);
  try { cache.put(PRODUCTS_CACHE_KEY, JSON.stringify(products), PRODUCTS_CACHE_SECONDS); } catch (e) { /* quota */ }
  return products;
}

function invalidateProductsCache_() {
  try { CacheService.getScriptCache().remove(PRODUCTS_CACHE_KEY); } catch (e) { /* quota */ }
}

function findProductRow_(id) {
  var sheet = productsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function validateProductInput_(input) {
  var errors = [];
  var p = {};
  p.name = clean_(input.name, 120);
  p.category = clean_(input.category, 40);
  p.price = int_(input.price, 1, 100000000, -1);
  p.old_price = input.old_price === null || input.old_price === undefined || input.old_price === ''
    ? null : int_(input.old_price, 1, 100000000, -1);
  p.description = clean_(input.description, 2000);
  p.image_url = clean_(input.image_url, 500);
  p.sizes = parseJsonArray_(JSON.stringify(input.sizes || []), 12, 30);
  p.colors = parseJsonArray_(JSON.stringify(input.colors || []), 12, 30);
  p.additional_images = parseJsonArray_(JSON.stringify(input.additional_images || []), 6, 500);
  p.stock = int_(input.stock, 0, 999999, -1);
  p.status = clean_(input.status, 20);

  if (p.name.length < 2) errors.push('name');
  if (p.category.length < 2) errors.push('category');
  if (p.price < 0) errors.push('price');
  if (p.old_price === -1) errors.push('old_price');
  if (p.stock < 0) errors.push('stock');
  if (STATUSES.indexOf(p.status) === -1) errors.push('status');
  if (p.image_url && !/^https:\/\/\S{10,500}$/i.test(p.image_url)) errors.push('image_url');
  for (var i = 0; i < p.additional_images.length; i++) {
    if (!/^https:\/\/\S{10,500}$/i.test(p.additional_images[i])) errors.push('additional_images');
  }
  return { errors: errors, product: p };
}

function saveProduct_(input) {
  var check = validateProductInput_(input);
  if (check.errors.length) {
    return { ok: false, code: 'invalid_request', message: 'Invalid product data: ' + check.errors.join(', ') + '.' };
  }
  var p = check.product;
  var sheet = productsSheet_();
  var now = new Date().toISOString();
  var id = clean_(input.id, 64);
  var row = id ? findProductRow_(id) : -1;

  if (row > -1) {
    var old = sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length).getValues()[0];
    var createdAt = old[12] ? old[12] : now;
    var finalId = String(old[0]);
    sheet.getRange(row, 1, 1, PRODUCT_HEADERS.length).setValues([[
      finalId, p.name, p.category, p.price, p.old_price, p.description, p.image_url,
      JSON.stringify(p.additional_images), JSON.stringify(p.sizes), JSON.stringify(p.colors),
      p.stock, p.status, createdAt, now
    ]]);
    invalidateProductsCache_();
    return { ok: true, product: {
      id: finalId, name: p.name, category: p.category, price: p.price, old_price: p.old_price,
      description: p.description, image_url: p.image_url, additional_images: p.additional_images,
      sizes: p.sizes, colors: p.colors, stock: p.stock, status: p.status,
      created_at: createdAt, updated_at: now
    } };
  }

  var newId = 'p_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  sheet.appendRow([newId, p.name, p.category, p.price, p.old_price, p.description, p.image_url,
    JSON.stringify(p.additional_images), JSON.stringify(p.sizes), JSON.stringify(p.colors),
    p.stock, p.status, now, now]);
  invalidateProductsCache_();
  return { ok: true, product: {
    id: newId, name: p.name, category: p.category, price: p.price, old_price: p.old_price,
    description: p.description, image_url: p.image_url, additional_images: p.additional_images,
    sizes: p.sizes, colors: p.colors, stock: p.stock, status: p.status,
    created_at: now, updated_at: now
  } };
}

/* ---------------- orders ---------------- */

function validateOrderInput_(order) {
  var errors = [];
  var out = {};
  out.customer_name = clean_(order.customer_name, 80);
  out.phone = clean_(order.phone, 24).replace(/[^0-9+]/g, '');
  out.email = clean_(order.email, 120);
  out.wilaya_or_region = clean_(order.wilaya_or_region, 60);
  out.address = clean_(order.address, 300);
  out.payment_method = clean_(order.payment_method, 40);

  if (out.customer_name.length < 2 || out.customer_name.length > 80) errors.push('customer_name');
  if (out.phone.length < 8 || out.phone.length > 15) errors.push('phone');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out.email)) errors.push('email');
  if (out.wilaya_or_region.length < 2) errors.push('wilaya_or_region');
  if (out.address.length < 8) errors.push('address');
  if (PAYMENT_METHODS.indexOf(out.payment_method) === -1) errors.push('payment_method');

  var items = order.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    errors.push('items');
    items = [];
  }
  out.items = items.map(function (item) {
    return {
      id: clean_(item.id, 64),
      size: clean_(item.size, 30),
      color: clean_(item.color, 30),
      qty: int_(item.qty, 1, 99, 0)
    };
  });
  out.items.forEach(function (item, i) {
    if (!item.id || item.qty < 1) errors.push('items[' + i + ']');
  });
  return { errors: errors, order: out };
}

function placeOrder_(order, clientToken) {
  var check = validateOrderInput_(order);
  if (check.errors.length) {
    return { ok: false, code: 'invalid_request', message: 'Invalid order data: ' + check.errors.join(', ') + '.' };
  }

  var cache = CacheService.getScriptCache();
  var tokenKey = clientToken ? 'order_' + sha256_(String(clientToken)).slice(0, 40) : '';
  if (tokenKey) {
    var previous = cache.get(tokenKey);
    if (previous) {
      try { return { ok: true, data: JSON.parse(previous), duplicate: true }; }
      catch (e) { /* reprocess */ }
    }
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { ok: false, code: 'busy', message: 'The store is busy right now. Please try again in a moment.' };
  }

  try {
    var valid = check.order;
    var catalog = {};
    readProducts_(false).forEach(function (p) { catalog[p.id] = p; });

    var lines = [];
    var qtyByProduct = {};
    var total = 0;
    for (var i = 0; i < valid.items.length; i++) {
      var item = valid.items[i];
      var product = catalog[item.id];
      if (!product) {
        return { ok: false, code: 'stock', message: 'A product in your cart is no longer available. Please refresh your cart.' };
      }
      if (product.sizes.length && product.sizes.indexOf(item.size) === -1) {
        return { ok: false, code: 'invalid_request', message: 'Invalid size for ' + product.name + '.' };
      }
      if (product.colors.length && product.colors.indexOf(item.color) === -1) {
        return { ok: false, code: 'invalid_request', message: 'Invalid color for ' + product.name + '.' };
      }
      qtyByProduct[product.id] = (qtyByProduct[product.id] || 0) + item.qty;
      if (qtyByProduct[product.id] > product.stock) {
        return { ok: false, code: 'stock', message: 'Not enough stock for ' + product.name + ' (' + product.stock + ' left).' };
      }
      lines.push({
        id: product.id, name: product.name, size: item.size, color: item.color,
        qty: item.qty, price: product.price
      });
      total += product.price * item.qty;
    }

    var timeZone = Session.getScriptTimeZone();
    var orderId = 'ORD-' + Utilities.formatDate(new Date(), timeZone, 'yyMMdd-HHmmss') +
      '-' + Math.floor(1000 + Math.random() * 9000);
    var createdAt = new Date().toISOString();

    var sheet = ordersSheet_();
    sheet.appendRow([orderId, createdAt, valid.customer_name, valid.phone, valid.email,
      valid.wilaya_or_region, valid.address, JSON.stringify(lines), total,
      valid.payment_method, 'pending', clientToken ? clean_(clientToken, 64) : '']);

    var productSheet = productsSheet_();
    Object.keys(qtyByProduct).forEach(function (pid) {
      var rowIndex = findProductRow_(pid);
      if (rowIndex > -1) {
        var currentStock = int_(productSheet.getRange(rowIndex, 11).getValue(), 0, 999999, 0);
        productSheet.getRange(rowIndex, 11).setValue(Math.max(0, currentStock - qtyByProduct[pid]));
      }
    });
    invalidateProductsCache_();

    var response = {
      order_id: orderId,
      created_at: createdAt,
      total_amount: total,
      status: 'pending'
    };
    if (tokenKey) {
      try { cache.put(tokenKey, JSON.stringify(response), 21600); } catch (e) { /* quota */ }
    }
    return { ok: true, data: response };
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- admin auth ---------------- */

function hashPassword_(password) {
  return sha256_(getProp_('ADMIN_PASSWORD_SALT') + password);
}

function rateLimitLogin_(email) {
  var cache = CacheService.getScriptCache();
  var key = 'login_' + sha256_(email).slice(0, 32);
  var attempts = Number(cache.get(key) || 0);
  if (attempts >= 5) return false;
  cache.put(key, String(attempts + 1), 600);
  return true;
}

function adminLogin_(email, password) {
  var cleanEmail = clean_(email, 120).toLowerCase();
  var cleanPass = String(password || '').slice(0, 200);
  if (!cleanEmail || !cleanPass) {
    return { ok: false, code: 'invalid_request', message: 'Email and password are required.' };
  }
  if (!rateLimitLogin_(cleanEmail)) {
    return { ok: false, code: 'rate_limited', message: 'Too many sign-in attempts. Try again in 10 minutes.' };
  }
  var storedEmail = String(getProp_('ADMIN_EMAIL') || '').toLowerCase();
  var storedHash = String(getProp_('ADMIN_PASSWORD_HASH') || '');
  if (!storedEmail || !storedHash) {
    return { ok: false, code: 'server_error', message: 'No admin account is configured yet. Run setAdminPassword() in the Apps Script editor.' };
  }
  if (cleanEmail !== storedEmail || hashPassword_(cleanPass) !== storedHash) {
    return { ok: false, code: 'invalid_credentials', message: 'Wrong email or password.' };
  }
  var secret = getProp_('TOKEN_SECRET');
  if (!secret) {
    return { ok: false, code: 'server_error', message: 'Server is not configured. Run setup() first.' };
  }
  var expiresAt = Date.now() + TOKEN_TTL_SECONDS * 1000;
  var payload = base64Url_(Utilities.newBlob(cleanEmail + '|' + expiresAt).getBytes());
  var token = payload + '.' + sign_(payload, secret);
  return { ok: true, data: { token: token, expires_at: new Date(expiresAt).toISOString(), email: cleanEmail } };
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  var payload = parts[0];
  var signature = parts[1];
  var secret = getProp_('TOKEN_SECRET');
  if (!secret) return null;
  if (sign_(payload, secret) !== signature) return null;
  var text = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload)).getDataAsString();
  var segments = text.split('|');
  var email = segments[0];
  var expiresAt = Number(segments[1]);
  if (!email || !isFinite(expiresAt) || Date.now() > expiresAt) return null;
  var notBefore = Number(getProp_('TOKEN_NOT_BEFORE') || 0);
  if (expiresAt < notBefore) return null;
  return email;
}

function listOrders_() {
  var sheet = ordersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, ORDER_HEADERS.length).getValues();
  return values.filter(function (r) { return r[0]; }).map(function (r) {
    var items = [];
    try { items = JSON.parse(r[7]); } catch (e) { items = []; }
    return {
      order_id: String(r[0]),
      created_at: r[1] ? new Date(r[1]).toISOString() : '',
      customer_name: String(r[2]),
      phone: String(r[3]),
      email: String(r[4]),
      wilaya_or_region: String(r[5]),
      address: String(r[6]),
      items: items,
      total_amount: Math.round(Number(r[8]) || 0),
      payment_method: String(r[9]),
      order_status: String(r[10] || 'pending')
    };
  }).sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
}

function setOrderStatus_(orderId, status) {
  if (ORDER_STATUSES.indexOf(status) === -1) {
    return { ok: false, code: 'invalid_request', message: 'Invalid order status.' };
  }
  var sheet = ordersSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, code: 'not_found', message: 'Order not found.' };
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(orderId)) {
      sheet.getRange(i + 2, 11).setValue(status);
      var orders = listOrders_();
      for (var j = 0; j < orders.length; j++) {
        if (orders[j].order_id === orderId) return { ok: true, order: orders[j] };
      }
      return { ok: true, order: { order_id: orderId, order_status: status } };
    }
  }
  return { ok: false, code: 'not_found', message: 'Order not found.' };
}

/* ---------------- entry points ---------------- */

function doGet(e) {
  try {
    var action = e && e.parameter ? String(e.parameter.action || '') : '';
    if (action === 'products') {
      return json_({ products: getCachedProducts_(), server_time: new Date().toISOString() });
    }
    if (action === 'product') {
      var id = clean_(e.parameter.id, 64);
      var match = null;
      var products = getCachedProducts_();
      for (var i = 0; i < products.length; i++) {
        if (products[i].id === id) { match = products[i]; break; }
      }
      if (match) return json_({ product: match });
      return err_('not_found', 'Product not found.');
    }
    return err_('invalid_request', 'Unknown action.');
  } catch (error) {
    Logger.log('doGet error: ' + error);
    return err_('server_error', 'Something went wrong. Please try again.');
  }
}

function doPost(e) {
  try {
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (parseError) {
      return err_('invalid_request', 'Malformed request body.');
    }
    var action = clean_(body.action, 40);

    if (action === 'place_order') {
      var result = placeOrder_(body.order || {}, body.client_token);
      if (result.ok) return json_(result.data);
      return err_(result.code, result.message);
    }

    if (action === 'admin_login') {
      var login = adminLogin_(body.email, body.password);
      if (login.ok) return json_(login.data);
      return err_(login.code, login.message);
    }

    var email = verifyToken_(body.token);
    if (!email) return err_('unauthorized', 'Your session is invalid or expired. Sign in again.');

    if (action === 'admin_list_products') {
      return json_({ products: readProducts_(true) });
    }
    if (action === 'admin_list_orders') {
      return json_({ orders: listOrders_() });
    }
    if (action === 'admin_save_product') {
      var saved = saveProduct_(body.product || {});
      if (saved.ok) return json_({ product: saved.product });
      return err_(saved.code, saved.message);
    }
    if (action === 'admin_set_status') {
      var id = clean_(body.id, 64);
      var status = clean_(body.status, 20);
      if (STATUSES.indexOf(status) === -1) {
        return err_('invalid_request', 'Invalid status.');
      }
      var rowIndex = findProductRow_(id);
      if (rowIndex === -1) return err_('not_found', 'Product not found.');
      productsSheet_().getRange(rowIndex, 12).setValue(status);
      productsSheet_().getRange(rowIndex, 13).setValue(new Date().toISOString());
      invalidateProductsCache_();
      var all = readProducts_(true);
      for (var k = 0; k < all.length; k++) {
        if (all[k].id === id) return json_({ product: all[k] });
      }
      return err_('not_found', 'Product not found.');
    }
    if (action === 'admin_update_stock') {
      var stockId = clean_(body.id, 64);
      var stock = int_(body.stock, 0, 999999, -1);
      if (stock < 0) return err_('invalid_request', 'Invalid stock value.');
      var stockRow = findProductRow_(stockId);
      if (stockRow === -1) return err_('not_found', 'Product not found.');
      productsSheet_().getRange(stockRow, 11).setValue(stock);
      productsSheet_().getRange(stockRow, 14).setValue(new Date().toISOString());
      invalidateProductsCache_();
      var allProducts = readProducts_(true);
      for (var m = 0; m < allProducts.length; m++) {
        if (allProducts[m].id === stockId) return json_({ product: allProducts[m] });
      }
      return err_('not_found', 'Product not found.');
    }
    if (action === 'admin_update_order_status') {
      var orderResult = setOrderStatus_(clean_(body.order_id, 40), clean_(body.status, 20));
      if (orderResult.ok) return json_({ order: orderResult.order });
      return err_(orderResult.code, orderResult.message);
    }

    return err_('invalid_request', 'Unknown action.');
  } catch (error) {
    Logger.log('doPost error: ' + error);
    return err_('server_error', 'Something went wrong. Please try again.');
  }
}
