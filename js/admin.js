(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var TOKEN_KEY = "shop_admin_token";
  var EMAIL_KEY = "shop_admin_email";
  var ORDER_STATUSES = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  var token = null;
  var state = {
    products: [],
    orders: [],
    view: "overview",
    orderFilter: "all",
    prodQuery: "",
    prodStatus: "all",
    saving: false
  };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fmtMoney(n) {
    var c = CFG.CURRENCY || {};
    var num = Number(n);
    if (!isFinite(num)) num = 0;
    var str;
    try { str = num.toLocaleString(c.locale || "en-US"); }
    catch (err) { str = String(num); }
    return (str + " " + (c.symbol || "")).trim();
  }

  function toast(msg, type) { window.ShopToastAdmin.push(msg, type); }

  function readToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); }
    catch (err) { return null; }
  }

  function storeToken(value) {
    try {
      sessionStorage.setItem(TOKEN_KEY, value);
      sessionStorage.setItem(EMAIL_KEY, value ? "1" : "");
    } catch (err) { /* ignore */ }
  }

  function clearToken() {
    token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(EMAIL_KEY); }
    catch (err) { /* ignore */ }
  }

  function call(action, payload) {
    return window.ShopAPI.admin(action, payload || {}, token).then(function (res) {
      if (!res.ok && res.error && (res.error.code === "unauthorized" || res.error.code === "invalid_token")) {
        clearToken();
        showLogin("Your session expired. Please sign in again.");
        return res;
      }
      return res;
    });
  }

  function showLogin(msg) {
    $("loginView").style.display = "flex";
    $("adminShell").classList.remove("on");
    var alert = $("loginAlert");
    if (msg) { alert.textContent = msg; alert.hidden = false; }
  }

  function showShell() {
    $("loginView").style.display = "none";
    $("adminShell").classList.add("on");
    $("setupCallout").hidden = window.ShopAPI.configured();
    loadAll();
  }

  function loadAll() {
    return Promise.all([
      call("admin_list_products"),
      call("admin_list_orders")
    ]).then(function (results) {
      if (!token) return;
      var pr = results[0];
      var or = results[1];
      if (pr.ok) state.products = pr.data.products || [];
      else toast(pr.error && pr.error.message, "error");
      if (or.ok) state.orders = or.data.orders || [];
      else if (or.error && or.error.code !== "unauthorized") toast(or.error && or.error.message, "error");
      renderAll();
    });
  }

  function renderAll() {
    renderStats();
    renderProducts();
    renderOrders();
  }

  function renderStats() {
    var products = state.products;
    var orders = state.orders;
    var pending = orders.filter(function (o) { return o.order_status === "pending"; }).length;
    var low = products.filter(function (p) { return p.status === "available" && Number(p.stock) <= 3; }).length;

    $("statProducts").textContent = String(products.length);
    $("statOrders").textContent = String(orders.length);
    $("statPending").textContent = String(pending);
    $("statLowStock").textContent = String(low);
    $("sideProductCount").textContent = String(products.length);
    $("sideOrderCount").textContent = String(orders.length);

    var body = $("recentOrdersBody");
    body.replaceChildren();
    orders.slice(0, 5).forEach(function (o) {
      var tr = el("tr");
      tr.appendChild(el("td", "", o.order_id));
      tr.appendChild(el("td", "", formatDate(o.created_at)));
      tr.appendChild(el("td", "", o.customer_name));
      tr.appendChild(el("td", "", fmtMoney(o.total_amount)));
      tr.appendChild(el("td", "", ""));
      tr.lastChild.appendChild(statusTag(o.order_status));
      body.appendChild(tr);
    });
  }

  function formatDate(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return String(iso || "");
    try {
      return new Date(t).toLocaleDateString(CFG.CURRENCY && CFG.CURRENCY.locale || "en-GB",
        { day: "2-digit", month: "short", year: "numeric" });
    } catch (err) { return new Date(t).toISOString().slice(0, 10); }
  }

  function statusTag(status) {
    var cls = "tag";
    if (status === "available" || status === "delivered") cls += " tag-ok";
    else if (status === "pending" || status === "confirmed" || status === "shipped") cls += " tag-warn";
    else cls += " tag-off";
    return el("span", cls, status);
  }

  function renderProducts() {
    var body = $("productsBody");
    if (!body) return;
    body.replaceChildren();

    var list = state.products.filter(function (p) {
      if (state.prodStatus !== "all" && p.status !== state.prodStatus) return false;
      if (state.prodQuery) {
        var hay = (p.name + " " + p.category).toLowerCase();
        if (hay.indexOf(state.prodQuery) === -1) return false;
      }
      return true;
    });

    $("productsEmpty").hidden = state.products.length !== 0;

    list.forEach(function (p) {
      var tr = el("tr");

      var tdImg = el("td");
      var img = el("img", "thumb");
      img.src = p.image_url || "";
      img.alt = "";
      img.loading = "lazy";
      tdImg.appendChild(img);
      tr.appendChild(tdImg);

      tr.appendChild(el("td", "", p.name));
      tr.appendChild(el("td", "", p.category));
      tr.appendChild(el("td", "", fmtMoney(p.price)));

      var tdStock = el("td");
      var stockInput = document.createElement("input");
      stockInput.type = "number";
      stockInput.min = "0";
      stockInput.step = "1";
      stockInput.value = String(p.stock);
      stockInput.className = "status-select";
      stockInput.style.width = "76px";
      stockInput.setAttribute("aria-label", "Stock for " + p.name);
      stockInput.addEventListener("change", function () {
        var v = parseInt(stockInput.value, 10);
        if (!isFinite(v) || v < 0) { stockInput.value = String(p.stock); return; }
        call("admin_update_stock", { id: p.id, stock: v }).then(function (res) {
          if (res.ok) {
            var idx = state.products.findIndex(function (x) { return x.id === p.id; });
            if (idx > -1) state.products[idx] = res.data.product;
            renderStats();
            toast("Stock updated.", "ok");
          } else {
            stockInput.value = String(p.stock);
            toast(res.error && res.error.message, "error");
          }
        });
      });
      tdStock.appendChild(stockInput);
      tr.appendChild(tdStock);

      var tdStatus = el("td");
      tdStatus.appendChild(statusTag(p.status));
      tr.appendChild(tdStatus);

      var tdActions = el("td");
      var actions = el("div", "actions");

      var edit = el("button", "btn btn-quiet btn-sm", "Edit");
      edit.type = "button";
      edit.addEventListener("click", function () { openProductModal(p); });
      actions.appendChild(edit);

      if (p.status === "archived") {
        var restore = el("button", "btn btn-quiet btn-sm", "Restore");
        restore.type = "button";
        restore.addEventListener("click", function () { setStatus(p, "available"); });
        actions.appendChild(restore);
      } else {
        var toggle = el("button", "btn btn-quiet btn-sm", p.status === "available" ? "Hide" : "Show");
        toggle.type = "button";
        toggle.addEventListener("click", function () {
          setStatus(p, p.status === "available" ? "unavailable" : "available");
        });
        actions.appendChild(toggle);

        var archive = el("button", "btn btn-quiet btn-sm", "Archive");
        archive.type = "button";
        archive.addEventListener("click", function () { setStatus(p, "archived"); });
        actions.appendChild(archive);
      }

      tdActions.appendChild(actions);
      tr.appendChild(tdActions);
      body.appendChild(tr);
    });
  }

  function setStatus(p, status) {
    call("admin_set_status", { id: p.id, status: status }).then(function (res) {
      if (res.ok) {
        var idx = state.products.findIndex(function (x) { return x.id === p.id; });
        if (idx > -1) state.products[idx] = res.data.product;
        renderAll();
        toast("Product updated.", "ok");
      } else {
        toast(res.error && res.error.message, "error");
      }
    });
  }

  function renderOrders() {
    var body = $("ordersBody");
    if (!body) return;
    body.replaceChildren();

    var list = state.orders.filter(function (o) {
      return state.orderFilter === "all" || o.order_status === state.orderFilter;
    });

    $("ordersEmpty").hidden = state.orders.length !== 0;

    list.forEach(function (o) {
      var tr = el("tr");
      tr.appendChild(el("td", "", o.order_id));
      tr.appendChild(el("td", "", formatDate(o.created_at)));
      tr.appendChild(el("td", "", o.customer_name));
      tr.appendChild(el("td", "", o.wilaya_or_region));
      tr.appendChild(el("td", "", fmtMoney(o.total_amount)));
      tr.appendChild(el("td", "", o.payment_method === "arranged_transfer" ? "Transfer" : "Cash on delivery"));

      var tdStatus = el("td");
      var sel = document.createElement("select");
      sel.className = "status-select";
      sel.setAttribute("aria-label", "Status for order " + o.order_id);
      ORDER_STATUSES.forEach(function (s) {
        var opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        if (o.order_status === s) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () {
        sel.disabled = true;
        call("admin_update_order_status", { order_id: o.order_id, status: sel.value }).then(function (res) {
          sel.disabled = false;
          if (res.ok) {
            var idx = state.orders.findIndex(function (x) { return x.order_id === o.order_id; });
            if (idx > -1) state.orders[idx] = res.data.order;
            renderOrders();
            renderStats();
            toast("Order status updated.", "ok");
          } else {
            sel.value = o.order_status;
            toast(res.error && res.error.message, "error");
          }
        });
      });
      tdStatus.appendChild(sel);
      tr.appendChild(tdStatus);

      var tdView = el("td");
      var view = el("button", "btn btn-quiet btn-sm", "View");
      view.type = "button";
      view.addEventListener("click", function () { openOrderModal(o); });
      tdView.appendChild(view);
      tr.appendChild(tdView);

      body.appendChild(tr);
    });

    renderOrderChips();
  }

  function renderOrderChips() {
    var box = $("orderChips");
    if (!box) return;
    box.replaceChildren();
    var defs = [{ key: "all", label: "All" }].concat(ORDER_STATUSES.map(function (s) {
      return { key: s, label: s.charAt(0).toUpperCase() + s.slice(1) };
    }));
    defs.forEach(function (d) {
      var b = el("button", "chip", d.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.orderFilter === d.key));
      b.addEventListener("click", function () {
        state.orderFilter = d.key;
        renderOrders();
      });
      box.appendChild(b);
    });
  }

  function switchView(view) {
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll(".admin-view"), function (v) {
      v.classList.toggle("on", v.id === "view-" + view);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".side-link[data-view]"), function (b) {
      if (b.getAttribute("data-view") === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    var titles = { overview: "Overview", products: "Products", orders: "Orders" };
    $("viewTitle").textContent = titles[view] || "Overview";
  }

  function splitList(str) {
    return String(str || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .slice(0, 12);
  }

  function setErr(id, msg) {
    var input = $(id);
    if (!input) return;
    var field = input.closest(".field");
    var err = document.querySelector('[data-err-for="' + id + '"]');
    if (field) field.classList.toggle("invalid", !!msg);
    if (err) err.textContent = msg || "";
  }

  function validUrl(u) {
    return /^https:\/\/\S{10,500}$/i.test(u);
  }

  function openProductModal(p) {
    state.saving = false;
    $("productModalTitle").textContent = p ? "Edit product" : "Add product";
    $("productAlert").hidden = true;
    ["prodName", "prodCategory", "prodPrice", "prodOldPrice", "prodDesc", "prodImageUrl", "prodExtraImages", "prodSizes", "prodColors", "prodStock"].forEach(function (id) { setErr(id, ""); });

    $("prodId").value = p ? p.id : "";
    $("prodName").value = p ? p.name : "";
    $("prodCategory").value = p ? p.category : "";
    $("prodPrice").value = p ? String(p.price) : "";
    $("prodOldPrice").value = p && p.old_price ? String(p.old_price) : "";
    $("prodDesc").value = p && p.description ? p.description : "";
    $("prodImageUrl").value = p && p.image_url ? p.image_url : "";
    $("prodExtraImages").value = p && p.additional_images && p.additional_images.length ? p.additional_images.join("\n") : "";
    $("prodSizes").value = p && p.sizes ? p.sizes.join(", ") : "";
    $("prodColors").value = p && p.colors ? p.colors.join(", ") : "";
    $("prodStock").value = p ? String(p.stock) : "0";
    $("prodStatus").value = p ? p.status : "available";
    $("prodImageFile").value = "";
    $("uploadStatus").textContent = "";
    $("prodImagePreview").src = p && p.image_url ? p.image_url : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

    var dl = $("categoryList");
    dl.replaceChildren();
    var seen = {};
    state.products.forEach(function (x) {
      if (!seen[x.category]) {
        seen[x.category] = 1;
        dl.appendChild(el("option", "", x.category));
      }
    });
    (CFG.CATEGORIES || []).forEach(function (c) {
      if (!seen[c]) dl.appendChild(el("option", "", c));
    });

    $("productModalBack").classList.add("on");
    setTimeout(function () { $("prodName").focus(); }, 30);
  }

  function closeProductModal() {
    $("productModalBack").classList.remove("on");
  }

  function validateProductForm() {
    var ok = true;
    var name = $("prodName").value.trim();
    var category = $("prodCategory").value.trim();
    var price = Number($("prodPrice").value);
    var oldRaw = $("prodOldPrice").value.trim();
    var oldPrice = oldRaw === "" ? null : Number(oldRaw);
    var stock = parseInt($("prodStock").value, 10);
    var imageUrl = $("prodImageUrl").value.trim();

    if (name.length < 2 || name.length > 120) { setErr("prodName", "Name must be 2–120 characters."); ok = false; }
    else setErr("prodName", "");

    if (category.length < 2 || category.length > 40) { setErr("prodCategory", "Category must be 2–40 characters."); ok = false; }
    else setErr("prodCategory", "");

    if (!isFinite(price) || price <= 0 || price > 100000000) { setErr("prodPrice", "Enter a valid price greater than 0."); ok = false; }
    else setErr("prodPrice", "");

    if (oldPrice !== null && (!isFinite(oldPrice) || oldPrice <= 0)) { setErr("prodOldPrice", "Enter a valid old price or leave it empty."); ok = false; }
    else setErr("prodOldPrice", "");

    if (!imageUrl || !validUrl(imageUrl)) { setErr("prodImageUrl", "Upload a photo or paste an https:// image URL."); ok = false; }
    else setErr("prodImageUrl", "");

    if (!isFinite(stock) || stock < 0 || stock > 999999) { setErr("prodStock", "Enter a stock quantity of 0 or more."); ok = false; }
    else setErr("prodStock", "");

    if (!ok) return null;

    var extras = splitList($("prodExtraImages").value.replace(/\n/g, ",")).filter(validUrl);
    return {
      id: $("prodId").value || undefined,
      name: name,
      category: category,
      price: Math.round(price),
      old_price: oldPrice === null ? null : Math.round(oldPrice),
      description: $("prodDesc").value.trim().slice(0, 2000),
      image_url: imageUrl,
      additional_images: extras.slice(0, 6),
      sizes: splitList($("prodSizes").value),
      colors: splitList($("prodColors").value),
      stock: stock,
      status: $("prodStatus").value
    };
  }

  function saveProduct(e) {
    e.preventDefault();
    if (state.saving) return;
    var payload = validateProductForm();
    if (!payload) return;

    state.saving = true;
    var btn = $("saveProductBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";

    call("admin_save_product", { product: payload }).then(function (res) {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = "Save product";

      if (res.ok) {
        closeProductModal();
        toast(payload.id ? "Product updated." : "Product added — it is live in the storefront.", "ok");
        loadAll();
      } else {
        var box = $("productAlert");
        box.textContent = (res.error && res.error.message) || "Could not save the product.";
        box.hidden = false;
      }
    });
  }

  function uploadToCloudinary(file) {
    var cc = CFG.CLOUDINARY || {};
    if (!cc.cloudName || !cc.uploadPreset) {
      return Promise.resolve({
        ok: false,
        error: { message: "Image upload is not configured. Set CLOUDINARY in js/config.js or paste an image URL instead." }
      });
    }
    var allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.indexOf(file.type) === -1) {
      return Promise.resolve({ ok: false, error: { message: "Only JPG, PNG and WebP images are allowed." } });
    }
    if (file.size > 3 * 1024 * 1024) {
      return Promise.resolve({ ok: false, error: { message: "Image is larger than 3 MB." } });
    }

    var form = new FormData();
    form.append("file", file);
    form.append("upload_preset", cc.uploadPreset);

    $("uploadStatus").textContent = "Uploading…";

    return fetch("https://api.cloudinary.com/v1_1/" + encodeURIComponent(cc.cloudName) + "/image/upload", {
      method: "POST",
      body: form
    })
      .then(function (r) { return r.json().catch(function () { return null; }); })
      .then(function (data) {
        if (data && data.secure_url) return { ok: true, url: data.secure_url };
        return { ok: false, error: { message: "Upload failed. Check your Cloudinary settings." } };
      })
      .catch(function () {
        return { ok: false, error: { message: "Upload failed. Check your connection." } };
      });
  }

  function openOrderModal(o) {
    $("orderModalTitle").textContent = "Order " + o.order_id;
    var body = $("orderModalBody");
    body.replaceChildren();

    var info = el("div");
    info.appendChild(el("p", "", "Customer: " + o.customer_name));
    info.appendChild(el("p", "", "Phone: " + o.phone));
    if (o.email) info.appendChild(el("p", "", "Email: " + o.email));
    info.appendChild(el("p", "", "Address: " + o.wilaya_or_region + " — " + o.address));
    info.appendChild(el("p", "", "Payment: " + (o.payment_method === "arranged_transfer" ? "Arranged transfer" : "Cash on delivery")));
    info.appendChild(el("p", "", "Placed: " + formatDate(o.created_at)));
    body.appendChild(info);

    var items = o.items;
    if (!items && typeof o.items_json === "string") {
      try { items = JSON.parse(o.items_json); } catch (err) { items = []; }
    }
    var ul = el("ul", "order-items");
    (items || []).forEach(function (it) {
      var li = el("li");
      var left = el("span");
      left.appendChild(document.createTextNode(it.name || it.id));
      var variant = [it.size, it.color].filter(Boolean).join(" · ");
      left.appendChild(el("span", "sub", (variant ? variant + " · " : "") + "× " + it.qty));
      li.appendChild(left);
      li.appendChild(el("span", "", fmtMoney(Number(it.price) * Number(it.qty))));
      ul.appendChild(li);
    });
    body.appendChild(ul);

    var totalRow = el("p", "", "Total: " + fmtMoney(o.total_amount));
    totalRow.style.fontWeight = "700";
    body.appendChild(totalRow);

    $("orderModalBack").classList.add("on");
  }

  function bind() {
    $("loginForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("loginEmail").value.trim();
      var password = $("loginPassword").value;
      var alert = $("loginAlert");
      if (!email || !password) {
        alert.textContent = "Enter your email and password.";
        alert.hidden = false;
        return;
      }
      var btn = $("loginBtn");
      btn.disabled = true;
      btn.textContent = "Signing in…";

      window.ShopAPI.login(email, password).then(function (res) {
        btn.disabled = false;
        btn.textContent = "Sign in";
        if (res.ok) {
          token = res.data.token;
          storeToken(token);
          alert.hidden = true;
          $("loginPassword").value = "";
          showShell();
        } else {
          alert.textContent = (res.error && res.error.message) || "Sign-in failed.";
          alert.hidden = false;
        }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll(".side-link[data-view]"), function (b) {
      b.addEventListener("click", function () { switchView(b.getAttribute("data-view")); });
    });

    $("logoutBtn").addEventListener("click", function () {
      clearToken();
      showLogin("Signed out.");
    });

    $("refreshBtn").addEventListener("click", function () {
      loadAll().then(function () { toast("Refreshed.", "ok"); });
    });

    $("addProductBtn").addEventListener("click", function () { openProductModal(null); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-add]"), function (b) {
      b.addEventListener("click", function () { openProductModal(null); });
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-close-modal]"), function (b) {
      b.addEventListener("click", closeProductModal);
    });
    $("productModalBack").addEventListener("click", function (e) {
      if (e.target === $("productModalBack")) closeProductModal();
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-close-order-modal]"), function (b) {
      b.addEventListener("click", function () { $("orderModalBack").classList.remove("on"); });
    });
    $("orderModalBack").addEventListener("click", function (e) {
      if (e.target === $("orderModalBack")) $("orderModalBack").classList.remove("on");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeProductModal();
        $("orderModalBack").classList.remove("on");
      }
    });

    $("productForm").addEventListener("submit", saveProduct);

    $("prodImageFile").addEventListener("change", function () {
      var file = $("prodImageFile").files && $("prodImageFile").files[0];
      if (!file) return;
      uploadToCloudinary(file).then(function (res) {
        if (res.ok) {
          $("prodImageUrl").value = res.url;
          $("prodImagePreview").src = res.url;
          $("uploadStatus").textContent = "Uploaded ✓";
          setErr("prodImageUrl", "");
        } else {
          $("uploadStatus").textContent = "";
          setErr("prodImageUrl", res.error.message);
        }
      });
    });

    $("prodImageUrl").addEventListener("change", function () {
      var u = $("prodImageUrl").value.trim();
      if (u) $("prodImagePreview").src = u;
    });

    var search = $("prodSearch");
    var timer;
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.prodQuery = search.value.trim().toLowerCase();
        renderProducts();
      }, 150);
    });

    $("prodStatusFilter").addEventListener("change", function () {
      state.prodStatus = $("prodStatusFilter").value;
      renderProducts();
    });
  }

  var ShopToastAdmin = {
    push: function (msg, type) {
      var stack = $("toastStack");
      if (!stack || !msg) return;
      var t = el("div", "toast" + (type === "error" ? " error" : type === "ok" ? " ok" : ""));
      t.appendChild(el("span", "", msg));
      var close = el("button", "", "×");
      close.type = "button";
      close.addEventListener("click", function () { t.remove(); });
      t.appendChild(close);
      stack.appendChild(t);
      setTimeout(function () { t.remove(); }, 4200);
    }
  };

  window.ShopToastAdmin = ShopToastAdmin;

  bind();
  Array.prototype.forEach.call(document.querySelectorAll("[data-store-name]"), function (n) {
    n.textContent = CFG.STORE_NAME || "Store";
  });
  document.title = "Admin — " + (CFG.STORE_NAME || "Store");

  if (!window.ShopAPI.configured()) {
    var a = $("loginAlert");
    a.textContent = "Demo mode: API_URL is not configured yet. Complete the setup in README.md, then sign in.";
    a.hidden = false;
  }

  token = readToken();
  if (token) showShell();
  else showLogin();
})();
