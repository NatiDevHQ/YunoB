import express from "express";
import { sql } from "../config/db.js";
import { requireAuth, getUserId } from "../middleware/bulletproofAuth.js";

const router = express.Router();

// Public routes
router.get("/plans", async (req, res) => {
  try {
    const plans = await sql`
      SELECT * FROM subscription_plans 
      WHERE is_active = true 
      ORDER BY price ASC
    `;
    res.json(plans);
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({ error: "Failed to fetch subscription plans" });
  }
});

// Protected routes
router.use(requireAuth);
router.use(getUserId);

// Check if user needs to see welcome modal
router.get("/onboarding-status", async (req, res) => {
  try {
    const { user_id } = req;

    const [existingTrial, existingSubscription] = await Promise.all([
      sql`SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1`,
      sql`SELECT * FROM user_subscriptions WHERE user_id = ${user_id} AND status = 'active' LIMIT 1`,
    ]);

    // User has active subscription
    if (existingSubscription.length > 0) {
      return res.json({ show_welcome: false, has_subscription: true });
    }

    // User has used trial before
    if (existingTrial.length > 0) {
      const trial = existingTrial[0];
      const trialEnd = new Date(trial.trial_end_date);
      const now = new Date();

      if (trialEnd > now && trial.is_active) {
        return res.json({
          show_welcome: false,
          has_trial: true,
          trial_active: true,
          trial_end_date: trial.trial_end_date,
        });
      }
      return res.json({
        show_welcome: false,
        has_trial: true,
        trial_active: false,
      });
    }

    // New user - show welcome modal
    res.json({
      show_welcome: true,
      has_trial: false,
      has_subscription: false,
    });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    res.status(500).json({ error: "Failed to check onboarding status" });
  }
});

// Start 7-day free trial
router.post("/start-trial", async (req, res) => {
  try {
    const { user_id } = req;

    const existingTrial = await sql`
      SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1
    `;

    if (existingTrial.length > 0) {
      return res.status(400).json({ error: "Trial already used" });
    }

    const trialStart = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);

    const trial = await sql`
      INSERT INTO user_trials (user_id, trial_start_date, trial_end_date, is_active)
      VALUES (${user_id}, ${trialStart}, ${trialEnd}, true)
      RETURNING *
    `;

    res.json({
      message: "7-day free trial started!",
      trial: trial[0],
      trial_end_date: trialEnd,
    });
  } catch (error) {
    console.error("Error starting trial:", error);
    res.status(500).json({ error: "Failed to start trial: " + error.message });
  }
});

// Skip trial and go to premium selection - FIXED VERSION
router.post("/skip-trial", async (req, res) => {
  try {
    const { user_id } = req;

    // Check if user already has a trial record
    const existingTrial = await sql`
      SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1
    `;

    const trialStart = new Date();
    const trialEnd = new Date(); // Set to current date since they skipped trial

    if (existingTrial.length > 0) {
      // Update existing trial to inactive with proper dates
      await sql`
        UPDATE user_trials 
        SET is_active = false, trial_start_date = ${trialStart}, trial_end_date = ${trialEnd}
        WHERE user_id = ${user_id}
      `;
    } else {
      // Create new inactive trial record with proper dates
      await sql`
        INSERT INTO user_trials (user_id, trial_start_date, trial_end_date, is_active)
        VALUES (${user_id}, ${trialStart}, ${trialEnd}, false)
      `;
    }

    res.json({
      message: "Trial skipped successfully",
      trial_skipped: true,
    });
  } catch (error) {
    console.error("Error skipping trial:", error);
    res.status(500).json({ error: "Failed to skip trial: " + error.message });
  }
});

