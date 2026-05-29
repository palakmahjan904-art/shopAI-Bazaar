const state = {
  products: [],
  filtered: [],
  coupons: [],
  category: "All",
  store: "All",
  cart: JSON.parse(localStorage.getItem("shopai_cart") || "[]"),
  wishlist: JSON.parse(localStorage.getItem("shopai_wishlist") || "[]"),
  compare: JSON.parse(localStorage.getItem("shopai_compare") || "[]"),
  user: null,
  pendingSignup: null,
  heroIndex: 0
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => `₹${Number(value).toLocaleString("en-IN")}`;
const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function priceBounds(product) {
  const offers = product.offers?.length ? product.offers : [{ price: product.price, source: product.source || "ShopAI" }];
  const prices = offers.map((offer) => Number(offer.price || product.price));
  return { low: Math.min(...prices), high: Math.max(...prices), offers };
}

const heroSlides = [
  ["Mega Smart Deals", "Discover electronics, fashion, accessories, and same-day delivery with a support assistant that never sleeps.", "Up to 60% off"],
  ["AI Finds Your Fit", "Ask for a phone, saree, laptop, shoes, delivery support, payment help, or refund guidance in seconds.", "Chat to shop"],
  ["Fast Delivery Week", "Free delivery above ₹1000, express options, same-day choices, and live tracking simulation.", "Delivery made clear"]
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(node.timer);
  node.timer = setTimeout(() => node.classList.remove("show"), 2500);
}

function saveCart() {
  localStorage.setItem("shopai_cart", JSON.stringify(state.cart));
  $("#cartCount").textContent = state.cart.reduce((sum, item) => sum + item.qty, 0);
  renderCart();
}

function saveWishlist() {
  localStorage.setItem("shopai_wishlist", JSON.stringify(state.wishlist));
  renderAccountPanel();
}

function applyFilters() {
  const query = $("#searchInput").value.trim().toLowerCase();
  let list = state.products.filter((product) => {
    const matchesCategory = state.category === "All" || product.category === state.category;
    const matchesStore = state.store === "All" || product.source === state.store;
    const haystack = `${product.name} ${product.category} ${product.source || ""} ${product.description} ${product.tags.join(" ")}`.toLowerCase();
    return matchesCategory && matchesStore && haystack.includes(query);
  });

  const sort = $("#sortSelect").value;
  if (sort === "price-low") list.sort((a, b) => a.price - b.price);
  if (sort === "price-high") list.sort((a, b) => b.price - a.price);
  if (sort === "savings") list.sort((a, b) => (b.mrp - b.price) - (a.mrp - a.price));
  if (sort === "stock") list.sort((a, b) => b.stock - a.stock);
  if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
  state.filtered = list;
  renderProducts();
}

function renderCategories() {
  const categories = ["All", ...new Set(state.products.map((product) => product.category))];
  $("#categoryFilters").innerHTML = categories.map((category) => (
    `<button class="chip ${category === state.category ? "active" : ""}" data-category="${category}">${category}</button>`
  )).join("");
  $$("#categoryFilters button").forEach((button) => {
    button.addEventListener("click", () => {
      state.category = button.dataset.category;
      renderCategories();
      applyFilters();
    });
  });
}

function renderStores() {
  const stores = ["All", ...new Set(state.products.map((product) => product.source || "ShopAI"))];
  $("#storeFilters").innerHTML = stores.map((store) => (
    `<button class="chip ${store === state.store ? "active" : ""}" data-store="${store}">${store}</button>`
  )).join("");
  $$("#storeFilters button").forEach((button) => {
    button.addEventListener("click", () => {
      state.store = button.dataset.store;
      renderStores();
      applyFilters();
    });
  });
}

function renderOffers() {
  const activeCoupons = state.coupons.filter((coupon) => coupon.active).slice(0, 4);
  $("#offersGrid").innerHTML = activeCoupons.map((coupon) => `
    <article>
      <span>${coupon.label || "Coupon"}</span>
      <strong>${coupon.code}</strong>
      <small>${coupon.description || `${Math.round((coupon.discount || 0) * 100)}% off`}</small>
    </article>
  `).join("");
}

function renderAccountPanel() {
  const panel = $("#accountPanel");
  if (!panel) return;
  if (!state.user) {
    panel.innerHTML = `
      <article class="account-card">
        <span class="source-badge">Guest</span>
        <h3>Login or create an account</h3>
        <p class="muted">Use OTP verification, wishlist, order history, refunds, and saved checkout details.</p>
        <button id="accountLoginBtn" class="primary-btn">${icon("log-in")} Login / Signup</button>
      </article>
      <article class="account-card">
        <h3>Account benefits</h3>
        <p>${icon("heart")} Save wishlist products</p>
        <p>${icon("box")} Track orders and refunds</p>
        <p>${icon("shield")} Secure checkout support</p>
      </article>
    `;
    $("#accountLoginBtn").addEventListener("click", loginView);
    return;
  }

  panel.innerHTML = `
    <article class="account-card">
      <span class="source-badge">${state.user.verified ? "OTP verified" : "Verification pending"}</span>
      <h3>${state.user.name}</h3>
      <p class="muted">${state.user.email}</p>
      <p class="muted">${state.user.phone || "No phone saved"}</p>
      <div class="card-actions">
        <button id="accountProfileBtn" class="secondary-btn">${icon("user")} Profile</button>
        <button id="accountOrdersBtn" class="secondary-btn">${icon("box")} Orders</button>
        <button id="accountWishlistBtn" class="secondary-btn">${icon("heart")} Wishlist</button>
      </div>
    </article>
    <article class="account-card">
      <h3>Wishlist</h3>
      <p class="muted">${state.wishlist.length} saved item${state.wishlist.length === 1 ? "" : "s"}</p>
      <button id="accountProductsBtn" class="primary-btn">${icon("shopping-bag")} Continue shopping</button>
    </article>
  `;
  $("#accountProfileBtn").addEventListener("click", showProfile);
  $("#accountOrdersBtn").addEventListener("click", showOrders);
  $("#accountWishlistBtn").addEventListener("click", showWishlist);
  $("#accountProductsBtn").addEventListener("click", () => $("#productsSection").scrollIntoView({ behavior: "smooth" }));
}

function renderProducts() {
  $("#productGrid").innerHTML = state.filtered.map((product) => {
    const wished = state.wishlist.includes(product.id);
    const stockClass = product.stock < 10 ? "stock low-stock" : "stock";
    return `
      <article class="product-card">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        <div class="product-body">
          <div class="price-row">
            <span class="rating">★ ${product.rating}</span>
            <span class="source-badge">${product.source || "ShopAI"}</span>
            <button class="icon-btn ${wished ? "wish-active" : ""}" data-wish="${product.id}" title="Wishlist" aria-label="Wishlist">${icon("heart")}</button>
          </div>
          <h3 class="product-title">${product.name}</h3>
          <p>${product.description}</p>
          <div class="price-row">
            <span><strong class="price">${money(product.price)}</strong> <span class="mrp">${money(product.mrp)}</span></span>
          </div>
          <div class="stock-row">
            <span class="${stockClass}">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</span>
            <small>${product.category}</small>
          </div>
          <div class="card-actions">
            <button class="primary-btn" data-add="${product.id}" ${product.stock === 0 ? "disabled" : ""}>${icon("cart")} Add</button>
            <button class="secondary-btn" data-view-product="${product.id}">${icon("eye")} Details</button>
            ${product.sourceUrl ? `<a class="secondary-btn source-link" href="${product.sourceUrl}" target="_blank" rel="noopener">${icon("external")} Visit</a>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("") || `<p class="muted">No products found. Try another search.</p>`;

  $$("[data-add]").forEach((button) => button.addEventListener("click", () => addToCart(button.dataset.add)));
  $$("[data-wish]").forEach((button) => button.addEventListener("click", () => toggleWishlist(button.dataset.wish)));
  $$("[data-view-product]").forEach((button) => button.addEventListener("click", () => showProduct(button.dataset.viewProduct)));
}

function addToCart(productId) {
  const existing = state.cart.find((item) => item.productId === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({ productId, qty: 1 });
  saveCart();
  toast("Added to cart");
}

function toggleWishlist(productId) {
  state.wishlist = state.wishlist.includes(productId)
    ? state.wishlist.filter((id) => id !== productId)
    : [...state.wishlist, productId];
  saveWishlist();
  renderProducts();
  toast("Wishlist updated");
}

function removeFromWishlist(productId) {
  state.wishlist = state.wishlist.filter((id) => id !== productId);
  saveWishlist();
  renderProducts();
  showWishlist();
  toast("Removed from wishlist");
}

function moveWishlistToCart(productId) {
  addToCart(productId);
  state.wishlist = state.wishlist.filter((id) => id !== productId);
  saveWishlist();
  renderProducts();
  showWishlist();
  toast("Moved to cart");
}

function wishlistProducts() {
  return state.wishlist
    .map((id) => state.products.find((product) => product.id === id))
    .filter(Boolean);
}

function wishlistMarkup() {
  const items = wishlistProducts();
  if (!items.length) {
    return `
      <section class="wishlist-empty">
        <div class="empty-icon">${icon("heart")}</div>
        <h3>Your wishlist is empty</h3>
        <p class="muted">Save products you love and come back to them anytime.</p>
        <button id="emptyWishlistShopBtn" class="primary-btn">${icon("shopping-bag")} Start shopping</button>
      </section>
    `;
  }

  return `
    <section class="wishlist-grid">
      ${items.map((product) => `
        <article class="wishlist-card">
          <img src="${product.image}" alt="${product.name}" loading="lazy">
          <div class="wishlist-card-body">
            <div class="price-row">
              <span class="source-badge">${product.source || "ShopAI"}</span>
              <span class="rating">★ ${product.rating}</span>
            </div>
            <h3>${product.name}</h3>
            <p class="muted">${product.description}</p>
            <div class="price-row">
              <span><strong class="price">${money(product.price)}</strong> <span class="mrp">${money(product.mrp)}</span></span>
              <span class="${product.stock < 10 ? "stock low-stock" : "stock"}">${product.stock > 0 ? "In stock" : "Out of stock"}</span>
            </div>
            <div class="wishlist-actions">
              <button class="primary-btn" data-move-wishlist="${product.id}">${icon("cart")} Move to cart</button>
              <button class="danger-btn" data-remove-wishlist="${product.id}" aria-label="Remove ${product.name} from wishlist">${icon("trash")} Remove</button>
            </div>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function bindWishlistActions() {
  $$("[data-move-wishlist]").forEach((button) => {
    button.addEventListener("click", () => moveWishlistToCart(button.dataset.moveWishlist));
  });
  $$("[data-remove-wishlist]").forEach((button) => {
    button.addEventListener("click", () => removeFromWishlist(button.dataset.removeWishlist));
  });
  $("#emptyWishlistShopBtn")?.addEventListener("click", () => {
    closeModal();
    $("#productsSection").scrollIntoView({ behavior: "smooth" });
  });
}

function cartTotals() {
  const subtotal = state.cart.reduce((sum, item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
  const code = $("#couponInput")?.value.trim().toUpperCase() || "";
  const coupon = state.coupons.find((entry) => entry.code === code && entry.active && subtotal >= (entry.minCart || 0));
  const discount = coupon?.type === "fixed" ? Math.min(subtotal, coupon.amount || 0) : Math.round(subtotal * (coupon?.discount || 0));
  const mode = $("#deliveryMode")?.value || "standard";
  const baseShipping = subtotal - discount > 1000 ? 0 : subtotal - discount >= 500 ? 20 : subtotal ? 50 : 0;
  const shipping = coupon?.freeShipping ? 0 : mode === "same-day" ? 149 : mode === "express" ? 79 : baseShipping;
  return { subtotal, discount, shipping, total: Math.max(0, subtotal - discount + shipping) };
}

function renderCart() {
  const items = state.cart.map((item) => {
    const product = state.products.find((entry) => entry.id === item.productId);
    if (!product) return "";
    return `
      <div class="cart-line">
        <img src="${product.image}" alt="${product.name}">
        <div>
          <strong>${product.name}</strong>
          <div class="muted">${money(product.price)} × ${item.qty}</div>
        </div>
        <div>
          <button class="icon-btn" data-dec="${product.id}" aria-label="Decrease quantity">${icon("minus")}</button>
          <button class="icon-btn" data-inc="${product.id}" aria-label="Increase quantity">${icon("plus")}</button>
        </div>
      </div>
    `;
  }).join("");
  $("#cartItems").innerHTML = items || `<p class="muted">Your cart is empty.</p>`;
  const totals = cartTotals();
  $("#cartSummary").innerHTML = `
    <div class="order-line"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
    <div class="order-line"><span>Discount</span><strong>-${money(totals.discount)}</strong></div>
    <div class="order-line"><span>Delivery</span><strong>${totals.shipping ? money(totals.shipping) : "Free"}</strong></div>
    <hr>
    <div class="order-line"><span>Total</span><strong>${money(totals.total)}</strong></div>
  `;
  $$("[data-inc]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.inc, 1)));
  $$("[data-dec]").forEach((button) => button.addEventListener("click", () => changeQty(button.dataset.dec, -1)));
}

function changeQty(productId, delta) {
  const item = state.cart.find((entry) => entry.productId === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) state.cart = state.cart.filter((entry) => entry.productId !== productId);
  saveCart();
}

function openModal(html) {
  $("#modalContent").innerHTML = html;
  $("#modalLayer").classList.add("open");
  $("#modalLayer").setAttribute("aria-hidden", "false");
}

function closeModal() {
  $("#modalLayer").classList.remove("open");
  $("#modalLayer").setAttribute("aria-hidden", "true");
}

function showProduct(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  openModal(`
    <div class="checkout-grid">
      <img src="${product.image}" alt="${product.name}" style="width:100%;border-radius:.75rem;aspect-ratio:4/3;object-fit:cover">
      <div>
        <span class="eyebrow">${product.category}</span>
        <h2>${product.name}</h2>
        <p><span class="source-badge">${product.source || "ShopAI"}</span></p>
        <p>${product.description}</p>
        <p><span class="rating">★ ${product.rating}</span> <span class="stock">${product.stock} in stock</span></p>
        <h3>${money(product.price)} <span class="mrp">${money(product.mrp)}</span></h3>
        <button class="primary-btn" onclick="addToCart('${product.id}')">${icon("cart")} Add to cart</button>
        ${product.sourceUrl ? `<a class="secondary-btn source-link modal-source" href="${product.sourceUrl}" target="_blank" rel="noopener">${icon("external")} Open on ${product.source || "source website"}</a>` : ""}
        <h3>Reviews</h3>
        ${(product.reviews || []).map((review) => `<p><strong>${review.user}</strong> ★ ${review.rating}<br>${review.text}</p>`).join("") || "<p class='muted'>No reviews yet.</p>"}
      </div>
    </div>
  `);
}

function loginView() {
  openModal(`
    <div class="form-grid">
      <form id="loginForm" class="auth-card">
        <h2>Login</h2>
        <label class="field"><span>Email</span><input name="email" value="customer@shopai.local" required></label>
        <label class="field"><span>Password</span><input name="password" type="password" value="Customer@123" required></label>
        <button class="primary-btn full">Login securely</button>
        <p class="muted">Admin: admin@shopai.local / Admin@123</p>
      </form>
      <form id="signupForm" class="auth-card">
        <h2>Signup + OTP</h2>
        <label class="field"><span>Name</span><input name="name" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" required></label>
        <label class="field"><span>Phone</span><input name="phone"></label>
        <label class="field"><span>Password</span><input name="password" type="password" required></label>
        <button class="secondary-btn full">Create account</button>
        <p class="muted">Demo OTP after signup: 123456</p>
      </form>
    </div>
  `);
  $("#loginForm").addEventListener("submit", loginSubmit);
  $("#signupForm").addEventListener("submit", signupSubmit);
}

async function loginSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify(data) });
    state.user = result.user;
    closeModal();
    updateAuthUi();
    toast(`Welcome, ${state.user.name}`);
  } catch (error) {
    toast(error.message);
  }
}

async function signupSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api("/api/signup", { method: "POST", body: JSON.stringify(data) });
    state.pendingSignup = { email: data.email, password: data.password };
    showOtpView(result.user.email, result.message);
  } catch (error) {
    toast(error.message);
  }
}

function showOtpView(email, message = "Demo OTP is 123456.") {
  openModal(`
    <div class="auth-card">
      <h2>Verify your account</h2>
      <p class="muted">${message}</p>
      <form id="otpForm">
        <label class="field">
          <span>Email</span>
          <input name="email" type="email" value="${email}" required>
        </label>
        <label class="field">
          <span>OTP code</span>
          <input name="otp" inputmode="numeric" maxlength="6" value="123456" required>
        </label>
        <button class="primary-btn full">Verify and login</button>
      </form>
      <button id="backToLogin" class="secondary-btn full" type="button" style="margin-top:.75rem">Back to login</button>
    </div>
  `);
  $("#otpForm").addEventListener("submit", verifyOtpSubmit);
  $("#backToLogin").addEventListener("click", loginView);
}

async function verifyOtpSubmit(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  try {
    await api("/api/verify-otp", { method: "POST", body: JSON.stringify(data) });
    if (state.pendingSignup?.email?.toLowerCase() === data.email.toLowerCase()) {
      const login = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: data.email, password: state.pendingSignup.password })
      });
      state.user = login.user;
      state.pendingSignup = null;
      closeModal();
      updateAuthUi();
      toast(`Account created. Welcome, ${state.user.name}`);
      return;
    }
    toast("Account verified. Please login.");
    loginView();
  } catch (error) {
    toast(error.message);
  }
}

