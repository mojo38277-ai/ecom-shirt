# Atelier Noir — Online Clothing Store

A complete, beginner-friendly online clothing store. Customers browse products,
add them to a cart and place a cash-on-delivery order. You manage everything —
products, photos, stock and orders — from a private admin dashboard, **without
touching any code**.

There is no build step and no framework. It is plain HTML, CSS and JavaScript,
backed by **Google Sheets** (as the database) + **Google Apps Script** (as the
API) + **Cloudinary** (free image hosting). It can be hosted for free on Netlify
or GitHub Pages.

---

## What you get

| Page | Purpose |
| --- | --- |
| `index.html` | Storefront: hero, categories, search, filters, sort, product grid, cart drawer |
| `product.html?id=…` | Product detail page: photos, size/color pickers, quantity, related items |
| `checkout.html` | Order form (name, phone, wilaya, address), payment choice, order confirmation |
| `admin.html` | Private dashboard: sign-in, stats, product editor (with photo upload), order list |
| `apps-script/Code.gs` | The backend that talks to your Google Sheet |
| `tools/mock-server.js` | Optional local server to test everything before you deploy |

All data lives in your Google Sheet. When you add or edit a product in the
dashboard, it appears in the storefront automatically within about a minute
(or instantly on page reload).

---

## 1. Quick look (demo mode)

You can open the storefront right now with no setup. When no API is configured,
the site runs in **demo mode** and shows the sample products in
`js/config.js`.

- Just open `index.html` in your browser, or
- Serve the folder locally (recommended — some browsers restrict `file://`):

```bash
# from this folder (others/)
npx serve .
# or, if you have Python:
python -m http.server 8080
```

In demo mode the checkout is honest: it will tell you the order was **not**
sent, because there is no database yet. That is intentional.

---

## 2. Test the whole flow with the local mock server

The mock server behaves exactly like the real Apps Script backend, so you can
test ordering and the admin dashboard before setting up Google.

```bash
node tools/mock-server.js
```

Then open **http://127.0.0.1:8787** in your browser.

To make the site talk to it, temporarily edit `js/config.js`:

```js
API_URL: "http://127.0.0.1:8787/api",
```

Mock admin sign-in:

```
Email:    admin@store.test
Password: admin123
```

Data is kept in memory and resets every time you restart the server. When you
are done testing, set `API_URL` back to `""`.

---

## 3. What you need

- A free **Google account** (for Sheets + Apps Script)
- A free **Cloudinary account** (for product photos) — optional but recommended
- A free **Netlify** or **GitHub Pages** account (to put the site online)

---

## 4. Set up the backend (Google Sheet + Apps Script)

### 4.1 Create the Sheet and paste the code

1. Go to <https://sheets.new> to create a new blank spreadsheet. Name it
   something like **Store DB**.
2. In the spreadsheet, click **Extensions → Apps Script**.
3. Delete the placeholder code in the editor.
4. Open `apps-script/Code.gs` from this project, copy **all** of it, and paste it
   into the Apps Script editor.
5. Click the **Save** icon (💾).

### 4.2 Run the setup functions

At the top of the editor there is a function dropdown. Run these two, in order:

1. Select **`setup`** → click **Run**. Approve the permissions prompt (choose
   your account → *Advanced* → *Go to project (unsafe)* → *Allow*). This creates
   the **Products** and **Orders** tabs and 6 sample products.
2. Select **`setAdminPassword`** → click **Run**. A prompt asks for your admin
   email and a password (at least 8 characters). This is the login you will use
   on `admin.html`. **Choose a strong, unique password.**

> Tip: you can change the admin password any time by running
> `setAdminPassword()` again. To force everyone to sign in again, run
> `revokeAllSessions()`.

### 4.3 Deploy the web app

1. Click **Deploy → New deployment**.
2. Click the gear ⚙ near *Select type* → choose **Web app**.
3. Set:
   - **Description:** `Store API`
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**
4. Click **Deploy** and **copy the Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfy…long…/exec
   ```

That URL is your API. Keep it handy for the next step.

> Whenever you change `Code.gs`, you must create a **new deployment**
> (or use *Manage deployments → edit → Version: New version*) for the change
> to go live.

---

## 5. Set up image hosting (Cloudinary — free)

Product photos need a public `https://` URL. Cloudinary's free tier is perfect.

1. Create a free account at <https://cloudinary.com>.
2. On your **Dashboard**, note your **Cloud name** (e.g. `dxxxxx`).
3. Go to **Settings → Upload → Upload presets → Add upload preset**.
   - Set **Signing Mode** to **Unsigned**.
   - Save it and note the preset name.
4. Paste both values into `js/config.js`:

```js
CLOUDINARY: { cloudName: "YOUR_CLOUD_NAME", uploadPreset: "YOUR_UPLOAD_PRESET" },
```

Now the admin dashboard's **Photo upload** button will send images straight to
Cloudinary and fill in the image URL for you.

> No Cloudinary? You can skip it and paste any `https://` image URL into the
> product form instead.

---

## 6. Connect the store to the backend

