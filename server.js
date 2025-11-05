import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { initDB } from "./config/db.js";
import rateLimiter from "./middleware/rateLimiter.js";

// Import routes
import adminSubscriptionRoute from "./routes/adminSubscriptionRoute.js";
import authRoute from "./routes/authRoute.js";
import subscriptionRoute from "./routes/subscriptionRoute.js";

dotenv.config();
const app = express();

// Path setup for serving admin dashboard
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting & JSON parsing
app.use(rateLimiter);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================
   JSON Parsing Error Handler
   ========================= */
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      error: "Invalid JSON",
      message: "The request contains invalid JSON",
    });
  }
  next(error);
});

/* =========================
   Request Logger Middleware
   ========================= */
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

/* =========================
   Health Check
   ========================= */
app.get("/api/health", (req, res) => {
  const healthCheck = {
    status: "ok",
    service: "Yuno App API",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || "1.0.0",
  };

  res.status(200).json(healthCheck);
});

/* =========================
   Admin API Health Check
   ========================= */
app.get("/api/admin/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "Yuno App Admin API",
    timestamp: new Date().toISOString(),
    features: {
      subscription_management: true,
      payment_approval: true,
      user_management: true,
    },
  });
});

/* =========================
   Root Route
   ========================= */
app.get("/", (req, res) => {
  res.json({
    message: "Yuno App Backend Server",
    status: "Running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    endpoints: {
      health: "/api/health",
      admin_health: "/api/admin/health",
      admin_dashboard: "/admin",
      subscription: "/api/subscription",
      admin_subscription: "/api/admin/subscription",
    },
  });
});

/* =========================
   API Routes
   ========================= */
app.use("/api/auth", authRoute);
app.use("/api/subscription", subscriptionRoute);
app.use("/api/admin/subscription", adminSubscriptionRoute);

/* =========================
   Database Setup Route (Public for initial setup)
   ========================= */
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

/* =========================
   Serve Admin Dashboard
   ========================= */
app.use("/admin", express.static(path.join(__dirname, "admin")));

// Serve admin dashboard for specific routes only
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
});

// Specific admin dashboard routes
const adminRoutes = [
  "/admin/dashboard",
  "/admin/payments",
  "/admin/subscriptions",
  "/admin/settings",
];

adminRoutes.forEach((route) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, "admin", "dashboard.html"));
  });
});

/* =========================
   Simple 404 Handler
   ========================= */
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found",
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
      available_endpoints: [
        "/api/health",
        "/api/auth",
        "/api/subscription",
        "/api/admin/subscription",
      ],
    });
  }
  next();
});

/* =========================
   Error Handlers
   ========================= */

// Clerk Authentication Errors
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes("Unauthenticated")) {
    return res.status(401).json({
      error: "Authentication required",
      message: "Valid authentication token required",
      timestamp: new Date().toISOString(),
    });
  }
  next(err);
});

// General Error Handler
app.use((err, req, res, next) => {
  console.error("🚨 Server Error:", err.message);
  console.error("Stack:", err.stack);

  const errorResponse = {
    error: "Internal server error",
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === "development") {
    errorResponse.message = err.message;
    errorResponse.stack = err.stack;
  }

  res.status(500).json(errorResponse);
});

/* =========================
   Graceful Shutdown Handler
   ========================= */
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  // Give ongoing requests 10 seconds to complete
  setTimeout(() => {
    console.log("👋 Server shutdown complete");
    process.exit(0);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

/* =========================
   Initialize Database & Start Server
   ========================= */
const PORT = process.env.PORT || 5001;

const startServer = async () => {
  try {
    console.log("🔄 Initializing database...");
    await initDB();

    app.listen(PORT, () => {
      console.log("=".repeat(60));
      console.log("🚀 Yuno App Server Started Successfully");
      console.log("=".repeat(60));
      console.log(`📡 PORT: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🔐 Clerk Auth: ${
          process.env.CLERK_PUBLISHABLE_KEY ? "Enabled" : "Disabled"
        }`
      );
      console.log(
        `🛡️ Admin API: ${process.env.ADMIN_TOKEN ? "Enabled" : "Disabled"}`
      );
      console.log(`🏠 Local URL: http://localhost:${PORT}`);
      console.log(`👑 Admin Dashboard: http://localhost:${PORT}/admin`);
      console.log(`❤️ Health Check: http://localhost:${PORT}/api/health`);
      console.log("=".repeat(60));
      console.log("📊 Available Endpoints:");
      console.log("  • /api/health - Service health check");
      console.log("  • /api/auth - Authentication routes");
      console.log("  • /api/subscription - User subscription management");
      console.log(
        "  • /api/admin/subscription - Admin subscription management"
      );
      console.log("  • /admin - Admin dashboard");
      console.log("=".repeat(60));
    });
  } catch (error) {
    console.error("❌ Failed to start Yuno App server:", error);

    // Provide helpful error messages
    if (error.code === "ECONNREFUSED") {
      console.error("💡 Database connection failed. Please check:");
      console.error("   - Is PostgreSQL running?");
      console.error("   - Is DATABASE_URL set correctly in .env?");
      console.error("   - Does the database exist?");
    }

    process.exit(1);
  }
};

// Start the server
startServer();

export default app;
