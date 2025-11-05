import express from "express";
import { sql } from "../config/db.js";

const router = express.Router();

// =======================
// 🔐 Admin Middleware
// =======================
const requireAdmin = (req, res, next) => {
  const adminToken = req.headers["admin-token"];
  if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "Admin access required" });
  }
  next();
};

router.use(requireAdmin);

// =======================
// 🗄️ Database Setup Route
// =======================
router.post("/setup-database", async (req, res) => {
  try {
    // Create user_trials table
    await sql`
      CREATE TABLE IF NOT EXISTS user_trials (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        trial_start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trial_end_date TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create payment_submissions table
    await sql`
      CREATE TABLE IF NOT EXISTS payment_submissions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email VARCHAR(255),
        user_name VARCHAR(255),
        plan_id INTEGER,
        amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        transaction_code VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verified_at TIMESTAMP,
        verified_by VARCHAR(100),
        admin_notes TEXT,
        rejection_reason TEXT
      )
    `;

    // Create user_subscriptions table
    await sql`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_id INTEGER,
        status VARCHAR(20) DEFAULT 'active',
        start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_date TIMESTAMP,
        days_remaining INTEGER,
        trial_used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create subscription_plans table
    await sql`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        duration_days INTEGER NOT NULL,
        features JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    // Create default premium plan
    await sql`
      INSERT INTO subscription_plans (name, description, price, duration_days, features, is_active)
      VALUES (
        'Premium Plan',
        'Unlock all premium features including advanced analytics, unlimited products, and priority support',
        200.00,
        30,
        '["Advanced Analytics", "Unlimited Products", "Priority Support", "Data Export", "Custom Reports"]'::jsonb,
        true
      ) ON CONFLICT DO NOTHING
    `;

    res.json({
      message: "Database tables created successfully",
      tables: [
        "user_trials",
        "payment_submissions",
        "user_subscriptions",
        "subscription_plans",
      ],
    });
  } catch (error) {
    console.error("Error setting up database:", error);
    res.status(500).json({ error: "Failed to setup database" });
  }
});

// =======================
// 💳 Payment Management
// =======================

// Get all pending payments
router.get("/pending-payments", async (req, res) => {
  try {
    const payments = await sql`
      SELECT ps.*, sp.name as plan_name, sp.duration_days
      FROM payment_submissions ps
      LEFT JOIN subscription_plans sp ON ps.plan_id = sp.id
      WHERE ps.status = 'pending'
      ORDER BY ps.submitted_at DESC
    `;
    res.json(payments);
  } catch (error) {
    console.error("Error fetching pending payments:", error);
    res.status(500).json({ error: "Failed to fetch pending payments" });
  }
});

// Approve payment and activate subscription
router.post("/approve-payment/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { admin_notes } = req.body;

    const payment = await sql`
      SELECT * FROM payment_submissions 
      WHERE id = ${paymentId} AND status = 'pending'
    `;

    if (payment.length === 0)
      return res.status(404).json({ error: "Pending payment not found" });

    const paymentData = payment[0];
    const plan = await sql`
      SELECT duration_days FROM subscription_plans 
      WHERE id = ${paymentData.plan_id}
    `;
    const durationDays = plan[0]?.duration_days || 30;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + durationDays);

    // Update payment status
    await sql`
      UPDATE payment_submissions 
      SET 
        status = 'approved',
        verified_at = CURRENT_TIMESTAMP,
        verified_by = 'admin',
        admin_notes = ${admin_notes || ""}
      WHERE id = ${paymentId}
    `;

    // Deactivate any existing subscription
    await sql`
      UPDATE user_subscriptions 
      SET status = 'inactive'
      WHERE user_id = ${paymentData.user_id} AND status = 'active'
    `;

    // Create new subscription
    await sql`
      INSERT INTO user_subscriptions (
        user_id, plan_id, status, start_date, end_date, days_remaining
      ) VALUES (
        ${paymentData.user_id}, 
        ${paymentData.plan_id}, 
        'active',
        CURRENT_TIMESTAMP,
        ${endDate.toISOString()},
        ${durationDays}
      )
    `;

    res.json({
      message: "Payment approved and subscription activated successfully",
      payment_id: paymentId,
      user_id: paymentData.user_id,
      end_date: endDate,
    });
  } catch (error) {
    console.error("Error approving payment:", error);
    res
      .status(500)
      .json({ error: "Failed to approve payment: " + error.message });
  }
});

// Reject payment
router.post("/reject-payment/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason)
      return res.status(400).json({ error: "Rejection reason is required" });

    const result = await sql`
      UPDATE payment_submissions 
      SET 
        status = 'rejected',
        rejection_reason = ${rejection_reason},
        verified_at = CURRENT_TIMESTAMP,
        verified_by = 'admin'
      WHERE id = ${paymentId} AND status = 'pending'
      RETURNING *
    `;

    if (result.length === 0)
      return res.status(404).json({ error: "Pending payment not found" });

    res.json({
      message: "Payment rejected successfully",
      payment: result[0],
    });
  } catch (error) {
    console.error("Error rejecting payment:", error);
    res
      .status(500)
      .json({ error: "Failed to reject payment: " + error.message });
  }
});

// =======================
// 📦 Subscription Management
// =======================

// Get all subscriptions
router.get("/subscriptions", async (req, res) => {
  try {
    const subscriptions = await sql`
      SELECT 
        us.*, ps.user_email, ps.user_name,
        sp.name as plan_name, sp.price
      FROM user_subscriptions us
      LEFT JOIN payment_submissions ps ON us.user_id = ps.user_id AND ps.status = 'approved'
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      ORDER BY us.created_at DESC
    `;
    res.json(subscriptions);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ error: "Failed to fetch subscriptions" });
  }
});

// Cancel subscription
router.post("/cancel-subscription/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await sql`
      UPDATE user_subscriptions 
      SET status = 'cancelled', end_date = CURRENT_TIMESTAMP 
      WHERE user_id = ${userId} AND status = 'active'
      RETURNING *
    `;

    if (result.length === 0)
      return res.status(404).json({ error: "Active subscription not found" });

    res.json({
      message: "Subscription cancelled successfully",
      user_id: userId,
    });
  } catch (error) {
    console.error("Error cancelling subscription:", error);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// =======================
// 🪙 Subscription Plans
// =======================
router.get("/plans", async (req, res) => {
  try {
    const plans =
      await sql`SELECT * FROM subscription_plans ORDER BY price ASC`;
    res.json(plans);
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({ error: "Failed to fetch subscription plans" });
  }
});

router.post("/plans", async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      duration_days,
      features,
      is_active = true,
    } = req.body;

    if (!name || !price || !duration_days)
      return res
        .status(400)
        .json({ error: "Missing required fields: name, price, duration_days" });

    const plan = await sql`
      INSERT INTO subscription_plans (
        name, description, price, duration_days, features, is_active
      ) VALUES (
        ${name}, ${description}, ${price}, ${duration_days}, ${JSON.stringify(
      features || []
    )}, ${is_active}
      ) RETURNING *
    `;

    res.status(201).json({
      message: "Subscription plan created successfully",
      plan: plan[0],
    });
  } catch (error) {
    console.error("Error creating subscription plan:", error);
    res.status(500).json({ error: "Failed to create subscription plan" });
  }
});

// =======================
// 📊 Dashboard Stats
// =======================
router.get("/dashboard-stats", async (req, res) => {
  try {
    const [totalRevenue, activeSubscriptions, pendingPayments, recentPayments] =
      await Promise.all([
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM payment_submissions WHERE status = 'approved'`,
        sql`SELECT COUNT(*) as count FROM user_subscriptions WHERE status = 'active' AND end_date > CURRENT_TIMESTAMP`,
        sql`SELECT COUNT(*) as count FROM payment_submissions WHERE status = 'pending'`,
        sql`SELECT COUNT(*) as count FROM payment_submissions WHERE submitted_at >= CURRENT_DATE - INTERVAL '7 days'`,
      ]);

    res.json({
      total_revenue: parseFloat(totalRevenue[0].total) || 0,
      active_subscriptions: parseInt(activeSubscriptions[0].count) || 0,
      pending_payments: parseInt(pendingPayments[0].count) || 0,
      recent_payments: parseInt(recentPayments[0].count) || 0,
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
});

// =======================
// 🩺 Health Check
// =======================
router.get("/health", async (req, res) => {
  try {
    await sql`SELECT 1`;
    res.json({
      status: "healthy",
      service: "Admin Subscription API",
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      service: "Admin Subscription API",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: error.message,
    });
  }
});

export default router;