function updateAuthUi() {
  $("#loginOpen").innerHTML = state.user ? `${icon("log-out")} Logout` : `${icon("log-in")} Login`;
  $$(".admin-only").forEach((node) => node.style.display = state.user?.role === "admin" ? "" : "none");
  renderAccountPanel();
}

async function checkoutView() {
  if (!state.cart.length) return toast("Add products to cart first");
  if (!state.user) return loginView();
  const totals = cartTotals();
  openModal(`
    <div class="modal-head"><h2>Secure checkout</h2><span class="status-pill">Encrypted demo payment</span></div>
    <form id="checkoutForm" class="checkout-grid">
      <div>
        <label class="field"><span>Delivery address</span><textarea name="address" required>${state.user.addresses?.[0] || ""}</textarea></label>
        <label class="field"><span>Payment method</span><select name="paymentMethod"><option>UPI</option><option>Debit/Credit Card</option><option>Cash on Delivery</option></select></label>
        <label class="field"><span>Delivery mode</span><select name="deliveryMode"><option value="standard">Standard</option><option value="express">Express</option><option value="same-day">Same-day</option></select></label>
        <label class="field"><span>Coupon</span><input name="coupon" value="${$("#couponInput").value.trim()}"></label>
      </div>
      <div class="summary-box">
        <h3>Order summary</h3>
        <p>Subtotal: <strong>${money(totals.subtotal)}</strong></p>
        <p>Discount: <strong>-${money(totals.discount)}</strong></p>
        <p>Delivery: <strong>${totals.shipping ? money(totals.shipping) : "Free"}</strong></p>
        <h2>Total: ${money(totals.total)}</h2>
        <button class="primary-btn full">Place order</button>
      </div>
    </form>
  `);
  $("#checkoutForm").addEventListener("submit", placeOrder);
}

