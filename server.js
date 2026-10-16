require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "enquiries.json");
const SESSION_COOKIE = "df_admin";
const sessions = new Map();

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", { mode: 0o600 });

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/enquiry", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false }));

function readEnquiries() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return []; }
}
function writeEnquiries(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2), { mode: 0o600 });
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function adminAuth(req, res, next) {
  const token = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + "="))?.split("=").slice(1).join("=");
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: "Please log in as administrator." });
}
function mailerConfigured() {
  return process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_TO;
}
async function sendEnquiryEmail(item) {
  if (!mailerConfigured()) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: `"Dhani Finance Website" <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_TO,
    replyTo: item.email || undefined,
    subject: `New loan enquiry — ${item.reference}`,
    text: [
      "A new loan enquiry was submitted.",
      `Reference: ${item.reference}`,
      `Name: ${item.name}`,
      `Mobile: ${item.mobile}`,
      `Email: ${item.email || "Not provided"}`,
      `Loan type: ${item.loanType}`,
      `Requested amount: ₹${item.amount}`,
      `Employment: ${item.employment || "Not provided"}`,
      `Monthly income: ${item.income || "Not provided"}`,
      `Location: ${item.city || ""}${item.city && item.state ? ", " : ""}${item.state || ""}`,
      `Submitted at: ${item.createdAt}`,
      "",
      "This is an enquiry only and is not a loan approval or offer."
    ].join("\n")
  });
  return true;
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.post("/api/enquiry", async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 100);
  const mobile = String(b.mobile || "").replace(/\D/g, "").slice(0, 10);
  const email = String(b.email || "").trim().slice(0, 160);
  const loanType = String(b.loanType || "").trim().slice(0, 40);
  const amount = Number(b.amount);
  if (!name || !/^\d{10}$/.test(mobile) || !["Personal Loan", "Business Loan", "Home Loan", "Education Loan", "Other"].includes(loanType) || !Number.isFinite(amount) || amount < 1000 || amount > 100000000) {
    return res.status(400).json({ error: "Please check your name, 10-digit mobile number, loan type and amount (₹1,000 to ₹10 crore)." });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Please enter a valid email address." });
  const item = {
    reference: "DF-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    name, mobile, email, loanType, amount,
    employment: String(b.employment || "").slice(0, 40),
    income: String(b.income || "").slice(0, 40),
    city: String(b.city || "").trim().slice(0, 80),
    state: String(b.state || "").trim().slice(0, 80),
    status: "Pending",
    createdAt: new Date().toISOString()
  };
  const rows = readEnquiries();
  rows.unshift(item);
  writeEnquiries(rows);
  let emailSent = false;
  try { emailSent = await sendEnquiryEmail(item); }
  catch (err) { console.error("Email delivery failed:", err.message); }
  res.status(201).json({
    ok: true, reference: item.reference,
    message: emailSent
      ? "Your enquiry was submitted and the notification email was sent."
      : "Your enquiry was saved, but email delivery is not configured yet. Please try again later or contact the website administrator."
  });
});

app.post("/api/admin/login", (req, res) => {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured || configured.length < 12) return res.status(503).json({ error: "Admin password is not configured securely. Set ADMIN_PASSWORD to a unique password of at least 12 characters." });
  const supplied = String((req.body || {}).password || "");
  const a = Buffer.from(supplied), b = Buffer.from(configured);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: "Incorrect password." });
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.post("/api/admin/logout", adminAuth, (req, res) => {
  const token = (req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith(SESSION_COOKIE + "="))?.split("=").slice(1).join("=");
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ ok: true });
});
app.get("/api/admin/enquiries", adminAuth, (req, res) => {
  res.json({ enquiries: readEnquiries() });
});
app.patch("/api/admin/enquiries/:reference", adminAuth, (req, res) => {
  const allowed = ["Pending", "Under Review", "Approved", "Rejected"];
  const status = String((req.body || {}).status || "");
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status." });
  const rows = readEnquiries();
  const row = rows.find(x => x.reference === req.params.reference);
  if (!row) return res.status(404).json({ error: "Enquiry not found." });
  row.status = status;
  writeEnquiries(rows);
  res.json({ ok: true });
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Dhani Finance enquiry app listening on ${PORT}`));
