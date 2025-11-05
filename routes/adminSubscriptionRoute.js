import express from "express";
import { sql } from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/bulletproofAuth.js";

const router = express.Router();

// Apply admin middleware to all routes
router.use(requireAuth);
router.use(requireAdmin);

/**
 * 🔧 ADMIN PAYMENT MANAGEMENT
 *
 * Features:
 * - View pending payments
 * - Approve payments (idempotent)
 * - Reject payments with reason
 * - Audit trail with admin IDs
 */

/**
 * Get all pending payments for admin review
 * GET /api/admin/subscription/payments/pending
 */
router.get("/payments/pending", async (req, res) => {
  try {
    const payments = await sql`
      SELECT 
        p.*,
        u.email as user_email,
        u.name as user_name
      FROM payments p
      LEFT JOIN users u ON p.clerk_user_id = u.clerk_user_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at DESC
    `;

    res.json({
      payments,
      count: payments.length,
    });
  } catch (error) {
    console.error("❌ Get pending payments error:", error);
    res.status(500).json({
      error: "Failed to get pending payments",
      message: error.message,
    });
  }
});

/**
 * Approve a payment (idempotent)
 * POST /api/admin/subscription/payments/:paymentId/approve
 */
router.post("/payments/:paymentId/approve", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { admin_id } = req;

    const payment = await sql`
      SELECT * FROM payments 
      WHERE id = ${paymentId} 
      FOR UPDATE
    `;

    if (payment.length === 0) {
      return res.status(404).json({
        error: "Payment not found",
        message: `Payment with ID ${paymentId} does not exist`,
      });
    }

    const paymentData = payment[0];

    // Idempotency check
    if (paymentData.status === "approved") {
      return res.json({
        success: true,
        message: "Payment already approved",
        payment_id: paymentId,
        user_id: paymentData.clerk_user_id,
      });
    }

    if (paymentData.status !== "pending") {
      return res.status(400).json({
        error: "Invalid payment status",
        message: `Cannot approve payment with status: ${paymentData.status}`,
      });
    }

    // Update payment status
    await sql`
      UPDATE payments 
      SET 
        status = 'approved',
        admin_id = ${admin_id},
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}
    `;

    // Create or update user with pro status
    await sql`
      INSERT INTO users (clerk_user_id, is_pro, pro_since, created_at)
      VALUES (${paymentData.clerk_user_id}, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (clerk_user_id) 
      DO UPDATE SET 
        is_pro = true,
        pro_since = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `;

    console.log(`✅ Payment ${paymentId} approved by admin ${admin_id}`);
    console.log(`🎉 User ${paymentData.clerk_user_id} upgraded to Pro`);

    res.json({
      success: true,
      message: "Payment approved and user upgraded to Pro",
      payment_id: paymentId,
      user_id: paymentData.clerk_user_id,
      approved_by: admin_id,
    });
  } catch (error) {
    console.error("❌ Payment approval error:", error);
    res.status(500).json({
      error: "Failed to approve payment",
      message: error.message,
    });
  }
});

/**
 * Reject a payment
 * POST /api/admin/subscription/payments/:paymentId/reject
 */
router.post("/payments/:paymentId/reject", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { admin_id } = req;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({
        error: "Rejection reason required",
        message: "Please provide a reason for rejection",
      });
    }

    const payment = await sql`
      SELECT * FROM payments 
      WHERE id = ${paymentId} 
      FOR UPDATE
    `;

    if (payment.length === 0) {
      return res.status(404).json({
        error: "Payment not found",
        message: `Payment with ID ${paymentId} does not exist`,
      });
    }

    const paymentData = payment[0];

    // Idempotency check
    if (paymentData.status === "rejected") {
      return res.json({
        success: true,
        message: "Payment already rejected",
        payment_id: paymentId,
      });
    }

    if (paymentData.status !== "pending") {
      return res.status(400).json({
        error: "Invalid payment status",
        message: `Cannot reject payment with status: ${paymentData.status}`,
      });
    }

    // Update payment status
    await sql`
      UPDATE payments 
      SET 
        status = 'rejected',
        admin_id = ${admin_id},
        rejection_reason = ${rejection_reason},
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${paymentId}
    `;

    console.log(`❌ Payment ${paymentId} rejected by admin ${admin_id}`);

    res.json({
      success: true,
      message: "Payment rejected successfully",
      payment_id: paymentId,
      rejected_by: admin_id,
      rejection_reason: rejection_reason,
    });
  } catch (error) {
    console.error("❌ Payment rejection error:", error);
    res.status(500).json({
      error: "Failed to reject payment",
      message: error.message,
    });
  }
});

/**
 * Get all payments with filtering
 * GET /api/admin/subscription/payments
 */
router.get("/payments", async (req, res) => {
  try {
    const { status, user_id } = req.query;

    let query = sql`
      SELECT 
        p.*,
        u.email as user_email,
        u.name as user_name,
        u.is_pro
      FROM payments p
      LEFT JOIN users u ON p.clerk_user_id = u.clerk_user_id
      WHERE 1=1
    `;

    if (status && status !== "all") {
      query = query.append(sql` AND p.status = ${status}`);
    }

    if (user_id) {
      query = query.append(sql` AND p.clerk_user_id = ${user_id}`);
    }

    query = query.append(sql` ORDER BY p.created_at DESC`);

    const payments = await query;

    res.json({
      payments,
      count: payments.length,
    });
  } catch (error) {
    console.error("❌ Get payments error:", error);
    res.status(500).json({
      error: "Failed to get payments",
      message: error.message,
    });
  }
});

/**
 * Get admin dashboard stats
 * GET /api/admin/subscription/stats
 */
router.get("/stats", async (req, res) => {
  try {
    const [totalRevenue, proUsers, pendingPayments, totalPayments] =
      await Promise.all([
        sql`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'approved'`,
        sql`SELECT COUNT(*) as count FROM users WHERE is_pro = true`,
        sql`SELECT COUNT(*) as count FROM payments WHERE status = 'pending'`,
        sql`SELECT COUNT(*) as count FROM payments WHERE status = 'approved'`,
      ]);

    res.json({
      total_revenue: parseFloat(totalRevenue[0].total) || 0,
      pro_users: parseInt(proUsers[0].count) || 0,
      pending_payments: parseInt(pendingPayments[0].count) || 0,
      total_payments: parseInt(totalPayments[0].count) || 0,
    });
  } catch (error) {
    console.error("❌ Get admin stats error:", error);
    res.status(500).json({
      error: "Failed to get admin statistics",
      message: error.message,
    });
  }
});

export default router;