async function placeOrder(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...form, items: state.cart, coupon: form.coupon })
    });
    state.cart = [];
    saveCart();
    closeModal();
    toast(`Order placed: ${result.order.id}`);
    showOrders();
    await loadProducts();
  } catch (error) {
    toast(error.message);
  }
}

async function showOrders() {
  if (!state.user) return loginView();
  try {
    const { orders } = await api("/api/orders");
    openModal(`
      <h2>Order history & live tracking</h2>
      <div class="tracking-steps">
        ${orders.map((order) => `
          <article class="tracking-card">
            <div class="order-line"><strong>${order.id}</strong><span class="status-pill">${order.status}</span></div>
            <p>${order.items.map((item) => `${item.name} × ${item.qty}`).join(", ")}</p>
            <p>Total: <strong>${money(order.total)}</strong> · ETA: <strong>${order.eta}</strong></p>
            <div class="tracking-steps">${order.tracking.map((step) => `<span>${step}</span>`).join("")}</div>
            <p class="muted">GPS simulation: ${order.gps.lat}, ${order.gps.lng}</p>
            <button class="secondary-btn" data-refund="${order.id}">Return / refund / exchange</button>
          </article>
        `).join("") || "<p class='muted'>No orders yet.</p>"}
      </div>
    `);
    $$("[data-refund]").forEach((button) => button.addEventListener("click", () => refundView(button.dataset.refund)));
  } catch (error) {
    toast(error.message);
  }
}

