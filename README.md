# ABC Tees - T-shirt Store (Client shop + Admin panel)

A complete T-shirt selling website built on the **MCSL-217 ER model** (stores, employees, customers, addresses, categories, products, inventory, orders, payments, deliveries).
**Node.js + MongoDB** - only one npm package (`mongodb`, the official driver), no framework.

* **Client site** - `http://localhost:3000/` : browse, search, filter, size selection, cart, checkout (home delivery **or** store pick-up), payment mode, order tracking, cancel order, saved addresses, store list.
* **Admin panel** - `http://localhost:3000/admin` : dashboard, **add / edit / hide / delete t-shirts (with picture upload)**, **"Out of Stock" button**, store-wise stock, orders (status flow, delivery details, payments), **in-store billing (customer buys at the store)**, categories, stores, employees, customers, payments.

## Run it (3 steps)
1. Install **Node.js 18+** and **MongoDB** (local MongoDB Community, Docker `docker run -p 27017:27017 mongo`, or a free MongoDB Atlas cluster).
2. Open a terminal in the **`backend`** folder:  `cd backend`  then  `npm install`
3. `npm start`  -> open http://localhost:3000  (demo data is created automatically the first time).
   (From the main folder you can also use `npm run setup` once and then `npm start`.)

| Login | Username / e-mail | Password |
|---|---|---|
| Admin panel | `admin` | `admin123` (change it in *Settings*) |
| Demo customer | `demo@example.com` | `demo123` |

Settings (environment variables, all optional): `MONGODB_URI` (default `mongodb://127.0.0.1:27017`), `DB_NAME` (default `tshirt_store`), `PORT` (3000), `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`, `NO_AUTO_SEED=1`.
`npm run seed` (in `backend`) wipes the shop data and loads the demo data again.

## How the "Out of Stock" feature works
* **Automatic:** stock is kept per **store x t-shirt x size** (`inventory` collection). When the quantity of a size is 0 the size button is crossed out; when **all sizes in all stores are 0** the product card and product page show a red disabled **"Out of Stock"** button instead of *Add to Cart*.
* **Admin button:** in *Admin -> T-shirts* every row has an **Out of Stock** button (and *Mark in stock* to undo). It sets `manualOutOfStock` and the shop immediately shows "Out of Stock" and refuses orders, even if pieces are physically left.
* **Stock is reduced automatically** for every online order (home delivery or pick-up) and for every in-store sale, in the store that supplies the goods. Cancelling an order puts the stock back. The reduction is one atomic MongoDB update (`findOneAndUpdate` with `qty >= wanted` and `$inc`), so the **last piece can never be sold twice** and no MongoDB transaction / replica set is needed.

## Features of the MCSL-217 question that are covered
| Requirement | Where |
|---|---|
| Network of stores across the country | `stores` collection, *Admin -> Stores*, client "Our stores" |
| Online shop, delivery to the customer's address | checkout -> **Home delivery** with saved addresses (`addresses`), `deliveries` record, courier + tracking |
| Delivery can be taken from a store selected by the customer | checkout -> **Pick up from a store** (only stores that have all items in stock can be chosen) |
| Visit any store and buy in person | *Admin -> In-store billing*: choose store, billing employee, items, payment; walk-in or registered customer |
| Quantity of appliance reduced whenever goods are bought online or in a store | `backend/src/services/orders.js` (`reserve()` / `release()`) |
| Entities: Store, Employee, Customer, Address, Category, Product, Inventory, Order, Order item, Payment, Delivery | MongoDB collections (below) |

