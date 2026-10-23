(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var CACHE_KEY = "shop_products_v1";
  var state = {
    products: [],
    q: "",
    cat: "all",
    sort: "newest",
    demo: false,
    loaded: false
  };

  function $(id) { return document.getElementById(id); }

  function fmtMoney(n) {
    var c = CFG.CURRENCY || {};
    var num = Number(n);
    if (!isFinite(num)) num = 0;
    var str;
    try { str = num.toLocaleString(c.locale || "en-US"); }
    catch (err) { str = String(num); }
    return (str + " " + (c.symbol || "")).trim();
  }

  var COLOR_HEX = {
    black: "#111113", white: "#ffffff", grey: "#9a9a9a", gray: "#9a9a9a",
    blue: "#4a6076", navy: "#24344d", brown: "#8a5f38", beige: "#d9cfbc",
    cream: "#efe7d8", red: "#a3372f", green: "#4c6b4f", pink: "#d8a7ad"
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function isRecent(p) {
    var days = CFG.NEW_ARRIVAL_DAYS || 21;
    var t = Date.parse(p.created_at);
    if (!isFinite(t)) return false;
    return (Date.now() - t) / 86400000 <= days;
  }

  function isDemoPrice(p) {
    return p.old_price !== null && p.old_price !== undefined && Number(p.old_price) > Number(p.price);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.products)) return parsed;
    } catch (err) { /* ignore bad cache */ }
    return null;
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), products: state.products, demo: state.demo }));
    } catch (err) { /* quota: ignore */ }
  }

  function loadProducts(opts) {
    var options = opts || {};
    var grid = $("productGrid");
    if (grid && !state.loaded && !readCache()) {
      grid.setAttribute("aria-busy", "true");
      renderSkeletons(grid);
    }

    return window.ShopAPI.products().then(function (res) {
      if (res.ok) {
        state.products = res.data.products || [];
        state.demo = !!res.data.demo;
        state.loaded = true;
        writeCache();
        hide("errorState");
        renderAll();
      } else if (!state.loaded) {
        state.loaded = true;
        var cached = readCache();
        if (cached && cached.products.length) {
          state.products = cached.products;
          state.demo = !!cached.demo;
          renderAll();
        } else {
          showError(res.error && res.error.message);
        }
      } else if (options.showError && state.products.length === 0) {
        showError(res.error && res.error.message);
      }
      return res;
    });
  }

  function showError(msg) {
    var grid = $("productGrid");
    if (grid) grid.setAttribute("aria-busy", "false");
    if (grid) grid.hidden = true;
    hide("emptyState");
    var box = $("errorState");
    if (box) {
      var m = $("errorStateMsg");
      if (m) m.textContent = msg || "Something went wrong. Please try again.";
      box.hidden = false;
    }
  }

  function hide(id) { var n = $(id); if (n) n.hidden = true; }
  function show(id) { var n = $(id); if (n) n.hidden = false; }

  function renderSkeletons(grid) {
    grid.replaceChildren();
    for (var i = 0; i < 8; i++) {
      var card = el("article", "card skeleton");
      card.appendChild(el("div", "card-media"));
      card.appendChild(el("div", "skeleton-line w60"));
      card.appendChild(el("div", "skeleton-line w40"));
      grid.appendChild(card);
    }
  }

  function matchesFilters(p) {
    if (state.cat === "new" && !isRecent(p)) return false;
    if (state.cat !== "all" && state.cat !== "new" && p.category !== state.cat) return false;
    if (state.q) {
      var hay = (p.name + " " + p.category + " " + (p.description || "")).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function sorted(list) {
    var out = list.slice();
    if (state.sort === "price-asc") out.sort(function (a, b) { return a.price - b.price; });
    else if (state.sort === "price-desc") out.sort(function (a, b) { return b.price - a.price; });
    else if (state.sort === "name") out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else out.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    return out;
  }

  function swatchEl(name, extraClass) {
    var s = el("span", "swatch" + (extraClass ? " " + extraClass : ""));
    var hex = COLOR_HEX[String(name).toLowerCase()];
    s.style.background = hex || "#cfcac1";
    s.title = name;
    return s;
  }

  function buildCard(p) {
    var card = el("article", "card");
    var out = Number(p.stock) <= 0;

    var media = el("div", "card-media");
    var badges = el("div", "card-badges");
    if (isDemoPrice(p)) {
      var pct = Math.round((1 - Number(p.price) / Number(p.old_price)) * 100);
      badges.appendChild(el("span", "badge badge-sale", "-" + pct + "%"));
    }
    if (isRecent(p) && !out) badges.appendChild(el("span", "badge badge-new", "New"));
    if (out) badges.appendChild(el("span", "badge badge-out", "Sold out"));
    media.appendChild(badges);

    var img = el("img");
    img.src = p.image_url || "assets/img/tee.svg";
    img.alt = p.name;
    img.width = 600;
    img.height = 750;
    img.loading = "lazy";
    img.decoding = "async";
    media.appendChild(img);
    card.appendChild(media);

    var body = el("div", "card-body");
    body.appendChild(el("span", "card-category", p.category));

    var h = el("h3", "card-title");
    var link = el("a", "", p.name);
    link.href = "product.html?id=" + encodeURIComponent(p.id);
    h.appendChild(link);
    body.appendChild(h);

    var price = el("div", "card-price");
    price.appendChild(el("span", "", fmtMoney(p.price)));
    if (isDemoPrice(p)) price.appendChild(el("span", "old", fmtMoney(p.old_price)));
    body.appendChild(price);

    var sw = el("div", "swatches");
    var colors = p.colors || [];
    colors.slice(0, 4).forEach(function (c) { sw.appendChild(swatchEl(c)); });
    if (colors.length > 4) sw.appendChild(el("span", "swatch-more", "+" + (colors.length - 4)));
    body.appendChild(sw);

    var actions = el("div", "card-actions");
    var hasVariants = (p.sizes || []).length > 0 || colors.length > 0;
    if (out) {
      var dead = el("button", "btn btn-quiet", "Sold out");
      dead.type = "button";
      dead.disabled = true;
      actions.appendChild(dead);
    } else if (hasVariants) {
      var view = el("a", "btn btn-ghost", "View product");
      view.href = "product.html?id=" + encodeURIComponent(p.id);
      actions.appendChild(view);
    } else {
      var add = el("button", "btn", "Add to cart");
      add.type = "button";
      add.addEventListener("click", function () {
        if (window.ShopCart) window.ShopCart.add(p, "", "", 1);
      });
      actions.appendChild(add);
    }
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderGrid() {
    var grid = $("productGrid");
    if (!grid) return;
    var list = sorted(state.products.filter(matchesFilters));
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "false");

    var count = $("resultCount");
    if (count) {
      count.textContent = state.loaded
        ? list.length + (list.length === 1 ? " product" : " products")
        : "";
    }

    if (!state.loaded) return;

    if (state.products.length === 0) {
      grid.hidden = true;
      hide("emptyState");
      if (window.ShopAPI.configured()) {
        show("errorState");
        var m = $("errorStateMsg");
        if (m) m.textContent = "No products in the store yet. Add one from the admin dashboard.";
        hide("emptyState");
      } else {
        hide("errorState");
      }
      return;
    }

    hide("errorState");
    if (list.length === 0) {
      grid.hidden = true;
      show("emptyState");
      return;
    }
    hide("emptyState");
    grid.hidden = false;
    list.forEach(function (p) { grid.appendChild(buildCard(p)); });
  }

  function renderChips() {
    var box = $("chips");
    if (!box) return;
    box.replaceChildren();
    var defs = [{ key: "all", label: "All" }];
    (CFG.CATEGORIES || []).forEach(function (c) { defs.push({ key: c, label: c }); });
    defs.push({ key: "new", label: "New arrivals" });

    defs.forEach(function (d) {
      var b = el("button", "chip", d.label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.cat === d.key));
      b.addEventListener("click", function () {
        state.cat = d.key;
        syncUrl();
        renderChips();
        renderGrid();
      });
      box.appendChild(b);
    });
  }

  function renderCategories() {
    var box = $("categoryGrid");
    if (!box) return;
    box.replaceChildren();
    var defs = (CFG.CATEGORIES || []).map(function (c) { return { key: c, label: c }; });
    defs.push({ key: "new", label: "New arrivals" });

    defs.forEach(function (d) {
      var tile = el("a", "category-tile");
      tile.href = "#shop";
      var n = state.products.filter(function (p) {
        return d.key === "new" ? isRecent(p) : p.category === d.key;
      }).length;
      tile.appendChild(el("strong", "", d.label));
      tile.appendChild(el("span", "", n + (n === 1 ? " product" : " products")));
      tile.addEventListener("click", function () {
        state.cat = d.key;
        syncUrl();
        renderChips();
        renderGrid();
      });
      box.appendChild(tile);
    });
  }

  function renderAll() {
    renderChips();
    renderCategories();
    renderGrid();
  }

  function syncUrl() {
    if (location.protocol === "file:") return;
    try {
      var params = new URLSearchParams();
      if (state.q) params.set("q", state.q);
      if (state.cat !== "all") params.set("cat", state.cat);
      if (state.sort !== "newest") params.set("sort", state.sort);
      var qs = params.toString();
      history.replaceState(null, "", qs ? "?" + qs : location.pathname);
    } catch (err) { /* history unavailable */ }
  }

  function readUrl() {
    var params = new URLSearchParams(location.search);
    state.q = params.get("q") || "";
    state.cat = params.get("cat") || "all";
    state.sort = params.get("sort") || "newest";
    var search = $("searchInput");
    if (search) search.value = state.q;
    var sortSel = $("sortSelect");
    if (sortSel) sortSel.value = state.sort;
  }

  function initHome() {
    if (!$("productGrid")) return;
    readUrl();

    var cached = readCache();
    if (cached && cached.products.length) {
      state.products = cached.products;
      state.demo = !!cached.demo;
      state.loaded = true;
      renderAll();
    }
    loadProducts();

    var search = $("searchInput");
    if (search) {
      search.addEventListener("input", debounce(function () {
        state.q = search.value.trim().toLowerCase();
        syncUrl();
        renderGrid();
      }, 160));
    }

    var sortSel = $("sortSelect");
    if (sortSel) {
      sortSel.addEventListener("change", function () {
        state.sort = sortSel.value;
        syncUrl();
        renderGrid();
      });
    }

    var clear = $("clearFiltersBtn");
    if (clear) {
      clear.addEventListener("click", function () {
        state.q = "";
        state.cat = "all";
        state.sort = "newest";
        if (search) search.value = "";
        if (sortSel) sortSel.value = "newest";
        syncUrl();
        renderChips();
        renderGrid();
      });
    }

    var retry = $("retryBtn");
    if (retry) {
      retry.addEventListener("click", function () {
        hide("errorState");
        state.loaded = false;
        loadProducts({ showError: true });
      });
    }

    setInterval(function () {
      if (document.visibilityState === "visible" && window.ShopAPI.configured()) loadProducts();
    }, CFG.REFRESH_MS || 60000);
  }

  function renderHero() {
    var hero = CFG.HERO || {};
    Object.keys(hero).forEach(function (k) {
      var node = document.querySelector('[data-hero="' + k + '"]');
      if (node) node.textContent = hero[k];
    });
    var sec = document.querySelector("[data-hero-cta-secondary]");
    if (sec && hero.ctaSecondary) sec.textContent = hero.ctaSecondary;
  }

  function initProductPage() {
    var nameEl = $("pdpName");
    if (!nameEl) return;
    var id = new URLSearchParams(location.search).get("id");
    var selected = { size: null, color: null, qty: 1, product: null };

    function render(p) {
      selected.product = p;
      document.title = p.name + " — " + (CFG.STORE_NAME || "Store");
      var crumb = $("crumbName");
      if (crumb) crumb.textContent = p.name;
      var cat = $("pdpCategory");
      if (cat) cat.textContent = p.category;
      nameEl.textContent = p.name;
      var priceBox = $("pdpPrice");
      priceBox.replaceChildren();
      priceBox.appendChild(el("span", "", fmtMoney(p.price)));
      if (isDemoPrice(p)) priceBox.appendChild(el("span", "old", fmtMoney(p.old_price)));
      var desc = $("pdpDesc");
      if (desc) desc.textContent = p.description || "";

      var images = [p.image_url].concat(p.additional_images || []).filter(function (u) { return !!u; });
      var main = $("pdpImage");
      main.src = images[0];
      main.alt = p.name;
      var thumbs = $("pdpThumbs");
      thumbs.replaceChildren();
      images.forEach(function (src, i) {
        var b = el("button", "pdp-thumb");
        b.type = "button";
        b.setAttribute("aria-pressed", String(i === 0));
        b.setAttribute("aria-label", "View image " + (i + 1));
        var im = el("img");
        im.src = src;
        im.alt = "";
        im.loading = "lazy";
        b.appendChild(im);
        b.addEventListener("click", function () {
          main.src = src;
          Array.prototype.forEach.call(thumbs.children, function (c, j) {
            c.setAttribute("aria-pressed", String(j === i));
          });
        });
        thumbs.appendChild(b);
      });

      var sizes = p.sizes || [];
      var sizeGroup = $("sizeGroup");
      var sizePills = $("sizePills");
      sizePills.replaceChildren();
      if (sizes.length) {
        sizeGroup.hidden = false;
        selected.size = null;
        sizes.forEach(function (s) {
          var b = el("button", "pill", s);
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.addEventListener("click", function () {
            selected.size = s;
            Array.prototype.forEach.call(sizePills.children, function (c) {
              c.setAttribute("aria-pressed", String(c === b));
            });
            $("sizeValue").textContent = "· " + s;
          });
          sizePills.appendChild(b);
        });
      } else {
        sizeGroup.hidden = true;
        selected.size = "";
      }

      var colors = p.colors || [];
      var colorGroup = $("colorGroup");
      var colorPills = $("colorPills");
      colorPills.replaceChildren();
      if (colors.length) {
        colorGroup.hidden = false;
        selected.color = null;
        colors.forEach(function (c) {
          var b = el("button", "pill pill-color");
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.appendChild(swatchEl(c));
          b.appendChild(el("span", "", c));
          b.addEventListener("click", function () {
            selected.color = c;
            Array.prototype.forEach.call(colorPills.children, function (x) {
              x.setAttribute("aria-pressed", String(x === b));
            });
            $("colorValue").textContent = "· " + c;
          });
          colorPills.appendChild(b);
        });
      } else {
        colorGroup.hidden = true;
        selected.color = "";
      }

      selected.qty = 1;
      $("qtyValue").textContent = "1";
      var stock = Number(p.stock) || 0;
      var stockLine = $("stockLine");
      if (stock <= 0) {
        stockLine.textContent = "Out of stock";
        stockLine.className = "stock-line out";
      } else if (stock <= 5) {
        stockLine.textContent = "Only " + stock + " left in stock";
        stockLine.className = "stock-line";
      } else {
        stockLine.textContent = "In stock · " + stock + " available";
        stockLine.className = "stock-line";
      }
      var addBtn = $("addToCartBtn");
      addBtn.disabled = stock <= 0;
      addBtn.textContent = stock <= 0 ? "Sold out" : "Add to cart";

      $("metaSku").textContent = "SKU: " + p.id;
      $("metaCategory").textContent = "Category: " + p.category;

      renderRelated(p);
    }

    function renderRelated(p) {
      var box = $("relatedGrid");
      if (!box) return;
      box.replaceChildren();
      state.products
        .filter(function (x) { return x.category === p.category && x.id !== p.id && Number(x.stock) > 0; })
        .slice(0, 4)
        .forEach(function (x) { box.appendChild(buildCard(x)); });
      var sec = box.closest(".section");
      if (sec) sec.hidden = box.children.length === 0;
    }

    $("qtyMinus").addEventListener("click", function () {
      selected.qty = Math.max(1, selected.qty - 1);
      $("qtyValue").textContent = String(selected.qty);
    });
    $("qtyPlus").addEventListener("click", function () {
      var max = selected.product ? Number(selected.product.stock) || 1 : 1;
      selected.qty = Math.min(max, selected.qty + 1);
      $("qtyValue").textContent = String(selected.qty);
    });

    $("addToCartBtn").addEventListener("click", function () {
      var p = selected.product;
      if (!p) return;
      if ((p.sizes || []).length && !selected.size) {
        if (window.ShopToast) window.ShopToast.push("Please choose a size.", "error");
        $("sizePills").querySelector("button") && $("sizePills").querySelector("button").focus();
        return;
      }
      if ((p.colors || []).length && !selected.color) {
        if (window.ShopToast) window.ShopToast.push("Please choose a color.", "error");
        return;
      }
      if (window.ShopCart) window.ShopCart.add(p, selected.size || "", selected.color || "", selected.qty);
    });

    function loadRelatedList() {
      window.ShopAPI.products().then(function (res) {
        if (res.ok) {
          state.products = res.data.products || [];
          state.loaded = true;
        }
      });
    }

    if (!id) {
      nameEl.textContent = "Product not found";
      return;
    }

    var cached = readCache();
    if (cached) {
      state.products = cached.products;
      state.demo = !!cached.demo;
      var hit = state.products.filter(function (x) { return x.id === id; })[0];
      if (hit) render(hit);
    }

    window.ShopAPI.product(id).then(function (res) {
      if (res.ok) {
        render(res.data.product);
        if (!state.loaded) loadRelatedList();
      } else if (!state.loaded) {
        nameEl.textContent = "Product not found";
        var crumb = $("crumbName");
        if (crumb) crumb.textContent = "Not found";
        if (window.ShopToast) window.ShopToast.push(res.error && res.error.message, "error");
      }
    });
  }

  renderHero();
  initHome();
  initProductPage();

  window.ShopStore = { reload: function () { loadProducts(); } };
})();