function refundView(orderId) {
  openModal(`
    <h2>Return request</h2>
    <form id="refundForm" class="auth-card">
      <input type="hidden" name="orderId" value="${orderId}">
      <label class="field"><span>Reason</span><select name="reason"><option>Damaged product</option><option>Wrong product</option><option>Size issue</option><option>Quality issue</option></select></label>
      <label class="field"><span>Resolution</span><select name="option"><option value="refund">Full refund</option><option value="exchange">Exchange product</option></select></label>
      <p class="muted">Refund processing takes 3-7 days after pickup verification.</p>
      <button class="primary-btn">Submit request</button>
    </form>
  `);
  $("#refundForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/refunds", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
      closeModal();
      toast("Refund request submitted");
    } catch (error) {
      toast(error.message);
    }
  });
}

function showProfile() {
  if (!state.user) return loginView();
  openModal(`
    <div class="profile-grid">
      <section class="profile-card">
        <h2>${state.user.name}</h2>
        <p>${state.user.email}</p>
        <p>${state.user.phone || "No phone saved"}</p>
        <span class="status-pill">${state.user.verified ? "OTP verified" : "Verification pending"}</span>
      </section>
      <section class="profile-card profile-wishlist-card">
        <h3>Wishlist</h3>
        ${wishlistMarkup()}
      </section>
      <section class="profile-card">
        <h3>Security</h3>
        <p>Passwords are hashed with scrypt in this demo. Sessions use HttpOnly cookies.</p>
      </section>
      <section class="profile-card">
        <h3>Notifications</h3>
        <p>Email/SMS order alerts are simulated through in-app toast notifications.</p>
      </section>
    </div>
  `);
  bindWishlistActions();
}