// Get user's current subscription status
router.get("/my-subscription", async (req, res) => {
  try {
    const { user_id } = req;

    const [activeTrial, subscription] = await Promise.all([
      sql`
        SELECT * FROM user_trials 
        WHERE user_id = ${user_id} AND is_active = true AND trial_end_date > CURRENT_TIMESTAMP
        LIMIT 1
      `,
      sql`
        SELECT us.*, sp.name as plan_name, sp.price, sp.features,
          CASE 
            WHEN us.end_date > CURRENT_TIMESTAMP AND us.status = 'active' THEN 'active'
            WHEN us.end_date <= CURRENT_TIMESTAMP THEN 'expired'
            ELSE 'inactive'
          END as subscription_status
        FROM user_subscriptions us
        LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE us.user_id = ${user_id}
        ORDER BY us.created_at DESC
        LIMIT 1
      `,
    ]);

    if (activeTrial.length > 0) {
      const trial = activeTrial[0];
      const trialEnd = new Date(trial.trial_end_date);
      const daysLeft = Math.ceil(
        (trialEnd - new Date()) / (1000 * 60 * 60 * 24)
      );

      return res.json({
        status: "trial",
        trial_end_date: trial.trial_end_date,
        trial_days_left: daysLeft,
        is_trial_active: true,
        trial_duration: 7,
        message: `7-day free trial active - ${daysLeft} days left`,
      });
    }

    if (subscription.length > 0) {
      const sub = subscription[0];
      const isActive = sub.subscription_status === "active";
      const daysLeft = isActive
        ? Math.ceil(
            (new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24)
          )
        : 0;

      return res.json({
        ...sub,
        days_remaining: daysLeft,
        message: isActive
          ? `Premium active - ${daysLeft} days remaining`
          : "Subscription expired",
      });
    }

    // Check if user has used trial before
    const usedTrial = await sql`
      SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1
    `;

    res.json({
      status: "inactive",
      is_trial_available: usedTrial.length === 0,
      is_trial_used: usedTrial.length > 0,
      message:
        usedTrial.length > 0
          ? "Free trial used. Upgrade to premium."
          : "No active subscription",
    });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({ error: "Failed to fetch subscription" });
  }
});

// Submit payment for subscription - FIXED VERSION
router.post("/submit-payment", async (req, res) => {
  try {
    const { user_id } = req;
    const {
      plan_id,
      amount,
      payment_method,
      transaction_code,
      user_email,
      user_name,
    } = req.body;

    if (!plan_id || !amount || !payment_method || !transaction_code) {
      return res.status(400).json({
        error:
          "Missing required fields: plan_id, amount, payment_method, transaction_code",
      });
    }

    const plan = await sql`
      SELECT * FROM subscription_plans WHERE id = ${plan_id} AND is_active = true
    `;

    if (plan.length === 0) {
      return res.status(404).json({ error: "Subscription plan not found" });
    }

    // Convert to numbers for comparison
    const submittedAmount = parseFloat(amount);
    const planPrice = parseFloat(plan[0].price);

    if (submittedAmount !== planPrice) {
      return res.status(400).json({
        error: `Amount must be exactly ${planPrice} for this plan`,
      });
    }

    // Provide default values for user data to avoid null constraints
    const finalUserEmail = user_email || "user@example.com";
    const finalUserName = user_name || "User";

    // Submit payment
    const payment = await sql`
      INSERT INTO payment_submissions (
        user_id, user_email, user_name, plan_id, amount, payment_method, transaction_code, status
      ) VALUES (${user_id}, ${finalUserEmail}, ${finalUserName}, ${plan_id}, ${submittedAmount}, ${payment_method}, ${transaction_code}, 'pending')
      RETURNING *
    `;

    // Mark trial as used when user subscribes - FIXED VERSION
    const trialStart = new Date();
    const trialEnd = new Date();

    await sql`
      INSERT INTO user_trials (user_id, trial_start_date, trial_end_date, is_active) 
      VALUES (${user_id}, ${trialStart}, ${trialEnd}, false)
      ON CONFLICT (user_id) DO UPDATE SET 
        is_active = false,
        trial_start_date = COALESCE(user_trials.trial_start_date, ${trialStart}),
        trial_end_date = COALESCE(user_trials.trial_end_date, ${trialEnd})
    `;

    res.status(201).json({
      message: "Payment submitted successfully. Waiting for admin approval.",
      payment: payment[0],
    });
  } catch (error) {
    console.error("Error submitting payment:", error);
    res
      .status(500)
      .json({ error: "Failed to submit payment: " + error.message });
  }
});

// Get payment history
router.get("/payment-history", async (req, res) => {
  try {
    const { user_id } = req;

    const payments = await sql`
      SELECT ps.*, sp.name as plan_name
      FROM payment_submissions ps
      LEFT JOIN subscription_plans sp ON ps.plan_id = sp.id
      WHERE ps.user_id = ${user_id}
      ORDER BY ps.submitted_at DESC
    `;

    res.json(payments);
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({ error: "Failed to fetch payment history" });
  }
});

export default router;
