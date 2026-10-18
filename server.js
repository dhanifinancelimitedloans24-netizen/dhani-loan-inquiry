

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "enquiries.json");
const sessions = new Map();
const COOKIE_NAME = "df_admin";

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, "[]");
}

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));

// Website homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Admin dashboard
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// Server health check
app.get("/health", (req, res) => {
  res.status(200).send("Dhani Finance server is running");
});

app.use(
  "/api/enquiry",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false
  })
);

function readEnquiries() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeEnquiries(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}

function getToken(req) {
  const cookies = (req.headers.cookie || "").split(";");
  const cookie = cookies
    .map(c => c.trim())
    .find(c => c.startsWith(COOKIE_NAME + "="));

  return cookie ? cookie.slice(COOKIE_NAME.length + 1) : "";
}

function adminAuth(req, res, next) {
  const token = getToken(req);
  const expires = sessions.get(token);

  if (token && expires && expires > Date.now()) {
    return next();
  }

  if (token) sessions.delete(token);

  return res.status(401).json({
    error: "Please log in as administrator."
  });
}

function emailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_TO
  );
}

async function sendEmail(item) {
  if (!emailConfigured()) return false;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: `"Dhani Finance Website" <${process.env.SMTP_USER}>`,
    to: process.env.EMAIL_TO,
    replyTo: item.email || undefined,
    subject: `New Loan Enquiry - ${item.reference}`,
    text: [
      "New customer loan enquiry received.",
      `Reference: ${item.reference}`,
      `Name: ${item.name}`,
      `Mobile: ${item.mobile}`,
      `Email: ${item.email || "Not provided"}`,
      `Loan type: ${item.loanType}`,
      `Loan amount: INR ${item.amount}`,
      `Employment: ${item.employment || "Not provided"}`,
      `Monthly income: ${item.income || "Not provided"}`,
      `City: ${item.city || "Not provided"}`,
      `State: ${item.state || "Not provided"}`,
      `Date: ${item.createdAt}`,
      "",
      "This is an enquiry only, not a loan approval."
    ].join("\n")
  });

  return true;
}

// Customer enquiry submission
app.post("/api/enquiry", async (req, res) => {
  const b = req.body || {};

  const name = String(b.name || "").trim().slice(0, 100);
  const mobile = String(b.mobile || "").replace(/\D/g, "");
  const email = String(b.email || "").trim().slice(0, 160);
  const loanType = String(b.loanType || "").trim();
  const amount = Number(b.amount);

  const allowedTypes = [
    "Personal Loan",
    "Business Loan",
    "Home Loan",
    "Education Loan",
    "Other"
  ];

  if (
    !name ||
    !/^\d{10}$/.test(mobile) ||
    !allowedTypes.includes(loanType) ||
    !Number.isFinite(amount) ||
    amount < 1000 ||
    amount > 100000000
  ) {
    return res.status(400).json({
      error: "Please enter a valid name, 10-digit mobile number, loan type and amount."
    });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Please enter a valid email address."
    });
  }

  const rows = readEnquiries();

  const item = {
    reference: "DF-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
    name,
    mobile,
    email,
    loanType,
    amount,
    employment: String(b.employment || "").slice(0, 40),
    income: String(b.income || "").slice(0, 40),
    city: String(b.city || "").trim().slice(0, 80),
    state: String(b.state || "").trim().slice(0, 80),
    status: "Pending",
    createdAt: new Date().toISOString()
  };

  rows.unshift(item);

  try {
    writeEnquiries(rows);
  } catch (error) {
    console.error("Saving enquiry failed:", error.message);
    return res.status(500).json({
      error: "Unable to save enquiry. Please try again."
    });
  }

  let emailSent = false;

  try {
    emailSent = await sendEmail(item);
  } catch (error) {
    console.error("Email delivery failed:", error.message);
  }

  return res.status(201).json({
    ok: true,
    reference: item.reference,
    status: item.status,
    message: emailSent
      ? "Enquiry submitted successfully. Notification email sent."
      : "Enquiry submitted, but email notification is not configured or could not be sent."
  });
});

// Check application status using reference number
app.get("/api/status/:reference", (req, res) => {
  const reference = String(req.params.reference || "").trim().toUpperCase();
  const item = readEnquiries().find(
    row => row.reference === reference
  );

  if (!item) {
    return res.status(404).json({
      error: "Reference number not found."
    });
  }

  return res.json({
    reference: item.reference,
    status: item.status,
    message: "Application status retrieved successfully."
  });
});

// Admin login
app.post("/api/admin/login", (req, res) => {
  const password = process.env.ADMIN_PASSWORD;

  if (!password || password.length < 12) {
    return res.status(503).json({
      error: "Set a unique ADMIN_PASSWORD of at least 12 characters in Render Environment Variables."
    });
  }

  const supplied = String((req.body || {}).password || "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(password);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({
      error: "Incorrect password."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + 8 * 60 * 60 * 1000);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800; Secure`
  );

  return res.json({ ok: true });
});

// Admin logout
app.post("/api/admin/logout", adminAuth, (req, res) => {
  sessions.delete(getToken(req));

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`
  );

  return res.json({ ok: true });
});

// View enquiries in admin dashboard
app.get("/api/admin/enquiries", adminAuth, (req, res) => {
  return res.json({ enquiries: readEnquiries() });
});

// Update enquiry status
app.patch("/api/admin/enquiries/:reference", adminAuth, (req, res) => {
  const allowed = ["Pending", "Under Review", "Approved", "Rejected"];
  const status = String((req.body || {}).status || "");

  if (!allowed.includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const rows = readEnquiries();
  const item = rows.find(
    row => row.reference === req.params.reference
  );

  if (!item) {
    return res.status(404).json({ error: "Enquiry not found." });
  }

  item.status = status;
  writeEnquiries(rows);

  return res.json({ ok: true, reference: item.reference, status });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dhani Finance server running on port ${PORT}`);
});