Open `js/config.js` and set your API URL:

```js
API_URL: "https://script.google.com/macros/s/AKfy…long…/exec",
```

While you are there, make the store your own:

```js
STORE_NAME: "Your Store Name",
CURRENCY:   { symbol: "DA", locale: "fr-DZ" },   // e.g. "USD"/"en-US", "EUR"/"de-FR"
CATEGORIES: ["Men", "Women", "Shoes", "Accessories"],
NEW_ARRIVAL_DAYS: 21,      // products newer than this get a "New" badge
REFRESH_MS: 60000,         // how often the storefront re-checks for new products

CONTACT: {
  phone: "+213 555 00 00 00",
  email: "contact@yourstore.com",
  address: "Your City, Algeria",
  instagram: "https://instagram.com/yourstore",
  facebook:  "https://facebook.com/yourstore"
},

HERO: {
  eyebrow: "New season · 2026",
  title: "Everyday essentials, quietly refined.",
  subtitle: "Curated basics and statement pieces. Cash on delivery across Algeria.",
  cta: "Shop now",
  ctaSecondary: "New arrivals"
},
```

Save the file. Reload the storefront — the demo banner disappears and your real
products load.

---

## 7. Put the site online (free)

You only deploy the **frontend** files (HTML/CSS/JS/images). The backend is
already online as your Apps Script web app.

### Option A — Netlify (easiest, drag & drop)

1. Go to <https://app.netlify.com/drop>.
2. Drag the whole `others` folder onto the page.
3. Netlify gives you a public URL instantly. (Optional: rename the site in
   *Site settings*.)

### Option B — GitHub Pages

1. Create a repository and upload the contents of the `others` folder.
2. Go to **Settings → Pages**.
3. Under *Build and deployment*, choose **Deploy from a branch**, pick your
   `main` branch and `/ (root)`, then **Save**.
4. Your site is live at `https://yourname.github.io/repo/`.

> Your `admin.html` will be at `https://your-site/admin.html`. It is marked
> `noindex`, and it is safe to know the URL — the login is what protects it.

---

## 8. First sign-in and a test order

1. Open your live site, then go to `/admin.html`.
2. Sign in with the admin email and password from step 4.2.
3. Click **+ Add product**, fill in the fields and **Save**. It is now live
   in the storefront.
4. Open the storefront, add something to the cart, and go to checkout. Fill in
   the form and **Place order**.
5. Back in **admin → Orders**, your order appears. Open it to see the items and
   customer details.

---

## 9. Day-to-day: managing your shop

Everything is done from `admin.html`. No code needed.

**Add a product** — *Products → + Add product*. Required: name, category,
price, stock, and an image (upload or `https://` URL). Sizes/colors are comma
separated (`S, M, L`). Leave old price empty unless the item is on sale.

**Edit a product** — *Products → Edit*. Changes appear on the site within about
a minute.

**Change stock** — edit the number directly in the *Stock* column.

**Hide without deleting** — *Hide* (shows as `unavailable`), or *Archive* to
retire it. *Restore* brings it back.

**Process orders** — *Orders → change the status* (`pending → confirmed →
shipped → delivered`, or `cancelled`). Use the status chips to filter.

> Orders are **never** deleted automatically, and stock is decreased
> automatically each time an order is placed.

---

## 10. Spreadsheet layout

`setup()` creates two tabs. You normally never edit them by hand, but here is
what the columns mean.

**Products**

`id · name · category · price · old_price · description · image_url ·
additional_images · sizes · colors · stock · status · created_at · updated_at`

- `additional_images`, `sizes`, `colors` are JSON arrays, e.g. `["S","M"]`.
- `status` is `available`, `unavailable` or `archived`.
- The storefront only shows `available` products.

**Orders**

`order_id · created_at · customer_name · phone · email · wilaya_or_region ·
address · items_json · total_amount · payment_method · order_status ·
client_token`

- `items_json` stores the purchased lines (name, size, color, qty, price).
- `order_status` is `pending`, `confirmed`, `shipped`, `delivered` or
  `cancelled`.
- `total_amount` is always **recalculated on the server** — the browser cannot
  change prices.

---

## 11. API contract (for reference)

All responses are JSON: `{ "ok": true, "data": … }` or
`{ "ok": false, "error": { "code": "…", "message": "…" } }`.

**Public GET**

| Request | Returns |
| --- | --- |
| `?action=products` | `{ products: [...], server_time }` |
| `?action=product&id=ID` | `{ product: {...} }` |

**POST** — JSON body with `action` (sent as `text/plain` to avoid CORS
preflight, exactly like the frontend does):

| `action` | Key fields | Notes |
| --- | --- | --- |
| `place_order` | `order`, `client_token` | Public. Server validates & recomputes totals |
| `admin_login` | `email`, `password` | Returns `{ token, expires_at, email }` |
| `admin_list_products` | `token` | Includes hidden/archived |
| `admin_list_orders` | `token` | Newest first |
| `admin_save_product` | `token`, `product` | Create or update |
| `admin_set_status` | `token`, `id`, `status` | Show / hide / archive |
| `admin_update_stock` | `token`, `id`, `stock` | |
| `admin_update_order_status` | `token`, `order_id`, `status` | |

