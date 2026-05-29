const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DB_FILE = path.join(ROOT, "data", "db.json");
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function readDb() {
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function parseCookies(req) {
  return (req.headers.cookie || "").split(";").reduce((acc, cookie) => {
    const [key, ...value] = cookie.trim().split("=");
    if (key) acc[key] = decodeURIComponent(value.join("="));
    return acc;
  }, {});
}

function getSessionUser(req, db) {
  const sessionId = parseCookies(req).shopai_session;
  if (!sessionId) return null;
  const session = db.sessions.find((item) => item.id === sessionId);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function send(res, status, payload, contentType = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": contentType, ...headers });
  if (Buffer.isBuffer(payload)) {
    res.end(payload);
    return;
  }
  res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function json(res, status, payload, headers = {}) {
  send(res, status, payload, "application/json; charset=utf-8", headers);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function deliveryCharge(subtotal) {
  if (subtotal > 1000) return 0;
  if (subtotal >= 500) return 20;
  return 50;
}

function attachMarketplaceOffers(products) {
  const sources = ["Amazon", "Flipkart", "Croma", "Myntra", "Ajio", "Meesho", "Tata CLiQ", "Nykaa"];
  return products.map((product, index) => {
    if (product.offers?.length) return product;
    const primary = product.source || sources[index % sources.length];
    const alternates = sources.filter((source) => source !== primary).slice(index % 3, (index % 3) + 2);
    const base = Number(product.price);
    const offers = [primary, ...alternates].map((source, offerIndex) => ({
      source,
      price: Math.max(99, Math.round(base * (0.88 + ((index + offerIndex) % 6) * 0.045))),
      url: product.sourceUrl
    }));
    return {
      ...product,
      offers,
      lowPrice: Math.min(...offers.map((offer) => offer.price)),
      highPrice: Math.max(...offers.map((offer) => offer.price))
    };
  });
}

function estimateDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function requireAuth(req, res, db) {
  const user = getSessionUser(req, db);
  if (!user) {
    json(res, 401, { error: "Please login first." });
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireAuth(req, res, db);
  if (!user) return null;
  if (user.role !== "admin") {
    json(res, 403, { error: "Admin access required." });
    return null;
  }
  return user;
}

function chatbotReply(message, lang, db, user) {
  const text = String(message || "").toLowerCase();
  const hindi = lang === "hi" || /[\u0900-\u097F]/.test(message || "");
  const say = (en, hi) => (hindi ? hi : en);
  const productMatches = db.products
    .filter((product) => {
      const haystack = `${product.name} ${product.category} ${product.source || ""} ${product.tags.join(" ")}`.toLowerCase();
      return text.split(/\s+/).some((word) => word.length > 2 && haystack.includes(word));
    })
    .slice(0, 3);

  if (/refund|return|damaged|wrong|रिफंड|वापस|रिटर्न/.test(text)) {
    return {
      intent: "refund",
      reply: say(
        "You can request a return from Orders. Damaged or wrong products are eligible for full refund, processed in 3-7 days after pickup verification.",
        "आप Orders से return request कर सकते हैं। Damaged या wrong product पर full refund मिलता है और pickup verification के बाद 3-7 दिनों में process होता है।"
      ),
      quickReplies: ["Start return", "Refund status", "Exchange product"]
    };
  }

  if (/charge|shipping|deliver|fee|डिलीवरी|चार्ज/.test(text)) {
    return {
      intent: "delivery-charge",
      reply: say("Delivery charges: below ₹499 = ₹50, ₹500-₹999 = ₹20, above ₹1000 = free. Express and same-day delivery are available at checkout.", "Delivery charges: ₹499 से कम = ₹50, ₹500-₹999 = ₹20, ₹1000 से ऊपर = free. Express और same-day delivery checkout पर available हैं।"),
      quickReplies: ["Calculate for ₹450", "Calculate for ₹800", "Free delivery items"]
    };
  }

  if (/track|order|delivery|where|ट्रैक|ऑर्डर|डिलीवरी/.test(text)) {
    const latest = user ? db.orders.filter((order) => order.userId === user.id).at(-1) : null;
    return {
      intent: "tracking",
      reply: latest
        ? say(`Your latest order ${latest.id} is ${latest.status}. Estimated delivery: ${latest.eta}.`, `आपका latest order ${latest.id} अभी ${latest.status} है। Estimated delivery: ${latest.eta}.`)
        : say("Login and open Orders to track live shipment stages, GPS simulation, and delivery ETA.", "Login करके Orders खोलें। वहां live shipment stages, GPS simulation और delivery ETA दिखेगा।"),
      quickReplies: ["Track latest order", "Delivery charges", "Talk to support"]
    };
  }

  if (/upi|card|payment|cod|pay|पेमेंट|कार्ड|यूपीआई/.test(text)) {
    return {
      intent: "payment",
      reply: say("We support UPI, debit/credit cards, and Cash on Delivery. Card/UPI payments use a secure payment-gateway simulation in this demo.", "हम UPI, debit/credit card और Cash on Delivery support करते हैं। इस demo में card/UPI secure payment gateway simulation से चलते हैं।"),
      quickReplies: ["UPI help", "COD available?", "Payment failed"]
    };
  }

  if (/coupon|discount|offer|deal|कूपन|ऑफर/.test(text)) {
    const activeCoupons = db.coupons
      .filter((coupon) => coupon.active)
      .map((coupon) => `${coupon.code}: ${coupon.description || `${Math.round((coupon.discount || 0) * 100)}% off`}`)
      .join("; ");
    return {
      intent: "coupon",
      reply: say(`Current offers: ${activeCoupons}.`, `Current offers: ${activeCoupons}.`),
      quickReplies: ["Apply SAVE20", "Budget products", "Free delivery"]
    };
  }

  if (productMatches.length) {
    return {
      intent: "recommendation",
      reply: say("I found a few good matches for you. Use the product buttons below to add them to your cart or compare ratings.", "आपके लिए कुछ अच्छे products मिले हैं। नीचे product buttons से cart में add करें या ratings compare करें।"),
      products: productMatches,
      quickReplies: ["Cheapest option", "Best rated", "In stock only"]
    };
  }

  const recommended = db.products
    .filter((product) => product.stock > 0)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 3);
  return {
    intent: "general",
    reply: say("Hi, I can help you find products, track orders, explain refunds, calculate delivery charges, solve payment issues, and create support tickets.", "नमस्ते, मैं products खोजने, orders track करने, refunds समझाने, delivery charge calculate करने, payment help और support tickets में मदद कर सकता हूँ।"),
    products: recommended,
    quickReplies: ["Recommend products", "Track order", "Refund policy", "Delivery charges"]
  };
}

async function handleApi(req, res, route) {
  const db = readDb();
  const method = req.method;

  try {
    if (method === "GET" && route === "/api/products") {
      db.products = attachMarketplaceOffers(db.products);
      writeDb(db);
      return json(res, 200, { products: db.products });
    }

    if (method === "GET" && route === "/api/fetch-products") {
      db.products = attachMarketplaceOffers(db.products);
      writeDb(db);
      return json(res, 200, {
        message: "Fetched products from configured marketplace feeds.",
        products: db.products.length,
        sources: [...new Set(db.products.map((product) => product.source || "ShopAI"))]
      });
    }

    if (method === "GET" && route === "/api/coupons") {
      return json(res, 200, { coupons: db.coupons });
    }

    if (method === "GET" && route === "/api/me") {
      return json(res, 200, { user: publicUser(getSessionUser(req, db)) });
    }

    if (method === "POST" && route === "/api/signup") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !body.password || !body.name) return json(res, 400, { error: "Name, email, and password are required." });
      if (db.users.some((user) => user.email === email)) return json(res, 409, { error: "Email already registered." });
      const user = {
        id: uid("usr"),
        name: body.name,
        email,
        phone: body.phone || "",
        role: "customer",
        verified: false,
        otp: "123456",
        passwordHash: hashPassword(body.password),
        wishlist: [],
        addresses: [],
        createdAt: new Date().toISOString()
      };
      db.users.push(user);
      writeDb(db);
      return json(res, 201, { message: "Signup successful. Demo OTP is 123456.", user: publicUser(user) });
    }

    if (method === "POST" && route === "/api/verify-otp") {
      const body = await readBody(req);
      const user = db.users.find((item) => item.email === String(body.email || "").toLowerCase());
      if (!user || body.otp !== user.otp) return json(res, 400, { error: "Invalid OTP." });
      user.verified = true;
      user.otp = null;
      writeDb(db);
      return json(res, 200, { message: "Email/OTP verified." });
    }

    if (method === "POST" && route === "/api/login") {
      const body = await readBody(req);
      const user = db.users.find((item) => item.email === String(body.email || "").trim().toLowerCase());
      if (!user || !verifyPassword(body.password || "", user.passwordHash)) return json(res, 401, { error: "Invalid login details." });
      if (!user.verified) return json(res, 403, { error: "Please verify your OTP before logging in." });
      const session = { id: uid("ses"), userId: user.id, createdAt: Date.now() };
      db.sessions = db.sessions.filter((item) => Date.now() - item.createdAt < SESSION_TTL_MS);
      db.sessions.push(session);
      writeDb(db);
      return json(res, 200, { user: publicUser(user) }, { "Set-Cookie": `shopai_session=${session.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` });
    }

    if (method === "POST" && route === "/api/logout") {
      const sessionId = parseCookies(req).shopai_session;
      db.sessions = db.sessions.filter((session) => session.id !== sessionId);
      writeDb(db);
      return json(res, 200, { message: "Logged out." }, { "Set-Cookie": "shopai_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    }

    if (method === "POST" && route === "/api/chat") {
      const body = await readBody(req);
      const user = getSessionUser(req, db);
      const answer = chatbotReply(body.message, body.lang, db, user);
      db.chats.push({ id: uid("chat"), userId: user?.id || "guest", message: body.message, answer: answer.reply, createdAt: new Date().toISOString() });
      writeDb(db);
      return json(res, 200, answer);
    }

    if (method === "POST" && route === "/api/delivery-charge") {
      const body = await readBody(req);
      const subtotal = Number(body.subtotal || 0);
      return json(res, 200, { charge: deliveryCharge(subtotal) });
    }

    if (method === "GET" && route === "/api/orders") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const orders = user.role === "admin" ? db.orders : db.orders.filter((order) => order.userId === user.id);
      return json(res, 200, { orders });
    }

    if (method === "POST" && route === "/api/orders") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const items = (body.items || []).map((item) => {
        const product = db.products.find((entry) => entry.id === item.productId);
        return product ? { productId: product.id, name: product.name, price: product.price, qty: Math.max(1, Number(item.qty || 1)) } : null;
      }).filter(Boolean);
      if (!items.length) return json(res, 400, { error: "Cart is empty." });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      let discount = 0;
      const coupon = db.coupons.find((entry) => entry.code === String(body.coupon || "").toUpperCase() && entry.active);
      if (coupon && subtotal >= (coupon.minCart || 0)) {
        discount = coupon.type === "fixed" ? Math.min(subtotal, coupon.amount || 0) : Math.round(subtotal * (coupon.discount || 0));
      }
      const shipping = body.deliveryMode === "same-day" ? 149 : body.deliveryMode === "express" ? 79 : deliveryCharge(subtotal - discount);
      const finalShipping = coupon?.freeShipping && subtotal >= (coupon.minCart || 0) ? 0 : shipping;
      const order = {
        id: uid("ord"),
        userId: user.id,
        items,
        subtotal,
        discount,
        shipping: finalShipping,
        total: subtotal - discount + finalShipping,
        paymentMethod: body.paymentMethod || "COD",
        deliveryMode: body.deliveryMode || "standard",
        address: body.address || "Default address",
        status: "Packed",
        eta: estimateDate(body.deliveryMode === "same-day" ? 0 : body.deliveryMode === "express" ? 2 : 5),
        tracking: ["Order placed", "Packed"],
        gps: { lat: 28.6139, lng: 77.209 },
        createdAt: new Date().toISOString()
      };
      db.orders.push(order);
      db.payments.push({ id: uid("pay"), orderId: order.id, method: order.paymentMethod, amount: order.total, status: order.paymentMethod === "COD" ? "Pending COD" : "Paid" });
      for (const item of items) {
        const product = db.products.find((entry) => entry.id === item.productId);
        if (product) product.stock = Math.max(0, product.stock - item.qty);
      }
      writeDb(db);
      return json(res, 201, { order });
    }

    if (method === "POST" && route === "/api/refunds") {
      const user = requireAuth(req, res, db);
      if (!user) return;
      const body = await readBody(req);
      const order = db.orders.find((item) => item.id === body.orderId && (item.userId === user.id || user.role === "admin"));
      if (!order) return json(res, 404, { error: "Order not found." });
      const refund = {
        id: uid("ref"),
        orderId: order.id,
        userId: order.userId,
        reason: body.reason || "Damaged/wrong product",
        option: body.option || "refund",
        status: "Requested",
        timeline: ["Request submitted", "Pickup verification pending"],
        createdAt: new Date().toISOString()
      };
      db.refunds.push(refund);
      writeDb(db);
      return json(res, 201, { refund });
    }

    if (method === "GET" && route === "/api/admin") {
      const admin = requireAdmin(req, res, db);
      if (!admin) return;
      const revenue = db.orders.reduce((sum, order) => sum + order.total, 0);
      return json(res, 200, {
        products: db.products,
        orders: db.orders,
        customers: db.users.filter((user) => user.role === "customer").map(publicUser),
        refunds: db.refunds,
        tickets: db.tickets,
        analytics: {
          revenue,
          orders: db.orders.length,
          customers: db.users.filter((user) => user.role === "customer").length,
          lowStock: db.products.filter((product) => product.stock < 10).length,
          categorySales: db.products.map((product) => ({ label: product.name.slice(0, 18), value: db.orders.flatMap((order) => order.items).filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.qty, 0) }))
        }
      });
    }

    if (method === "POST" && route === "/api/admin/products") {
      requireAdmin(req, res, db);
      if (res.writableEnded) return;
      const body = await readBody(req);
      const product = { id: uid("prd"), rating: 4.2, reviews: [], tags: [], ...body, price: Number(body.price), stock: Number(body.stock) };
      db.products.push(product);
      writeDb(db);
      return json(res, 201, { product });
    }

    if (method === "PUT" && route.startsWith("/api/admin/products/")) {
      requireAdmin(req, res, db);
      if (res.writableEnded) return;
      const id = route.split("/").at(-1);
      const body = await readBody(req);
      const product = db.products.find((entry) => entry.id === id);
      if (!product) return json(res, 404, { error: "Product not found." });
      Object.assign(product, body, { price: Number(body.price ?? product.price), stock: Number(body.stock ?? product.stock) });
      writeDb(db);
      return json(res, 200, { product });
    }

    if (method === "DELETE" && route.startsWith("/api/admin/products/")) {
      requireAdmin(req, res, db);
      if (res.writableEnded) return;
      const id = route.split("/").at(-1);
      db.products = db.products.filter((product) => product.id !== id);
      writeDb(db);
      return json(res, 200, { message: "Product deleted." });
    }

    return json(res, 404, { error: "API route not found." });
  } catch (error) {
    return json(res, 500, { error: error.message || "Server error" });
  }
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return send(res, 404, "Not found", "text/plain; charset=utf-8");
        send(res, 200, fallback, "text/html; charset=utf-8");
      });
      return;
    }
    send(res, 200, content, mimeTypes[path.extname(filePath)] || "application/octet-stream");
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
  console.log(`AI Shopping Chatbot Website running at http://localhost:${PORT}`);
});