### ER model -> MongoDB collections
| ER entity | Collection | Notes |
|---|---|---|
| STORE | `stores` | `managerId` -> employee (1:1 "manages") |
| EMPLOYEE | `employees` | `storeId` (store employs employees) |
| CUSTOMER | `customers` | password stored as salted scrypt hash |
| ADDRESS | `addresses` | `customerId` |
| CATEGORY | `categories` | |
| PRODUCT (t-shirt) | `products` | `categoryId`, `sizes[]`, `manualOutOfStock`, `isActive` |
| INVENTORY | `inventory` | unique (`storeId`,`productId`,`size`) -> `qty`, `reorderLevel` |
| CUSTOMER_ORDER + ORDER_ITEM | `orders` | order items are **embedded** (`items[]`) - natural in MongoDB; `channel` (ONLINE / IN_STORE), `fulfilmentMode`, `storeId`, `empId` |
| PAYMENT | `payments` | `orderId` |
| DELIVERY | `deliveries` | only for home delivery; address snapshot, courier, tracking, dates |
| (admin login) | `admins` | |

Order life-cycle: home delivery `PLACED -> CONFIRMED -> PACKED -> SHIPPED -> DELIVERED`; pick-up `PLACED -> CONFIRMED -> READY_FOR_PICKUP -> COLLECTED`; in-store `COMPLETED`; any live order can be `CANCELLED` (customer: only before packing; admin: until shipped).
Delivery charge: free above Rs. 999, else Rs. 60; pick-up is free. Online payment uses **Razorpay** when you add your keys (see the Razorpay section); without keys it is **simulated** (demo). COD / pay-at-store payments become "paid" when the order is delivered / collected.

## Razorpay payment integration (add your keys here)
The code for **real online payments with Razorpay** is already written - you only have to put **your API keys**.

1. Create a Razorpay account -> Dashboard -> *Account & Settings -> API Keys* -> generate **Test keys** (`rzp_test_...`).
2. In the `backend` folder copy `env.example` to **`backend/.env`** and fill in:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx          <- your Key Id
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx       <- your Key Secret (never put it in the browser code / GitHub)
   RAZORPAY_WEBHOOK_SECRET=                   <- optional, see step 4
   SESSION_SECRET=any-long-random-text
   ```
3. Start with `npm run start:env` (Node 20.6+ reads `.env`) - or set the same variables in your hosting panel and use `npm start`.
   The console shows **"Razorpay: ENABLED"**. (Without keys it says "not configured" and the shop uses the simulated demo payment.)
4. *(Recommended)* Dashboard -> *Webhooks -> Add*: URL `https://YOUR-DOMAIN/api/payments/razorpay/webhook`, events `payment.captured` and `order.paid`, secret = `RAZORPAY_WEBHOOK_SECRET`. It confirms payments even if the customer closes the browser after paying.
5. Test with Razorpay test cards / UPI (`success@razorpay`) from the Razorpay docs. For the real shop use **live keys** and HTTPS.