Error codes: `invalid_request`, `not_found`, `unauthorized`,
`invalid_credentials`, `rate_limited`, `stock`, `busy`, `server_error`.

---

## 12. How security works (and its limits)

This is a small store, so the security model is simple and honest.

**What is protected**

- **Admin password** is never stored in the browser or in the code. Only a
  salted SHA-256 hash lives in Apps Script's script properties. Sign-in issues a
  signed token that expires after 8 hours.
- **Prices and totals are recalculated on the server.** Editing prices in the
  browser does nothing — a tampered order is simply rejected or repriced.
- **Stock is checked and decremented on the server** under a lock, so a product
  cannot be oversold by two people ordering at once.
- **Login is rate-limited** (5 attempts per 10 minutes) to slow password guessing.
- **All text is inserted with `textContent`**, not `innerHTML`, so customer or
  product data cannot inject code (no XSS).
- **Image URLs must be `https://`**, so no insecure or `javascript:` URLs sneak
  into the store.
- **Nothing sensitive is stored in the browser** — only the cart, cached public
  products, and the short-lived admin session token (in `sessionStorage`).

**What it is not**

- This is not a bank. Cash-on-delivery stores do not process payments online, so
  there are no card numbers to protect. If you later add real online payments,
  that must be handled by a payment provider (e.g. Stripe/Chargé), never in this
  frontend.
- The admin URL is public (though `noindex`). Security relies on the password,
  so **use a long, unique one** and never share it.
- Anyone with the Web app URL can call `place_order` (that is the point — it is
  the public order endpoint). Spam is limited by the honeypot field, a minimum
  fill time, and the fact that fake orders still consume stock.
- Google Apps Script has usage quotas. For a small shop it is plenty; at large
  volume you would move to a dedicated database.

---

## 13. Troubleshooting

**"Could not load products" / network error**
- Check `API_URL` in `js/config.js` ends with `/exec` and has no trailing slash.
- Re-deploy the Apps Script web app and make sure *Who has access* is **Anyone**.
- Open the URL in a browser tab — you should see JSON, not an error page.

**Products don't show in the storefront**
- Make sure the product's **Status** is `available` (not `unavailable`/`archived`).
- Wait up to a minute (products are cached for 60 seconds), or reload the page.

**"No admin account is configured yet"**
- Run `setAdminPassword()` in the Apps Script editor.

**Wrong email or password / too many attempts**
- Passwords are case-sensitive. After 5 bad tries, wait 10 minutes.

**Photo upload fails**
- Check `CLOUDINARY` `cloudName` and `uploadPreset` in `js/config.js`.
- The preset must be **unsigned**; images must be JPG/PNG/WebP and under 3 MB.
- You can always paste an image URL instead.

**Order says "not sent"**
- That is demo mode. Configure `API_URL` (section 6) to accept real orders.

**Changes to `Code.gs` don't take effect**
- You must create a new deployment version after editing the script.

---

## 14. Testing checklist

Use this to confirm a fresh install works. (The mock server automates the API
part; these are the manual checks.)

- [ ] Demo mode: storefront shows the 6 sample products with the demo banner.
- [ ] Checkout in demo mode shows the honest "not sent" message.
- [ ] After setup: the 6 sample products load from the Sheet.
- [ ] Admin sign-in rejects a wrong password and accepts the correct one.
- [ ] Add a product → it appears in the storefront within ~60s.
- [ ] Upload a photo → the URL is filled in automatically.
- [ ] Edit stock in the admin table → value persists after refresh.
- [ ] Hide a product → it disappears from the storefront.
- [ ] Place an order → it appears in admin → Orders.
- [ ] Product stock decreases by the ordered quantity.
- [ ] Ordering more than the available stock is rejected.
- [ ] Tampering with a price in the browser does not change the order total.
- [ ] A customer name containing `<script>` is shown as plain text (no XSS).
- [ ] Admin action without a valid token is rejected.
- [ ] Refreshing the checkout after an order does not create a duplicate.

---

## 15. Project structure

```
others/
├── index.html            # Storefront
├── product.html          # Product detail
├── checkout.html         # Checkout + confirmation
├── admin.html            # Admin dashboard
├── css/
│   └── style.css         # All styling (storefront + admin)
├── js/
│   ├── config.js         # ← your settings live here
│   ├── api.js            # Talks to the Apps Script API (or demo data)
│   ├── store.js          # Storefront rendering
│   ├── cart.js           # Cart + checkout logic
│   └── admin.js          # Admin dashboard logic
├── assets/img/           # Sample SVG product images
├── apps-script/
│   └── Code.gs           # Backend: paste into Apps Script
├── tools/
│   └── mock-server.js    # Local test server (dev only)
└── README.md
```

**Page weight:** the storefront ships about **80 KB** of HTML/CSS/JS,
uncompressed, with **no external fonts, trackers or third-party scripts**.
Product images load lazily. The only external services are your Apps Script API
and Cloudinary.
