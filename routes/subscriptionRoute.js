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
    res.json({
      service: "Yuno App Subscription API",
      plans,
    });
  } catch (error) {
    console.error("Error fetching subscription plans:", error);
    res.status(500).json({
      error: "Failed to fetch subscription plans",
      service: "Yuno App Subscription API",
    });
  }
});

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "Yuno App Subscription API",
    timestamp: new Date().toISOString(),
    features: {
      subscription_management: true,
      trial_system: true,
      payment_processing: true,
    },
  });
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
      sql`SELECT * FROM user_subscriptions WHERE user_id = ${user_id} AND status = 'active' AND end_date > CURRENT_TIMESTAMP LIMIT 1`,
    ]);

    // User has active 5-month subscription = PRO user
    if (existingSubscription.length > 0) {
      return res.json({
        show_welcome: false,
        has_subscription: true,
        isPro: true,
        service: "Yuno App Subscription API",
      });
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
          isPro: false,
          trial_end_date: trial.trial_end_date,
          service: "Yuno App Subscription API",
        });
      }
      return res.json({
        show_welcome: false,
        has_trial: true,
        trial_active: false,
        isPro: false,
        service: "Yuno App Subscription API",
      });
    }

    // New user - show welcome modal
    res.json({
      show_welcome: true,
      has_trial: false,
      has_subscription: false,
      isPro: false,
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    res.status(500).json({
      error: "Failed to check onboarding status",
      service: "Yuno App Subscription API",
    });
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
      return res.status(400).json({
        error: "Trial already used",
        service: "Yuno App Subscription API",
      });
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
      isPro: false,
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error starting trial:", error);
    res.status(500).json({
      error: "Failed to start trial: " + error.message,
      service: "Yuno App Subscription API",
    });
  }
});

// Skip trial and go to premium selection
router.post("/skip-trial", async (req, res) => {
  try {
    const { user_id } = req;

    // Check if user already has a trial record
    const existingTrial = await sql`
      SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1
    `;

    const trialStart = new Date();
    const trialEnd = new Date();

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
      isPro: false,
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error skipping trial:", error);
    res.status(500).json({
      error: "Failed to skip trial: " + error.message,
      service: "Yuno App Subscription API",
    });
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

    // User has active 5-month subscription = PRO user
    if (
      subscription.length > 0 &&
      subscription[0].subscription_status === "active"
    ) {
      const sub = subscription[0];
      const daysLeft = Math.ceil(
        (new Date(sub.end_date) - new Date()) / (1000 * 60 * 60 * 24)
      );
      const monthsLeft = Math.ceil(daysLeft / 30);

      return res.json({
        ...sub,
        days_remaining: daysLeft,
        months_remaining: monthsLeft,
        isPro: true,
        status: "pro",
        message: `5-month subscription active - ${monthsLeft} months remaining`,
        service: "Yuno App Subscription API",
      });
    }

    // User has active trial = NOT PRO (still needs to upgrade)
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
        isPro: false,
        trial_duration: 7,
        message: `7-day free trial active - ${daysLeft} days left`,
        service: "Yuno App Subscription API",
      });
    }

    // Check if user has used trial before
    const usedTrial = await sql`
      SELECT * FROM user_trials WHERE user_id = ${user_id} LIMIT 1
    `;

    // Check if user had subscription that expired
    const expiredSubscription = await sql`
      SELECT * FROM user_subscriptions 
      WHERE user_id = ${user_id} AND end_date <= CURRENT_TIMESTAMP
      ORDER BY end_date DESC LIMIT 1
    `;

    let message = "No active subscription";
    if (usedTrial.length > 0) {
      message = "Free trial used. Purchase 5-month subscription.";
    } else if (expiredSubscription.length > 0) {
      message = "5-month subscription expired. Purchase again.";
    }

    // No subscription, no active trial = NOT PRO
    res.json({
      status: "inactive",
      is_trial_available: usedTrial.length === 0,
      is_trial_used: usedTrial.length > 0,
      had_subscription: expiredSubscription.length > 0,
      isPro: false,
      message: message,
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({
      error: "Failed to fetch subscription",
      service: "Yuno App Subscription API",
    });
  }
});

// Submit payment for 5-month subscription
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
        service: "Yuno App Subscription API",
      });
    }

    const plan = await sql`
      SELECT * FROM subscription_plans WHERE id = ${plan_id} AND is_active = true
    `;

    if (plan.length === 0) {
      return res.status(404).json({
        error: "Subscription plan not found",
        service: "Yuno App Subscription API",
      });
    }

    // Convert to numbers for comparison
    const submittedAmount = parseFloat(amount);
    const planPrice = parseFloat(plan[0].price);

    if (submittedAmount !== planPrice) {
      return res.status(400).json({
        error: `Amount must be exactly ${planPrice} for this plan`,
        service: "Yuno App Subscription API",
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

    // Mark trial as used when user purchases subscription
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
      isPro: false, // Still not Pro until admin approves
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error submitting payment:", error);
    res.status(500).json({
      error: "Failed to submit payment: " + error.message,
      service: "Yuno App Subscription API",
    });
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

    res.json({
      payments,
      service: "Yuno App Subscription API",
    });
  } catch (error) {
    console.error("Error fetching payment history:", error);
    res.status(500).json({
      error: "Failed to fetch payment history",
      service: "Yuno App Subscription API",
    });
  }
});

export default router;
