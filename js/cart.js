(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var CART_KEY = "shop_cart_v1";
  var TOKEN_KEY = "shop_checkout_token";
  var items = [];
  var pageLoadedAt = Date.now();

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

  var ShopToast = {
    push: function (msg, type) {
      var stack = $("toastStack");
      if (!stack || !msg) return;
      var t = el("div", "toast" + (type === "error" ? " error" : type === "ok" ? " ok" : ""));
      t.appendChild(el("span", "", msg));
      var close = el("button", "", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Dismiss");
      close.addEventListener("click", function () { t.remove(); });
      t.appendChild(close);
      stack.appendChild(t);
      setTimeout(function () { t.remove(); }, 4200);
    }
  };

  function read() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.filter(function (i) { return i && i.id; }) : [];
    } catch (err) { items = []; }
  }

  function save() {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); }
    catch (err) { /* quota: ignore */ }
  }

  function lineKey(i) { return i.id + "§" + (i.size || "") + "§" + (i.color || ""); }

  function count() {
    return items.reduce(function (n, i) { return n + i.qty; }, 0);
  }

  function total() {
    return items.reduce(function (n, i) { return n + i.qty * Number(i.price); }, 0);
  }

  function updateBadge() {
    var n = count();
    Array.prototype.forEach.call(document.querySelectorAll("[data-cart-count]"), function (b) {
      b.textContent = String(n);
      b.setAttribute("data-empty", String(n === 0));
    });
  }

  function renderDrawer() {
    var box = $("cartLines");
    if (!box) return;
    box.replaceChildren();

    if (items.length === 0) {
      box.appendChild(el("p", "cart-empty", "Your cart is empty."));
    } else {
      items.forEach(function (i) {
        var line = el("div", "cart-line");
        var img = el("img");
        img.src = i.image || "";
        img.alt = "";
        img.width = 64;
        img.height = 80;
        img.loading = "lazy";
        line.appendChild(img);

        var mid = el("div");
        mid.appendChild(el("p", "name", i.name));
        var variant = [i.size, i.color].filter(Boolean).join(" · ");
        mid.appendChild(el("p", "variant", variant || "One size"));

        var qty = el("div", "qty");
        var minus = el("button", "", "−");
        minus.type = "button";
        minus.setAttribute("aria-label", "Decrease quantity of " + i.name);
        var out = el("output", "", String(i.qty));
        var plus = el("button", "", "+");
        plus.type = "button";
        plus.setAttribute("aria-label", "Increase quantity of " + i.name);
        var key = lineKey(i);
        minus.addEventListener("click", function () { setQty(key, i.qty - 1); });
        plus.addEventListener("click", function () { setQty(key, i.qty + 1); });
        qty.appendChild(minus);
        qty.appendChild(out);
        qty.appendChild(plus);
        mid.appendChild(qty);

        var right = el("div");
        right.appendChild(el("p", "price", fmtMoney(i.qty * i.price)));
        var rm = el("button", "text-btn", "Remove");
        rm.type = "button";
        rm.addEventListener("click", function () { removeLine(key); });
        right.appendChild(rm);
        line.appendChild(mid);
        line.appendChild(right);

        box.appendChild(line);
      });
    }

    var totalEl = $("cartTotal");
    if (totalEl) totalEl.textContent = fmtMoney(total());
    updateBadge();
  }

  function setQty(key, qty) {
    var line = items.filter(function (i) { return lineKey(i) === key; })[0];
    if (!line) return;
    var max = Math.max(1, Number(line.stock) || 1);
    if (qty < 1) { removeLine(key); return; }
    if (qty > max) {
      ShopToast.push("Only " + max + " in stock.", "error");
      qty = max;
    }
    line.qty = qty;
    save();
    renderDrawer();
    if (window.ShopCheckout) window.ShopCheckout.refreshSummary();
  }

  function removeLine(key) {
    items = items.filter(function (i) { return lineKey(i) !== key; });
    save();
    renderDrawer();
    ShopToast.push("Removed from cart.");
    if (window.ShopCheckout) window.ShopCheckout.refreshSummary();
  }

  var ShopCart = {
    add: function (product, size, color, qty) {
      var stock = Number(product.stock) || 0;
      if (stock <= 0) {
        ShopToast.push("This product is out of stock.", "error");
        return;
      }
      var wanted = { id: product.id, size: size || "", color: color || "" };
      var existing = items.filter(function (i) { return lineKey(i) === lineKey(wanted); })[0];
      var addQty = Math.max(1, qty || 1);

      if (existing) {
        var next = existing.qty + addQty;
        if (next > stock) {
          ShopToast.push("Only " + stock + " in stock.", "error");
          next = stock;
        }
        existing.qty = next;
      } else {
        if (addQty > stock) {
          ShopToast.push("Only " + stock + " in stock.", "error");
          addQty = stock;
        }
        items.push({
          id: product.id,
          name: product.name,
          price: Number(product.price),
          image: product.image_url || "",
          size: size || "",
          color: color || "",
          qty: addQty,
          stock: stock
        });
      }
      save();
      renderDrawer();
      ShopToast.push("Added to cart ✓", "ok");
      openDrawer();
    },
    items: function () { return items.slice(); },
    total: total,
    count: count,
    clear: function () {
      items = [];
      save();
      renderDrawer();
    }
  };

  function openDrawer() {
    var d = $("cartDrawer"), o = $("overlay");
    if (!d) return;
    d.classList.add("open");
    d.setAttribute("aria-hidden", "false");
    if (o) { o.hidden = false; requestAnimationFrame(function () { o.classList.add("open"); }); }
    var close = $("cartCloseBtn");
    if (close) close.focus();
  }

  function closeDrawer() {
    var d = $("cartDrawer"), o = $("overlay");
    if (!d) return;
    d.classList.remove("open");
    d.setAttribute("aria-hidden", "true");
    if (o) {
      o.classList.remove("open");
      setTimeout(function () { o.hidden = true; }, 250);
    }
  }

  function makeLink(li, href, text) {
    var a = el("a", "", text);
    a.href = href;
    li.appendChild(a);
  }

  function initChrome() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-store-name]"), function (n) {
      n.textContent = CFG.STORE_NAME || "Store";
    });

    var demoBar = $("demoBar");
    if (demoBar) demoBar.hidden = window.ShopAPI.configured();

    var phone = (CFG.CONTACT || {}).phone || "";
    var email = (CFG.CONTACT || {}).email || "";
    var address = (CFG.CONTACT || {}).address || "";

    var cPhone = $("contactPhone");
    if (cPhone) cPhone.textContent = phone;
    var cEmail = $("contactEmail");
    if (cEmail) cEmail.textContent = email;
    var cAddr = $("contactAddress");
    if (cAddr) cAddr.textContent = address;

    var cSocial = $("contactSocial");
    if (cSocial) {
      cSocial.replaceChildren();
      var soc = CFG.CONTACT || {};
      if (soc.instagram) {
        var s1 = el("span");
        var a1 = el("a", "", "Instagram");
        a1.href = soc.instagram;
        a1.target = "_blank";
        a1.rel = "noopener noreferrer";
        s1.appendChild(a1);
        cSocial.appendChild(s1);
      }
      if (soc.facebook) {
        var s2 = el("span");
        var a2 = el("a", "", "Facebook");
        a2.href = soc.facebook;
        a2.target = "_blank";
        a2.rel = "noopener noreferrer";
        s2.appendChild(a2);
        cSocial.appendChild(s2);
      }
      if (!soc.instagram && !soc.facebook) cSocial.textContent = "—";
    }

    var fPhone = $("footerPhone");
    if (fPhone && phone) makeLink(fPhone, "tel:" + phone.replace(/[^0-9+]/g, ""), phone);
    var fEmail = $("footerEmail");
    if (fEmail && email) makeLink(fEmail, "mailto:" + email, email);
    var fAddr = $("footerAddress");
    if (fAddr) fAddr.textContent = address;

    var fSocial = $("footerSocial");
    if (fSocial) {
      fSocial.replaceChildren();
      var soc = CFG.CONTACT || {};
      if (soc.instagram) { var li1 = el("li"); makeLink(li1, soc.instagram, "Instagram"); li1.firstChild.target = "_blank"; li1.firstChild.rel = "noopener noreferrer"; fSocial.appendChild(li1); }
      if (soc.facebook) { var li2 = el("li"); makeLink(li2, soc.facebook, "Facebook"); li2.firstChild.target = "_blank"; li2.firstChild.rel = "noopener noreferrer"; fSocial.appendChild(li2); }
      if (!soc.instagram && !soc.facebook) fSocial.appendChild(el("li", "", "—"));
    }

    var copy = $("footerCopy");
    if (copy) copy.textContent = "© " + new Date().getFullYear() + " " + (CFG.STORE_NAME || "Store") + ". All rights reserved.";

    var menuBtn = $("menuBtn");
    var mobileNav = $("mobileNav");
    if (menuBtn && mobileNav) {
      menuBtn.addEventListener("click", function () {
        var open = mobileNav.classList.toggle("open");
        menuBtn.setAttribute("aria-expanded", String(open));
      });
    }

    var openBtn = $("cartOpenBtn");
    if (openBtn) openBtn.addEventListener("click", openDrawer);
    var closeBtn = $("cartCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
    var overlay = $("overlay");
    if (overlay) overlay.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDrawer();
    });
  }

  function randomToken() {
    if (window.crypto && crypto.randomUUID) return "ck_" + crypto.randomUUID();
    return "ck_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  var ShopCheckout = {
    init: function () {
      var form = $("checkoutForm");
      if (!form) return;

      renderSummary();

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submit(form);
      });
    },

    refreshSummary: function () {
      if (!$("checkoutForm")) return;
      renderSummary();
      var alertBox = $("checkoutAlert");
      if (items.length === 0 && alertBox) showAlert("Your cart is empty. Add some products first.", "error");
    }
  };

  function showAlert(msg, kind) {
    var box = $("checkoutAlert");
    if (!box) return;
    if (!msg) { box.hidden = true; box.textContent = ""; return; }
    box.textContent = msg;
    box.className = "alert " + (kind === "ok" ? "alert-ok" : "alert-error");
    box.hidden = false;
  }

  function renderSummary() {
    var list = $("checkoutLines");
    if (!list) return;
    list.replaceChildren();

    if (items.length === 0) {
      var li = el("li");
      li.appendChild(el("span", "", "Your cart is empty."));
      list.appendChild(li);
    } else {
      items.forEach(function (i) {
        var li = el("li");
        var left = el("span");
        left.appendChild(document.createTextNode(i.name));
        var variant = [i.size, i.color].filter(Boolean).join(" · ");
        left.appendChild(el("span", "sub", (variant ? variant + " · " : "") + "× " + i.qty));
        li.appendChild(left);
        li.appendChild(el("span", "", fmtMoney(i.qty * i.price)));
        list.appendChild(li);
      });
    }

    var sub = $("sumSubtotal");
    if (sub) sub.textContent = fmtMoney(total());
    var tot = $("sumTotal");
    if (tot) tot.textContent = fmtMoney(total());
  }

  function setFieldError(id, msg) {
    var input = $(id);
    if (!input) return;
    var field = input.closest(".field");
    var err = document.querySelector('[data-err-for="' + id + '"]');
    if (field) field.classList.toggle("invalid", !!msg);
    if (err) err.textContent = msg || "";
  }

  function validate(form) {
    var errors = 0;
    var name = $("custName").value.trim();
    var phone = $("custPhone").value.trim();
    var email = $("custEmail").value.trim();
    var wilaya = $("custWilaya").value.trim();
    var address = $("custAddress").value.trim();

    if (name.length < 3 || name.length > 80 || !/^[\p{L} \-'.]+$/u.test(name)) {
      setFieldError("custName", "Enter a valid full name (letters only, 3–80 characters).");
      errors++;
    } else setFieldError("custName", "");

    var digits = phone.replace(/[^0-9+]/g, "");
    if (!/^[0-9+]{8,15}$/.test(digits) || (digits.match(/\+/g) || []).length > 1) {
      setFieldError("custPhone", "Enter a valid phone number (8–15 digits).");
      errors++;
    } else setFieldError("custPhone", "");

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setFieldError("custEmail", "Enter a valid email or leave it empty.");
      errors++;
    } else setFieldError("custEmail", "");

    if (wilaya.length < 2 || wilaya.length > 60) {
      setFieldError("custWilaya", "Enter your wilaya or region.");
      errors++;
    } else setFieldError("custWilaya", "");

    if (address.length < 8 || address.length > 300) {
      setFieldError("custAddress", "Enter a complete delivery address (at least 8 characters).");
      errors++;
    } else setFieldError("custAddress", "");

    return errors === 0
      ? { name: name, phone: phone, email: email, wilaya: wilaya, address: address }
      : null;
  }

  function submit(form) {
    showAlert("");

    if ($("companyField").value !== "") {
      showAlert("Could not place the order. Please try again.");
      return;
    }
    if (Date.now() - pageLoadedAt < 2500) {
      showAlert("Please wait a moment and try again.");
      return;
    }
    if (items.length === 0) {
      showAlert("Your cart is empty. Add some products first.");
      return;
    }

    var customer = validate(form);
    if (!customer) {
      showAlert("Please fix the highlighted fields.");
      var firstBad = form.querySelector(".field.invalid input, .field.invalid textarea");
      if (firstBad) firstBad.focus();
      return;
    }

    var payment = form.querySelector('input[name="payment"]:checked');
    var btn = $("placeOrderBtn");
    btn.disabled = true;
    btn.textContent = "Placing order…";

    var token;
    try {
      token = sessionStorage.getItem(TOKEN_KEY);
      if (!token) {
        token = randomToken();
        sessionStorage.setItem(TOKEN_KEY, token);
      }
    } catch (err) { token = randomToken(); }

    var payload = {
      order: {
        customer_name: customer.name,
        phone: customer.phone,
        email: customer.email,
        wilaya_or_region: customer.wilaya,
        address: customer.address,
        payment_method: payment ? payment.value : "cash_on_delivery",
        items: items.map(function (i) {
          return { id: i.id, size: i.size || "", color: i.color || "", qty: i.qty };
        })
      },
      clientToken: token
    };

    window.ShopAPI.placeOrder(payload).then(function (res) {
      btn.disabled = false;
      btn.textContent = "Place order";

      if (res.ok) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* ignore */ }
        ShopCart.clear();
        $("checkoutForm").hidden = true;
        var panelH = document.querySelector("#checkoutPanel h1");
        if (panelH) panelH.hidden = true;
        var panelP = document.querySelector("#checkoutPanel p");
        if (panelP) panelP.hidden = true;
        $("successOrderId").textContent = res.data.order_id || "—";
        var tot = res.data.total_amount;
        $("successTotal").textContent = tot !== undefined && tot !== null ? "Total: " + fmtMoney(tot) + " (cash on delivery)" : "";
        $("successBox").hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      showAlert((res.error && res.error.message) || "Could not place the order. Please try again.");
    });
  }

  read();
  initChrome();
  renderDrawer();
  ShopCheckout.init();

  window.ShopCart = ShopCart;
  window.ShopToast = ShopToast;
  window.ShopCheckout = ShopCheckout;
})();
