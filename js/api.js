(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var BASE = (CFG.API_URL || "").replace(/\/+$/, "");
  var TIMEOUT_MS = 12000;

  function configured() {
    return BASE.length > 0;
  }

  function demoError(message) {
    return {
      ok: false,
      error: { code: "demo_mode", message: message || "Demo mode: API_URL is not configured yet. See README.md." }
    };
  }

  function request(path, options) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
    var opts = options || {};
    if (controller) opts.signal = controller.signal;

    return fetch(BASE + path, opts)
      .then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try { body = text ? JSON.parse(text) : null; } catch (err) { body = null; }
          if (!body) {
            return { ok: false, error: { code: "bad_response", message: "The server returned an unreadable response." } };
          }
          return body;
        });
      })
      .catch(function (err) {
        var msg = err && err.name === "AbortError"
          ? "The request timed out. Check your connection and the API URL."
          : "Could not reach the API. Check the API URL and redeploy the web app.";
        return { ok: false, error: { code: "network", message: msg } };
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
      });
  }

  function get(params) {
    var qs = Object.keys(params)
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
      .join("&");
    return request("?" + qs, { method: "GET" });
  }

  function post(body) {
    return request("", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body)
    });
  }

  function demoProducts() {
    return (CFG.DEMO_PRODUCTS || []).slice();
  }

  var ShopAPI = {
    configured: configured,

    products: function () {
      if (!configured()) {
        return Promise.resolve({ ok: true, data: { products: demoProducts(), server_time: new Date().toISOString(), demo: true } });
      }
      return get({ action: "products" });
    },

    product: function (id) {
      if (!configured()) {
        var found = demoProducts().filter(function (p) { return p.id === id; })[0] || null;
        return Promise.resolve(found
          ? { ok: true, data: { product: found, demo: true } }
          : { ok: false, error: { code: "not_found", message: "Product not found." } });
      }
      return get({ action: "product", id: id });
    },

    placeOrder: function (payload) {
      if (!configured()) {
        return Promise.resolve(demoError("Demo mode: the order was not sent. Configure API_URL and redeploy to accept real orders."));
      }
      return post({ action: "place_order", order: payload.order, client_token: payload.clientToken });
    },

    login: function (email, password) {
      if (!configured()) return Promise.resolve(demoError());
      return post({ action: "admin_login", email: email, password: password });
    },

    admin: function (action, payload, token) {
      if (!configured()) return Promise.resolve(demoError());
      var body = {};
      Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
      body.action = action;
      body.token = token;
      return post(body);
    }
  };

  window.ShopAPI = ShopAPI;
})();
