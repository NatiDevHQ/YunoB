import express from "express";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

const router = express.Router();

// Simple auth check endpoint
router.get("/check", ClerkExpressRequireAuth(), (req, res) => {
  res.json({
    authenticated: true,
    service: "Yuno App Auth API",
    user: {
      id: req.auth.userId,
      email: req.auth.sessionClaims?.email,
    },
  });
});

// Get user profile
router.get("/profile", ClerkExpressRequireAuth(), (req, res) => {
  res.json({
    service: "Yuno App Auth API",
    user_id: req.auth.userId,
    email: req.auth.sessionClaims?.email,
    name: req.auth.sessionClaims?.name,
  });
});

// Health check
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "Yuno App Auth API",
    timestamp: new Date().toISOString(),
    features: {
      clerk_integration: true,
      user_authentication: true,
    },
  });
});

export default router;
