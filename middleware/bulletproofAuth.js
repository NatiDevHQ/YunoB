import { createClerkClient } from "@clerk/clerk-sdk-node";

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

console.log("🔐 Yuno App Clerk Auth - Ready");

// Custom requireAuth that returns JSON errors
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required",
        message: "Bearer token required in Authorization header",
      });
    }

    const token = authHeader.substring(7);

    if (!token.startsWith("eyJ")) {
      return res.status(401).json({
        error: "Invalid token format",
        message: "Token must be a valid JWT",
      });
    }

    // Verify the token with Clerk
    try {
      const session = await clerkClient.verifyToken(token);
      req.auth = { userId: session.sub };
      console.log("✅ Token verified for user:", session.sub);
      next();
    } catch (verifyError) {
      console.log("❌ Token verification failed:", verifyError.message);
      return res.status(401).json({
        error: "Invalid token",
        message: "Token verification failed",
      });
    }
  } catch (error) {
    console.error("🔑 Auth middleware error:", error);
    return res.status(500).json({
      error: "Authentication error",
      message: "Internal authentication failure",
    });
  }
};

export const getUserId = async (req, res, next) => {
  try {
    if (!req.auth || !req.auth.userId) {
      return res.status(401).json({
        error: "User ID not found",
        message: "Authentication data missing",
      });
    }

    req.user_id = req.auth.userId;
    console.log(`👤 Yuno App - Using user ID: ${req.user_id}`);
    next();
  } catch (error) {
    console.error("❌ User ID processing error:", error);
    return res.status(500).json({
      error: "User processing failed",
      message: "Failed to process user information",
    });
  }
};
