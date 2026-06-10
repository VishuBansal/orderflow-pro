import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api } from "./api";
import { AuthProvider, useAuth } from "./AuthContext";
import { useToast } from "./useToast";
import "./App.css";

// ── Constants ─────────────────────────────────────────────────────
const STATUSES = ["all","pending","confirmed","shipped","delivered","cancelled"];
const STATUS_META = {
  pending:   { bg: "#FEF3C7", color: "#92400E", dot: "#F59E0B" },
  confirmed: { bg: "#DBEAFE", color: "#1E40AF", dot: "#3B82F6" },
  shipped:   { bg: "#EDE9FE", color: "#5B21B6", dot: "#8B5CF6" },
  delivered: { bg: "#D1FAE5", color: "#065F46", dot: "#10B981" },
  cancelled: { bg: "#FEE2E2", color: "#991B1B", dot: "#EF4444" },
};
const STALE_DAYS = 3;
const fmt = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Skeleton row ──────────────────────────────────────────────────
function SkeletonRows({ count = 8 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="skeleton-row">
          <td><div className="sk sk-check" /></td>
          <td><div className="sk sk-id" /></td>
          <td><div className="sk sk-name" /></td>
          <td><div className="sk sk-med" /></td>
          <td><div className="sk sk-sm" /></td>
          <td><div className="sk sk-sm" /></td>
          <td><div className="sk sk-med" /></td>
          <td><div className="sk sk-med" /></td>
          <td><div className="sk sk-badge" /></td>
          <td><div className="sk sk-med" /></td>
          <td><div className="sk sk-actions" /></td>
        </tr>
      ))}
    </>
  );
}

// ── Mobile order card ─────────────────────────────────────────────
function OrderCard({ o, isStale, onEdit, onPayment, onInvoice, onDelete, showToast }) {
  const pendingAmt = Math.max(0, (+o.amount || 0) - (+o.received || 0));
  return (
    <div className={"order-card" + (isStale ? " order-card-stale" : "")}>
      <div className="oc-header">
        <StatusBadge status={o.status} />
        {isStale && <span className="stale-tag">stale</span>}
        <span className="oc-id">
          {o.orderId}
          <button className="copy-btn" style={{opacity:1}} onClick={() => { navigator.clipboard.writeText(o.orderId); showToast("Copied"); }}>⧉</button>
        </span>
      </div>
      <div className="oc-customer">{o.customerName}</div>
      <div className="oc-product">{o.product} · qty {o.quantity}</div>
      <div className="oc-amounts">
        {o.amount ? <span className="oc-amount">{fmt(o.amount)}</span> : null}
        {pendingAmt > 0 && <span className="oc-pending">⏳ {fmt(pendingAmt)} due</span>}
        {o.amount > 0 && pendingAmt === 0 && <span className="oc-paid">Paid ✓</span>}
      </div>
      <div className="oc-date">{o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}</div>
      <div className="oc-actions">
        <button className="btn xs" onClick={onEdit}>Edit</button>
        <button className="btn xs success" onClick={onPayment} title="Record payment">💰</button>
        <button className="btn xs" onClick={onInvoice} title="Invoice">🧾</button>
        <button className="btn xs danger" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}

function daysSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0; }