function showWishlist() {
  openModal(`
    <div class="modal-head wishlist-head">
      <div>
        <span class="eyebrow">Saved products</span>
        <h2>Wishlist</h2>
      </div>
      <span class="status-pill">${wishlistProducts().length} saved</span>
    </div>
    ${wishlistMarkup()}
  `);
  bindWishlistActions();
}

async function showAdmin() {
  if (!state.user) return loginView();
  try {
    const data = await api("/api/admin");
    const max = Math.max(...data.analytics.categorySales.map((item) => item.value), 1);
    openModal(`
      <h2>Admin dashboard</h2>
      <div class="admin-grid">
        <section class="admin-panel"><h3>Revenue</h3><h2>${money(data.analytics.revenue)}</h2><p>${data.analytics.orders} orders · ${data.analytics.customers} customers</p></section>
        <section class="admin-panel"><h3>Inventory</h3><h2>${data.analytics.lowStock}</h2><p>Low-stock products need attention</p></section>
        <section class="admin-panel">
          <h3>Add product</h3>
          <form id="adminProductForm">
            <label class="field"><span>Name</span><input name="name" required></label>
            <label class="field"><span>Category</span><input name="category" required></label>
            <label class="field"><span>Price</span><input name="price" type="number" required></label>
            <label class="field"><span>Stock</span><input name="stock" type="number" required></label>
            <label class="field"><span>Image URL</span><input name="image" required></label>
            <button class="primary-btn full">Add product</button>
          </form>
        </section>
        <section class="admin-panel">
          <h3>Sales analytics</h3>
          <div class="chart">${data.analytics.categorySales.map((item) => `<div class="bar"><small>${item.label}</small><span style="width:${Math.max(8, item.value / max * 100)}%"></span><strong>${item.value}</strong></div>`).join("")}</div>
        </section>
      </div>
      <section class="admin-panel" style="margin-top:1rem">
        <h3>Orders, refunds, delivery</h3>
        ${data.orders.map((order) => `<p><strong>${order.id}</strong> ${order.status} · ${money(order.total)} · ${order.deliveryMode} · ETA ${order.eta}</p>`).join("")}
        <h3>Refund approvals</h3>
        ${data.refunds.map((refund) => `<p><strong>${refund.id}</strong> ${refund.status} · ${refund.reason} · ${refund.option}</p>`).join("")}
      </section>
    `);
    $("#adminProductForm").addEventListener("submit", addAdminProduct);
  } catch (error) {
    toast(error.message);
  }
}

