import express from "express";
import { sql } from "../config/db.js";
import { requireAuth, getUserId } from "../middleware/bulletproofAuth.js";
import { paymentRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * 🎯 SIMPLE ONE-TIME PAYMENT FLOW
 *
 * Flow:
 * 1. User submits payment with transaction ID
 * 2. System checks if user is already pro → prevents if true
 * 3. Admin verifies transaction ID and approves/rejects
 * 4. User gets pro status on approval
 */

// Apply auth middleware to all routes
router.use(requireAuth);
router.use(getUserId);

/**
 * Check if user is pro
 * GET /api/payment-flow/pro-status
 */
router.get("/pro-status", async (req, res) => {
  try {
    const { clerk_user_id } = req;

    const user = await sql`
      SELECT is_pro, pro_since FROM users WHERE clerk_user_id = ${clerk_user_id} LIMIT 1
    `;

    if (user.length === 0) {
      return res.json({
        isPro: false,
        proSince: null,
        message: "User is not Pro",
      });
    }

    const userData = user[0];
    res.json({
      isPro: userData.is_pro,
      proSince: userData.pro_since,
      message: userData.is_pro ? "User has Pro status" : "User is not Pro",
    });
  } catch (error) {
    console.error("❌ Pro status check error:", error);
    res.status(500).json({
      error: "Failed to check Pro status",
      message: error.message,
    });
  }
});

/**
 * Submit one-time payment with transaction ID
 * POST /api/payment-flow/submit-payment
 */
router.post("/submit-payment", paymentRateLimiter, async (req, res) => {
  try {
    const { clerk_user_id } = req;
    const { amount, transaction_id } = req.body;

    // Input validation
    if (!amount || !transaction_id) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Amount and transaction_id are required",
      });
    }

    // Check if user already has pro status
    const user = await sql`
      SELECT is_pro FROM users WHERE clerk_user_id = ${clerk_user_id} LIMIT 1
    `;

    if (user.length > 0 && user[0].is_pro) {
      return res.status(409).json({
        error: "User already has Pro status",
        message: "Pro users cannot submit new payments",
      });
    }

    // Check for existing pending payments
    const existingPending = await sql`
      SELECT id FROM payments 
      WHERE clerk_user_id = ${clerk_user_id} AND status = 'pending'
      LIMIT 1
    `;

    if (existingPending.length > 0) {
      return res.status(409).json({
        error: "Pending payment exists",
        message: "You already have a pending payment request",
      });
    }

    // Check if transaction ID already used
    const existingTransaction = await sql`
      SELECT id FROM payments WHERE transaction_id = ${transaction_id} LIMIT 1
    `;

    if (existingTransaction.length > 0) {
      return res.status(409).json({
        error: "Transaction ID already used",
        message: "This transaction ID has already been submitted",
      });
    }

    // Create payment record
    const payment = await sql`
      INSERT INTO payments (clerk_user_id, amount, transaction_id, status)
      VALUES (${clerk_user_id}, ${amount}, ${transaction_id}, 'pending')
      RETURNING *
    `;

    console.log(
      `💰 Payment submitted for user ${clerk_user_id}, Transaction: ${transaction_id}`
    );

    res.status(201).json({
      success: true,
      message: "Payment submitted successfully. Waiting for admin approval.",
      payment: {
        id: payment[0].id,
        amount: payment[0].amount,
        transaction_id: payment[0].transaction_id,
        status: payment[0].status,
        created_at: payment[0].created_at,
      },
    });
  } catch (error) {
    console.error("❌ Payment submission error:", error);
    res.status(500).json({
      error: "Failed to submit payment",
      message: error.message,
    });
  }
});

/**
 * Get user's payment history
 * GET /api/payment-flow/payment-history
 */
router.get("/payment-history", async (req, res) => {
  try {
    const { clerk_user_id } = req;

    const payments = await sql`
      SELECT 
        id,
        amount,
        transaction_id,
        status,
        rejection_reason,
        created_at,
        processed_at
      FROM payments 
      WHERE clerk_user_id = ${clerk_user_id}
      ORDER BY created_at DESC
    `;

    res.json({
      payments,
      count: payments.length,
    });
  } catch (error) {
    console.error("❌ Payment history error:", error);
    res.status(500).json({
      error: "Failed to fetch payment history",
      message: error.message,
    });
  }
});

export default router;
