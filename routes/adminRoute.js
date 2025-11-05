import express from "express";
import { sql } from "../config/db.js";

const router = express.Router();

// Middleware to check if user is admin (you can implement your own admin check)
const requireAdmin = (req, res, next) => {
  // Implement your admin verification logic here
  // This could be based on Clerk roles, a separate admin table, etc.
  const isAdmin = true; // Temporary - replace with actual admin check
  if (!isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// Get all pending payments for admin
router.get("/payments/pending", requireAdmin, async (req, res) => {
  try {
    const payments = await sql`
      SELECT 
        ps.*,
        sp.name as plan_name
      FROM payment_submissions ps
      LEFT JOIN subscription_plans sp ON ps.plan_id = sp.id
      WHERE ps.status = 'pending'
      ORDER BY ps.submitted_at DESC
    `;

    res.json({ payments });
  } catch (error) {
    console.error("Get pending payments error:", error);
    res.status(500).json({ error: "Failed to get pending payments" });
  }
});

// Get all payments with filtering
router.get("/payments", requireAdmin, async (req, res) => {
  try {
    const { status, method } = req.query;

    let query = sql`
      SELECT 
        ps.*,
        sp.name as plan_name
      FROM payment_submissions ps
      LEFT JOIN subscription_plans sp ON ps.plan_id = sp.id
      WHERE 1=1
    `;

    if (status && status !== "all") {
      query = query.append(sql` AND ps.status = ${status}`);
    }

    if (method && method !== "all") {
      query = query.append(sql` AND ps.payment_method = ${method}`);
    }

    query = query.append(sql` ORDER BY ps.submitted_at DESC`);

    const payments = await query;

    res.json({ payments });
  } catch (error) {
    console.error("Get payments error:", error);
    res.status(500).json({ error: "Failed to get payments" });
  }
});

// Verify a payment
router.post("/payments/:id/verify", requireAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const adminId = "system_admin"; // Replace with actual admin ID from auth

    // Get payment details
    const payment = await sql`
      SELECT * FROM payment_submissions WHERE id = ${paymentId}
    `;

    if (payment.length === 0) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const pay = payment[0];

    if (pay.status !== "pending") {
      return res.status(400).json({ error: "Payment already processed" });
    }

    // Update payment status
    await sql`
      UPDATE payment_submissions 
      SET status = 'verified',
          verified_at = CURRENT_TIMESTAMP,
          verified_by = ${adminId}
      WHERE id = ${paymentId}
    `;

    // Create or extend user subscription
    const plan = await sql`
      SELECT * FROM subscription_plans WHERE id = ${pay.plan_id}
    `;

    if (plan.length > 0) {
      const planData = plan[0];
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + planData.duration_days);

      // Check if user already has a subscription
      const existingSub = await sql`
        SELECT * FROM user_subscriptions 
        WHERE user_id = ${pay.user_id} 
        ORDER BY created_at DESC 
        LIMIT 1
      `;

      if (existingSub.length > 0) {
        // Extend existing subscription
        await sql`
          UPDATE user_subscriptions 
          SET end_date = ${endDate.toISOString()},
              status = 'active',
              is_frozen = false,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${existingSub[0].id}
        `;
      } else {
        // Create new subscription
        await sql`
          INSERT INTO user_subscriptions (
            user_id, plan_id, status, end_date, days_remaining
          ) VALUES (
            ${pay.user_id}, ${pay.plan_id}, 'active', 
            ${endDate.toISOString()}, ${planData.duration_days}
          )
        `;
      }
    }

    res.json({
      success: true,
      message: "Payment verified and subscription activated",
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

// Reject a payment
router.post("/payments/:id/reject", requireAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    // Update payment status
    await sql`
      UPDATE payment_submissions 
      SET status = 'rejected',
          rejection_reason = ${reason},
          verified_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}
    `;

    res.json({
      success: true,
      message: "Payment rejected successfully",
    });
  } catch (error) {
    console.error("Reject payment error:", error);
    res.status(500).json({ error: "Failed to reject payment" });
  }
});

// Get dashboard stats for admin
router.get("/stats", requireAdmin, async (req, res) => {
  try {
    const totalRevenue = await sql`
      SELECT COALESCE(SUM(amount), 0) as total 
      FROM payment_submissions 
      WHERE status = 'verified'
    `;

    const activeSubscriptions = await sql`
      SELECT COUNT(*) as count 
      FROM user_subscriptions 
      WHERE status = 'active' AND is_frozen = false
    `;

    const pendingPayments = await sql`
      SELECT COUNT(*) as count 
      FROM payment_submissions 
      WHERE status = 'pending'
    `;

    const verifiedToday = await sql`
      SELECT COUNT(*) as count 
      FROM payment_submissions 
      WHERE status = 'verified' 
      AND DATE(verified_at) = CURRENT_DATE
    `;

    res.json({
      total_revenue: parseFloat(totalRevenue[0].total) || 0,
      active_subscriptions: parseInt(activeSubscriptions[0].count) || 0,
      pending_payments: parseInt(pendingPayments[0].count) || 0,
      verified_today: parseInt(verifiedToday[0].count) || 0,
    });
  } catch (error) {
    console.error("Get admin stats error:", error);
    res.status(500).json({ error: "Failed to get admin statistics" });
  }
});

export default router;