async function addAdminProduct(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  form.description = "New admin-added product with smart shopping support.";
  form.mrp = Number(form.price) + 500;
  form.tags = [form.category.toLowerCase()];
  try {
    await api("/api/admin/products", { method: "POST", body: JSON.stringify(form) });
    toast("Product added");
    await loadProducts();
    showAdmin();
  } catch (error) {
    toast(error.message);
  }
}

function addMessage(text, from = "bot") {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${from}`;
  bubble.textContent = text;
  $("#chatMessages").appendChild(bubble);
  $("#chatMessages").scrollTop = $("#chatMessages").scrollHeight;
  return bubble;
}

async function sendChat(message) {
  if (!message.trim()) return;
  addMessage(message, "user");
  $("#chatInput").value = "";
  const typing = addMessage("Typing...", "bot typing");
  try {
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message, lang: $("#languageSelect").value })
    });
    setTimeout(() => {
      typing.remove();
      addMessage(result.reply, "bot");
      renderQuickReplies(result.quickReplies || []);
      if (result.products?.length) renderChatProducts(result.products);
    }, 500);
  } catch (error) {
    typing.remove();
    addMessage(error.message, "bot");
  }
}

function renderQuickReplies(replies) {
  $("#quickReplies").innerHTML = replies.map((reply) => `<button type="button">${reply}</button>`).join("");
  $$("#quickReplies button").forEach((button) => button.addEventListener("click", () => sendChat(button.textContent)));
}

function renderChatProducts(products) {
  const names = products.map((product) => `${product.name} - ${product.source || "ShopAI"} (${money(product.price)}, ★${product.rating})`).join("\n");
  addMessage(names, "bot");
}

function setupVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("#voiceBtn").addEventListener("click", () => toast("Voice input is not supported in this browser"));
    return;
  }
  const recognition = new Recognition();
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    $("#chatInput").value = event.results[0][0].transcript;
  };
  $("#voiceBtn").addEventListener("click", () => {
    recognition.lang = $("#languageSelect").value === "hi" ? "hi-IN" : "en-IN";
    recognition.start();
  });
}

function setupSearchTools() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  $("#searchMicBtn").addEventListener("click", () => {
    if (!Recognition) {
      toast("Voice search is not supported in this browser");
      return;
    }
    const recognition = new Recognition();
    recognition.interimResults = false;
    recognition.lang = "en-IN";
    recognition.onresult = (event) => {
      $("#searchInput").value = event.results[0][0].transcript;
      applyFilters();
      $("#productsSection").scrollIntoView({ behavior: "smooth" });
      toast("Voice search applied");
    };
    recognition.start();
  });

  $("#cameraSearchBtn").addEventListener("click", () => $("#cameraSearchInput").click());
  $("#cameraSearchInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fromName = file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\b(img|image|photo|pic|screenshot)\b/gi, "")
      .trim();
    $("#searchInput").value = fromName || "budget accessories";
    applyFilters();
    $("#productsSection").scrollIntoView({ behavior: "smooth" });
    toast("Camera search matched by image name");
    event.target.value = "";
  });
}

async function loadProducts() {
  const { products } = await api("/api/products");
  state.products = products;
  state.coupons = (await api("/api/coupons")).coupons;
  renderCategories();
  renderStores();
  renderOffers();
  applyFilters();
  saveCart();
}

async function init() {
  document.body.dataset.theme = localStorage.getItem("shopai_theme") || "light";
  await loadProducts();
  try {
    state.user = (await api("/api/me")).user;
  } catch {
    state.user = null;
  }
  updateAuthUi();

  $("#searchInput").addEventListener("input", applyFilters);
  $("#sortSelect").addEventListener("change", applyFilters);
  $("#cartOpen").addEventListener("click", () => $("#cartDrawer").classList.add("open"));
  $("[data-close-cart]").addEventListener("click", () => $("#cartDrawer").classList.remove("open"));
  $("#couponInput").addEventListener("input", renderCart);
  $("#deliveryMode").addEventListener("change", renderCart);
  $("#checkoutBtn").addEventListener("click", checkoutView);
  $("#loginOpen").addEventListener("click", async () => {
    if (!state.user) return loginView();
    await api("/api/logout", { method: "POST" });
    state.user = null;
    updateAuthUi();
    toast("Logged out");
  });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalLayer").addEventListener("click", (event) => {
    if (event.target.id === "modalLayer") closeModal();
  });
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.view === "orders") showOrders();
    if (button.dataset.view === "wishlist") showWishlist();
    if (button.dataset.view === "profile") showProfile();
    if (button.dataset.view === "admin") showAdmin();
  }));
  $$("[data-scroll-target]").forEach((button) => button.addEventListener("click", () => {
    document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth" });
  }));
  $("[data-scroll-products]").addEventListener("click", () => $("#productsSection").scrollIntoView({ behavior: "smooth" }));
  $("#askAiHero").addEventListener("click", () => {
    $("#chatPanel").classList.add("open");
    sendChat("Recommend products");
  });
  $("#themeToggle").addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = next;
    localStorage.setItem("shopai_theme", next);
  });
  $("#chatFab").addEventListener("click", () => $("#chatPanel").classList.toggle("open"));
  $("#chatClose").addEventListener("click", () => $("#chatPanel").classList.remove("open"));
  $("#chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendChat($("#chatInput").value);
  });
  setupVoice();
  setupSearchTools();
  renderQuickReplies(["Recommend products", "Track order", "Refund policy", "Delivery charges"]);
  addMessage("Hi! I can recommend products, track orders, explain refunds, calculate delivery charges, and help with payments.");

  setInterval(() => {
    state.heroIndex = (state.heroIndex + 1) % heroSlides.length;
    const [title, text, discount] = heroSlides[state.heroIndex];
    $("#heroTitle").textContent = title;
    $("#heroText").textContent = text;
    $("#heroDiscount").textContent = discount;
  }, 4500);
}

init().catch((error) => {
  console.error(error);
  toast(error.message);
});
