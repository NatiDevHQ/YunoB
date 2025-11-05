import express from "express";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

const router = express.Router();

// Simple auth check endpoint
router.get("/check", ClerkExpressRequireAuth(), (req, res) => {
  res.json({
    authenticated: true,
    user: {
      id: req.auth.userId,
    },
  });
});

// Get user profile (if needed)
router.get("/profile", ClerkExpressRequireAuth(), (req, res) => {
  res.json({
    user_id: req.auth.userId,
    email: req.auth.sessionClaims?.email,
    name: req.auth.sessionClaims?.name,
  });
});

export default router;