**How the payment flow works (code: `backend/src/services/razorpay.js` and `backend/src/routes/payments.js`):**
1. Customer places the order -> the server **reserves the stock**, saves the order as `PENDING` payment and calls Razorpay `POST /v1/orders` (`startRzp`) - amount in paise, receipt = our order number.
2. The browser opens **Razorpay Checkout** (`frontend/client/js/app.js` -> `payRzp`) with the Key Id and Razorpay order id (UPI / cards / net banking / wallets are chosen on Razorpay's page).
3. After payment the browser sends `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature` to `POST /api/payments/razorpay/verify`. The server checks the signature `HMAC_SHA256(order_id|payment_id, key_secret)` and only then marks the order **paid** (payment id saved as the transaction reference). Payments are never trusted from the browser alone.
4. **Safety nets:** the webhook (above); **"Pay now"** button on *My orders* if the customer closed the payment window; unpaid online orders are **auto-cancelled after 30 minutes** (`UNPAID_MINUTES`) and the stock is released; if Razorpay is down the order is not kept; a payment that arrives after cancellation is **refunded automatically**.
5. **Refunds:** cancelling a paid order (customer before packing, or admin) calls Razorpay `POST /v1/payments/{id}/refund` for the full amount and returns the stock. If the refund call fails the order shows `REFUND_PENDING` so that you can refund from the Razorpay dashboard.

Cash on delivery and pay-at-store stay available. The keys are only read from the environment - the secret never reaches the browser (`/api/config` sends only the Key Id).

## Folder structure
```
tshirt-store/
|-- package.json              shortcuts: npm run setup | start | test | seed  (they run inside backend/)
|-- README.md
|-- docs/                     screenshots of every page
|-- backend/                  ===== SERVER (Node.js + MongoDB) =====
|   |-- package.json          (only dependency: mongodb)       env.example  -> copy to .env
|   |-- server.js             entry point: connects to MongoDB, creates admin, starts the server
|   |-- src/
|   |   |-- app.js            web server: API dispatcher + serves the frontend folders
|   |   |-- db.js             MongoDB collections + indexes
|   |   |-- routes/           public.js (products, stores)  customer.js (login, addresses, orders)
|   |   |                     payments.js (Razorpay)  admin.js (admin panel API)  shared.js
|   |   |-- services/         orders.js (stock + order logic)  razorpay.js  catalog.js  images.js  bootstrap.js
|   |   |-- utils/            helpers.js (validation)  security.js (passwords, sessions)
|   |   `-- seed/demoData.js  demo stores, t-shirts, stock, customer
|   |-- scripts/              seed.js  make-images.js
|   |-- test/                 run.js (28 shop tests)  razorpay.js (13 payment tests)  fakeMongo.js  serve-fake.js
|   `-- uploads/              pictures uploaded by the admin
`-- frontend/                 ===== WEBSITE (plain HTML / CSS / JavaScript) =====
    |-- client/               customer shop        index.html  js/app.js
    |-- admin/                admin panel          index.html  js/admin.js
    `-- shared/               css/style.css (used by both)   img/ (t-shirt pictures, placeholder)
```
The backend serves the frontend: `/` -> `frontend/client`, `/admin` -> `frontend/admin`, `/css` and `/img` -> `frontend/shared`, `/uploads` -> `backend/uploads`; all data comes from the JSON API under `/api/...`. Because both are served from one address, login cookies work without any CORS setup.

## Security notes
Passwords hashed (scrypt) - signed HttpOnly session cookies - JSON-only POST (CSRF protection) - input validation on every API - parameterised queries (no string-built queries) - all text escaped in the pages (XSS) - Content-Security-Policy - image upload checks type, size and file signature - login rate limit - path-traversal protection.
For real use: set `SESSION_SECRET`, change the admin password, use live Razorpay keys and run behind HTTPS.

## Tests
`npm test` (in `backend`) runs 41 tests: 28 for the shop (customer, admin, orders, stock, security) and 13 for the Razorpay integration (using a **fake Razorpay server**, so no keys or internet are needed). The tests use a small **in-memory stand-in for MongoDB** (`test/fakeMongo.js`) so they need no database; the application itself always uses the real `mongodb` driver. `node test/serve-fake.js` (in `backend`) runs the site with the in-memory database (demo, port 3100); `RAZORPAY_MOCK=1 node test/serve-fake.js` also fakes Razorpay.
> Honest note: the project was tested end-to-end in a browser (Chrome) against the in-memory stand-in. The sandbox where it was built had no MongoDB server, so please run it once against your MongoDB (`npm start`) - the code only uses standard driver calls (`find`, `insertOne`, `updateOne`, `findOneAndUpdate`, `deleteOne`, `countDocuments`, `createIndex`).

## UPI / Google Pay / PhonePe / Paytm
At checkout, **Pay online** shows two choices: **UPI** (Google Pay, PhonePe, Paytm, BHIM or any UPI app) and **Card / Net banking / Wallet**. UPI is the default; Razorpay Checkout then shows a UPI block on top (mobile: the UPI app opens, laptop: QR code or UPI ID) and keeps the other methods below it. The options are built in `frontend/client/js/rzp-options.js`.
Dashboard: *Settings -> Configuration -> Payment Methods* -> UPI must be ON. Test mode: UPI ID `success@razorpay` = success, `failure@razorpay` = failure. Real GPay / PhonePe apps only work with LIVE keys and a KYC-approved account.
`npm test` runs 3 test files (shop, Razorpay, UPI).
