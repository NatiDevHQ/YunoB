import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { initDB } from "./config/db.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

// Import routes
import adminSubscriptionRoute from "./routes/adminSubscriptionRoute.js";
import authRoute from "./routes/authRoute.js";
import paymentFlowRoute from "./routes/paymentFlow.js";

dotenv.config();
const app = express();

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting & JSON parsing
app.use(rateLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// JSON parsing error handler
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      error: "Invalid JSON",
      message: "The request contains invalid JSON",
    });
  }
  next(error);
});

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Serve static files from admin folder
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "Payment Pro API",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    features: {
      clerk_auth: true,
      payment_flow: true,
      pro_management: true,
      admin_dashboard: true,
    },
  });
});

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Payment Pro Backend Server",
    status: "Running",
    timestamp: new Date().toISOString(),
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      payment_flow: "/api/payment-flow",
      admin: "/api/admin/subscription",
      admin_dashboard: "/admin",
    },
  });
});

// API Routes
app.use("/api/auth", authRoute);
app.use("/api/payment-flow", paymentFlowRoute);
app.use("/api/admin/subscription", adminSubscriptionRoute);

// Serve admin dashboard - exact route
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// Catch-all route for admin SPA - use the correct Express wildcard pattern
app.get(["/admin/dashboard", "/admin/payments", "/admin/users"], (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// Database setup route
app.post("/api/setup-database", async (req, res) => {
  try {
    const { setup_key } = req.body;

    if (process.env.SETUP_KEY && setup_key !== process.env.SETUP_KEY) {
      return res.status(401).json({ error: "Invalid setup key" });
    }

    await initDB();
    res.json({ message: "Database initialized successfully" });
  } catch (error) {
    console.error("Database setup error:", error);
    res.status(500).json({ error: "Database setup failed: " + error.message });
  }
});

// 404 Handler for API routes
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found",
      path: req.originalUrl,
      method: req.method,
    });
  }

  // For non-API routes that don't match admin, show a simple 404
  if (!req.path.startsWith("/admin")) {
    return res.status(404).json({
      error: "Endpoint not found",
      message: "Available endpoints: /api/*, /admin",
    });
  }

  next();
});

// Error handler
app.use((err, req, res, next) => {
  console.error("🚨 Server Error:", err.message);

  const errorResponse = {
    error: "Internal server error",
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    errorResponse.message = err.message;
  }

  res.status(500).json(errorResponse);
});

// Server initialization
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  try {
    console.log("🔄 Initializing database...");
    await initDB();

    app.listen(PORT, () => {
      console.log("=".repeat(50));
      console.log("🚀 Payment Pro Server Started Successfully");
      console.log("=".repeat(50));
      console.log(`📡 PORT: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🔐 Clerk Auth: ${
          process.env.CLERK_SECRET_KEY ? "Enabled" : "Disabled"
        }`
      );
      console.log(`🏠 Local URL: http://localhost:${PORT}`);
      console.log(`👑 Admin Dashboard: http://localhost:${PORT}/admin`);
      console.log(`❤️ Health Check: http://localhost:${PORT}/api/health`);
      console.log("=".repeat(50));
      console.log("📊 Available Endpoints:");
      console.log("  • GET  /api/payment-flow/pro-status - Check Pro status");
      console.log("  • POST /api/payment-flow/submit-payment - Submit payment");
      console.log(
        "  • GET  /api/payment-flow/payment-history - Payment history"
      );
      console.log(
        "  • GET  /api/admin/subscription/payments/pending - Admin view"
      );
      console.log(
        "  • POST /api/admin/subscription/payments/:id/approve - Approve"
      );
      console.log(
        "  • POST /api/admin/subscription/payments/:id/reject - Reject"
      );
      console.log("=".repeat(50));
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

export default app;