// ── Inline status popover ─────────────────────────────────────────
function InlineStatus({ order, onUpdate, userEmail }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function pick(status) {
    if (status === order.status) return setOpen(false);
    setSaving(true);
    try {
      await api.update(order.orderId, { status, statusNote: "Status changed", userEmail });
      onUpdate(order.orderId, status);
    } finally { setSaving(false); setOpen(false); }
  }

  const m = STATUS_META[order.status] || { bg:"#eee", color:"#333", dot:"#999" };
  return (
    <div className="inline-status-wrap" ref={ref}>
      <button
        className="badge inline-status-btn"
        style={{ background: m.bg, color: m.color, cursor: saving ? "wait" : "pointer" }}
        onClick={() => !saving && setOpen(o => !o)}
        title="Click to change status"
      >
        <span className="badge-dot" style={{ background: m.dot }} />
        {saving ? "…" : order.status}
        <span style={{ fontSize: 9, marginLeft: 3, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div className="status-popover">
          {STATUSES.slice(1).map(s => {
            const sm = STATUS_META[s];
            return (
              <button key={s} className={"status-option" + (s === order.status ? " current" : "")}
                onClick={() => pick(s)}>
                <span className="badge-dot" style={{ background: sm.dot }} />{s}
                {s === order.status && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────
export default function Root() {
  return <AuthProvider><AppShell /></AuthProvider>;
}
function AppShell() {
  const { user } = useAuth();
  const [onboarded] = useState(() => !!localStorage.getItem("of_onboarded"));
  if (!user) return <LoginPage />;
  if (!onboarded) return <OnboardingFlow />;
  return <App />;
}

// ── Login ─────────────────────────────────────────────────────────
function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault(); setErr(""); setLoading(true);
    try { login(await api.login(email, password)); }
    catch (ex) { setErr(ex.message); }
    finally { setLoading(false); }
  }
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">OF</div>
        <h1 className="login-title">OrderFlow Pro</h1>
        <p className="login-sub">Sign in to your workspace</p>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" required autoFocus /></div>
          <div className="field"><label>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
          {err && <div className="banner error">{err}</div>}
          <button className="btn primary full" disabled={loading}>{loading?"Signing in…":"Sign in"}</button>
        </form>
      </div>
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────
const OB_STEPS = [
  { id:"welcome",  icon:"👋", title:"Welcome to OrderFlow Pro",  sub:"Let's get you set up in 3 quick steps. This will only take 2 minutes." },
  { id:"customer", icon:"👥", title:"Add your first customer",   sub:"Customers are auto-suggested when creating orders." },
  { id:"product",  icon:"🏷️", title:"Add your first product",    sub:"Products and rates are auto-suggested in the order form." },
  { id:"order",    icon:"📦", title:"Create your first order",   sub:"Try creating a test order to see everything in action." },
  { id:"done",     icon:"🎉", title:"You're all set!",           sub:"Your CRM is ready. You can always add more from the sidebar." },
];
function OnboardingFlow() {
  const [step, setStep] = useState(0);
  const [custName, setCustName] = useState(""); const [custEmail, setCustEmail] = useState(""); const [custMobile, setCustMobile] = useState("");
  const [prodName, setProdName] = useState(""); const [prodRate, setProdRate] = useState("");
  const [ordCust, setOrdCust] = useState(""); const [ordProd, setOrdProd] = useState(""); const [ordQty, setOrdQty] = useState("1"); const [ordRate, setOrdRate] = useState("");
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  async function saveCustomer() {
    if (!custName.trim()) return setErr("Customer name is required");
    setSaving(true); setErr("");
    try { await api.addCustomer({ name: custName, email: custEmail, mobile: custMobile }); setStep(2); }
    catch(e) { setErr(e.message); } finally { setSaving(false); }
  }
  async function saveProduct() {
    if (!prodName.trim()) return setErr("Product name is required");
    setSaving(true); setErr("");
    try { await api.addProduct({ name: prodName, rate: prodRate }); setOrdProd(prodName); setOrdRate(prodRate); setStep(3); }
    catch(e) { setErr(e.message); } finally { setSaving(false); }
  }
  async function saveOrder() {
    if (!ordCust.trim() || !ordProd.trim() || !ordQty) return setErr("All fields required");
    setSaving(true); setErr("");
    try {
      await api.create({ customerName: ordCust, product: ordProd, quantity: +ordQty, rate: +ordRate, amount: +ordQty * +ordRate, status: "pending" });
      setStep(4);
    } catch(e) { setErr(e.message); } finally { setSaving(false); }
  }
  function finish() { localStorage.setItem("of_onboarded","1"); window.location.reload(); }

  const s = OB_STEPS[step];
  const progress = Math.round((step / (OB_STEPS.length - 1)) * 100);

  return (
    <div className="ob-wrap">
      <div className="ob-card">
        <div className="ob-progress"><div className="ob-bar" style={{ width: progress+"%" }} /></div>
        <div className="ob-icon">{s.icon}</div>
        <h2 className="ob-title">{s.title}</h2>
        <p className="ob-sub">{s.sub}</p>
        {err && <div className="banner error">{err}</div>}
        {step === 0 && <button className="btn primary full" style={{marginTop:24}} onClick={()=>setStep(1)}>Get started →</button>}
        {step === 1 && (
          <div style={{marginTop:20}}>
            <div className="field"><label>Customer name *</label><input value={custName} onChange={e=>setCustName(e.target.value)} placeholder="e.g. Acme Corp" autoFocus /></div>
            <div className="field-row">
              <div className="field"><label>Email</label><input type="email" value={custEmail} onChange={e=>setCustEmail(e.target.value)} /></div>
              <div className="field"><label>Mobile</label><input value={custMobile} onChange={e=>setCustMobile(e.target.value)} /></div>
            </div>
            <div className="ob-actions">
              <button className="btn" onClick={()=>setStep(2)}>Skip</button>
              <button className="btn primary" onClick={saveCustomer} disabled={saving}>{saving?"Saving…":"Add Customer →"}</button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div style={{marginTop:20}}>
            <div className="field-row">
              <div className="field"><label>Product name *</label><input value={prodName} onChange={e=>setProdName(e.target.value)} placeholder="e.g. Widget Pro" autoFocus /></div>
              <div className="field"><label>Default rate (₹)</label><input type="number" value={prodRate} onChange={e=>setProdRate(e.target.value)} placeholder="0.00" /></div>
            </div>
            <div className="ob-actions">
              <button className="btn" onClick={()=>setStep(3)}>Skip</button>
              <button className="btn primary" onClick={saveProduct} disabled={saving}>{saving?"Saving…":"Add Product →"}</button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div style={{marginTop:20}}>
            <div className="field"><label>Customer</label><input value={ordCust} onChange={e=>setOrdCust(e.target.value)} placeholder="Customer name" autoFocus /></div>
            <div className="field"><label>Product</label><input value={ordProd} onChange={e=>setOrdProd(e.target.value)} placeholder="Product name" /></div>
            <div className="field-row">
              <div className="field"><label>Qty</label><input type="number" min="1" value={ordQty} onChange={e=>setOrdQty(e.target.value)} /></div>
              <div className="field"><label>Rate (₹)</label><input type="number" value={ordRate} onChange={e=>setOrdRate(e.target.value)} /></div>
              <div className="field"><label>Amount</label><input readOnly value={ordQty && ordRate ? fmt(+ordQty * +ordRate) : "—"} style={{background:"var(--bg)"}} /></div>
            </div>
            <div className="ob-actions">
              <button className="btn" onClick={()=>setStep(4)}>Skip</button>
              <button className="btn primary" onClick={saveOrder} disabled={saving}>{saving?"Saving…":"Create Order →"}</button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div style={{marginTop:24,textAlign:"center"}}>
            <p style={{color:"var(--muted)",marginBottom:20,fontSize:14}}>Everything is connected. Your orders, customers, products, and emails are all live.</p>
            <button className="btn primary full" onClick={finish}>Open my CRM →</button>
          </div>
        )}
        <div className="ob-dots">
          {OB_STEPS.map((_,i) => <span key={i} className={"ob-dot"+(i===step?" active":i<step?" done":"")} />)}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
function App() {
  const { user, logout } = useAuth();
  const { toast, show: showToast } = useToast();
  const [page, setPage] = useState("orders");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = ["INPUT","TEXTAREA","SELECT"].includes(tag);
      if (e.key === "Escape") { setSidebarOpen(false); return; }
      if (typing) return;
      if (e.key === "n" || e.key === "N") { setPage("orders"); setTimeout(()=>window.dispatchEvent(new CustomEvent("of:new-order")),50); }
      if (e.key === "/") { setTimeout(()=>document.getElementById("main-search")?.focus(),50); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="layout">
      {/* Mobile overlay */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={()=>setSidebarOpen(false)} />}
      <Sidebar page={page} setPage={(p)=>{setPage(p);setSidebarOpen(false);}} user={user} onLogout={logout} open={sidebarOpen} />
      <div className="content">
        {/* Mobile topbar */}
        <div className="mobile-topbar">
          <button className="hamburger" onClick={()=>setSidebarOpen(o=>!o)}>☰</button>
          <span className="brand-name">OrderFlow Pro</span>
        </div>
        {page === "orders"    && <OrdersPage showToast={showToast} user={user} />}
        {page === "analytics" && <AnalyticsPage />}
        {page === "activity"  && <ActivityPage />}
        {page === "customers" && <MasterPage type="customers" showToast={showToast} user={user} />}
        {page === "products"  && <MasterPage type="products"  showToast={showToast} user={user} />}
      </div>
      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
      {/* Keyboard shortcut hint */}
      <div className="kbd-hint">
        <span><kbd>N</kbd> New order</span>
        <span><kbd>/</kbd> Search</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────
function Sidebar({ page, setPage, user, onLogout, open }) {
  const [dark, setDark] = useState(()=>document.documentElement.classList.contains("dark"));
  const toggleDark = () => { document.documentElement.classList.toggle("dark"); setDark(d=>!d); };
  const nav = [
    { id:"orders",    label:"Orders",       icon:"📦" },
    { id:"analytics", label:"Analytics",    icon:"📊" },
    { id:"activity",  label:"Activity Log", icon:"🕐" },
    { id:"customers", label:"Customers",    icon:"👥" },
    { id:"products",  label:"Products",     icon:"🏷️" },
  ];
  return (
    <aside className={"sidebar"+(open?" sidebar-open":"")}>
      <div className="sidebar-brand">
        <div className="brand-logo">OF</div>
        <span className="brand-name">OrderFlow Pro</span>
      </div>
      <nav className="sidebar-nav">
        {nav.map(n=>(
          <button key={n.id} className={"nav-item"+(page===n.id?" active":"")} onClick={()=>setPage(n.id)}>
            <span className="nav-icon">{n.icon}</span><span>{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className="nav-item" onClick={toggleDark}>
          <span className="nav-icon">{dark?"☀️":"🌙"}</span>
          <span>{dark?"Light mode":"Dark mode"}</span>
        </button>
        <div className="user-row">
          <div className="user-avatar">{(user?.email?.[0]||"U").toUpperCase()}</div>
          <div className="user-info">
            <span className="user-email">{user?.email}</span>
            <span className="user-role">{user?.role}</span>
          </div>
          <button className="btn-icon" onClick={onLogout} title="Sign out">⇥</button>
        </div>
      </div>
    </aside>
  );
}

// ── Orders Page ───────────────────────────────────────────────────
function OrdersPage({ showToast, user }) {
  const [orders, setOrders]     = useState([]);
  const [stats,  setStats]      = useState(null);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState("");
  const [filter, setFilter]     = useState("active"); // "active" hides delivered by default
  const [invoiceCustomer, setInvoiceCustomer] = useState(null); // for multi-item customer invoice
  const [search, setSearch]     = useState("");
  const [sortCol, setSortCol]   = useState("createdAt");
  const [sortDir, setSortDir]   = useState("desc");
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal]       = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts]   = useState([]);
  const [pg, setPg]             = useState(1);
  const PAGE_SIZE = 20;
  const searchTimer = useRef(null);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [res, s, c, p] = await Promise.all([api.list({pageSize:500}), api.stats(), api.getCustomers(), api.getProducts()]);
      setOrders(Array.isArray(res.orders)?res.orders:[]);
      setStats(s);
      setCustomers(Array.isArray(c)?c:[]);
      setProducts(Array.isArray(p)?p:[]);
    } catch(e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(()=>{ load(); },[load]);

  // Listen for global N shortcut
  useEffect(()=>{
    const h = ()=>setModal({mode:"create"});
    window.addEventListener("of:new-order",h);
    return ()=>window.removeEventListener("of:new-order",h);
  },[]);

  const stale = orders.filter(o=>o.status==="pending"&&daysSince(o.createdAt)>=STALE_DAYS);
  const deliveredOrders = orders.filter(o=>o.status==="delivered");

  // "active" = all except delivered AND fully paid orders
  const isFullyPaid = (o) => o.amount > 0 && (o.received||0) >= o.amount;

  let visible = orders.filter(o=>{
    if (filter === "active") {
      if (o.status === "delivered") return false;
      if (isFullyPaid(o)) return false;
    }
    else if (filter !== "all" && o.status !== filter) return false;
    if (search && ![o.customerName,o.product,o.orderId].some(f=>(f||"").toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });
  visible = [...visible].sort((a,b)=>{
    let av=a[sortCol]??"", bv=b[sortCol]??"";
    if(["quantity","rate","amount"].includes(sortCol)){av=+av;bv=+bv;}
    const c=av<bv?-1:av>bv?1:0;
    return sortDir==="desc"?-c:c;
  });
  const totalPages = Math.max(1,Math.ceil(visible.length/PAGE_SIZE));
  const paged = visible.slice((pg-1)*PAGE_SIZE, pg*PAGE_SIZE);

  function toggleSort(col){ if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc"); else{setSortCol(col);setSortDir("asc");} setPg(1); }
  function onSearch(val){ clearTimeout(searchTimer.current); searchTimer.current=setTimeout(()=>{setSearch(val);setPg(1);},280); }
  function toggleSelect(id){ setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;}); }
  function toggleAll(){ setSelected(s=>s.size===paged.length&&paged.length>0?new Set():new Set(paged.map(o=>o.orderId))); }

  async function handleBulkStatus(status){
    try{ await api.bulkStatus([...selected],status); showToast(`${selected.size} orders → ${status}`); setSelected(new Set()); setBulkModal(false); load(); }
    catch(e){ showToast(e.message,"error"); }
  }
  async function handleBulkDelete(){
    try{ await api.bulkDelete([...selected]); showToast(`${selected.size} orders cancelled`); setSelected(new Set()); setBulkModal(false); load(); }
    catch(e){ showToast(e.message,"error"); }
  }
  async function handleDelete(orderId){
    try{ await api.delete(orderId); showToast("Order cancelled"); setDeleting(null); load(); }
    catch(e){ showToast(e.message,"error"); setDeleting(null); }
  }

  // Inline status update (optimistic)
  function handleInlineStatusUpdate(orderId, newStatus) {
    setOrders(prev => prev.map(o =>
      o.orderId === orderId ? { ...o, status: newStatus } : o
    ));
    showToast(`Status → ${newStatus}`);
  }

  const SortTh = ({col,label})=>(
    <th className="sortable" onClick={()=>toggleSort(col)}>
      {label}<span className="sort-arrows">{sortCol===col?(sortDir==="asc"?" ↑":" ↓"):" ↕"}</span>
    </th>
  );

  const totalAmount   = visible.reduce((s,o)=>s+(+o.amount||0),0);
  const totalReceived = visible.reduce((s,o)=>s+(+o.received||0),0);
  const totalPending  = visible.reduce((s,o)=>{
    const due = (+o.amount||0) - (+o.received||0);
    return s + (due > 0 ? due : 0);
  },0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-sub">{orders.length} total · {fmt(totalPending)} pending</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={load}>↻</button>
          <button className="btn primary" onClick={()=>setModal({mode:"create"})}>+ New Order <kbd className="btn-kbd">N</kbd></button>
        </div>
      </div>

      {stale.length>0&&(
        <div className="banner warning">⏰ <strong>{stale.length} order{stale.length>1?"s":""}</strong> pending for {STALE_DAYS}+ days.</div>
      )}
      {err&&<div className="banner error">{err}</div>}

      {stats&&(
        <div className="stats-row">
          {[["Total",stats.counts?.total,""],["Pending",stats.counts?.pending,STATUS_META.pending.dot],
            ["Shipped",stats.counts?.shipped,STATUS_META.shipped.dot],["Delivered",stats.counts?.delivered,STATUS_META.delivered.dot],
            ["Avg Fulfil",stats.avgFulfillDays!=null?`${stats.avgFulfillDays}d`:"—",""]
          ].map(([label,val,col])=>(
            <div className="stat" key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{color:col||"inherit"}}>{val??"—"}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Payment Dashboard ── */}
      <PaymentDashboard orders={orders} />

      <div className="toolbar">
        <input id="main-search" ref={searchRef} className="search-input" placeholder="Search orders… (press /)"
          onChange={e=>onSearch(e.target.value)} />
        {selected.size>0&&(
          <div className="bulk-bar">
            <span>{selected.size} selected</span>
            <button className="btn" onClick={()=>setBulkModal(true)}>Bulk action</button>
            <button className="btn danger" onClick={()=>setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>

      <div className="pills">
        {/* Active (default) = all non-delivered */}
        <button className={"pill"+(filter==="active"?" active":"")} onClick={()=>{setFilter("active");setPg(1);}}>
          Active <span className="pill-count">{orders.filter(o=>o.status!=="delivered").length}</span>
        </button>
        {["pending","confirmed","shipped","cancelled"].map(s=>(
          <button key={s} className={"pill"+(filter===s?" active":"")} onClick={()=>{setFilter(s);setPg(1);}}>
            <span className="pill-dot" style={{background:STATUS_META[s]?.dot}}/>{s}
            <span className="pill-count">{orders.filter(o=>o.status===s).length}</span>
          </button>
        ))}
        {/* Delivered = fulfilled/archived */}
        <button className={"pill pill-delivered"+(filter==="delivered"?" active":"")} onClick={()=>{setFilter("delivered");setPg(1);}}>
          <span className="pill-dot" style={{background:STATUS_META.delivered?.dot}}/>Delivered
          <span className="pill-count">{deliveredOrders.length}</span>
        </button>
        <button className={"pill pill-all"+(filter==="all"?" active":"")} onClick={()=>{setFilter("all");setPg(1);}}>
          All orders <span className="pill-count">{orders.length}</span>
        </button>
      </div>

      {filter==="delivered"&&deliveredOrders.length>0&&(
        <div className="delivered-info">
          ✅ Showing {deliveredOrders.length} fulfilled order{deliveredOrders.length>1?"s":""} — these are archived and hidden from the Active view.
        </div>
      )}

      <div className="table-wrap">
        {loading?(
          <table>
            <thead><tr>
              <th style={{width:40}}></th>
              <th>Order ID</th><th>Customer</th><th>Product</th>
              <th>Qty</th><th>Rate</th><th>Amount</th><th>Received</th>
              <th>Status</th><th>Created</th><th>Actions</th>
            </tr></thead>
            <tbody><SkeletonRows count={8} /></tbody>
          </table>
        ):visible.length===0?(
          <div className="center empty">
            <p className="empty-icon">📭</p><p>No orders found.</p>
            <button className="btn" style={{marginTop:12}} onClick={()=>{setFilter("all");setSearch("");}}>Clear filters</button>
          </div>
        ):(
          <>
          {/* Desktop table */}
          <table className="orders-table">
            <thead><tr>
              <th style={{width:40}}><input type="checkbox" checked={selected.size===paged.length&&paged.length>0} onChange={toggleAll}/></th>
              <SortTh col="orderId" label="Order ID"/>
              <SortTh col="customerName" label="Customer"/>
              <SortTh col="product" label="Product"/>
              <SortTh col="quantity" label="Qty"/>
              <SortTh col="rate" label="Rate"/>
              <SortTh col="amount" label="Amount"/>
              <SortTh col="received" label="Received"/>
              <SortTh col="status" label="Status"/>
              <SortTh col="createdAt" label="Created"/>
              <th>Actions</th>
            </tr></thead>
            <tbody>
              {paged.map(o=>{
                const isStale=o.status==="pending"&&daysSince(o.createdAt)>=STALE_DAYS;
                const pendingAmt = Math.max(0, (+o.amount||0) - (+o.received||0));
                const pct = o.amount > 0 ? Math.min(100, Math.round(((+o.received||0) / +o.amount)*100)) : 0;
                return(
                  <tr key={o.orderId} className={isStale?"row-stale":""}>
                    <td><input type="checkbox" checked={selected.has(o.orderId)} onChange={()=>toggleSelect(o.orderId)}/></td>
                    <td>
                      <span className="order-id">{o.orderId}</span>
                      <button className="copy-btn" onClick={()=>{navigator.clipboard.writeText(o.orderId);showToast("Copied");}}>⧉</button>
                    </td>
                    <td><strong>{o.customerName}</strong></td>
                    <td>{o.product}</td>
                    <td>{o.quantity}</td>
                    <td className="muted">{o.rate?fmt(o.rate):"—"}</td>
                    <td><strong>{o.amount?fmt(o.amount):"—"}</strong></td>
                    <td>
                      {o.amount > 0 ? (
                        <div className="recv-cell">
                          <div className="recv-bar-wrap">
                            <div className="recv-bar" style={{width:`${pct}%`, background: pct===100?"#10B981":"#3B82F6"}}/>
                          </div>
                          <span className="recv-label" style={{color: pct===100?"#10B981": pendingAmt>0?"#F59E0B":"inherit"}}>
                            {pct===100 ? "Paid ✓" : `${fmt(o.received||0)}`}
                          </span>
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <InlineStatus order={o} onUpdate={handleInlineStatusUpdate} userEmail={user?.email}/>
                      {isStale&&<span className="stale-tag">stale</span>}
                    </td>
                    <td className="muted">{o.createdAt?new Date(o.createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"}):"—"}</td>
                    <td><div className="row-actions">
                      <button className="btn xs" onClick={()=>setModal({mode:"edit",order:o})}>Edit</button>
                      <button className="btn xs success" onClick={()=>setModal({mode:"received",order:o})} title="Record payment">💰</button>
                      <button className="btn xs" onClick={()=>setInvoiceCustomer(o.customerName)} title="Full customer invoice">🧾</button>
                      <button className="btn xs danger" onClick={()=>setDeleting(o.orderId)}>✕</button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {/* Mobile card grid */}
          <div className="order-cards">
            {paged.map(o => {
              const isStale = o.status==="pending" && daysSince(o.createdAt)>=STALE_DAYS;
              return (
                <OrderCard
                  key={o.orderId}
                  o={o}
                  isStale={isStale}
                  showToast={showToast}
                  onEdit={()=>setModal({mode:"edit",order:o})}
                  onPayment={()=>setModal({mode:"received",order:o})}
                  onInvoice={()=>setInvoiceCustomer(o.customerName)}
                  onDelete={()=>setDeleting(o.orderId)}
                />
              );
            })}
          </div>
          {/* Amount summary row */}
          <div className="table-footer">
            <span>{visible.length} orders</span>
            <span style={{display:"flex",gap:20}}>
              <span>Amount: <strong>{fmt(totalAmount)}</strong></span>
              <span style={{color:"#F59E0B"}}>Pending: <strong>{fmt(totalPending)}</strong></span>
            </span>
          </div>
          {totalPages>1&&(
            <div className="pagination">
              <button className="btn xs" disabled={pg===1} onClick={()=>setPg(p=>p-1)}>← Prev</button>
              <span>Page {pg} of {totalPages}</span>
              <button className="btn xs" disabled={pg===totalPages} onClick={()=>setPg(p=>p+1)}>Next →</button>
            </div>
          )}
          </>
        )}
      </div>

      {modal&&modal.mode!=="received"&&<OrderModal mode={modal.mode} order={modal.order} customers={customers} products={products}
        orders={orders} user={user}
        onClose={()=>setModal(null)} onSave={msg=>{showToast(msg);setModal(null);load();}} onError={msg=>showToast(msg,"error")}/>}
      {modal&&modal.mode==="received"&&<ReceivedModal order={modal.order}
        user={user}
        onClose={()=>setModal(null)}
        onSave={msg=>{showToast(msg);setModal(null);load();}}
        onOptimisticUpdate={(orderId, received) => {
          setOrders(prev => prev.map(o =>
            o.orderId === orderId
              ? { ...o, received, status: (o.amount > 0 && received >= o.amount && o.status !== "cancelled") ? "delivered" : o.status }
              : o
          ));
        }}
        onError={msg=>showToast(msg,"error")}/>}
      {deleting&&<ConfirmModal title="Cancel this order?" message="Sets status to Cancelled." confirmLabel="Yes, cancel" onConfirm={()=>handleDelete(deleting)} onClose={()=>setDeleting(null)}/>}
      {bulkModal&&<BulkModal count={selected.size} onStatus={handleBulkStatus} onDelete={handleBulkDelete} onClose={()=>setBulkModal(false)}/>}
      {invoiceCustomer&&<InvoiceModal customerName={invoiceCustomer} orders={orders.filter(o=>o.customerName===invoiceCustomer)} onClose={()=>setInvoiceCustomer(null)}/>}
    </div>
  );
}

// ── Payment Dashboard ─────────────────────────────────────────────
function PaymentDashboard({ orders }) {
  const [open, setOpen] = useState(false);

  const activeOrders = orders.filter(o => o.status !== "cancelled");
  const totalInvoiced = activeOrders.reduce((s,o) => s + (+o.amount||0), 0);
  const totalReceived = activeOrders.reduce((s,o) => s + (+o.received||0), 0);
  const totalPending  = Math.max(0, totalInvoiced - totalReceived);

  // Party-wise breakdown
  const partyMap = {};
  activeOrders.forEach(o => {
    if (!o.customerName) return;
    if (!partyMap[o.customerName]) partyMap[o.customerName] = { invoiced: 0, received: 0 };
    partyMap[o.customerName].invoiced  += (+o.amount||0);
    partyMap[o.customerName].received  += (+o.received||0);
  });
  const parties = Object.entries(partyMap)
    .map(([name, v]) => ({ name, invoiced: v.invoiced, received: v.received, pending: Math.max(0, v.invoiced - v.received) }))
    .filter(p => p.invoiced > 0)
    .sort((a,b) => b.pending - a.pending);

  return (
    <div className="payment-dashboard">
      <div className="payment-summary">
        <div className="pay-stat invoiced">
          <div className="pay-stat-label">Total Invoiced</div>
          <div className="pay-stat-value">{fmt(totalInvoiced)}</div>
        </div>
        <div className="pay-stat received">
          <div className="pay-stat-label">Total Received</div>
          <div className="pay-stat-value">{fmt(totalReceived)}</div>
        </div>
        <div className="pay-stat pending">
          <div className="pay-stat-label">Total Pending</div>
          <div className="pay-stat-value">{fmt(totalPending)}</div>
        </div>
        <button className="btn xs" style={{alignSelf:"center",marginLeft:"auto"}} onClick={()=>setOpen(o=>!o)}>
          {open?"▲ Hide":"▼ Party-wise"}
        </button>
      </div>
      {open && (
        <div className="party-table-wrap">
          <table className="party-table">
            <thead><tr>
              <th>Party</th>
              <th style={{textAlign:"right"}}>Invoiced</th>
              <th style={{textAlign:"right"}}>Received</th>
              <th style={{textAlign:"right"}}>Pending</th>
              <th style={{textAlign:"right"}}>Status</th>
            </tr></thead>
            <tbody>
              {parties.length === 0
                ? <tr><td colSpan={5} style={{textAlign:"center",padding:"16px",color:"var(--muted)"}}>No payment data yet.</td></tr>
                : parties.map(p => {
                  const pct = p.invoiced > 0 ? Math.round((p.received/p.invoiced)*100) : 0;
                  return (
                    <tr key={p.name}>
                      <td><strong>{p.name}</strong></td>
                      <td style={{textAlign:"right"}}>{fmt(p.invoiced)}</td>
                      <td style={{textAlign:"right",color:"#10B981",fontWeight:600}}>{p.received>0?fmt(p.received):"—"}</td>
                      <td style={{textAlign:"right",color:p.pending>0?"#F59E0B":"#10B981",fontWeight:600}}>{p.pending>0?fmt(p.pending):"Paid ✓"}</td>
                      <td style={{textAlign:"right"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end"}}>
                          <div style={{width:60,height:6,background:"var(--border)",borderRadius:4,overflow:"hidden"}}>
                            <div style={{width:`${pct}%`,height:"100%",background:"#10B981",borderRadius:4}}/>
                          </div>
                          <span style={{fontSize:11,color:"var(--muted)"}}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              }
            </tbody>
            <tfoot>
              <tr style={{fontWeight:700,borderTop:"2px solid var(--border)"}}>
                <td>Total</td>
                <td style={{textAlign:"right"}}>{fmt(totalInvoiced)}</td>
                <td style={{textAlign:"right",color:"#10B981"}}>{fmt(totalReceived)}</td>
                <td style={{textAlign:"right",color:totalPending>0?"#F59E0B":"#10B981"}}>{totalPending>0?fmt(totalPending):"All Paid ✓"}</td>
                <td/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Order Modal ───────────────────────────────────────────────────
function OrderModal({ mode, order, customers, products, orders: allOrders, onClose, onSave, onError, user }) {
  const [form, setForm] = useState({
    customerName: order?.customerName||"", product: order?.product||"",
    quantity: order?.quantity?String(order.quantity):"",
    rate: order?.rate?String(order.rate):"",
    amount: order?.amount?String(order.amount):"",
    status: order?.status||"pending", notes: order?.notes||"",
  });
  const [noteInput, setNoteInput] = useState(""); // for appending a new note
  const [err, setErr]     = useState("");
  const [saving,setSaving]= useState(false);

  // Feature 5: Duplicate detection
  const duplicate = mode === "create" && form.customerName && form.product
    ? (allOrders||[]).find(o =>
        o.customerName?.toLowerCase() === form.customerName.toLowerCase() &&
        o.product?.toLowerCase() === form.product.toLowerCase() &&
        o.status !== "cancelled" &&
        daysSince(o.createdAt) < 7
      )
    : null;

  const set = (k,v) => setForm(f=>{
    const next={...f,[k]:v};
    if(k==="quantity"||k==="rate"){
      const q=parseFloat(k==="quantity"?v:next.quantity)||0;
      const r=parseFloat(k==="rate"?v:next.rate)||0;
      next.amount = q && r ? String((q*r).toFixed(2)) : "";
    }
    return next;
  });

  function onProductChange(val) {
    // Auto-fill rate from product master
    const p = products.find(p => p.name === val);
    setForm(f => {
      const next = { ...f, product: val };
      if (p?.rate) {
        next.rate = String(p.rate);
        const q = parseFloat(f.quantity) || 0;
        next.amount = q ? String((q * p.rate).toFixed(2)) : "";
      }
      return next;
    });
  }

  async function save() {
    if(!form.customerName.trim()) return setErr("Customer name is required");
    if(!form.product.trim())      return setErr("Product is required");
    if(!form.quantity||isNaN(form.quantity)||+form.quantity<1) return setErr("Quantity must be at least 1");
    setSaving(true); setErr("");
    try {
      // Feature 6: Append new note to existing notes (separated by " · ")
      const finalNotes = noteInput.trim()
        ? (form.notes ? form.notes + " · " + noteInput.trim() : noteInput.trim())
        : form.notes;
      const data = { ...form, notes: finalNotes, quantity:+form.quantity, rate:+form.rate||0, amount:+form.amount||0,
        // Feature 7: Audit trail
        userEmail: user?.email || "",
        statusNote: noteInput.trim() || undefined,
      };
      if(mode==="edit") await api.update(order.orderId, data);
      else              await api.create(data);
      onSave(mode==="edit"?"Order updated ✓":"Order created ✓");
    } catch(e){ setErr(e.message); setSaving(false); }
  }

  useEffect(()=>{
    const h=(e)=>{ if(e.key==="Escape") onClose(); if(e.key==="Enter"&&e.ctrlKey) save(); };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[]);

  return (
    <Overlay onClose={onClose}>
      <div className="modal">
        <ModalHeader title={mode==="edit"?"Edit Order":"New Order"} onClose={onClose}/>

        {/* Feature 5: Duplicate warning */}
        {duplicate && (
          <div className="banner warning" style={{marginBottom:12}}>
            ⚠️ Similar order exists: <strong>{duplicate.orderId}</strong> ({duplicate.status}, {Math.ceil(daysSince(duplicate.createdAt))}d ago).
            This may be a duplicate.
          </div>
        )}

        <div className="field"><label>Customer</label>
          <input list="ob-cust" value={form.customerName} onChange={e=>set("customerName",e.target.value)} placeholder="Type or pick" autoFocus/>
          <datalist id="ob-cust">{customers.map(c=><option key={c.rowIndex} value={c.name}/>)}</datalist>
        </div>
        <div className="field"><label>Product</label>
          <input list="ob-prod" value={form.product} onChange={e=>onProductChange(e.target.value)} placeholder="Type or pick"/>
          <datalist id="ob-prod">{products.map(p=><option key={p.rowIndex} value={p.name}/>)}</datalist>
        </div>
        <div className="field-row3">
          <div className="field"><label>Qty</label>
            <input type="number" min="1" value={form.quantity} onChange={e=>set("quantity",e.target.value)}/></div>
          <div className="field"><label>Rate (₹)</label>
            <input type="number" min="0" step="0.01" value={form.rate} onChange={e=>set("rate",e.target.value)}/></div>
          <div className="field"><label>Amount (₹)</label>
            <input readOnly value={form.amount?fmt(form.amount):"—"} className="input-calc"/></div>
        </div>

        {/* Feature 6: Notes timeline — show existing, add new */}
        {mode === "edit" && form.notes && (
          <div className="notes-timeline">
            {form.notes.split(" · ").map((n, i) => (
              <div key={i} className="notes-entry">
                <span className="notes-dot"/>
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}
        <div className="field-row">
          <div className="field">
            <label>{mode==="edit" ? "Add note" : "Notes"} <span className="label-opt">(optional)</span></label>
            <input
              value={mode==="edit" ? noteInput : form.notes}
              onChange={e => mode==="edit" ? setNoteInput(e.target.value) : set("notes", e.target.value)}
              placeholder={mode==="edit" ? "Append a note to this order…" : "Internal notes…"}
            />
          </div>
        </div>
        <div className="field" style={{maxWidth:200}}>
          <label>Status</label>
          <select value={form.status} onChange={e=>set("status",e.target.value)}>
            {STATUSES.slice(1).map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {err&&<div className="banner error">{err}</div>}
        <div className="modal-actions">
          <span className="modal-hint">Ctrl+Enter to save</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving?"Saving…":mode==="edit"?"Save changes":"Create order"}</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Received Modal ────────────────────────────────────────────────
function ReceivedModal({ order, onClose, onSave, onOptimisticUpdate, onError, user }) {
  const alreadyReceived = +order.received || 0;
  const totalAmount     = +order.amount   || 0;
  const due             = Math.max(0, totalAmount - alreadyReceived);

  // Feature 1: Parse existing payment history
  const payHistory = (() => {
    try { return order.paymentHistory ? JSON.parse(order.paymentHistory) : []; }
    catch { return []; }
  })();

  const [amount, setAmount]   = useState(due > 0 ? String(due) : "");
  const [note, setNote]       = useState("");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");

  const newTotal  = alreadyReceived + (parseFloat(amount) || 0);
  const remaining = Math.max(0, totalAmount - newTotal);
  const overpaid  = totalAmount > 0 && newTotal > totalAmount;

  async function save() {
    const val = parseFloat(amount);
    if (!amount || isNaN(val) || val <= 0) return setErr("Enter a valid amount");
    setSaving(true); setErr("");

    // Build new payment log entry
    const newEntry = {
      amount: val,
      total: newTotal,
      date: new Date().toISOString(),
      note: note.trim() || "",
      by: user?.email || "unknown",
    };
    const updatedHistory = [...payHistory, newEntry];

    onOptimisticUpdate?.(order.orderId, newTotal);
    try {
      await api.update(order.orderId, {
        received: newTotal,
        paymentHistory: JSON.stringify(updatedHistory),
        userEmail: user?.email || "",
      });
      onSave("Payment recorded ✓");
    } catch(e) {
      onOptimisticUpdate?.(order.orderId, alreadyReceived);
      setErr(e.message);
      setSaving(false);
    }
  }

  useEffect(()=>{
    const h=(e)=>{ if(e.key==="Escape") onClose(); if(e.key==="Enter"&&e.ctrlKey) save(); };
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[]);

  return (
    <Overlay onClose={onClose}>
      <div className="modal" style={{maxWidth:420}}>
        <ModalHeader title="Record Payment" onClose={onClose}/>

        {/* Order summary */}
        <div style={{marginBottom:16,padding:"12px 14px",background:"var(--bg)",borderRadius:"var(--radius)",fontSize:13}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{color:"var(--muted)"}}>Order</span>
            <span style={{fontFamily:"monospace",fontWeight:600}}>{order.orderId}</span>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{color:"var(--muted)"}}>Customer</span>
            <strong>{order.customerName}</strong>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{color:"var(--muted)"}}>Invoice Amount</span>
            <strong>{fmt(totalAmount)}</strong>
          </div>
          {alreadyReceived > 0 && (
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{color:"var(--muted)"}}>Already Received</span>
              <span style={{color:"#10B981",fontWeight:600}}>{fmt(alreadyReceived)}</span>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"space-between",borderTop:"1px solid var(--border)",paddingTop:6,marginTop:4}}>
            <span style={{color:"var(--muted)"}}>Balance Due</span>
            <span style={{color: due>0?"#F59E0B":"#10B981", fontWeight:700}}>{due>0?fmt(due):"Paid ✓"}</span>
          </div>
        </div>

        {/* Feature 1: Payment history */}
        {payHistory.length > 0 && (
          <div className="pay-history">
            <div className="pay-history-title">Payment history</div>
            {payHistory.map((p, i) => (
              <div key={i} className="pay-history-row">
                <span className="pay-history-dot"/>
                <div className="pay-history-body">
                  <span className="pay-history-amt">{fmt(p.amount)}</span>
                  <span className="pay-history-meta">
                    {new Date(p.date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                    {p.by && p.by !== "unknown" ? ` · ${p.by}` : ""}
                    {p.note ? ` · "${p.note}"` : ""}
                  </span>
                </div>
                <span className="pay-history-running">{fmt(p.total)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label>Amount Received Now (₹)</label>
          <input type="number" min="0.01" step="0.01" value={amount}
            onChange={e=>setAmount(e.target.value)}
            placeholder={due>0?String(due):"0.00"}
            autoFocus
            style={{borderColor: amount && !overpaid ? "#10B981" : overpaid ? "#F59E0B" : undefined}}
          />
          {amount && parseFloat(amount) > 0 && (
            <span style={{fontSize:11,marginTop:3,display:"block",
              color: overpaid ? "#F59E0B" : remaining===0 ? "#10B981" : "#6B7280"}}>
              {overpaid
                ? `⚠️ Overpayment of ${fmt(newTotal - totalAmount)}`
                : remaining===0
                  ? "✓ Fully paid — order will be marked Delivered"
                  : `⏳ Still due after this: ${fmt(remaining)}`}
            </span>
          )}
        </div>
        <div className="field">
          <label>Note <span className="label-opt">(optional)</span></label>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. NEFT, cheque no., partial…"/>
        </div>

        {err && <div className="banner error">{err}</div>}
        <div className="modal-actions">
          <span className="modal-hint">Ctrl+Enter to save</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Record Payment"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Invoice Modal (multi-item, per customer) ──────────────────────
function InvoiceModal({ customerName, orders, onClose }) {
  // Group all orders for this customer, sorted by date
  const items = [...orders].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));

  // Feature 4: Sequential persistent invoice number
  const invoiceNum = useMemo(() => {
    const key = "of_inv_seq";
    const last = parseInt(localStorage.getItem(key) || "0", 10);
    const next = last + 1;
    localStorage.setItem(key, String(next));
    return "INV-" + String(next).padStart(5, "0");
  }, []);
  const today       = new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
  const subtotal    = items.reduce((s,o)=>s+(+o.amount||+o.quantity*(+o.rate||0)),0);
  const gst         = subtotal * 0.18;
  const total       = subtotal + gst;
  const totalReceived = items.filter(o=>o.status!=="cancelled").reduce((s,o)=>s+(+o.received||0),0);
  const balanceDue    = Math.max(0, total - totalReceived);
  const pendingAmt  = items.filter(o=>o.status!=="cancelled"&&o.status!=="delivered").reduce((s,o)=>s+(+o.amount||0),0);

  const STATUS_COLORS_PRINT = {
    pending:"#F59E0B",confirmed:"#3B82F6",shipped:"#8B5CF6",delivered:"#10B981",cancelled:"#EF4444"
  };

  function print() {
    const w = window.open("","_blank","width=860,height=980");
    const rows = items.map((o,i)=>{
      const amt = +o.amount || (+o.quantity * (+o.rate||0));
      const col = STATUS_COLORS_PRINT[o.status]||"#6B7280";
      return `<tr>
        <td>${i+1}</td>
        <td>
          <strong>${o.product}</strong>
          ${o.notes?`<div style="font-size:11px;color:#9CA3AF;margin-top:2px">${o.notes}</div>`:""}
          <div style="font-size:11px;color:#9CA3AF;margin-top:2px;font-family:monospace">${o.orderId}</div>
        </td>
        <td style="text-align:center">${o.quantity}</td>
        <td style="text-align:right">${o.rate?fmt(o.rate):"—"}</td>
        <td style="text-align:right">${amt?fmt(amt):"—"}</td>
        <td style="text-align:center">
          <span style="background:${col}20;color:${col};padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap">${o.status}</span>
        </td>
      </tr>`;
    }).join("");

    w.document.write(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>Invoice – ${customerName} – ${invoiceNum}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  body{font-family:'Inter',Arial,sans-serif;background:#fff;color:#111;padding:0}
  .page{max-width:760px;margin:0 auto;padding:48px 40px;min-height:100vh;position:relative}

  /* Header */
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:48px}
  .brand-wrap{}
  .brand{font-size:26px;font-weight:700;color:#111;letter-spacing:-0.04em}
  .brand span{color:#1A56DB}
  .brand-tagline{font-size:12px;color:#9CA3AF;margin-top:3px;letter-spacing:.03em}
  .inv-meta{text-align:right}
  .inv-label-sm{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9CA3AF;font-weight:600;margin-bottom:4px}
  .inv-number{font-size:22px;font-weight:700;color:#111;letter-spacing:-0.02em}
  .inv-date{font-size:13px;color:#6B7280;margin-top:3px}

  /* Accent bar */
  .accent-bar{height:3px;background:linear-gradient(90deg,#1A56DB,#8B5CF6);border-radius:2px;margin-bottom:36px}

  /* Bill to */
  .bill-section{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:36px;padding:20px 24px;background:#F9FAFB;border-radius:10px;border:1px solid #F3F4F6}
  .bill-block .bill-title{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#9CA3AF;font-weight:600;margin-bottom:8px}
  .bill-block .bill-name{font-size:16px;font-weight:700;color:#111;margin-bottom:4px}
  .bill-block .bill-detail{font-size:13px;color:#6B7280}

  /* Summary chips */
  .summary-chips{display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap}
  .chip{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:500;border:1px solid}
  .chip-total{background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE}
  .chip-gst{background:#F5F3FF;color:#7C3AED;border-color:#DDD6FE}
  .chip-pending{background:#FFF7ED;color:#C2410C;border-color:#FED7AA}
  .chip-items{background:#F0FDF4;color:#166534;border-color:#BBF7D0}

  /* Table */
  .inv-table-wrap{border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;margin-bottom:0}
  table{width:100%;border-collapse:collapse}
  thead tr{background:linear-gradient(135deg,#1A56DB,#2563EB)}
  thead th{padding:11px 14px;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.85);font-weight:600;text-align:left}
  thead th:nth-child(3),thead th:nth-child(4),thead th:nth-child(5){text-align:right}
  thead th:nth-child(6){text-align:center}
  tbody tr{border-bottom:1px solid #F3F4F6}
  tbody tr:last-child{border-bottom:none}
  tbody tr:nth-child(even){background:#FAFAFA}
  tbody td{padding:13px 14px;font-size:13px;vertical-align:top}
  tbody td:nth-child(3){text-align:center;font-weight:600}
  tbody td:nth-child(4),tbody td:nth-child(5){text-align:right}
  tbody td:nth-child(6){text-align:center}
  .sn{color:#9CA3AF;font-size:12px}

  /* Totals */
  .totals-wrap{border:1px solid #E5E7EB;border-top:none;border-radius:0 0 10px 10px;overflow:hidden;margin-bottom:36px}
  .total-row{display:flex;justify-content:space-between;padding:10px 16px;font-size:13px;border-bottom:1px solid #F3F4F6;align-items:center}
  .total-row:last-child{border-bottom:none}
  .total-row.subtotal{color:#6B7280}
  .total-row.gst{color:#7C3AED;background:#F5F3FF}
  .total-row.gross{background:linear-gradient(135deg,#1A56DB,#2563EB);color:#fff;font-weight:700;font-size:15px;padding:13px 16px}
  .total-row.received-row{color:#059669;background:#F0FDF4}
  .total-row.balance{background:${balanceDue===0?"linear-gradient(135deg,#059669,#10B981)":"linear-gradient(135deg,#D97706,#F59E0B)"};color:#fff;font-weight:700;font-size:16px;padding:14px 16px}
  .total-key{font-weight:500}

  /* Footer */
  .footer{margin-top:40px;padding-top:20px;border-top:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center}
  .footer-brand{font-size:13px;color:#9CA3AF}
  .footer-note{font-size:11px;color:#9CA3AF;text-align:right}

  /* Watermark for paid */
  ${items.every(o=>o.status==="delivered")?`.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:80px;font-weight:900;color:rgba(16,185,129,.07);pointer-events:none;letter-spacing:.1em;z-index:0}`:""}

  @media print{
    body{padding:0}
    .page{padding:32px 28px}
    .no-print{display:none!important}
    @page{size:A4;margin:0}
  }
</style></head><body>
<div class="page">
  ${items.every(o=>o.status==="delivered")?'<div class="watermark">FULFILLED</div>':""}
  <div class="header">
    <div class="brand-wrap">
      <div class="brand">Order<span>Flow</span> Pro</div>
      <div class="brand-tagline">Order Management System · Ajmer Industries</div>
    </div>
    <div class="inv-meta">
      <div class="inv-label-sm">Invoice</div>
      <div class="inv-number">${invoiceNum}</div>
      <div class="inv-date">Generated ${today}</div>
    </div>
  </div>

  <div class="accent-bar"></div>

  <div class="bill-section">
    <div class="bill-block">
      <div class="bill-title">Bill To</div>
      <div class="bill-name">${customerName}</div>
      <div class="bill-detail">${items.length} order${items.length>1?"s":""} · ${items.map(o=>o.product).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}</div>
    </div>
    <div class="bill-block" style="text-align:right">
      <div class="bill-title">Invoice Details</div>
      <div class="bill-detail">Date: <strong>${today}</strong></div>
      <div class="bill-detail" style="margin-top:4px">Orders: <strong>${items.length}</strong></div>
      ${items[0]?.createdAt?`<div class="bill-detail" style="margin-top:4px">First order: <strong>${new Date(items[0].createdAt).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</strong></div>`:""}
    </div>
  </div>

  <div class="summary-chips">
    <div class="chip chip-items">📦 ${items.length} item${items.length>1?"s":""}</div>
    <div class="chip chip-total">Total: ${fmt(total)}</div>
    ${totalReceived>0?`<div class="chip chip-received" style="background:#F0FDF4;color:#166534;border:1px solid #BBF7D0">✓ Received: ${fmt(totalReceived)}</div>`:""}
    ${balanceDue>0?`<div class="chip chip-pending">⏳ Balance Due: ${fmt(balanceDue)}</div>`:`<div class="chip" style="background:#F0FDF4;color:#166534;border:1px solid #BBF7D0">✅ Fully Paid</div>`}
  </div>

  <div class="inv-table-wrap">
    <table>
      <thead><tr>
        <th style="width:36px">#</th>
        <th>Product / Description</th>
        <th style="width:60px">Qty</th>
        <th style="width:90px">Rate</th>
        <th style="width:100px">Amount</th>
        <th style="width:90px">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div class="totals-wrap">
    <div class="total-row subtotal"><span class="total-key">Subtotal</span><span>${fmt(subtotal)}</span></div>
    <div class="total-row gst"><span class="total-key">GST @ 18%</span><span>${fmt(gst)}</span></div>
    <div class="total-row gross"><span class="total-key">Gross Total</span><span>${fmt(total)}</span></div>
    ${totalReceived>0?`<div class="total-row received-row"><span class="total-key">Less: Amount Received</span><span>− ${fmt(totalReceived)}</span></div>`:""}
    <div class="total-row balance"><span class="total-key">${balanceDue===0?"✓ Fully Paid":"Balance Due"}</span><span>${balanceDue===0?"Nil":fmt(balanceDue)}</span></div>
  </div>

  <div class="footer">
    <div class="footer-brand">OrderFlow Pro · Automated Invoice · ${new Date().toLocaleString("en-IN")}</div>
    <div class="footer-note">This is a computer-generated invoice.<br>No signature required.</div>
  </div>

  <div class="no-print" style="margin-top:32px;text-align:center">
    <button onclick="window.print()" style="padding:12px 32px;background:linear-gradient(135deg,#1A56DB,#2563EB);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;letter-spacing:.02em">
      🖨️ Print / Save as PDF
    </button>
    <button onclick="window.close()" style="margin-left:12px;padding:12px 24px;background:#F3F4F6;color:#374151;border:none;border-radius:8px;font-size:14px;cursor:pointer">
      Close
    </button>
  </div>
</div>
</body></html>`);
    w.document.close();
    setTimeout(()=>w.print(),600);
  }

  // Preview in modal
  const previewItems = items.slice(0,5); // show first 5 in preview
  const moreThan5 = items.length > 5;

  return (
    <Overlay onClose={onClose}>
      <div className="modal invoice-preview">
        <ModalHeader title={`Invoice — ${customerName}`} onClose={onClose}/>
        <div className="inv-body">
          {/* Header */}
          <div className="inv-top">
            <div><span className="inv-brand">OrderFlow Pro</span><div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>Ajmer Industries</div></div>
            <div className="inv-meta-right">
              <div className="inv-num">{invoiceNum}</div>
              <div className="inv-date">{today}</div>
            </div>
          </div>

          {/* Bill to */}
          <div className="inv-bill-row">
            <div>
              <div className="inv-label">Bill To</div>
              <strong style={{fontSize:15}}>{customerName}</strong>
              <div style={{fontSize:12,color:"var(--muted)",marginTop:2}}>{items.length} order{items.length>1?"s":""}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div className="inv-label">Summary</div>
              <strong>{fmt(total)}</strong>
              <div style={{fontSize:11,color:"var(--muted)",marginTop:2}}>incl. 18% GST</div>
              {totalReceived>0&&<div style={{fontSize:12,color:"#10B981",fontWeight:600,marginTop:4}}>Received: {fmt(totalReceived)}</div>}
              <div style={{fontSize:13,fontWeight:700,color:balanceDue===0?"#10B981":"#F59E0B",marginTop:2}}>
                {balanceDue===0?"✓ Fully Paid":"Due: "+fmt(balanceDue)}
              </div>
            </div>
          </div>

          {/* Items table */}
          <table className="inv-table">
            <thead><tr>
              <th>Product</th>
              <th style={{textAlign:"center"}}>Qty</th>
              <th style={{textAlign:"right"}}>Rate</th>
              <th style={{textAlign:"right"}}>Amount</th>
              <th>Status</th>
            </tr></thead>
            <tbody>
              {previewItems.map((o,i)=>{
                const amt = +o.amount || (+o.quantity*(+o.rate||0));
                return (
                  <tr key={o.orderId}>
                    <td>
                      <strong>{o.product}</strong>
                      <div style={{fontSize:11,color:"var(--muted)",fontFamily:"monospace"}}>{o.orderId}</div>
                    </td>
                    <td style={{textAlign:"center"}}>{o.quantity}</td>
                    <td style={{textAlign:"right"}}>{o.rate?fmt(o.rate):"—"}</td>
                    <td style={{textAlign:"right"}}><strong>{amt?fmt(amt):"—"}</strong></td>
                    <td><StatusBadge status={o.status}/></td>
                  </tr>
                );
              })}
              {moreThan5 && (
                <tr><td colSpan={5} style={{textAlign:"center",color:"var(--muted)",fontSize:12,padding:"8px 0"}}>
                  + {items.length - 5} more items in full invoice
                </td></tr>
              )}
            </tbody>
          </table>

          {/* Totals */}
          <div className="inv-totals">
            <div className="inv-total-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
            <div className="inv-total-row"><span>GST 18%</span><span>{fmt(gst)}</span></div>
            <div className="inv-total-row" style={{fontWeight:700}}><span>Gross Total</span><span>{fmt(total)}</span></div>
            {totalReceived>0&&(
              <div className="inv-total-row" style={{color:"#059669",background:"#F0FDF4"}}>
                <span>Less: Amount Received</span><span>− {fmt(totalReceived)}</span>
              </div>
            )}
            <div className="inv-total-row grand">
              <span>{balanceDue===0?"✓ Fully Paid":"Balance Due"}</span>
              <span>{balanceDue===0?"Nil":fmt(balanceDue)}</span>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={print}>🖨️ Print / Save PDF</button>
        </div>
      </div>
    </Overlay>
  );
}


// ── Bulk Modal ────────────────────────────────────────────────────
function BulkModal({ count, onStatus, onDelete, onClose }) {
  const [status, setStatus] = useState("confirmed");
  return (
    <Overlay onClose={onClose}>
      <div className="modal" style={{maxWidth:360}}>
        <ModalHeader title={`Bulk action — ${count} orders`} onClose={onClose}/>
        <div className="field"><label>Set status to</label>
          <select value={status} onChange={e=>setStatus(e.target.value)}>
            {STATUSES.slice(1).map(s=><option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="modal-actions">
          <button className="btn danger" onClick={onDelete}>Cancel all</button>
          <button className="btn primary" onClick={()=>onStatus(status)}>Apply to {count} orders</button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Activity Log Page ─────────────────────────────────────────────
function ActivityPage() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(()=>{
    api.list({pageSize:500}).then(res=>{
      const orders = Array.isArray(res.orders)?res.orders:[];
      const all = [];
      orders.forEach(o=>{
        (o.statusHistory||[]).forEach(h=>{
          all.push({ orderId:o.orderId, customerName:o.customerName, product:o.product, status:h.status, timestamp:h.timestamp, note:h.note, by: h.by || "" });
        });
      });
      all.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
      setEvents(all);
    }).finally(()=>setLoading(false));
  },[]);

  const filtered = search ? events.filter(e=>
    (e.customerName||"").toLowerCase().includes(search.toLowerCase())||
    (e.orderId||"").toLowerCase().includes(search.toLowerCase())||
    (e.product||"").toLowerCase().includes(search.toLowerCase())
  ) : events;

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Activity Log</h1>
          <p className="page-sub">{filtered.length} status changes across all orders</p></div>
      </div>
      <div className="toolbar" style={{marginBottom:16}}>
        <input className="search-input" placeholder="Filter by customer, order, product…" onChange={e=>setSearch(e.target.value)}/>
      </div>
      {loading?(
        <div className="center"><div className="spinner"/></div>
      ):filtered.length===0?(
        <div className="center empty"><p className="empty-icon">🕐</p><p>No activity yet.</p></div>
      ):(
        <div className="timeline">
          {filtered.map((ev,i)=>{
            const m = STATUS_META[ev.status]||{dot:"#999",color:"#555"};
            const ts = ev.timestamp ? new Date(ev.timestamp) : null;
            return (
              <div className="tl-item" key={i}>
                <div className="tl-dot" style={{background:m.dot}}/>
                <div className="tl-line"/>
                <div className="tl-content">
                  <div className="tl-header">
                    <StatusBadge status={ev.status}/>
                    <span className="tl-order">{ev.orderId}</span>
                    <span className="tl-time muted">{ts?ts.toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—"}</span>
                  </div>
                  <div className="tl-body">
                    <strong>{ev.customerName}</strong> — {ev.product}
                    {ev.note&&<span className="tl-note"> · {ev.note}</span>}
                    {ev.by&&<span className="tl-by"> · by {ev.by}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Analytics Page ────────────────────────────────────────────────
function AnalyticsPage() {
  const [data, setData]   = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    Promise.all([api.analytics(6),api.stats()]).then(([a,s])=>{setData(a);setStats(s);}).finally(()=>setLoading(false));
  },[]);
  if(loading) return <div className="page"><div className="center"><div className="spinner"/></div></div>;
  const maxCount = data?.monthly?.length?Math.max(...data.monthly.map(m=>m.count),1):1;
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">Analytics</h1></div>
      <div className="analytics-grid">
        <div className="card">
          <h3 className="card-title">Orders per month</h3>
          <div className="bar-chart">
            {(data?.monthly||[]).map(m=>(
              <div className="bar-col" key={m.month}>
                <div className="bar" style={{height:`${(m.count/maxCount)*120}px`}}>
                  <span className="bar-val">{m.count}</span>
                </div>
                <div className="bar-label">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Conversion funnel</h3>
          <div className="funnel">
            {(data?.funnel||[]).map(f=>(
              <div className="funnel-row" key={f.stage}>
                <span className="funnel-label">{f.stage}</span>
                <div className="funnel-bar-wrap"><div className="funnel-bar" style={{width:`${f.pct}%`}}/></div>
                <span className="funnel-pct">{f.pct}%</span>
                <span className="funnel-count">({f.count})</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Top customers</h3>
          {(data?.topCustomers||[]).length===0
            ?<p className="muted" style={{marginTop:12}}>No data yet.</p>
            :(data?.topCustomers||[]).map((c,i)=>(
              <div className="top-row" key={c.name}>
                <span className="top-rank">#{i+1}</span>
                <span className="top-name">{c.name}</span>
                <span className="top-val">{c.orders} orders</span>
              </div>
            ))
          }
        </div>
        <div className="card">
          <h3 className="card-title">Status breakdown</h3>
          {stats&&Object.entries(stats.counts||{}).filter(([k])=>k!=="total").map(([k,v])=>(
            <div className="top-row" key={k}><StatusBadge status={k}/><span className="top-val">{v}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Master Data Page ──────────────────────────────────────────────
function MasterPage({ type, showToast, user }) {
  const isAdmin = user?.role==="admin";
  const isCust  = type==="customers";
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [mobile, setMobile] = useState("");
  const [rate, setRate]     = useState("");
  const [err, setErr]       = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    try{ setItems(Array.isArray(isCust?await api.getCustomers():await api.getProducts())?isCust?await api.getCustomers():await api.getProducts():[]); }
    finally{ setLoading(false); }
  },[isCust]);

  // cleaner load
  const doLoad = useCallback(async()=>{
    setLoading(true);
    try{ const res = isCust?await api.getCustomers():await api.getProducts(); setItems(Array.isArray(res)?res:[]); }
    finally{ setLoading(false); }
  },[isCust]);
  useEffect(()=>{ doLoad(); },[doLoad]);

  async function add(){
    if(!name.trim()) return setErr(`${isCust?"Customer":"Product"} name is required`);
    setSaving(true); setErr("");
    try{
      if(isCust) await api.addCustomer({name,email,mobile});
      else       await api.addProduct({name,rate});
      setName("");setEmail("");setMobile("");setRate("");
      showToast(`${isCust?"Customer":"Product"} added ✓`); doLoad();
    }catch(e){setErr(e.message);}finally{setSaving(false);}
  }
  async function remove(rowIndex){
    try{ isCust?await api.deleteCustomer(rowIndex):await api.deleteProduct(rowIndex); showToast("Deleted"); doLoad(); }
    catch(e){showToast(e.message,"error");}
  }
  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">{isCust?"Customers":"Products"}</h1></div>
      {isAdmin&&(
        <div className="card" style={{marginBottom:20}}>
          <h3 className="card-title">Add {isCust?"customer":"product"}</h3>
          <div className="field-row" style={{marginTop:12}}>
            <div className="field"><label>{isCust?"Customer name":"Product name"} *</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder={isCust?"Acme Corp":"Widget Pro"} autoFocus/></div>
            {isCust&&<>
              <div className="field"><label>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></div>
              <div className="field"><label>Mobile</label><input value={mobile} onChange={e=>setMobile(e.target.value)}/></div>
            </>}
            {!isCust&&<div className="field"><label>Default rate (₹)</label>
              <input type="number" value={rate} onChange={e=>setRate(e.target.value)} placeholder="0.00"/></div>}
          </div>
          {err&&<div className="banner error" style={{marginTop:8}}>{err}</div>}
          <button className="btn primary" style={{marginTop:12}} onClick={add} disabled={saving}>
            {saving?"Adding…":`Add ${isCust?"customer":"product"}`}</button>
        </div>
      )}
      <div className="table-wrap">
        {loading?<div className="center"><div className="spinner"/></div>
        :items.length===0?<div className="center empty"><p className="empty-icon">{isCust?"👥":"🏷️"}</p><p>No {isCust?"customers":"products"} yet.</p></div>
        :<table>
          <thead><tr>
            <th>{isCust?"Customer":"Product"}</th>
            {isCust&&<><th>Email</th><th>Mobile</th></>}
            {!isCust&&<th>Default Rate</th>}
            {isAdmin&&<th>Actions</th>}
          </tr></thead>
          <tbody>{items.map(item=>(
            <tr key={item.rowIndex}>
              <td><strong>{item.name}</strong></td>
              {isCust&&<><td className="muted">{item.email||"—"}</td><td className="muted">{item.mobile||"—"}</td></>}
              {!isCust&&<td className="muted">{item.rate?fmt(item.rate):"—"}</td>}
              {isAdmin&&<td><button className="btn xs danger" onClick={()=>remove(item.rowIndex)}>Delete</button></td>}
            </tr>
          ))}</tbody>
        </table>}
      </div>
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const m = STATUS_META[status]||{bg:"#eee",color:"#333",dot:"#999"};
  return <span className="badge" style={{background:m.bg,color:m.color}}><span className="badge-dot" style={{background:m.dot}}/>{status}</span>;
}
function Overlay({ children, onClose }) {
  return <div className="overlay" onClick={e=>e.target.className==="overlay"&&onClose()}>{children}</div>;
}
function ModalHeader({ title, onClose }) {
  return <div className="modal-header"><h2>{title}</h2><button className="btn-icon" onClick={onClose}>✕</button></div>;
}
function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }) {
  return (
    <Overlay onClose={onClose}>
      <div className="modal" style={{maxWidth:380,textAlign:"center"}}>
        <p style={{fontSize:40,marginBottom:12}}>⚠️</p>
        <h2>{title}</h2>
        <p className="muted" style={{margin:"10px 0 24px"}}>{message}</p>
        <div className="modal-actions" style={{justifyContent:"center"}}>
          <button className="btn" onClick={onClose}>Keep it</button>
          <button className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </Overlay>
  );
}
